const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');

if (fs.existsSync('.env')) {
	require('dotenv').config();
}

const os = require('os');

const { BotLogs, COLOR } = require('./backend/bot/bot_functions.js');
const { BLOCK_EXIT_CODE, BLOCK_COOLDOWN_MS } = require('./adapters/discord/rate-limit.js');

// The supervisor is the only thing here that outlives its children, which makes
// it the only thing that can record why one of them died. A bot exiting on a
// Cloudflare block cannot reliably write its own obituary — `process.exit()` is
// immediate, and its logs were only ever in memory. See adapters/health/health-log.js.
const healthLog = require('./adapters/health/health-log.js');
const SUPERVISOR = `${os.hostname()}#${process.pid}`;

// PORT is what a cloud host injects, and it is the one port it routes public
// traffic to. It has to go to Next, because Next is the site: it serves every
// page and proxies /api/* through to Express itself (see next.config.js). Give
// it to Express instead and Next ends up on an internal port nobody can reach,
// the public URL lands on Express's `/`, and the browser is redirected to
// FRONTEND_URL — which defaults to localhost. That is the "the deployed site
// sends me to localhost" bug, and this line is where it starts.
//
// Express keeps a fixed internal port. Nothing outside the box talks to it.
const NEXT_PORT = process.env.NEXT_PORT || process.env.PORT || 3000;
const EXPRESS_PORT = process.env.EXPRESS_PORT || 3001;

let webProcess = null;
let botProcess = null;
let nextProcess = null;

// A child that dies on boot used to come back three seconds later, forever. For
// the bot that is not a restart policy, it is a denial-of-service against
// Discord from our own IP: every attempt is a fresh gateway identify, and once
// Cloudflare starts blocking us each retry extends the block. So restarts back
// off — 3s, 6s, 12s, up to five minutes — and the delay resets only once a
// child has proved it can stay up for a minute.
const RESTART_BASE_MS = 3000;
const RESTART_MAX_MS = 5 * 60 * 1000;
const HEALTHY_UPTIME_MS = 60 * 1000;

const restarts = Object.create(null);

// The block is on the IP, so it belongs to the whole box — but each child holds
// its own guard in memory, and a child that restarts comes back believing
// nothing is wrong. That is how a fifteen-minute cooldown turned into an
// afternoon: the web process would crash, come up with a clean guard, and start
// sending people to Discord again inside the same block.
//
// The supervisor is the only thing here that outlives its children, so it is
// where the deadline lives. Whichever child sees the refusal first reports it,
// every other child is told at once, and a child that starts while the deadline
// is still in the future is told as soon as it is forked.
let discordBlockedUntil = 0;

function discordBlockRemainingMs() {
	return Math.max(0, discordBlockedUntil - Date.now());
}

function tellChildAboutBlock(child) {
	if (!child || !child.connected || discordBlockRemainingMs() <= 0) return;
	try {
		child.send({ type: 'discord_block', untilMs: discordBlockedUntil });
	}
	catch {}
}

function noteDiscordBlock(untilMs, source) {
	const stamp = Number(untilMs) || 0;
	if (stamp <= discordBlockedUntil) return;

	const first = discordBlockRemainingMs() <= 0;
	discordBlockedUntil = stamp;
	if (first) {
		logMaster('System', `${COLOR.red}Discord has blocked this server's IP (reported by ${source}). Pausing every Discord call for ${Math.round(discordBlockRemainingMs() / 60000)} minutes — see DISCORD-RATE-LIMITS.md.`);
	}

	// Everyone, including the reporter: adopt() ignores a deadline it already
	// has, so telling it twice costs nothing and forgetting one is the bug.
	for (const child of [webProcess, botProcess]) tellChildAboutBlock(child);
}

function scheduleRestart(name, start, startedAt, exitCode) {
	const state = restarts[name] || (restarts[name] = { attempts: 0 });

	if (Date.now() - startedAt >= HEALTHY_UPTIME_MS) {
		state.attempts = 0;
	}

	let delay = Math.min(RESTART_BASE_MS * 2 ** state.attempts, RESTART_MAX_MS);
	state.attempts += 1;

	// The bot exits with this code when Discord has blocked our IP. Restarting
	// into a block is the one thing guaranteed to make it last longer, so this
	// case ignores the backoff curve and simply waits the block out.
	if (exitCode === BLOCK_EXIT_CODE) {
		noteDiscordBlock(Date.now() + BLOCK_COOLDOWN_MS, name);
		delay = Math.max(delay, BLOCK_COOLDOWN_MS);
		logMaster('System', `${COLOR.red}Holding ${name} down for ${Math.round(delay / 60000)} minutes rather than retrying into the block.`);
		// The child could not write this itself: the block is what killed it.
		// Without this row the only trace is a gap in the audit history exactly
		// BLOCK_COOLDOWN_MS wide, which is not evidence of anything.
		healthLog.record({
			kind: 'block_hold',
			instance: SUPERVISOR,
			service: name,
			detail: `${name} exited with BLOCK_EXIT_CODE; held down for ${Math.round(delay / 60000)} minutes`,
		});
	}
	else if (name === 'Discord Bot' && state.attempts >= 3 && exitCode !== 0) {
		noteDiscordBlock(Date.now() + BLOCK_COOLDOWN_MS, name);
		delay = Math.max(delay, BLOCK_COOLDOWN_MS);
		logMaster('System', `${COLOR.red}Discord Bot failed to connect ${state.attempts} times in a row. Pausing connections for ${Math.round(delay / 60000)} minutes to let Cloudflare limits reset.`);
	}
	else if (name === 'Discord Bot' && discordBlockRemainingMs() > 0) {
		// The bot did not exit *because* of the block, but coming back now means
		// a fresh gateway IDENTIFY into an IP Cloudflare is refusing, which
		// restarts the clock. Whatever killed it will still be there afterwards.
		delay = Math.max(delay, discordBlockRemainingMs());
		logMaster('System', `${COLOR.yellow}Discord is still blocking this IP, so ${name} waits ${Math.round(delay / 60000)} more minutes before reconnecting.`);
	}

	logMaster('System', `${COLOR.yellow}Restarting ${name} in ${Math.round(delay / 1000)}s (attempt ${state.attempts}).`);
	setTimeout(start, delay);
}

function logMaster(host, msg) {
	BotLogs(host, msg);
	if (webProcess && webProcess.connected) {
		const now = new Date();
		const now_hours = now.getHours().toString().padStart(2, '0');
		const now_mins = now.getMinutes().toString().padStart(2, '0');
		const now_seconds = now.getSeconds().toString().padStart(2, '0');
		const timeStr = `${now_hours}:${now_mins}:${now_seconds}`;
		const categoryLabel = host === 'Web' ? 'Web' : 'System';
		const cleanMsg = typeof msg === 'string' ? msg.replace(/\x1b\[[0-9;]*m/g, '') : String(msg);
		try {
			webProcess.send({
				type: 'log_entry',
				log: {
					timestamp: timeStr,
					category: categoryLabel,
					host: categoryLabel,
					message: cleanMsg,
				},
			});
		}
		catch {}
	}
}

function startWeb() {
	logMaster('System', `${COLOR.cyan}Starting Express REST API process (Port ${EXPRESS_PORT})...`);
	const startedAt = Date.now();
	webProcess = fork(path.join(__dirname, 'backend', 'web', 'web.js'), [], {
		stdio: 'inherit',
		env: {
			...process.env,
			EXPRESS_PORT: String(EXPRESS_PORT),
		},
	});

	tellChildAboutBlock(webProcess);

	webProcess.on('message', (message) => {
		if (!message) return;
		if (message.type === 'discord_block') {
			noteDiscordBlock(message.untilMs, 'the web process');
		}
		else if (message.type === 'discord_block_query') {
			// Asked on boot. A child that starts mid-block has to hear about it
			// before it serves its first request, and asking is the only way to
			// be sure of that — a message pushed at a child that has not
			// attached its listener yet is simply dropped.
			tellChildAboutBlock(webProcess);
		}
		else if (message.type === 'clear_discord_block') {
			discordBlockedUntil = 0;
			logMaster('System', `${COLOR.green}Discord block guard manually reset by Developer.`);
			for (const child of [webProcess, botProcess]) {
				if (child && child.connected) child.send({ type: 'clear_discord_block' });
			}
		}
		else if (message.type === 'ping_bot') {
			if (botProcess && botProcess.connected) {
				botProcess.send({ type: 'ping' });
			}
		}
		else if (message.target === 'bot') {
			if (botProcess && botProcess.connected) {
				botProcess.send(message);
			}
		}
	});

	webProcess.on('exit', (code, signal) => {
		logMaster('System', `${COLOR.red}Express REST API process exited with code ${code} (signal: ${signal}).`);
		scheduleRestart('Express REST API', startWeb, startedAt, code);
	});
}

function startNext() {
	logMaster('System', `${COLOR.cyan}Starting Next.js App Router Frontend server (Port ${NEXT_PORT})...`);
	const startedAt = Date.now();
	const nextBin = path.join(__dirname, 'node_modules', 'next', 'dist', 'bin', 'next');

	// Running `next dev` on a deploy is not a cosmetic mistake. It compiles on
	// demand and holds far more memory, so on a small instance it gets killed,
	// the loop below restarts it, and every restart of this supervisor's
	// children is another gateway IDENTIFY and another round of boot-time
	// Discord calls. From Cloudflare's side a crash loop caused by the wrong
	// Next mode is indistinguishable from a bot hammering the API.
	//
	// NODE_ENV stays the decision, because a developer who has run `npm run
	// build` once should still get `next dev` locally. But PORT is injected by
	// the host and never set by hand here, so PORT plus a build present is a
	// deploy that forgot to say so — and that is worth saying out loud.
	const deployed = Boolean(process.env.PORT);
	const built = fs.existsSync(path.join(__dirname, '.next', 'BUILD_ID'));
	const mode = (process.env.NODE_ENV === 'production' || (deployed && built)) ? 'start' : 'dev';
	if (mode === 'start' && process.env.NODE_ENV !== 'production') {
		logMaster('System', `${COLOR.yellow}NODE_ENV is not "production" but this looks like a deploy with a build present, so Next is starting in production mode. Set NODE_ENV=production to make it explicit.`);
	}
	else if (mode === 'dev' && deployed) {
		logMaster('System', `${COLOR.red}Running "next dev" on a deploy: no production build was found. It will use several times the memory and may be killed and restarted repeatedly, which is Discord rate-limit territory. Run "npm run build" during deploy and set NODE_ENV=production.`);
	}
	nextProcess = fork(nextBin, [mode, '-p', String(NEXT_PORT)], {
		stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
		env: {
			...process.env,
			EXPRESS_PORT: String(EXPRESS_PORT),
		},
	});

	nextProcess.stdout.on('data', (data) => {
		const lines = data.toString().split('\n');
		for (let line of lines) {
			line = line.trim();
			if (!line) continue;
			const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '');
			if (cleanLine.includes('GET ') || cleanLine.includes('POST ') || cleanLine.includes('200 in') || cleanLine.includes('304 in')) {
				logMaster('Web', cleanLine);
			}
			else {
				logMaster('System', cleanLine);
			}
		}
	});

	nextProcess.stderr.on('data', (data) => {
		const lines = data.toString().split('\n');
		for (let line of lines) {
			line = line.trim();
			if (!line) continue;
			const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '');
			logMaster('System', cleanLine);
		}
	});

	nextProcess.on('exit', (code, signal) => {
		logMaster('System', `${COLOR.red}Next.js server exited with code ${code} (signal: ${signal}).`);
		scheduleRestart('Next.js', startNext, startedAt, code);
	});
}

function startBot() {
	logMaster('System', `${COLOR.cyan}Starting Discord Bot process...`);
	const startedAt = Date.now();
	// Every bot start is a fresh gateway IDENTIFY, and that is the number this
	// deploy needs to be able to count. `bot:instances` can only see starts that
	// went on to write an audit row, so a bot that dies during boot — the exact
	// case that matters — is invisible to it. This row is not.
	healthLog.record({ kind: 'boot', instance: SUPERVISOR, service: 'Discord Bot' });
	botProcess = fork(path.join(__dirname, 'backend', 'bot', 'bot.js'), [], {
		stdio: 'inherit',
		env: {
			...process.env,
			EXPRESS_PORT: String(EXPRESS_PORT),
		},
	});

	tellChildAboutBlock(botProcess);

	botProcess.on('message', (message) => {
		if (!message) return;
		if (message.type === 'discord_block') {
			noteDiscordBlock(message.untilMs, 'the bot');
			return;
		}
		if (message.type === 'discord_block_query') {
			tellChildAboutBlock(botProcess);
			return;
		}
		if (message.target === 'web') {
			if (webProcess && webProcess.connected) {
				webProcess.send(message);
			}
		}
	});

	botProcess.on('exit', (code, signal) => {
		logMaster('System', `${COLOR.red}Discord Bot process exited with code ${code} (signal: ${signal}).`);
		healthLog.record({
			kind: 'exit',
			instance: SUPERVISOR,
			service: 'Discord Bot',
			detail: `code ${code}, signal ${signal}, after ${Math.round((Date.now() - startedAt) / 1000)}s of uptime`,
		});
		scheduleRestart('Discord Bot', startBot, startedAt, code);
	});
}

// A fresh supervisor means the whole service started: a deploy, a crash, or —
// on a plan that sleeps — a wake. Those are indistinguishable in the audit log
// and each one costs a full round of boot-time Discord work, so counting them
// is the first step to reducing them.
healthLog.record({
	kind: 'boot',
	instance: SUPERVISOR,
	service: 'supervisor',
	detail: `node ${process.version} on ${process.platform}, NODE_ENV=${process.env.NODE_ENV || 'unset'}`,
});

startWeb();
startNext();
startBot();
