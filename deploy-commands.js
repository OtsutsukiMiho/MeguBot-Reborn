require('dotenv').config();

const { REST, Routes } = require('discord.js');
const { clientId, token } = require('./config.json');
const fs = require('node:fs');
const path = require('node:path');

const commands = [];
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

const bot_functions = require('./bot_functions.js');
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
        } else {
            BotLogs("SYSTEM", `${COLOR.yellow}Warning: ${COLOR.white}The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

const rest = new REST().setToken(process.env.BOT_TOKEN);

(async () => {
    try {
        BotLogs("SYSTEM", `${COLOR.yellow}Started refreshing ${COLOR.white}${commands.length} ${COLOR.yellow}application (/) commands.`);

        const data = await rest.put(Routes.applicationCommands(clientId), { body: commands });

        BotLogs("SYSTEM", `${COLOR.green}Successfully reloaded ${COLOR.white}${data.length} ${COLOR.green}application (/) commands.`);
    } catch (error) {
        BotLogs("SYSTEM", `${COLOR.red}---------------------------------------------------------------`);
        BotLogs("SYSTEM", `${COLOR.red}Error Occurred: ${COLOR.white}${error.toString().replace(/^Error: /, "")}`);
        BotLogs("SYSTEM", `${COLOR.red}---------------------------------------------------------------`);
    }
})();