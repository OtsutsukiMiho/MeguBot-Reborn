const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder().setName('ping').setDescription('Replies with Pong!'),
	async execute(interaction) {
		await interaction.reply({ content: 'Secret Pong!', flags: MessageFlags.Ephemeral });
		await interaction.editReply('Pong again!');
	},
};