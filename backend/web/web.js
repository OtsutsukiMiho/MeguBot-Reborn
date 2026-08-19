const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

if (fs.existsSync('.env')) {
	require('dotenv').config();
}

const { BotLogs, COLOR, parseReactionRolesMap, getRecentLogs, addLogEntry } = require('../bot/bot_functions.js');
const database = require('../database/database.js');
const core = require('../../core/index.js');
const meguApi = require('../../adapters/http/megu-api.js');
const discordOAuth = require('../../adapters/discord/oauth.js');
const { createBlockGuard } = require('../../adapters/discord/rate-limit.js');

// When Cloudflare blocks our IP, every sign-in fails at the token exchange. The
// old behaviour was a bare 400 with "Failed to exchange code", which reads to a
// user as "click login again" — and each of those clicks is another round trip
// to Discord that extends the block. This remembers the block instead, so we
// stop sending anyone to Discord until it has had time to clear.
const discordBlock = createBlockGuard({
	onTrip: (seconds) => BotLogs('SYSTEM', `${COLOR.red}Discord has blocked this server's IP. Pausing all Discord sign-ins for ${Math.round(seconds / 60)} minutes — see DISCORD-RATE-LIMITS.md.`),
});

core.setLogger((scope, message) => BotLogs(scope, message));

let config = {};
try {
	config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
}
catch {
	// Ignore
}

const app = express();
// Not process.env.PORT. That belongs to Next, which is the public-facing
// server; see the comment in index.js. Express is internal on a fixed port.
const PORT = process.env.EXPRESS_PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || `http://localhost:${process.env.NEXT_PORT || 3000}`;

// Where Discord sends the user back to. It used to default to Express's own
// port, which is wrong in every environment: the callback is reached through
// the site, not through the internal API port. Deriving it from FRONTEND_URL
// means the one variable that names the site names it here too, and setting
// DISCORD_REDIRECT_URI is only needed when the callback genuinely lives
// somewhere else.
//
// Whatever this resolves to must also be registered in the Discord Developer
// Portal under OAuth2 → Redirects, or Discord rejects the request outright.
const OAUTH_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `${FRONTEND_URL}/api/auth/callback`;

// Each of these fails silently and late. On a cloud host that means hearing
// about it from a user rather than from a log, so say it once at boot instead.
if (process.env.NODE_ENV === 'production') {
	const missing = [];

	if (!process.env.FRONTEND_URL) {
		missing.push(`FRONTEND_URL — everything that has to name the site from outside falls back to ${FRONTEND_URL}, which no browser can reach. The Discord login would return to ${OAUTH_REDIRECT_URI}, and payment reminder DMs go out with no link at all.`);
	}

	// The client id falls back to config.json. The secret has no fallback
	// anywhere, and an unset one is sent to Discord as the string "undefined",
	// so signing in gets all the way to the callback and only then fails.
	if (!process.env.DISCORD_CLIENT_SECRET && !config.clientSecret && !config.client_secret) {
		missing.push('DISCORD_CLIENT_SECRET — unlike the client id this has no config.json fallback. Signing in will reach Discord, come back, and fail at the token exchange with invalid_client.');
	}

	if (!process.env.SESSION_SECRET) {
		missing.push('SESSION_SECRET — a random one is generated per boot, so every restart signs everyone out, and two instances never share a session at all.');
	}

	for (const line of missing) {
		BotLogs('SYSTEM', `${COLOR.red}Missing configuration: ${line}`);
	}
}

// A cloud host terminates TLS at its proxy and forwards plain HTTP, so without
// this Express believes the connection is insecure. The session cookie below is
// Secure in production, and a Secure cookie on a connection Express thinks is
// plain HTTP is silently never sent — the user completes the Discord login and
// lands back logged out, with nothing in the logs to say why.
if (process.env.NODE_ENV === 'production') {
	app.set('trust proxy', 1);
}

// One route carries an image and every other route carries a form's worth of
// fields, so the ceiling is raised for that route alone rather than globally.
// A payment slip is a photo the browser has already shrunk; the rest of the
// API has no business accepting megabytes.
//
// This has to sit above the general parser: body-parser marks a request as
// read, so whichever one runs first is the one whose limit applies, and the
// general one would reject a slip with a 413 before the router ever sees it.
const slipBody = express.json({ limit: '4mb' });
app.use((req, res, next) => (
	req.method === 'POST' && req.path.startsWith('/api/megu/') && req.path.endsWith('/slip')
		? slipBody(req, res, next)
		: next()
));

app.use(express.json({ strict: false }));
app.use(express.urlencoded({ extended: true }));

function parseAutomodConfig(raw) {
	const defaultConfig = {
		antispam_enabled: false,
		antiinvite_enabled: false,
		badwords_enabled: false,
		mention_spam_enabled: false,
		action: 'delete',
		badwords_list: [],
	};
	if (!raw) return defaultConfig;
	let parsed = raw;
	if (typeof parsed === 'string') {
		try { parsed = JSON.parse(parsed); } catch { return defaultConfig; }
	}
	if (typeof parsed === 'string') {
		try { parsed = JSON.parse(parsed); } catch { return defaultConfig; }
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return defaultConfig;
	}
	return { ...defaultConfig, ...parsed };
}

// Express JSON Parsing Error Handler (Catches double-encoded or malformed JSON payloads)
app.use((err, req, res, next) => {
	if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
		BotLogs('SYSTEM', `Warning: Intercepted malformed JSON payload from client (${req.ip}): ${err.message}`);
		return res.status(400).json({ error: 'Malformed or double-encoded JSON request payload.' });
	}
	next();
});

app.use(cookieParser());

// Security Response Headers
app.use((req, res, next) => {
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('X-Frame-Options', 'DENY');
	res.setHeader('X-XSS-Protection', '1; mode=block');
	res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
	next();
});

app.use(express.static(path.join(__dirname, '../../public')));



const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

app.use(session({
	secret: SESSION_SECRET,
	resave: false,
	saveUninitialized: false,
	cookie: {
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		maxAge: 24 * 60 * 60 * 1000,
	},
}));

// Session Timeout & Hijack Fingerprint Security Middleware
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes idle timeout
const ABSOLUTE_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours absolute max duration

// An expired session lands the browser on the home page, where there is a login
// button, rather than straight into /api/auth/login. That route redirects to
// Discord, and because the app is already authorised Discord bounces back with
// a fresh code — so the old behaviour turned every timed-out background tab
// into a full OAuth round trip that nobody asked for. The logs show the first
// token exchange arriving seven seconds after a timeout, which is that.
// Sign-in has to be a deliberate click.
const EXPIRED_SESSION_LANDING = '/';

app.use((req, res, next) => {
	if (req.session && req.session.user) {
		const now = Date.now();
		const userAgent = req.headers['user-agent'] || '';

		// 1. Session Fingerprint Verification (User-Agent mismatch detection)
		if (req.session.userAgent && req.session.userAgent !== userAgent) {
			BotLogs('SYSTEM', `Security Warning: User-Agent mismatch for user ${req.session.user.username}. Possible session hijacking. Terminating session.`);
			return req.session.destroy(() => {
				res.clearCookie('connect.sid');
				if (req.path.startsWith('/api/')) {
					return res.status(401).json({ error: 'Security Error: User-Agent mismatch detected. Please log in again.' });
				}
				res.redirect(EXPIRED_SESSION_LANDING);
			});
		}

		// 2. Inactivity Timeout (30 minutes of no requests)
		if (req.session.lastActivity && (now - req.session.lastActivity > IDLE_TIMEOUT_MS)) {
			BotLogs('SYSTEM', `Session Timeout: User ${req.session.user.username} inactive for 30+ minutes. Session terminated.`);
			return req.session.destroy(() => {
				res.clearCookie('connect.sid');
				if (req.path.startsWith('/api/')) {
					return res.status(401).json({ error: 'Session Expired: Logged out due to 30 minutes of inactivity.' });
				}
				res.redirect(EXPIRED_SESSION_LANDING);
			});
		}

		// 3. Absolute Session Lifetime Timeout (24 hours)
		if (req.session.loginTimestamp && (now - req.session.loginTimestamp > ABSOLUTE_TIMEOUT_MS)) {
			BotLogs('SYSTEM', `Session Timeout: User ${req.session.user.username} reached max 24h lifetime limit.`);
			return req.session.destroy(() => {
				res.clearCookie('connect.sid');
				if (req.path.startsWith('/api/')) {
					return res.status(401).json({ error: 'Session Expired: Maximum session lifetime reached (24h). Please log in again.' });
				}
				res.redirect(EXPIRED_SESSION_LANDING);
			});
		}

		req.session.lastActivity = now;
	}
	next();
});

const pendingIpcRequests = new Map();

process.on('message', (msg) => {
	if (!msg) return;
	if (msg.type === 'log_entry' && msg.log) {
		addLogEntry(msg.log);
	}
	else if (msg.reqId && pendingIpcRequests.has(msg.reqId)) {
		const { resolve } = pendingIpcRequests.get(msg.reqId);
		pendingIpcRequests.delete(msg.reqId);
		resolve(msg);
	}
});

function sendIpcRequest(payload, timeoutMs = 3000) {
	return new Promise((resolve) => {
		const reqId = Date.now().toString(36) + Math.random().toString(36).substring(2);
		const timeout = setTimeout(() => {
			pendingIpcRequests.delete(reqId);
			resolve(null);
		}, timeoutMs);

		pendingIpcRequests.set(reqId, {
			resolve: (data) => {
				clearTimeout(timeout);
				resolve(data);
			},
		});

		if (process.send) {
			process.send({ ...payload, target: 'bot', reqId });
		}
		else {
			clearTimeout(timeout);
			pendingIpcRequests.delete(reqId);
			resolve(null);
		}
	});
}

app.use('/api/megu', meguApi.router({
	botPresence: async (guildIds) => {
		const ipcRes = await sendIpcRequest({ type: 'check_guilds_presence', guildIds });
		const presence = (ipcRes && ipcRes.presence) ? ipcRes.presence : {};
		return Object.keys(presence).filter(id => presence[id]);
	},
	notifyPayment: async ({ recipients, message }) => {
		await sendIpcRequest({ type: 'payment_notice', recipients, message });
	},
}));

function requireAdminGuild(req, res, next) {
	if (!req.session || !req.session.user || !req.session.adminGuilds) {
		return res.status(401).json({ error: 'Unauthorized. Please log in with Discord.' });
	}

	const guildId = req.params.guildId;
	if (typeof guildId !== 'string' || !/^\d{17,20}$/.test(guildId)) {
		return res.status(400).json({ error: 'Invalid server ID format.' });
	}

	const hasAccess = req.session.adminGuilds.some(g => g.id === guildId);
	if (!hasAccess) {
		BotLogs('SYSTEM', `Security Warning: Unauthorized access attempt to Guild ID ${guildId} by User ${req.session.user.username} (${req.session.user.id}).`);
		return res.status(403).json({ error: 'Forbidden. You do not have Administrator or Manage Server permissions for this server.' });
	}
	next();
}

app.get(['/health', '/api/health'], (req, res) => {
	res.status(200).send('OK');
});

app.get('/api/health-stats', async (req, res) => {
	let version = '1.0.0';
	try {
		const cfg = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
		version = cfg.version || '1.0.0';
	}
	catch {}

	let botStats = null;

	// 1. Try Live IPC Request to Bot Process
	try {
		const ipcRes = await sendIpcRequest({ type: 'get_bot_stats' }, 1500);
		if (ipcRes && ipcRes.success && ipcRes.stats) {
			botStats = {
				status: 'online',
				ping: ipcRes.stats.pingMs || 0,
				readyTimestamp: ipcRes.stats.readyTimestamp || Date.now(),
				memory: { rss: `${ipcRes.stats.memoryRssMB || 0} MB` },
				version,
			};
		}
	}
	catch {}

	// 2. Multi-Path Fallback for bot-stats.json
	if (!botStats) {
		const candidatePaths = [
			path.join(process.cwd(), 'bot-stats.json'),
			path.join(__dirname, '../../bot-stats.json'),
			path.join(__dirname, '../bot-stats.json'),
			path.join(__dirname, 'bot-stats.json'),
		];

		for (const statsPath of candidatePaths) {
			if (fs.existsSync(statsPath)) {
				try {
					const rawData = fs.readFileSync(statsPath, 'utf8');
					const parsed = JSON.parse(rawData);
					if (parsed && parsed.timestamp && (Date.now() - parsed.timestamp < 15000)) {
						botStats = parsed;
						break;
					}
				}
				catch {}
			}
		}
	}

	const memoryUsage = process.memoryUsage();
	const rssMB = `${(memoryUsage.rss / 1024 / 1024).toFixed(1)} MB`;

	if (botStats) {
		return res.json({
			status: botStats.status || 'online',
			uptime: botStats.uptime || 0,
			readyTimestamp: botStats.readyTimestamp || Date.now(),
			ping: botStats.ping !== undefined ? botStats.ping : 0,
			version: botStats.version || version,
			nodeVersion: process.version,
			platform: process.platform,
			memory: {
				rss: botStats.memory?.rss || rssMB,
				heapUsed: botStats.memory?.heapUsed || '-',
			},
		});
	}

	// 3. Fallback to Express Web Process Telemetry
	res.json({
		status: 'online',
		uptime: Math.floor(process.uptime() * 1000),
		readyTimestamp: Date.now() - Math.floor(process.uptime() * 1000),
		ping: 1,
		version: version,
		nodeVersion: process.version,
		platform: process.platform,
		memory: {
			rss: rssMB,
			heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(1)} MB`,
		},
	});
});

app.post('/api/ping', (req, res) => {
	BotLogs('SYSTEM', 'Manual Ping Triggered from Web Client! Forwarding to Bot Process...');
	if (process.send) {
		process.send({ type: 'ping_bot' });
		res.json({ success: true, message: 'Ping command sent to bot process successfully.' });
	}
	else {
		res.status(500).json({ success: false, message: 'No IPC channel with main process.' });
	}
});

// Shown instead of sending anyone to Discord while we are blocked. It has no
// retry button on purpose: the whole point is that clicking again is what makes
// the outage last longer.
function sendBlockedPage(res) {
	const minutes = Math.max(1, Math.ceil(discordBlock.retryAfterSeconds() / 60));
	res.status(503).set('Retry-After', String(discordBlock.retryAfterSeconds())).send(`
		<!DOCTYPE html>
		<html>
		<head>
			<title>Discord is unavailable - Megu</title>
			<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">
			<style>
				body { background: #030712; color: #f3f4f6; font-family: 'Outfit', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
				.card { background: rgba(17, 24, 39, 0.85); border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 2.5rem; max-width: 500px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
				h2 { color: #fbbf24; font-size: 1.5rem; margin-top: 0; }
				p { color: #9ca3af; line-height: 1.6; }
			</style>
		</head>
		<body>
			<div class="card">
				<h2>⏳ Discord is rate limiting us</h2>
				<p>Discord is temporarily refusing requests from this server, so signing in cannot work right now. Nothing is wrong with your account.</p>
				<p><strong>Please try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.</strong> Reloading now will only make it last longer.</p>
			</div>
		</body>
		</html>
	`);
}

app.get('/api/auth/login', (req, res) => {
	const clientId = process.env.DISCORD_CLIENT_ID || config.clientId;
	const redirectUri = OAUTH_REDIRECT_URI;

	if (!clientId) {
		return res.status(500).send('Missing DISCORD_CLIENT_ID configuration.');
	}

	if (discordBlock.blocked()) {
		return sendBlockedPage(res);
	}

	const state = crypto.randomBytes(16).toString('hex');
	req.session.oauth2State = state;

	req.session.save((err) => {
		if (err) {
			BotLogs('SYSTEM', `Session save error on OAuth login: ${err.toString()}`);
		}
		const authUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify%20guilds&state=${state}`;
		res.redirect(authUrl);
	});
});

app.get('/api/auth/callback', async (req, res) => {
	const { code, state } = req.query;

	if (!state || (req.session.oauth2State && state !== req.session.oauth2State)) {
		return res.status(403).send(`
			<!DOCTYPE html>
			<html>
			<head>
				<title>Authentication Error - Megu</title>
				<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">
				<style>
					body { background: #030712; color: #f3f4f6; font-family: 'Outfit', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
					.card { background: rgba(17, 24, 39, 0.85); border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 2.5rem; max-width: 500px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
					h2 { color: #f87171; font-size: 1.5rem; margin-top: 0; }
					p { color: #9ca3af; line-height: 1.6; }
					.btn { display: inline-block; background: #6366f1; color: white; padding: 0.75rem 1.5rem; border-radius: 10px; text-decoration: none; font-weight: 600; margin-top: 1.5rem; }
				</style>
			</head>
			<body>
				<div class="card">
					<h2>🔑 Login Session Expired</h2>
					<p>Your authentication request expired or was interrupted. This can happen if the server was restarted while you were on the Discord authorization page.</p>
					<a href="/api/auth/login" class="btn">Try Logging In Again</a>
				</div>
			</body>
			</html>
		`);
	}
	delete req.session.oauth2State;

	if (!code) {
		return res.status(400).send('Missing authorization code.');
	}

	const clientId = process.env.DISCORD_CLIENT_ID || config.clientId;
	const clientSecret = process.env.DISCORD_CLIENT_SECRET || config.clientSecret || config.client_secret;
	const redirectUri = OAUTH_REDIRECT_URI;

	if (discordBlock.blocked()) {
		return sendBlockedPage(res);
	}

	try {
		const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				client_id: clientId,
				client_secret: clientSecret,
				grant_type: 'authorization_code',
				code: code.toString(),
				redirect_uri: redirectUri,
			}),
		});

		if (!tokenRes.ok) {
			const errText = await tokenRes.text();
			BotLogs('SYSTEM', `OAuth2 token exchange failed: ${errText}`);
			// A Cloudflare block is not this user's problem and not something a
			// retry fixes, so it gets its own answer and shuts sign-ins down.
			if (discordBlock.record(errText)) {
				return sendBlockedPage(res);
			}
			return res.status(400).send('Failed to exchange code for token with Discord.');
		}

		const tokenData = await tokenRes.json();
		const accessToken = tokenData.access_token;

		// These two were read as JSON without ever checking the status. A block
		// or a 401 arrived here as an error object, `userData.id` came out
		// undefined, and the session was written anyway — a logged-in user with
		// no identity. Both are checked now, and both feed the same guard.
		const userRes = await fetch('https://discord.com/api/v10/users/@me', {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (!userRes.ok) {
			const errText = await userRes.text();
			BotLogs('SYSTEM', `Discord profile read failed: ${errText}`);
			if (discordBlock.record(errText)) return sendBlockedPage(res);
			return res.status(502).send('Could not read your Discord profile.');
		}
		const userData = await userRes.json();

		const guildsRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (!guildsRes.ok) {
			const errText = await guildsRes.text();
			BotLogs('SYSTEM', `Discord guild list read failed: ${errText}`);
			if (discordBlock.record(errText)) return sendBlockedPage(res);
			return res.status(502).send('Could not read your Discord servers.');
		}
		const guildsData = await guildsRes.json();

		const adminGuilds = (Array.isArray(guildsData) ? guildsData : []).filter(g => {
			if (g.owner) return true;
			const permissions = BigInt(g.permissions || '0');
			const ADMINISTRATOR = 0x8n;
			const MANAGE_GUILD = 0x20n;
			return (permissions & ADMINISTRATOR) === ADMINISTRATOR || (permissions & MANAGE_GUILD) === MANAGE_GUILD;
		});

		// Mirror the Discord login into a Megu account so activities have an
		// owner, and adopt any participant rows created for this person before
		// they ever signed in.
		let meguUserId = null;
		try {
			const { user: meguUser } = await core.users.loginWithIdentity(discordOAuth.toIdentityProfile(userData));
			meguUserId = meguUser.id;
			const { claimed } = await core.users.claimParticipants(meguUserId);
			if (claimed > 0) {
				BotLogs('Megu', `${COLOR.white}${userData.username}${COLOR.reset} claimed ${COLOR.white}${claimed}${COLOR.reset} past activities`);
			}
		}
		catch (error) {
			BotLogs('Megu', `${COLOR.red}Could not create Megu account for ${userData.username}: ${error.message}`);
		}

		req.session.regenerate((err) => {
			if (err) {
				BotLogs('SYSTEM', `Session regenerate error: ${err.toString()}`);
			}

			req.session.user = {
				id: userData.id,
				username: userData.username,
				discriminator: userData.discriminator,
				global_name: userData.global_name || userData.username,
				avatar: userData.avatar,
			};
			req.session.meguUserId = meguUserId;

			// Every guild, not just the manageable ones: an ordinary member
			// still sees a server Megu lives in, just without the settings.
			req.session.allGuilds = (Array.isArray(guildsData) ? guildsData : []).map(g => ({
				id: g.id,
				name: g.name,
				icon: g.icon,
				permissions: g.permissions,
			}));

			req.session.adminGuilds = adminGuilds.map(g => ({
				id: g.id,
				name: g.name,
				icon: g.icon,
				banner: g.banner,
				splash: g.splash,
				owner: g.owner,
				permissions: g.permissions,
			}));

			req.session.userAgent = req.headers['user-agent'] || '';
			req.session.loginTimestamp = Date.now();
			req.session.lastActivity = Date.now();

			req.session.save(() => {
				BotLogs('Web', `User ${COLOR.white}${userData.username}${COLOR.reset} authenticated with ${COLOR.white}${adminGuilds.length}${COLOR.reset} admin servers`);
				res.redirect('/activities');
			});
		});
	}
	catch (error) {
		BotLogs('SYSTEM', `OAuth2 Callback error: ${error.toString()}`);
		// A block can also arrive as a thrown fetch failure rather than a
		// response, so the guard gets a look at this path too.
		if (discordBlock.record(error)) {
			return sendBlockedPage(res);
		}
		res.status(500).send('An unexpected error occurred during Discord authentication.');
	}
});

app.get('/api/auth/me', (req, res) => {
	if (req.session && req.session.user) {
		res.json({
			loggedIn: true,
			user: req.session.user,
		});
	}
	else {
		res.json({
			loggedIn: false,
			user: null,
		});
	}
});

app.post('/api/auth/logout', (req, res) => {
	if (req.session) {
		req.session.destroy(() => {
			res.clearCookie('connect.sid');
			res.json({ success: true });
		});
	}
	else {
		res.json({ success: true });
	}
});

app.get('/api/guilds', async (req, res) => {
	if (!req.session || !req.session.user || !req.session.adminGuilds) {
		return res.status(401).json({ error: 'Unauthorized. Please log in with Discord.' });
	}

	const userGuilds = req.session.adminGuilds;
	const guildIds = userGuilds.map(g => g.id);

	const ipcRes = await sendIpcRequest({ type: 'check_guilds_presence', guildIds });

	// A null response means the bot could not be reached at all — no IPC channel
	// (web.js started standalone instead of forked by index.js), the bot process
	// down, or the request timed out. That is NOT the same as the bot being
	// absent from every server, so it is reported separately rather than
	// collapsed into isBotInGuild: false for all of them.
	const botOnline = ipcRes !== null;
	const presenceMap = (ipcRes && ipcRes.presence) ? ipcRes.presence : {};
	const guildInfoMap = (ipcRes && ipcRes.guildInfo) ? ipcRes.guildInfo : {};

	if (!botOnline) {
		BotLogs('Web', `${COLOR.yellow}Guild presence unavailable — bot process unreachable. Servers will report an unknown state.`);
	}

	const clientId = process.env.DISCORD_CLIENT_ID || config.clientId;
	const enrichedGuilds = userGuilds.map(g => {
		const botInfo = guildInfoMap[g.id] || {};
		const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands&guild_id=${g.id}`;
		return {
			...g,
			banner: g.banner || botInfo.banner,
			splash: g.splash || botInfo.splash,
			memberCount: botInfo.memberCount,
			isBotInGuild: botOnline ? !!presenceMap[g.id] : null,
			inviteUrl,
		};
	});

	res.json({ success: true, botOnline, guilds: enrichedGuilds });
});

app.get('/api/guilds/:guildId', requireAdminGuild, async (req, res) => {
	const { guildId } = req.params;

	const botDetails = await sendIpcRequest({ type: 'get_guild_details', guildId }, 8000);
	const vars = await database.getAllGuildVars(guildId);
	const sessionGuild = (req.session.adminGuilds || []).find(g => String(g.id) === String(guildId));
	const guildName = (botDetails && botDetails.name) || (sessionGuild && sessionGuild.name) || 'Discord Server';
	const guildIcon = (botDetails && botDetails.icon) || (sessionGuild && sessionGuild.icon) || null;

	res.json({
		success: true,
		guildId,
		name: guildName,
		isBotInGuild: botDetails ? botDetails.exists : false,
		channels: (botDetails && botDetails.channels) || [],
		roles: (botDetails && botDetails.roles) || [],
		members: (botDetails && botDetails.members) || [],
		icon: guildIcon,
		config: {
			welcome_channel_id: vars.welcome_channel_id || null,
			welcome_message_template: vars.welcome_message_template || '',
			welcome_mode: vars.welcome_mode || 'text',
			welcome_embed: typeof vars.welcome_embed === 'string' ? (() => { try { return JSON.parse(vars.welcome_embed); } catch { return null; } })() : (vars.welcome_embed || null),
			leave_channel_id: vars.leave_channel_id || null,
			leave_message_template: vars.leave_message_template || '',
			leave_mode: vars.leave_mode || 'text',
			leave_embed: typeof vars.leave_embed === 'string' ? (() => { try { return JSON.parse(vars.leave_embed); } catch { return null; } })() : (vars.leave_embed || null),
			autorole_id: vars.autorole_id || null,
			autorole_ids: Array.isArray(vars.autorole_ids) ? vars.autorole_ids : (vars.autorole_id ? [vars.autorole_id] : []),
			bot_autorole_ids: Array.isArray(vars.bot_autorole_ids) ? vars.bot_autorole_ids : [],
			tts_channel_id: vars.tts_channel_id || null,
			tts_engine: vars.tts_engine || 'EDGE_TTS',
			tts_lang: vars.tts_lang || 'th',
			tts_voice: vars.tts_voice || 'th-TH-NiwatNeural',
			tts_ignore_prefix: vars.tts_ignore_prefix !== false,
			tts_max_length: vars.tts_max_length ? parseInt(vars.tts_max_length, 10) : 200,
			tts_antispam_enabled: vars.tts_antispam_enabled !== false,
			tts_antispam_max_messages: vars.tts_antispam_max_messages ? parseInt(vars.tts_antispam_max_messages, 10) : 3,
			tts_antispam_cooldown_seconds: vars.tts_antispam_cooldown_seconds ? parseInt(vars.tts_antispam_cooldown_seconds, 10) : 30,
			tts_afk_bringback_enabled: vars.tts_afk_bringback_enabled !== false,
			tts_vc_welcome_enabled: vars.tts_vc_welcome_enabled !== false,
			tts_vc_welcome_template: vars.tts_vc_welcome_template !== undefined ? vars.tts_vc_welcome_template : '{username} เข้าดิสมา',
			tts_vc_leave_enabled: vars.tts_vc_leave_enabled !== false,
			tts_vc_leave_template: vars.tts_vc_leave_template !== undefined ? vars.tts_vc_leave_template : '{username} ออกจากดิสแล้ว',
			honeypot_channel_id: vars.honeypot_channel_id || null,
			reaction_roles: parseReactionRolesMap(vars.reaction_roles),
			automod: parseAutomodConfig(vars.automod),
		},
	});
});

app.post('/api/guilds/:guildId/config', requireAdminGuild, async (req, res) => {
	const { guildId } = req.params;
	const {
		welcome_channel_id,
		welcome_message_template,
		welcome_mode,
		welcome_embed,
		leave_channel_id,
		leave_message_template,
		leave_mode,
		leave_embed,
		autorole_id,
		autorole_ids,
		bot_autorole_ids,
		tts_channel_id,
		tts_engine,
		tts_lang,
		tts_voice,
		tts_ignore_prefix,
		tts_max_length,
		tts_antispam_enabled,
		tts_antispam_max_messages,
		tts_antispam_cooldown_seconds,
		tts_afk_bringback_enabled,
		tts_vc_welcome_enabled,
		tts_vc_welcome_template,
		tts_vc_leave_enabled,
		tts_vc_leave_template,
		honeypot_channel_id,
	} = req.body || {};

	try {
		const oldVars = await database.getAllGuildVars(guildId);

		await database.setGuildVar(guildId, 'welcome_channel_id', welcome_channel_id || null);
		await database.setGuildVar(guildId, 'welcome_message_template', welcome_message_template || '');
		await database.setGuildVar(guildId, 'welcome_mode', welcome_mode || 'text');
		await database.setGuildVar(guildId, 'welcome_embed', typeof welcome_embed === 'object' && welcome_embed !== null ? JSON.stringify(welcome_embed) : (welcome_embed || ''));
		await database.setGuildVar(guildId, 'leave_channel_id', leave_channel_id || null);
		await database.setGuildVar(guildId, 'leave_message_template', leave_message_template || '');
		await database.setGuildVar(guildId, 'leave_mode', leave_mode || 'text');
		await database.setGuildVar(guildId, 'leave_embed', typeof leave_embed === 'object' && leave_embed !== null ? JSON.stringify(leave_embed) : (leave_embed || ''));
		await database.setGuildVar(guildId, 'autorole_id', autorole_id || (Array.isArray(autorole_ids) && autorole_ids[0] ? autorole_ids[0] : null));
		await database.setGuildVar(guildId, 'autorole_ids', Array.isArray(autorole_ids) ? autorole_ids : (autorole_id ? [autorole_id] : []));
		await database.setGuildVar(guildId, 'bot_autorole_ids', Array.isArray(bot_autorole_ids) ? bot_autorole_ids : []);
		await database.setGuildVar(guildId, 'tts_channel_id', tts_channel_id || null);
		await database.setGuildVar(guildId, 'tts_engine', tts_engine || 'EDGE_TTS');
		await database.setGuildVar(guildId, 'tts_lang', tts_lang || 'th');
		await database.setGuildVar(guildId, 'tts_voice', tts_voice || 'th-TH-NiwatNeural');
		await database.setGuildVar(guildId, 'tts_ignore_prefix', tts_ignore_prefix !== false);
		await database.setGuildVar(guildId, 'tts_max_length', tts_max_length ? parseInt(tts_max_length, 10) : 200);
		await database.setGuildVar(guildId, 'tts_antispam_enabled', tts_antispam_enabled !== false);
		await database.setGuildVar(guildId, 'tts_antispam_max_messages', tts_antispam_max_messages ? parseInt(tts_antispam_max_messages, 10) : 3);
		await database.setGuildVar(guildId, 'tts_antispam_cooldown_seconds', tts_antispam_cooldown_seconds ? parseInt(tts_antispam_cooldown_seconds, 10) : 30);
		await database.setGuildVar(guildId, 'tts_afk_bringback_enabled', tts_afk_bringback_enabled !== false);
		await database.setGuildVar(guildId, 'tts_vc_welcome_enabled', tts_vc_welcome_enabled !== false);
		await database.setGuildVar(guildId, 'tts_vc_welcome_template', tts_vc_welcome_template !== undefined ? tts_vc_welcome_template : '{username} เข้าดิสมา');
		await database.setGuildVar(guildId, 'tts_vc_leave_enabled', tts_vc_leave_enabled !== false);
		await database.setGuildVar(guildId, 'tts_vc_leave_template', tts_vc_leave_template !== undefined ? tts_vc_leave_template : '{username} ออกจากดิสแล้ว');
		await database.setGuildVar(guildId, 'honeypot_channel_id', honeypot_channel_id || null);

		if (process.send) {
			process.send({ target: 'bot', type: 'reload_guild_cache', guildId });
		}

		const sessionGuild = (req.session.adminGuilds || []).find(g => String(g.id) === String(guildId));
		const gName = sessionGuild ? sessionGuild.name : 'Discord Server';
		const uId = req.session.user.id;
		const uName = req.session.user.username;

		// 1. Welcome & Leave Diff
		const welcomeChanged = (welcome_channel_id || null) !== (oldVars.welcome_channel_id || null) || (welcome_message_template || '') !== (oldVars.welcome_message_template || '');
		const leaveChanged = (leave_channel_id || null) !== (oldVars.leave_channel_id || null) || (leave_message_template || '') !== (oldVars.leave_message_template || '');

		if (welcomeChanged || leaveChanged) {
			const wlDetails = [];
			if (welcomeChanged) wlDetails.push(`Welcome: ${welcome_channel_id ? `<#${welcome_channel_id}>` : 'Disabled'} ("${(welcome_message_template || '').substring(0, 30)}")`);
			if (leaveChanged) wlDetails.push(`Leave: ${leave_channel_id ? `<#${leave_channel_id}>` : 'Disabled'} ("${(leave_message_template || '').substring(0, 30)}")`);
			await database.logAuditEvent(guildId, 'WELCOME_LEAVE', uId, uName, wlDetails.join(' | '), gName);
		}

		// 2. AutoRole Diff
		const newHumans = Array.isArray(autorole_ids) ? autorole_ids : (autorole_id ? [autorole_id] : []);
		const oldHumans = Array.isArray(oldVars.autorole_ids) ? oldVars.autorole_ids : (oldVars.autorole_id ? [oldVars.autorole_id] : []);
		const newBots = Array.isArray(bot_autorole_ids) ? bot_autorole_ids : [];
		const oldBots = Array.isArray(oldVars.bot_autorole_ids) ? oldVars.bot_autorole_ids : [];

		if (JSON.stringify(newHumans) !== JSON.stringify(oldHumans) || JSON.stringify(newBots) !== JSON.stringify(oldBots)) {
			const humanRolesStr = newHumans.length > 0 ? newHumans.map(r => `<@&${r}>`).join(', ') : 'None';
			const botRolesStr = newBots.length > 0 ? newBots.map(r => `<@&${r}>`).join(', ') : 'None';
			const arDetails = `Human Roles: [${humanRolesStr}] | Bot Roles: [${botRolesStr}]`;
			await database.logAuditEvent(guildId, 'AUTOROLE', uId, uName, arDetails, gName);
		}

function toBool(val, defaultVal = true) {
	if (val === undefined || val === null) return defaultVal;
	if (val === false || val === 'false' || val === 0 || val === '0') return false;
	if (val === true || val === 'true' || val === 1 || val === '1') return true;
	return Boolean(val);
}

		// 3. Voice TTS Diff
		const ttsChannelChanged = (tts_channel_id || null) !== (oldVars.tts_channel_id || null);
		const ttsEngineChanged = (tts_engine || 'EDGE_TTS') !== (oldVars.tts_engine || 'EDGE_TTS') || (tts_voice || 'th-TH-NiwatNeural') !== (oldVars.tts_voice || 'th-TH-NiwatNeural');
		const ttsSpamChanged = toBool(tts_antispam_enabled) !== toBool(oldVars.tts_antispam_enabled) || parseInt(tts_antispam_max_messages || 3, 10) !== parseInt(oldVars.tts_antispam_max_messages || 3, 10) || parseInt(tts_antispam_cooldown_seconds || 30, 10) !== parseInt(oldVars.tts_antispam_cooldown_seconds || 30, 10);
		const ttsLengthChanged = parseInt(tts_max_length || 200, 10) !== parseInt(oldVars.tts_max_length || 200, 10);
		const ttsAfkChanged = toBool(tts_afk_bringback_enabled) !== toBool(oldVars.tts_afk_bringback_enabled);
		const ttsWelcomeChanged = toBool(tts_vc_welcome_enabled) !== toBool(oldVars.tts_vc_welcome_enabled) || (tts_vc_welcome_template || '{username} เข้าดิสมา') !== (oldVars.tts_vc_welcome_template || '{username} เข้าดิสมา');
		const ttsLeaveChanged = toBool(tts_vc_leave_enabled) !== toBool(oldVars.tts_vc_leave_enabled) || (tts_vc_leave_template || '{username} ออกจากดิสแล้ว') !== (oldVars.tts_vc_leave_template || '{username} ออกจากดิสแล้ว');

		if (ttsChannelChanged || ttsEngineChanged || ttsSpamChanged || ttsLengthChanged || ttsAfkChanged || ttsWelcomeChanged || ttsLeaveChanged) {
			const maxMsgs = tts_antispam_max_messages || 3;
			const cooldown = tts_antispam_cooldown_seconds || 30;
			const maxLen = tts_max_length || 200;
			const ttsDetails = `Channel: ${tts_channel_id ? `<#${tts_channel_id}>` : 'Disabled'} | Engine: ${tts_engine || 'EDGE_TTS'} | Anti-Spam: ${toBool(tts_antispam_enabled) ? `ON (${maxMsgs}m/${cooldown}s)` : 'OFF'} | AFK Bringback: ${toBool(tts_afk_bringback_enabled) ? 'ON' : 'OFF'} | VC Greeting: ${toBool(tts_vc_welcome_enabled) ? 'ON' : 'OFF'} | VC Goodbye: ${toBool(tts_vc_leave_enabled) ? 'ON' : 'OFF'}`;
			await database.logAuditEvent(guildId, 'VOICE_TTS', uId, uName, ttsDetails, gName);
		}

		// 4. Honeypot Diff
		if ((honeypot_channel_id || null) !== (oldVars.honeypot_channel_id || null)) {
			const hpDetails = `Trap Channel: ${honeypot_channel_id ? `<#${honeypot_channel_id}>` : 'Disabled'}`;
			await database.logAuditEvent(guildId, 'HONEYPOT', uId, uName, hpDetails, gName);
		}

		res.json({ success: true, message: 'Configuration saved successfully!' });
	}
	catch (error) {
		BotLogs('SYSTEM', `Error updating guild config: ${error.toString()}`);
		res.status(500).json({ error: 'Failed to save configuration.' });
	}
});

app.post('/api/guilds/:guildId/reaction-roles', requireAdminGuild, async (req, res) => {
	const { guildId } = req.params;
	let { action, messageId, messageLink, channelId, emoji, roleId, mode, enabled } = req.body || {};

	try {
		const rawMap = await database.getGuildVar(guildId, 'reaction_roles');
		let mappings = parseReactionRolesMap(rawMap);

		const sessionGuild = (req.session.adminGuilds || []).find(g => String(g.id) === String(guildId));
		const gName = sessionGuild ? sessionGuild.name : 'Discord Server';
		const uId = req.session.user.id;
		const uName = req.session.user.username;

		if (action === 'clear_all') {
			await database.setGuildVar(guildId, 'reaction_roles', JSON.stringify({}));
			await database.logAuditEvent(guildId, 'REACTION_ROLE', uId, uName, 'Cleared all reaction role mappings', gName);
			return res.json({ success: true, message: 'All reaction role mappings removed successfully!', reaction_roles: {} });
		}

		// Parse Discord Message Link if provided (e.g. https://discord.com/channels/123/456/789)
		if (messageLink && typeof messageLink === 'string') {
			const match = messageLink.match(/discord\.com\/channels\/\d+\/(\d+)\/(\d+)/i);
			if (match) {
				channelId = match[1];
				messageId = match[2];
			}
		}

		if (!messageId || !emoji) {
			return res.status(400).json({ error: 'Missing Message ID/Link or emoji.' });
		}

		if (action === 'delete') {
			if (mappings[messageId] && mappings[messageId][emoji]) {
				delete mappings[messageId][emoji];
				if (Object.keys(mappings[messageId]).length === 0) {
					delete mappings[messageId];
				}
				await database.setGuildVar(guildId, 'reaction_roles', JSON.stringify(mappings));
			}
			await database.logAuditEvent(guildId, 'REACTION_ROLE', uId, uName, `Deleted reaction role mapping ${emoji} on message ${messageId}`, gName);
			return res.json({ success: true, message: 'Reaction role removed successfully!', reaction_roles: mappings });
		}

		if (action === 'toggle') {
			if (mappings[messageId] && mappings[messageId][emoji]) {
				const currentEntry = mappings[messageId][emoji];
				if (typeof currentEntry === 'object' && currentEntry !== null) {
					currentEntry.enabled = currentEntry.enabled === false ? true : false;
				} else {
					mappings[messageId][emoji] = {
						roleId: currentEntry,
						mode: 'toggle',
						enabled: false,
					};
				}
				await database.setGuildVar(guildId, 'reaction_roles', JSON.stringify(mappings));
			}
			await database.logAuditEvent(guildId, 'REACTION_ROLE', uId, uName, `Toggled status for emoji ${emoji} on message ${messageId}`, gName);
			return res.json({ success: true, message: 'Reaction role status toggled!', reaction_roles: mappings });
		}

		if (!roleId) {
			return res.status(400).json({ error: 'Missing roleId.' });
		}

		if (!mappings[messageId]) {
			mappings[messageId] = {};
		}

		mappings[messageId][emoji] = {
			roleId,
			channelId: channelId || null,
			mode: mode || 'toggle',
			enabled: enabled !== false,
		};

		await database.setGuildVar(guildId, 'reaction_roles', JSON.stringify(mappings));

		await database.logAuditEvent(
			guildId,
			'REACTION_ROLE',
			uId,
			uName,
			`Added reaction role mapping ${emoji} -> role <@&${roleId}> on message ${messageId} (Mode: ${mode || 'toggle'})`,
			gName
		);

		// Dispatch IPC to bot to auto-react on Discord message
		if (process.send) {
			process.send({
				target: 'bot',
				type: 'add_reaction_role_react',
				guildId,
				channelId,
				messageId,
				emoji,
			});
		}

		res.json({ success: true, message: 'Reaction role mapping saved & auto-reacted on Discord!', reaction_roles: mappings });
	}
	catch (error) {
		BotLogs('SYSTEM', `Error updating reaction roles via web: ${error.toString()}`);
		res.status(500).json({ error: 'Failed to update reaction role mapping.' });
	}
});

app.post('/api/guilds/:guildId/send-embed', requireAdminGuild, async (req, res) => {
	const { guildId } = req.params;
	const channelId = req.body.channelId;
	const embedData = req.body.embedData || req.body.embed;

	if (!channelId || !embedData) {
		return res.status(400).json({ error: 'Missing channelId or embed data.' });
	}

	const ipcRes = await sendIpcRequest({
		type: 'send_custom_embed',
		guildId,
		channelId,
		embedData,
	}, 5000);

	if (ipcRes && ipcRes.success) {
		const sessionGuild = (req.session.adminGuilds || []).find(g => String(g.id) === String(guildId));
		const gName = sessionGuild ? sessionGuild.name : 'Discord Server';
		const uId = req.session.user.id;
		const uName = req.session.user.username;
		const titleStr = embedData.title ? `"${embedData.title}"` : 'Untitled Embed';
		const descStr = embedData.description ? ` (${embedData.description.substring(0, 40)}...)` : '';

		await database.logAuditEvent(
			guildId,
			'EMBED',
			uId,
			uName,
			`Dispatched custom embed to channel <#${channelId}>: ${titleStr}${descStr}`,
			gName
		).catch(() => undefined);

		res.json({ success: true, message: 'Embed message dispatched successfully to Discord channel!' });
	}
	else {
		res.status(500).json({ error: (ipcRes && ipcRes.error) || 'Failed to dispatch embed via bot process.' });
	}
});

// --- ROLE MANAGEMENT REST ENDPOINTS ---

// Create Role
app.post('/api/guilds/:guildId/roles/create', requireAdminGuild, async (req, res) => {
	const { guildId } = req.params;
	const { name, color, hoist, mentionable } = req.body || {};
	const uId = (req.session && req.session.user && req.session.user.id) || 'Unknown';
	const uName = (req.session && req.session.user && (req.session.user.global_name || req.session.user.username)) || 'Administrator';
	const matchedGuild = (req.session && req.session.adminGuilds && req.session.adminGuilds.find(g => g.id === guildId));
	const gName = matchedGuild ? matchedGuild.name : 'Discord Server';

	const ipcRes = await sendIpcRequest({
		type: 'create_guild_role',
		guildId,
		roleData: { name, color, hoist, mentionable },
		actor: uName,
	}, 6000);

	if (ipcRes && ipcRes.success) {
		await database.logAuditEvent(
			guildId,
			'ROLE_CREATE',
			uId,
			uName,
			`Created new server role @${ipcRes.role.name} (ID: ${ipcRes.role.id}, Color: ${ipcRes.role.hexColor})`,
			gName
		).catch(() => undefined);

		res.json({ success: true, message: `Role @${ipcRes.role.name} created successfully!`, role: ipcRes.role });
	}
	else {
		res.status(500).json({ error: (ipcRes && ipcRes.error) || 'Failed to create role on Discord.' });
	}
});

// Update Role
app.post('/api/guilds/:guildId/roles/:roleId/update', requireAdminGuild, async (req, res) => {
	const { guildId, roleId } = req.params;
	const { name, color, hoist, mentionable } = req.body || {};
	const uId = (req.session && req.session.user && req.session.user.id) || 'Unknown';
	const uName = (req.session && req.session.user && (req.session.user.global_name || req.session.user.username)) || 'Administrator';
	const matchedGuild = (req.session && req.session.adminGuilds && req.session.adminGuilds.find(g => g.id === guildId));
	const gName = matchedGuild ? matchedGuild.name : 'Discord Server';

	const ipcRes = await sendIpcRequest({
		type: 'update_guild_role',
		guildId,
		roleId,
		roleData: { name, color, hoist, mentionable },
		actor: uName,
	}, 6000);

	if (ipcRes && ipcRes.success) {
		await database.logAuditEvent(
			guildId,
			'ROLE_UPDATE',
			uId,
			uName,
			`Updated server role @${ipcRes.role.name} (ID: ${ipcRes.role.id}, Color: ${ipcRes.role.hexColor}, Hoist: ${ipcRes.role.hoist}, Mentionable: ${ipcRes.role.mentionable})`,
			gName
		).catch(() => undefined);

		res.json({ success: true, message: `Role @${ipcRes.role.name} updated successfully!`, role: ipcRes.role });
	}
	else {
		res.status(500).json({ error: (ipcRes && ipcRes.error) || 'Failed to update role on Discord.' });
	}
});

// Delete Role
app.post('/api/guilds/:guildId/roles/:roleId/delete', requireAdminGuild, async (req, res) => {
	const { guildId, roleId } = req.params;
	const uId = (req.session && req.session.user && req.session.user.id) || 'Unknown';
	const uName = (req.session && req.session.user && (req.session.user.global_name || req.session.user.username)) || 'Administrator';
	const matchedGuild = (req.session && req.session.adminGuilds && req.session.adminGuilds.find(g => g.id === guildId));
	const gName = matchedGuild ? matchedGuild.name : 'Discord Server';

	const ipcRes = await sendIpcRequest({
		type: 'delete_guild_role',
		guildId,
		roleId,
		actor: uName,
	}, 6000);

	if (ipcRes && ipcRes.success) {
		await database.logAuditEvent(
			guildId,
			'ROLE_DELETE',
			uId,
			uName,
			`Deleted server role @${ipcRes.roleName} (ID: ${roleId})`,
			gName
		).catch(() => undefined);

		res.json({ success: true, message: `Role @${ipcRes.roleName} deleted successfully!` });
	}
	else {
		res.status(500).json({ error: (ipcRes && ipcRes.error) || 'Failed to delete role on Discord.' });
	}
});

// Get Members for Role Assignment
app.get('/api/guilds/:guildId/members', requireAdminGuild, async (req, res) => {
	const { guildId } = req.params;
	const query = req.query.q || '';

	const ipcRes = await sendIpcRequest({
		type: 'get_guild_members',
		guildId,
		query,
	}, 8000);

	if (ipcRes && ipcRes.success) {
		res.json({ success: true, members: ipcRes.members || [] });
	}
	else {
		res.status(500).json({ error: (ipcRes && ipcRes.error) || 'Failed to fetch server members.' });
	}
});

// Modify / Batch Set Member Role Assignment
app.post(['/api/guilds/:guildId/members/:memberId/roles', '/api/guilds/:guildId/members/:memberId/set-roles'], requireAdminGuild, async (req, res) => {
	const { guildId, memberId } = req.params;
	const { roleId, action, roleIds } = req.body || {};
	const uId = (req.session && req.session.user && req.session.user.id) || 'Unknown';
	const uName = (req.session && req.session.user && (req.session.user.global_name || req.session.user.username)) || 'Administrator';
	const matchedGuild = (req.session && req.session.adminGuilds && req.session.adminGuilds.find(g => g.id === guildId));
	const gName = matchedGuild ? matchedGuild.name : 'Discord Server';

	// Case 1: Batch Role Update
	if (Array.isArray(roleIds)) {
		const ipcRes = await sendIpcRequest({
			type: 'set_member_roles',
			guildId,
			memberId,
			roleIds,
			actor: uName,
		}, 8000);

		if (ipcRes && ipcRes.success) {
			await database.logAuditEvent(
				guildId,
				'ROLE_UPDATE',
				uId,
				uName,
				`Updated roles for member <@${memberId}> (${roleIds.length} active roles)`,
				gName
			).catch(() => undefined);

			return res.json({ success: true, message: 'Member roles updated successfully!', roles: ipcRes.roles });
		}
		else {
			return res.status(500).json({ error: (ipcRes && ipcRes.error) || 'Failed to update member roles.' });
		}
	}

	// Case 2: Single Role Add/Remove
	if (!roleId || !action || !['add', 'remove'].includes(action)) {
		return res.status(400).json({ error: 'Invalid role ID or action.' });
	}

	const ipcRes = await sendIpcRequest({
		type: 'modify_member_role',
		guildId,
		memberId,
		roleId,
		action,
		actor: uName,
	}, 6000);

	if (ipcRes && ipcRes.success) {
		await database.logAuditEvent(
			guildId,
			action === 'add' ? 'AUTOROLE_ASSIGN' : 'AUTOROLE',
			uId,
			uName,
			`${action === 'add' ? 'Assigned' : 'Removed'} role <@&${roleId}> ${action === 'add' ? 'to' : 'from'} user <@${memberId}>`,
			gName
		).catch(() => undefined);

		res.json({ success: true, message: `Role ${action === 'add' ? 'assigned' : 'removed'} successfully!`, roles: ipcRes.roles });
	}
	else {
		res.status(500).json({ error: (ipcRes && ipcRes.error) || 'Failed to modify member role.' });
	}
});

app.post('/api/guilds/:guildId/automod', requireAdminGuild, async (req, res) => {
	const { guildId } = req.params;
	let automodConfig = req.body || {};
	if (typeof automodConfig === 'string') {
		try { automodConfig = JSON.parse(automodConfig); } catch {}
	}
	if (typeof automodConfig === 'string') {
		try { automodConfig = JSON.parse(automodConfig); } catch {}
	}
	if (typeof automodConfig !== 'object' || automodConfig === null) {
		automodConfig = {};
	}

	try {
		const rawOldAm = await database.getGuildVar(guildId, 'automod');
		let oldAm = {};
		if (typeof rawOldAm === 'string') {
			try { oldAm = JSON.parse(rawOldAm); } catch {}
		}
		else if (typeof rawOldAm === 'object' && rawOldAm !== null) {
			oldAm = rawOldAm;
		}

		await database.setGuildVar(guildId, 'automod', automodConfig);

		if (process.send) {
			process.send({ target: 'bot', type: 'reload_guild_cache', guildId });
		}

		if (JSON.stringify(automodConfig) !== JSON.stringify(oldAm)) {
			const sessionGuild = (req.session.adminGuilds || []).find(g => String(g.id) === String(guildId));
			const gName = sessionGuild ? sessionGuild.name : 'Discord Server';

			const amDetails = `Anti-Spam: ${automodConfig.antispam_enabled !== false ? 'ON' : 'OFF'} | Anti-Invite: ${automodConfig.antiinvite_enabled !== false ? 'ON' : 'OFF'} | Badwords: ${automodConfig.badwords_enabled ? `ON (${(automodConfig.badwords_list || []).length} words)` : 'OFF'} | Action: ${automodConfig.action || 'delete'}`;

			await database.logAuditEvent(
				guildId,
				'AUTOMOD',
				req.session.user.id,
				req.session.user.username,
				amDetails,
				gName
			);
		}

		res.json({ success: true, message: 'Auto-Moderation settings saved successfully!' });
	}
	catch (error) {
		BotLogs('SYSTEM', `Error updating Auto-Mod config: ${error.toString()}`);
		res.status(500).json({ error: 'Failed to save Auto-Moderation configuration.' });
	}
});

app.get('/api/guilds/:guildId/audit-logs', requireAdminGuild, async (req, res) => {
	const { guildId } = req.params;
	const { limit, filter } = req.query;

	try {
		const parsedLimit = Math.min(parseInt(limit || '50', 10), 100);
		const logs = await database.getGuildAuditLogs(guildId, parsedLimit, filter || 'ALL');
		res.json({ success: true, logs });
	}
	catch (error) {
		BotLogs('SYSTEM', `Error fetching audit logs for guild ${guildId}: ${error.toString()}`);
		res.status(500).json({ error: 'Failed to fetch audit logs.' });
	}
});

// --- Guild-Specific Audio Queue & Playback Controls ---
app.get('/api/guilds/:guildId/audio-queue', requireAdminGuild, async (req, res) => {
	const { guildId } = req.params;
	try {
		const ipcRes = await sendIpcRequest({ type: 'get_audio_queues' }, 3000);
		const queues = ipcRes?.queues || [];
		const guildQueue = queues.find(q => String(q.guildId) === String(guildId)) || {
			guildId,
			guildName: 'Discord Server',
			playerState: 'idle',
			isBusy: false,
			queueLength: 0,
			currentItem: null,
			items: [],
		};
		res.json({ success: true, queue: guildQueue });
	}
	catch (error) {
		res.status(500).json({ success: false, error: 'Failed to fetch guild audio queue.', queue: null });
	}
});

app.post('/api/guilds/:guildId/audio-queue/skip', requireAdminGuild, async (req, res) => {
	const { guildId } = req.params;
	try {
		const uName = (req.session && req.session.user && (req.session.user.global_name || req.session.user.username)) || 'Administrator';
		const ipcRes = await sendIpcRequest({ type: 'skip_audio_queue', guildId }, 4000);
		BotLogs('TTS', `User ${uName} force skipped audio in server ${guildId}`);
		res.json({ success: !!ipcRes?.success, message: ipcRes?.success ? 'Track skipped successfully!' : 'No track active to skip.' });
	}
	catch (error) {
		res.status(500).json({ success: false, error: 'Failed to skip audio track.' });
	}
});

app.post('/api/guilds/:guildId/audio-queue/remove', requireAdminGuild, async (req, res) => {
	const { guildId } = req.params;
	const { itemId } = req.body || {};
	if (!itemId) return res.status(400).json({ success: false, error: 'Missing itemId parameter.' });
	try {
		const uName = (req.session && req.session.user && (req.session.user.global_name || req.session.user.username)) || 'Administrator';
		const ipcRes = await sendIpcRequest({ type: 'remove_audio_queue_item', guildId, itemId }, 4000);
		BotLogs('TTS', `User ${uName} force removed queue item ${itemId} in server ${guildId}`);
		res.json({ success: !!ipcRes?.success, message: ipcRes?.success ? 'Item removed successfully!' : 'Item not found.' });
	}
	catch (error) {
		res.status(500).json({ success: false, error: 'Failed to remove queue item.' });
	}
});

app.post('/api/guilds/:guildId/audio-queue/clear', requireAdminGuild, async (req, res) => {
	const { guildId } = req.params;
	try {
		const uName = (req.session && req.session.user && (req.session.user.global_name || req.session.user.username)) || 'Administrator';
		const ipcRes = await sendIpcRequest({ type: 'clear_guild_audio_queue', guildId }, 4000);
		BotLogs('TTS', `User ${uName} cleared audio queue for server ${guildId}`);
		res.json({ success: true, message: 'Server audio queue cleared successfully!' });
	}
	catch (error) {
		res.status(500).json({ success: false, error: 'Failed to clear guild audio queue.' });
	}
});

app.post('/api/guilds/:guildId/audio-queue/inject', requireAdminGuild, async (req, res) => {
	const { guildId } = req.params;
	const { text, sound, userName, engine, voice, lang, volume } = req.body || {};
	if (!text && !sound) return res.status(400).json({ success: false, error: 'Missing text or sound parameter.' });
	try {
		const uName = userName || (req.session && req.session.user && (req.session.user.global_name || req.session.user.username)) || 'Dashboard Admin';
		const ipcRes = await sendIpcRequest({
			type: 'force_add_audio_queue',
			guildId,
			text: text || sound,
			sound: sound || undefined,
			userName: uName,
			engine: sound ? 'AUDIO_MP3' : (engine || 'EDGE_TTS'),
			voice: voice || 'th-TH-NiwatNeural',
			lang: lang || 'th',
			volume: typeof volume === 'number' ? volume : 0.5,
		}, 5000);

		if (ipcRes && ipcRes.success) {
			BotLogs('TTS', `User ${uName} enqueued audio (${sound || text}) to server ${guildId}`);
			return res.json({ success: true, message: 'Audio clip enqueued successfully!', id: ipcRes.id });
		}
		return res.status(400).json({ success: false, error: ipcRes?.error || 'Failed to enqueue audio.' });
	}
	catch (error) {
		res.status(500).json({ success: false, error: 'Failed to inject audio clip.' });
	}
});

app.get('/api/guilds/:guildId/audio-logs', requireAdminGuild, async (req, res) => {
	const { guildId } = req.params;
	const { limit, status, search } = req.query;
	try {
		const logs = await database.getAudioLogs({ limit, status, search, guildId });
		res.json({ success: true, logs });
	}
	catch (error) {
		res.status(500).json({ success: false, error: 'Failed to fetch guild audio logs.', logs: [] });
	}
});

let dbDevIdsCache = [];
let lastDbDevFetch = 0;

async function isUserDeveloperAsync(userId) {
	if (!userId) return false;
	try {
		if (Date.now() - lastDbDevFetch > 5000 || dbDevIdsCache.length === 0) {
			dbDevIdsCache = await database.getDeveloperUserIds();
			lastDbDevFetch = Date.now();
		}
		return dbDevIdsCache.includes(String(userId));
	}
	catch {
		return false;
	}
}

function isUserDeveloper(userId) {
	if (!userId) return false;
	return dbDevIdsCache.includes(String(userId));
}

async function requireDeveloper(req, res, next) {
	try {
		if (!req.session || !req.session.user) {
			return res.status(401).json({ error: 'Unauthorized. Please log in with Discord.' });
		}
		const isDev = await isUserDeveloperAsync(req.session.user.id);
		if (!isDev) {
			return res.status(403).json({ error: 'Forbidden: Developer access required.' });
		}
		next();
	}
	catch (err) {
		res.status(500).json({ error: 'Failed to verify developer status.' });
	}
}

app.get('/api/developer/check', async (req, res) => {
	try {
		const isDev = req.session && req.session.user ? await isUserDeveloperAsync(req.session.user.id) : false;
		res.json({ success: true, isDeveloper: isDev });
	}
	catch {
		res.json({ success: true, isDeveloper: false });
	}
});

app.get('/api/developer/stats', requireDeveloper, async (req, res) => {
	try {
		const memUsage = process.memoryUsage();
		const botStats = (await sendIpcRequest({ type: 'get_bot_stats' }, 3000)) || {};

		res.json({
			success: true,
			system: {
				ramUsedMB: Math.round(memUsage.rss / 1024 / 1024),
				heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
				heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
				uptimeSeconds: Math.floor(process.uptime()),
				nodeVersion: process.version,
				platform: process.platform,
			},
			bot: {
				status: botStats.exists ? 'online' : 'offline',
				pingMs: botStats.pingMs || 0,
				guildCount: botStats.guildsCount || 0,
				userCount: botStats.usersCount || 0,
				voiceConnections: botStats.voiceConnectionsCount || 0,
				readyTimestamp: botStats.readyTimestamp || null,
				guilds: botStats.guilds || [],
			},
			services: {
				botStatus: botStats.exists ? 'online' : 'offline',
				webStatus: 'online',
				dbStatus: database.isPostgres ? 'postgresql' : 'local_json',
			},
		});
	}
	catch (error) {
		res.status(500).json({ error: 'Failed to fetch developer stats.' });
	}
});

app.get('/api/developer/logs', requireDeveloper, (req, res) => {
	try {
		res.json({ success: true, logs: getRecentLogs() || [] });
	}
	catch (err) {
		res.status(500).json({ success: false, logs: [] });
	}
});

app.get('/api/developer/audio-queues', requireDeveloper, async (req, res) => {
	try {
		const ipcRes = await sendIpcRequest({ type: 'get_audio_queues' }, 3000);
		res.json({ success: true, queues: ipcRes?.queues || [] });
	}
	catch (error) {
		res.status(500).json({ success: false, error: 'Failed to fetch active audio queues.', queues: [] });
	}
});

app.post('/api/developer/audio-queues/skip', requireDeveloper, async (req, res) => {
	const { guildId } = req.body || {};
	if (!guildId) return res.status(400).json({ success: false, error: 'Missing guildId parameter.' });
	try {
		const ipcRes = await sendIpcRequest({ type: 'skip_audio_queue', guildId }, 4000);
		BotLogs('TTS', `Developer ${req.session.user.username} force skipped audio in server ${guildId}`);
		res.json({ success: !!ipcRes?.success, message: ipcRes?.success ? 'Track skipped successfully!' : 'No track active to skip.' });
	}
	catch (error) {
		res.status(500).json({ success: false, error: 'Failed to skip audio queue item.' });
	}
});

app.post('/api/developer/audio-queues/remove', requireDeveloper, async (req, res) => {
	const { guildId, itemId } = req.body || {};
	if (!guildId || !itemId) return res.status(400).json({ success: false, error: 'Missing guildId or itemId parameter.' });
	try {
		const ipcRes = await sendIpcRequest({ type: 'remove_audio_queue_item', guildId, itemId }, 4000);
		BotLogs('TTS', `Developer ${req.session.user.username} force removed queue item ${itemId} in server ${guildId}`);
		res.json({ success: !!ipcRes?.success, message: ipcRes?.success ? 'Queue item removed successfully!' : 'Item not found.' });
	}
	catch (error) {
		res.status(500).json({ success: false, error: 'Failed to remove audio queue item.' });
	}
});

app.post('/api/developer/audio-queues/clear', requireDeveloper, async (req, res) => {
	const { guildId } = req.body || {};
	if (!guildId) return res.status(400).json({ success: false, error: 'Missing guildId parameter.' });
	try {
		const ipcRes = await sendIpcRequest({ type: 'clear_guild_audio_queue', guildId }, 4000);
		BotLogs('TTS', `Developer ${req.session.user.username} cleared audio queue for server ${guildId}`);
		res.json({ success: true, message: 'Server audio queue cleared successfully!' });
	}
	catch (error) {
		res.status(500).json({ success: false, error: 'Failed to clear guild audio queue.' });
	}
});

app.post('/api/developer/audio-queues/add', requireDeveloper, async (req, res) => {
	const { guildId, text, userName, engine, voice, lang } = req.body || {};
	if (!guildId || !text) return res.status(400).json({ success: false, error: 'Missing guildId or text parameter.' });
	try {
		const ipcRes = await sendIpcRequest({
			type: 'force_add_audio_queue',
			guildId,
			text,
			userName: userName || req.session.user.username,
			engine: engine || 'EDGE_TTS',
			voice: voice || 'th-TH-NiwatNeural',
			lang: lang || 'th',
		}, 5000);
		if (ipcRes && ipcRes.success) {
			BotLogs('TTS', `Developer ${req.session.user.username} force enqueued TTS to server ${guildId}: "${text}"`);
			return res.json({ success: true, message: 'TTS enqueued successfully!', id: ipcRes.id });
		}
		return res.status(400).json({ success: false, error: ipcRes?.error || 'Failed to enqueue TTS.' });
	}
	catch (error) {
		res.status(500).json({ success: false, error: 'Failed to add item to audio queue.' });
	}
});

app.get('/api/developer/audio-logs', requireDeveloper, async (req, res) => {
	const { limit, status, search, guildId } = req.query;
	try {
		const logs = await database.getAudioLogs({ limit, status, search, guildId });
		res.json({ success: true, logs });
	}
	catch (error) {
		res.status(500).json({ success: false, error: 'Failed to fetch audio logs.', logs: [] });
	}
});

app.post('/api/developer/audio-logs/purge', requireDeveloper, async (req, res) => {
	const { days } = req.body || {};
	try {
		const retentionDays = parseInt(days || 7, 10);
		const count = await database.cleanOldAudioLogs(retentionDays);
		BotLogs('Web', `Developer ${req.session.user.username} purged audio logs older than ${retentionDays} days (${count} deleted)`);
		res.json({ success: true, message: `Purged ${count} audio log entries older than ${retentionDays} days!`, count });
	}
	catch (error) {
		res.status(500).json({ success: false, error: 'Failed to purge expired audio logs.' });
	}
});

app.get('/api/developer/audit-logs', requireDeveloper, async (req, res) => {
	const { limit, filter, search } = req.query;
	try {
		const parsedLimit = Math.min(parseInt(limit || '100', 10), 200);
		const logs = await database.getGlobalAuditLogs(parsedLimit, filter || 'ALL', search || '');
		res.json({ success: true, logs });
	}
	catch (error) {
		res.status(500).json({ error: 'Failed to fetch global audit logs.' });
	}
});

app.post('/api/developer/audit-logs/purge', requireDeveloper, async (req, res) => {
	const { days } = req.body || {};
	try {
		const retentionDays = parseInt(days || 7, 10);
		const count = await database.cleanOldAuditLogs(retentionDays);
		BotLogs('Web', `Developer ${req.session.user.username} purged audit logs older than ${retentionDays} days (${count} deleted)`);
		res.json({ success: true, message: `Purged ${count} audit log entries older than ${retentionDays} days!`, count });
	}
	catch (error) {
		res.status(500).json({ error: 'Failed to purge expired audit logs.' });
	}
});

app.post('/api/developer/action', requireDeveloper, async (req, res) => {
	const { action } = req.body || {};
	try {
		if (action === 'reload_cache') {
			if (process.send) {
				process.send({ target: 'bot', type: 'reload_guild_cache', guildId: 'ALL' });
			}
			BotLogs('SYSTEM', `Developer triggered full bot cache reload via Web Console (${req.session.user.username})`);
			return res.json({ success: true, message: 'Bot cache reload triggered successfully!' });
		}
		if (action === 'clear_queues') {
			const ipcRes = await sendIpcRequest({ type: 'clear_all_audio_queues' }, 5000);
			BotLogs('SYSTEM', `Developer cleared all audio queues via Web Console (${req.session.user.username})`);
			return res.json({ success: true, message: 'All audio queues cleared successfully!' });
		}
		if (action === 'restart_bot') {
			if (process.send) {
				process.send({ target: 'bot', type: 'restart_bot' });
			}
			BotLogs('SYSTEM', `Developer triggered Bot Process Restart via Web Console (${req.session.user.username})`);
			return res.json({ success: true, message: 'Bot process restart signal dispatched!' });
		}
		res.status(400).json({ error: 'Unknown developer action.' });
	}
	catch (error) {
		res.status(500).json({ error: 'Failed to execute developer action.' });
	}
});

// Express sits behind Next, so a browser arriving here at all means the public
// port went to the wrong process. Redirecting to FRONTEND_URL is the right
// answer when the two really are different origins, and an infinite loop when
// they are not — which is precisely what happens to someone who sets
// FRONTEND_URL to the public URL in order to stop the redirect to localhost.
// Say what is actually wrong instead of bouncing them forever.
app.get('/', (req, res) => {
	let sameOrigin = false;
	try {
		sameOrigin = new URL(FRONTEND_URL).host === req.headers.host;
	}
	catch {
		// FRONTEND_URL is not a parseable URL. Redirect and let it fail visibly.
	}

	if (sameOrigin) {
		return res.status(500).send(
			'This is Megu\'s API process answering on the public port. Next should have that port — '
			+ 'set NEXT_PORT (or leave PORT to Next) and give Express a fixed EXPRESS_PORT.',
		);
	}

	res.redirect(FRONTEND_URL);
});

BotLogs('Megu', `Core database: ${COLOR.white}${core.db.describe()}`);
core.initCoreSchema()
	.then(async () => {
		const forgotten = await core.activities.forgetOldSlips(7);
		if (forgotten > 0) BotLogs('Megu', `${COLOR.yellow}Expired ${forgotten} temporary raw slip image(s).`);
	})
	.catch((error) => {
		BotLogs('Megu', `${COLOR.red}Core schema init failed: ${error.message}. Activity features will not work.`);
	});

const server = app.listen(PORT, () => {
	BotLogs('SYSTEM', `Express health check & dashboard server running on port ${PORT}`);
});

// Configure Keep-Alive timeouts to prevent ECONNRESET proxy race conditions with Next.js rewrites
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

