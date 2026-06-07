const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const { BotLogs, COLOR } = require('../../bot_functions.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('uptime')
		.setDescription('Replies with the bot\'s current uptime and status metrics'),

	async execute(interaction) {
		const client = interaction.client;
		const uptimeMs = client.uptime;

		const totalSeconds = Math.floor(uptimeMs / 1000);
		const days = Math.floor(totalSeconds / 86400);
		const hours = Math.floor((totalSeconds % 86400) / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		const timeParts = [];
		if (days > 0) timeParts.push(`${days} day${days !== 1 ? 's' : ''}`);
		if (hours > 0) timeParts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
		if (minutes > 0) timeParts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
		if (seconds > 0 || timeParts.length === 0) timeParts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);

		const uptimeString = timeParts.join(', ');

		const readyTimestampSeconds = Math.floor(client.readyTimestamp / 1000);

		let version = 'unknown';
		try {
			const configPath = path.join(__dirname, '..', '..', 'config.json');
			const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
			version = config.version || 'unknown';
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Error reading config.json in uptime command: ${error.toString()}`);
		}

		const wsPing = client.ws.ping;

		BotLogs(interaction.guild.name, `${COLOR.cyan}Uptime command executed by ${COLOR.white}${interaction.user.tag}`);

		return await interaction.reply({
			content: '🟢 **MeguBot Reborn Status**\n' +
				`• **Uptime:** \`${uptimeString}\`\n` +
				`• **Online Since:** <t:${readyTimestampSeconds}:F> (<t:${readyTimestampSeconds}:R>)\n` +
				`• **API Latency:** \`${wsPing}ms\`\n` +
				`• **Bot Version:** \`v${version}\``,
			flags: MessageFlags.Ephemeral,
		});
	},
};
