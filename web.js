const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { BotLogs } = require('./bot_functions.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
	res.status(200).send('OK');
});

app.get('/api/health-stats', (req, res) => {
	let version = 'unknown';
	try {
		const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
		version = config.version || 'unknown';
	}
	catch {
		// Ignore
	}

	const statsFilePath = path.join(__dirname, 'bot-stats.json');
	let botStats = null;

	if (fs.existsSync(statsFilePath)) {
		try {
			const rawData = fs.readFileSync(statsFilePath, 'utf8');
			const parsed = JSON.parse(rawData);

			if (parsed && parsed.timestamp && (Date.now() - parsed.timestamp < 10000)) {
				botStats = parsed;
			}
		}
		catch {
			// Ignore
		}
	}

	if (botStats) {
		res.json({
			status: botStats.status,
			uptime: botStats.uptime,
			readyTimestamp: botStats.readyTimestamp,
			ping: botStats.ping,
			version: botStats.version || version,
			nodeVersion: process.version,
			platform: process.platform,
			memory: {
				rss: botStats.memory.rss,
				heapUsed: botStats.memory.heapUsed,
				heapTotal: botStats.memory.heapTotal,
			},
		});
	}
	else {
		res.json({
			status: 'offline',
			uptime: 0,
			readyTimestamp: 0,
			ping: 0,
			version: version,
			nodeVersion: process.version,
			platform: process.platform,
			memory: {
				rss: '0.0 MB',
				heapUsed: '0.0 MB',
				heapTotal: '0.0 MB',
			},
		});
	}
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

app.get('/', (req, res) => {
	res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
	BotLogs('SYSTEM', `Express health check server running on port ${PORT}`);
});
