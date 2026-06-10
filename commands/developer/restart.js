const { SlashCommandBuilder, MessageFlags } = require('discord.js');

const { BotLogs, COLOR: COLOR } = require('../../bot_functions.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('restart')
		.setDescription('Restart the bot (Developer Only)'),

	async execute(interaction) {
		const app = await interaction.client.application.fetch();
		const owner = app.owner;
		const isOwner = owner.members
			? owner.members.has(interaction.user.id)
			: owner.id === interaction.user.id;

		if (!isOwner) {
			return await interaction.reply({
				content: '❌ You do not have permission to use this command.',
				flags: MessageFlags.Ephemeral,
			});
		}

		await interaction.reply({
			content: '✅ Restarting...',
			flags: MessageFlags.Ephemeral,
		});

		const bot = interaction.client;

		BotLogs('SYSTEM', `${COLOR.yellow}Restarting...`);

		bot.destroy();
		setTimeout(() => {
			process.exit();
		}, 2000);
	},
};
