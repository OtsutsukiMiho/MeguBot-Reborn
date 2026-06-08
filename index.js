const { fork } = require('child_process');
const path = require('path');
const { BotLogs, COLOR } = require('./bot_functions.js');

let webProcess = null;
let botProcess = null;

function startWeb() {
	BotLogs('SYSTEM', `${COLOR.cyan}Starting Web Server process...`);
	webProcess = fork(path.join(__dirname, 'web.js'));

	webProcess.on('exit', (code, signal) => {
		BotLogs('SYSTEM', `${COLOR.red}Web Server process exited with code ${code} (signal: ${signal}). Restarting in 3 seconds...`);
		setTimeout(startWeb, 3000);
	});
}

function startBot() {
	BotLogs('SYSTEM', `${COLOR.cyan}Starting Discord Bot process...`);
	botProcess = fork(path.join(__dirname, 'bot.js'));

	botProcess.on('exit', (code, signal) => {
		BotLogs('SYSTEM', `${COLOR.red}Discord Bot process exited with code ${code} (signal: ${signal}). Restarting in 3 seconds...`);
		setTimeout(startBot, 3000);
	});
}

// Start both processes managed under this supervisor
startWeb();
startBot();