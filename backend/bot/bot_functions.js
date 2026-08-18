const fs = require("fs");
const path = require('path');

let checkLoggedDate = false;
let config;

const COLOR = {
    new: (r, g, b) => `\x1b[38;2;${r};${g};${b}m`,
    
    reset: "\x1b[0m",
    black: `\x1b[38;2;0;0;0m`,
    dark_blue: `\x1b[38;2;0;0;170m`,
    dark_green: `\x1b[38;2;0;170;0m`,
    dark_red: `\x1b[38;2;170;0;0m`,
    dark_purple: `\x1b[38;2;170;0;170m`,
    dark_gray: `\x1b[38;2;85;85;85m`,
    cyan: `\x1b[38;2;0;170;170m`,
    gold: `\x1b[38;2;255;170;0m`,
    blue: `\x1b[38;2;85;85;255m`,
    green: `\x1b[38;2;85;255;85m`,
    aqua: `\x1b[38;2;85;255;255m`,
    red: `\x1b[38;2;255;85;85m`,
    yellow: `\x1b[38;2;255;255;85m`,
    gray: `\x1b[38;2;170;170;170m`,
    white: `\x1b[38;2;255;255;255m`,
    pink: `\x1b[38;2;255;85;255m`
};

const recentLogsBuffer = [];

function resolveCategory(host) {
	if (!host) return { label: 'System', color: COLOR.white };
	const h = String(host).toUpperCase().trim();
	if (h === 'SYSTEM' || h === 'MAIN') return { label: 'System', color: COLOR.white };
	if (h === 'AUDIO' || h === 'TTS' || h === 'AUDIOQUEUE' || h === 'VOICE') return { label: 'TTS', color: COLOR.gold };
	if (h === 'WEB' || h === 'EXPRESS' || h === 'NEXT') return { label: 'Web', color: COLOR.cyan };
	if (h === 'AUTOMOD' || h === 'HONEYPOT' || h === 'SECURITY') return { label: 'AutoMod', color: COLOR.red };
	if (h === 'DATABASE' || h === 'DB') return { label: 'Database', color: COLOR.green };
	return { label: 'Bot', color: COLOR.pink };
}

function addLogEntry(logItem) {
	if (!logItem || !logItem.message) return;
	recentLogsBuffer.push(logItem);
	if (recentLogsBuffer.length > 500) {
		recentLogsBuffer.shift();
	}
}

function checkDate() {
    try {
        if (checkLoggedDate) return;
        config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
        let now = new Date();
        let options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
        let currentDate = now.toLocaleDateString('en-GB', options);

        if (currentDate !== config.lastLoggedDate) {
            checkLoggedDate = true;
            BotLogs("System", `${COLOR.pink}---------------------------------------------------------------`);
            BotLogs("System", `${COLOR.pink}Starting a New Day: 📅 ${COLOR.white}${currentDate}`);
            BotLogs("System", `${COLOR.pink}---------------------------------------------------------------`);
            config.lastLoggedDate = currentDate;
            fs.writeFileSync('./config.json', JSON.stringify(config, null, 4));
            checkLoggedDate = false;
        }
    } catch (error) {
        console.log(`${COLOR.red}---------------------------------------------------------------${COLOR.reset}`);
        console.log(`${COLOR.red}Error Occurred in checkDate: ${COLOR.white}"${error.toString()}" ${COLOR.red}from ${COLOR.white}"${path.basename(__filename)}"${COLOR.reset}`);
        console.log(`${COLOR.red}---------------------------------------------------------------${COLOR.reset}`);
    }
}

checkDate();

function BotLogs(host, msg) {
	checkDate();
	const now = new Date();
	const now_hours = now.getHours().toString().padStart(2, '0');
	const now_mins = now.getMinutes().toString().padStart(2, '0');
	const now_seconds = now.getSeconds().toString().padStart(2, '0');
	const timeStr = `${now_hours}:${now_mins}:${now_seconds}`;

	const { label, color } = resolveCategory(host);
	const cleanMsg = typeof msg === 'string' ? msg.replace(/\x1b\[[0-9;]*m/g, '') : String(msg);

	const logItem = {
		timestamp: timeStr,
		category: label,
		host: typeof host === 'string' ? host : label,
		message: cleanMsg,
	};

	addLogEntry(logItem);

	if (process.send) {
		try {
			process.send({ target: 'web', type: 'log_entry', log: logItem });
		}
		catch {}
	}

	console.log(`${COLOR.gray}[${COLOR.white}${timeStr}${COLOR.gray}] [${color}${label}${COLOR.gray}] ${msg}${COLOR.reset}`);
}

function getRecentLogs() {
	return recentLogsBuffer;
}

function parseReactionRolesMap(raw) {
	if (!raw) return {};
	let parsed = raw;
	if (typeof parsed === 'string') {
		try { parsed = JSON.parse(parsed); } catch { return {}; }
	}
	if (typeof parsed === 'string') {
		try { parsed = JSON.parse(parsed); } catch { return {}; }
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return {};
	}
	return parsed;
}

exports.BotLogs = BotLogs;
exports.COLOR = COLOR;
exports.parseReactionRolesMap = parseReactionRolesMap;
exports.getRecentLogs = getRecentLogs;
exports.addLogEntry = addLogEntry;
