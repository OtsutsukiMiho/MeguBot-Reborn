require('dotenv').config();

const { REST, Routes } = require('discord.js');
const {
	isGlobalBlock,
	isSevereRateLimit,
	INVALID_REQUEST_WARNING_INTERVAL,
	BLOCK_EXIT_CODE,
} = require('./adapters/discord/rate-limit.js');
const config = require('./config.json');
const clientId = process.env.DISCORD_CLIENT_ID || config.clientId;
const fs = require('node:fs');
const path = require('node:path');

const commands = [];
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

const bot_functions = require('./backend/bot/bot_functions.js');
const BotLogs = bot_functions.BotLogs;
const COLOR = bot_functions.COLOR;

for (const folder of commandFolders) {
	const commandsPath = path.join(foldersPath, folder);
	const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const command = require(filePath);
		if ('data' in command && 'execute' in command) {
			commands.push(command.data.toJSON());
		}
		else {
			BotLogs('SYSTEM', `${COLOR.yellow}Warning: ${COLOR.white}The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
}

// The same `rest` block the bot's Client gets, for the same reason.
//
// @discordjs/rest's default handler for an unexpected 429 sleeps and re-sends
// without incrementing the retry counter, so that path has no cap — and a
// Cloudflare block answers 429 with no rate-limit headers, which makes the
// sleep zero-length. That is a busy loop against an IP that was banned for
// sending too much, and the promise never settles, so the catch below would
// never run. See DISCORD-RATE-LIMITS.md §3b.
//
// This script is one request and is deliberately only run by `npm run deploy`.
// Registering commands on every service wake is unnecessary boot traffic.
let severeRateLimitSeen = false;
const rest = new REST({
	retries: 1,
	invalidRequestWarningInterval: INVALID_REQUEST_WARNING_INTERVAL,
	rejectOnRateLimit: (data) => {
		const severe = isSevereRateLimit(data);
		severeRateLimitSeen ||= severe;
		return severe;
	},
}).setToken(process.env.BOT_TOKEN);

(async () => {
	try {
		BotLogs('SYSTEM', `${COLOR.yellow}Started refreshing ${COLOR.white}${commands.length} ${COLOR.yellow}application (/) commands.`);

		const data = await rest.put(Routes.applicationCommands(clientId), { body: commands });

		BotLogs('SYSTEM', `${COLOR.green}Successfully reloaded ${COLOR.white}${data.length} ${COLOR.green}application (/) commands.`);
	}
	catch (error) {
		BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
		BotLogs('SYSTEM', `${COLOR.red}Error Occurred: ${COLOR.white}${error.toString().replace(/^Error: /, '')}`);
		BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);

		// A severe limit must make command deployment fail, not look successful
		// and invite an immediate service restart into the same restriction.
		//
		// Every other failure — a bad token, a network blip — keeps the old
		// behaviour because an out-of-date command list is still present and this
		// script is no longer in the normal service boot path.
		if (isGlobalBlock(error) || severeRateLimitSeen) {
			BotLogs('SYSTEM', `${COLOR.red}Discord is blocking this server's IP. Not starting the bot — a restart now would extend the block. See DISCORD-RATE-LIMITS.md.`);
			process.exit(BLOCK_EXIT_CODE);
		}
	}
})();
