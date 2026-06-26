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

		const nowUTC = Date.now();
		const offsetMs = 7 * 60 * 60 * 1000;
		const nowICT = new Date(nowUTC + offsetMs);

		const targetICT = new Date(nowUTC + offsetMs);
		targetICT.setUTCHours(hours, minutes, 0, 0);

		if (targetICT.getTime() <= nowICT.getTime()) {
			targetICT.setUTCDate(targetICT.getUTCDate() + 1);
		}

		return {
			targetTime: targetICT.getTime() - offsetMs,
			recurring: true,
		};
	}

	return null;
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('reminder')
		.setDescription('Manage reminders')
		.addSubcommand(subcommand =>
			subcommand
				.setName('set')
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
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('delete')
				.setDescription('Delete a reminder by ID')
				.addStringOption(option =>
					option
						.setName('id')
						.setDescription('The ID of the reminder to delete')
						.setRequired(true),
				),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('list')
				.setDescription('List your active reminders'),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('clear_all')
				.setDescription('Globally clear all reminders from the database (Developer Only)'),
		),

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();

		if (subcommand === 'set') {
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
					content: `✅ **Recurring reminder set!** I will remind you about: "${messageInput}" every day at **${timeInput.toLowerCase().replace(' everyday', '')}** (next: <t:${targetTimestampSeconds}:R>).`,
					flags: MessageFlags.Ephemeral,
				});
			}
			else {
				return await interaction.reply({
					content: `✅ **Reminder set!** I will remind you about: "${messageInput}" <t:${targetTimestampSeconds}:R> (<t:${targetTimestampSeconds}:f>).`,
					flags: MessageFlags.Ephemeral,
				});
			}
		}

		if (subcommand === 'delete') {
			const idInput = interaction.options.getString('id');
			const activeReminders = await database.getActiveReminders();
			const reminder = activeReminders.find(r => String(r.id) === idInput);

			if (!reminder) {
				return await interaction.reply({
					content: '❌ **Reminder not found!** Make sure you entered a valid ID from `/reminder list`.',
					flags: MessageFlags.Ephemeral,
				});
			}

			if (reminder.user_id !== interaction.user.id) {
				return await interaction.reply({
					content: '❌ **Access Denied!** You can only delete your own reminders.',
					flags: MessageFlags.Ephemeral,
				});
			}

			await database.deleteReminder(reminder.id);
			BotLogs(interaction.guild.name, `${COLOR.red}Reminder ID ${reminder.id} deleted by ${interaction.user.tag}`);

			return await interaction.reply({
				content: '✅ **Reminder deleted successfully!**',
				flags: MessageFlags.Ephemeral,
			});
		}

		if (subcommand === 'list') {
			const activeReminders = await database.getActiveReminders();
			const myReminders = activeReminders.filter(r => r.user_id === interaction.user.id && r.guild_id === interaction.guild.id);

			if (myReminders.length === 0) {
				return await interaction.reply({
					content: '⏰ **You have no active reminders in this server.** Use `/reminder set` to create one!',
					flags: MessageFlags.Ephemeral,
				});
			}

			let listStr = '⏰ **Your Active Reminders:**\n\n';
			myReminders.forEach((r, idx) => {
				const timeSec = Math.floor(r.reminder_time / 1000);
				const recurringStr = r.recurring ? '🔄 Daily' : '⏱️ One-time';
				listStr += `${idx + 1}. **"${r.message}"** (${recurringStr})\n   • Next: <t:${timeSec}:f> (<t:${timeSec}:R>)\n   • ID: \`${r.id}\`\n\n`;
			});

			return await interaction.reply({
				content: listStr,
				flags: MessageFlags.Ephemeral,
			});
		}

		if (subcommand === 'clear_all') {
			const app = await interaction.client.application.fetch();
			const owner = app.owner;
			const isOwner = owner.members
				? owner.members.has(interaction.user.id)
				: owner.id === interaction.user.id;

			if (!isOwner) {
				return await interaction.reply({
					content: '❌ **Permission Denied!** This subcommand is reserved for the bot developer.',
					flags: MessageFlags.Ephemeral,
				});
			}

			await database.clearAllReminders();
			BotLogs(interaction.guild.name, `${COLOR.red}Global reminders database cleared by developer ${interaction.user.tag}`);

			return await interaction.reply({
				content: '✅ **All reminders in the database have been globally cleared!**',
				flags: MessageFlags.Ephemeral,
			});
		}
	},
};
