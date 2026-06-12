const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const database = require('../../database.js');
const { BotLogs, COLOR } = require('../../bot_functions.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('tts-channel')
		.setDescription('Configure a text channel for automatic TTS playback')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addSubcommand(subcommand =>
			subcommand
				.setName('set')
				.setDescription('Set the text channel for TTS')
				.addChannelOption(option =>
					option
						.setName('channel')
						.setDescription('The text channel where typed messages will be read out loud')
						.addChannelTypes(ChannelType.GuildText)
						.setRequired(true),
				),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('disable')
				.setDescription('Disable the automatic TTS text channel'),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('status')
				.setDescription('View the TTS channel settings status'),
		),

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();
		const guildId = interaction.guild.id;

		if (!interaction.client.ttsChannels) {
			interaction.client.ttsChannels = new Map();
		}

		if (subcommand === 'set') {
			const channel = interaction.options.getChannel('channel');
			await database.setGuildVar(guildId, 'tts_channel_id', channel.id);

			interaction.client.ttsChannels.set(guildId, channel.id);

			BotLogs(interaction.guild.name, `${COLOR.green}TTS channel set to: ${COLOR.gray}[${COLOR.white}#${channel.name} (${channel.id})${COLOR.gray}]`);

			return await interaction.reply({
				content: `✅ **TTS channel has been set to** <#${channel.id}>. Typing messages there will now automatically speak them in your current Voice Channel.`,
				flags: MessageFlags.Ephemeral,
			});
		}

		if (subcommand === 'disable') {
			await database.deleteGuildVar(guildId, 'tts_channel_id');
			interaction.client.ttsChannels.delete(guildId);

			BotLogs(interaction.guild.name, `${COLOR.red}TTS channel disabled`);

			return await interaction.reply({
				content: '✅ **TTS channel monitoring has been disabled.**',
				flags: MessageFlags.Ephemeral,
			});
		}

		if (subcommand === 'status') {
			const currentChannelId = await database.getGuildVar(guildId, 'tts_channel_id') || interaction.client.ttsChannels.get(guildId);
			if (currentChannelId) {
				return await interaction.reply({
					content: `🔊 **TTS Channel Status:** Enabled\nChannel: <#${currentChannelId}> (\`${currentChannelId}\`)\n\n*Note: To use it, simply type text in that channel while connected to a Voice Channel.*`,
					flags: MessageFlags.Ephemeral,
				});
			}
			else {
				return await interaction.reply({
					content: '🔊 **TTS Channel Status:** Disabled\nUse `/tts-channel set` to configure.',
					flags: MessageFlags.Ephemeral,
				});
			}
		}
	},
};
