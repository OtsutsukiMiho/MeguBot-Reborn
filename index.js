const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');

if (fs.existsSync('.env')) {
	require('dotenv').config();
}

const { BotLogs, COLOR } = require('./backend/bot/bot_functions.js');

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
	webProcess = fork(path.join(__dirname, 'backend', 'web', 'web.js'), [], { stdio: 'inherit' });

	webProcess.on('message', (message) => {
		if (message.type === 'ping_bot') {
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
		logMaster('System', `${COLOR.red}Express REST API process exited with code ${code} (signal: ${signal}). Restarting in 3 seconds...`);
		setTimeout(startWeb, 3000);
	});
}

function startNext() {
	logMaster('System', `${COLOR.cyan}Starting Next.js App Router Frontend server (Port ${NEXT_PORT})...`);
	const nextBin = path.join(__dirname, 'node_modules', 'next', 'dist', 'bin', 'next');
	const mode = process.env.NODE_ENV === 'production' ? 'start' : 'dev';
	nextProcess = fork(nextBin, [mode, '-p', String(NEXT_PORT)], { stdio: ['inherit', 'pipe', 'pipe', 'ipc'] });

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
		logMaster('System', `${COLOR.red}Next.js server exited with code ${code} (signal: ${signal}). Restarting in 3 seconds...`);
		setTimeout(startNext, 3000);
	});
}

function startBot() {
	logMaster('System', `${COLOR.cyan}Starting Discord Bot process...`);
	botProcess = fork(path.join(__dirname, 'backend', 'bot', 'bot.js'), [], { stdio: 'inherit' });

	botProcess.on('message', (message) => {
		if (message.target === 'web') {
			if (webProcess && webProcess.connected) {
				webProcess.send(message);
			}
		}
	});

	botProcess.on('exit', (code, signal) => {
		logMaster('System', `${COLOR.red}Discord Bot process exited with code ${code} (signal: ${signal}). Restarting in 3 seconds...`);
		setTimeout(startBot, 3000);
	});
}

startWeb();
startNext();
startBot();