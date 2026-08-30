const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { audioQueueManager } = require('../../backend/bot/audio_queue.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('queue')
		.setDescription('View or manage the audio and TTS playback queue')
		.addSubcommand(subcommand =>
			subcommand
				.setName('view')
				.setDescription('Display the current audio playback queue'),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('clear')
				.setDescription('Clear all pending audio clips from the queue'),
		),

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand(false) || 'view';
		const guildId = interaction.guild.id;

		if (subcommand === 'clear') {
			const queue = audioQueueManager.getQueue(guildId);
			const count = queue ? queue.length : 0;

			if (count === 0) {
				return await interaction.reply({
					content: 'ℹ️ **The audio queue is already empty.**',
					flags: MessageFlags.Ephemeral,
				});
			}

			audioQueueManager.clearQueue(guildId);
			return await interaction.reply({
				content: `🧹 **Cleared ${count} item(s) from the audio queue.**`,
			});
		}

		// View Subcommand
		const queue = audioQueueManager.getQueue(guildId);
		const count = queue ? queue.length : 0;

		if (count === 0) {
			return await interaction.reply({
				content: 'ℹ️ **The audio queue is currently empty.** Use `/play` or speak in a TTS channel to queue audio!',
			});
		}

		const currentItem = queue[0];
		const upcoming = queue.slice(1, 11); // Show up to 10 upcoming

		const embed = new EmbedBuilder()
			.setTitle(`🎵 Audio Queue — ${interaction.guild.name}`)
			.setColor(0x3B82F6)
			.addFields({
				name: '▶️ Currently Playing',
				value: `**"${currentItem.text}"**\n*Requested by:* ${currentItem.options?.userName || 'System'} • *Type:* \`${currentItem.options?.type || 'TTS'}\``,
				inline: false,
			});

		if (upcoming.length > 0) {
			const upcomingList = upcoming.map((item, idx) => {
				return `\`${idx + 1}.\` **"${item.text}"** (${item.options?.userName || 'System'})`;
			}).join('\n');

			const remaining = count - 1 - upcoming.length;
			const footerExtra = remaining > 0 ? `\n*...and ${remaining} more item(s)*` : '';

			embed.addFields({
				name: `📋 Up Next (${count - 1} item${count - 1 === 1 ? '' : 's'})`,
				value: upcomingList + footerExtra,
				inline: false,
			});
		} else {
			embed.addFields({
				name: '📋 Up Next',
				value: '*No upcoming items in queue.*',
				inline: false,
			});
		}

		embed.setFooter({ text: `Total Queue Length: ${count} item(s)` });
		embed.setTimestamp();

		return await interaction.reply({ embeds: [embed] });
	},
};
