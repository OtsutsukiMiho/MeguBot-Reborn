const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { audioQueueManager } = require('../../backend/bot/audio_queue.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('skip')
		.setDescription('Skip the currently playing audio clip or TTS message'),

	async execute(interaction) {
		const guildId = interaction.guild.id;
		const queue = audioQueueManager.getQueue(guildId);

		if (!queue || queue.length === 0) {
			return await interaction.reply({
				content: '❌ **No audio is currently playing in this server.**',
				flags: MessageFlags.Ephemeral,
			});
		}

		const currentItem = queue[0];
		const success = audioQueueManager.skipCurrent(guildId);

		if (success) {
			return await interaction.reply({
				content: `⏭️ **Skipped:** "${currentItem ? currentItem.text : 'Current track'}"`,
			});
		} else {
			return await interaction.reply({
				content: '❌ **Failed to skip audio clip.**',
				flags: MessageFlags.Ephemeral,
			});
		}
	},
};
