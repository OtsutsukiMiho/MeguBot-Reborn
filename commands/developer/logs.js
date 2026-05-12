const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');

const { BotLogs, COLOR: COLOR } = require('../../bot_functions.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('logs')
		.setDescription('Toggle the logs on or off (Developer Only)')
		.addStringOption(option =>
			option.setName('type')
				.setDescription('Which log type to toggle')
				.setRequired(true)
				.addChoices(
					{ name: 'Audio Queue', value: 'audio_queue_logs' }
				)
		),

	async execute(interaction) {
		const app = await interaction.client.application.fetch();
        const owner = app.owner;
        let isOwner = false;
        
        if (owner.members) {
            isOwner = owner.members.has(interaction.user.id);
        } else {
            isOwner = owner.id === interaction.user.id;
        }

        if (!isOwner) {
            return await interaction.reply({ 
                content: `❌ You do not have permission to use this command.`, 
                flags: MessageFlags.Ephemeral 
            });
        }

		const logType = interaction.options.getString('type');

        const configPath = path.join(__dirname, '../../config.json');
        const rawData = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(rawData);

        if (!config.logs) {
            config.logs = {};
        }
        
        const current = !!config.logs[logType];
        config.logs[logType] = !current;

        fs.writeFileSync(configPath, JSON.stringify(config, null, 4));

        BotLogs("SYSTEM", `${COLOR.cyan}Developer ${COLOR.gray}[${COLOR.white}${interaction.user.tag}${COLOR.gray}] ${COLOR.cyan}toggled ${logType} to ${!current ? `${COLOR.green}ON` : `${COLOR.red}OFF`}${COLOR.cyan}.`);

		return await interaction.reply({ 
			content: `✅ Log setting \`${logType}\` is now **${!current ? 'ON' : 'OFF'}**.`, 
			flags: MessageFlags.Ephemeral 
		});
	},
};