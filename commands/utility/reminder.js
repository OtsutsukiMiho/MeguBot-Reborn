const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../../database.js');
const { BotLogs, COLOR } = require('../../bot_functions.js');

function parseTimeInput(timeStr) {
	timeStr = timeStr.trim().toLowerCase();

	const relativeRegex = /^(\d+)([smhd])$/;
	const relativeMatch = timeStr.match(relativeRegex);
	if (relativeMatch) {
		const value = parseInt(relativeMatch[1], 10);
		const unit = relativeMatch[2];
		let ms = 0;
		switch (unit) {
		case 's': ms = value * 1000; break;
		case 'm': ms = value * 60000; break;
		case 'h': ms = value * 3600000; break;
		case 'd': ms = value * 86400000; break;
		}
		return {
			targetTime: Date.now() + ms,
			recurring: false,
		};
	}

	const dailyRegex = /^(\d{1,2})[:.](\d{2})(?:\s*everyday)?$/;
	const dailyMatch = timeStr.match(dailyRegex);
	if (dailyMatch) {
		const hours = parseInt(dailyMatch[1], 10);
		const minutes = parseInt(dailyMatch[2], 10);

		if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
			return null;
		}

		const now = new Date();
		const target = new Date();
		target.setHours(hours, minutes, 0, 0);

		if (target.getTime() <= now.getTime()) {
			target.setDate(target.getDate() + 1);
		}

		return {
			targetTime: target.getTime(),
			recurring: true,
		};
	}

	return null;
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('reminder')
		.setDescription('Set a reminder')
		.addStringOption(option =>
			option
				.setName('time')
				.setDescription('Time duration (e.g. 10s, 5m, 2h, 1d) or daily time (e.g. 15:00 everyday)')
				.setRequired(true),
		)
		.addStringOption(option =>
			option
				.setName('message')
				.setDescription('The reminder message')
				.setRequired(true),
		),

	async execute(interaction) {
		const timeInput = interaction.options.getString('time');
		const messageInput = interaction.options.getString('message');

		const parsed = parseTimeInput(timeInput);
		if (!parsed) {
			return await interaction.reply({
				content: '❌ **Invalid time format!** Please use relative time (e.g., `10s`, `5m`, `2h`, `1d`) or daily time (e.g., `15:00 everyday`, `15.00`).',
				flags: MessageFlags.Ephemeral,
			});
		}

		const { targetTime, recurring } = parsed;

		if (!recurring && (targetTime - Date.now() < 5000)) {
			return await interaction.reply({
				content: '❌ **Reminder must be at least 5 seconds!**',
				flags: MessageFlags.Ephemeral,
			});
		}
		if (!recurring && (targetTime - Date.now() > 30 * 24 * 60 * 60 * 1000)) {
			return await interaction.reply({
				content: '❌ **Reminder cannot be set for more than 30 days!**',
				flags: MessageFlags.Ephemeral,
			});
		}

		const targetTimestampSeconds = Math.floor(targetTime / 1000);

		await database.addReminder(
			interaction.user.id,
			interaction.guild.id,
			interaction.channel.id,
			targetTime,
			messageInput,
			recurring,
		);

		BotLogs(interaction.guild.name, `${COLOR.green}Reminder set by ${interaction.user.tag}: "${messageInput}" for ${timeInput} (recurring: ${recurring})`);

		if (recurring) {
			return await interaction.reply({
				content: `✅ **Recurring reminder set!** I will remind you about: "${messageInput}" every day at **${timeInput.replace(' everyday', '')}** (next: <t:${targetTimestampSeconds}:R>).`,
			});
		}
		else {
			return await interaction.reply({
				content: `✅ **Reminder set!** I will remind you about: "${messageInput}" <t:${targetTimestampSeconds}:R> (<t:${targetTimestampSeconds}:f>).`,
			});
		}
	},
};
