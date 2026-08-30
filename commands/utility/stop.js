const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { audioQueueManager } = require('../../backend/bot/audio_queue.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('stop')
		.setDescription('Stop audio playback and clear the playback queue'),

	async execute(interaction) {
		const guildId = interaction.guild.id;
		const queue = audioQueueManager.getQueue(guildId);
		const count = queue ? queue.length : 0;

		audioQueueManager.clearQueue(guildId);

		return await interaction.reply({
			content: count > 0
				? `🛑 **Audio playback stopped and ${count} item(s) cleared from queue.**`
				: '🛑 **Audio playback stopped.**',
		});
	},
};
