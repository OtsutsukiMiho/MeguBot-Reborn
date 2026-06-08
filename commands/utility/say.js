const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const { addToQueue, generateUUID } = require('../../audio_queue.js');
const { BotLogs, COLOR } = require('../../bot_functions.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('say')
		.setDescription('Speak text in a voice channel using TTS')
		.addStringOption(option =>
			option.setName('text')
				.setDescription('The text you want the bot to say')
				.setRequired(true),
		)
		.addStringOption(option =>
			option.setName('lang')
				.setDescription('Select the language for TTS')
				.setRequired(false)
				.addChoices(
					{ name: 'Thai (Default)', value: 'th' },
					{ name: 'English', value: 'en' },
					{ name: 'Japanese', value: 'ja' },
				),
		)
		.addStringOption(option =>
			option.setName('engine')
				.setDescription('Select the TTS engine')
				.setRequired(false)
				.addChoices(
					{ name: 'Microsoft Edge (Neural, Default)', value: 'edge' },
					{ name: 'Google Translate', value: 'google' },
				),
		),

	async execute(interaction) {
		const voiceChannel = interaction.member.voice.channel;
		if (!voiceChannel) {
			return await interaction.reply({
				content: '❌ You need to join a voice channel first!',
				flags: MessageFlags.Ephemeral,
			});
		}

		const text = interaction.options.getString('text');
		const lang = interaction.options.getString('lang') || 'th';
		const engine = interaction.options.getString('engine') || 'google';

		const connection = joinVoiceChannel({
			channelId: voiceChannel.id,
			guildId: interaction.guild.id,
			adapterCreator: interaction.guild.voiceAdapterCreator,
		});

		const type = engine === 'edge' ? 'TTS' : 'GOOGLE_TTS';

		const entry = {
			uuid: generateUUID(),
			name: text,
			lang: lang,
			type: type,
			guild: interaction.guild,
			sender: interaction.user,
			voice_channel: voiceChannel,
			connection: connection,
		};

		const result = addToQueue(interaction.guild.id, entry);

		if (!result.success) {
			if (result.reason === 'SPAM') {
				return await interaction.reply({
					content: '❌ Spam detected: You have queued too many requests!',
					flags: MessageFlags.Ephemeral,
				});
			}
			else {
				return await interaction.reply({
					content: '❌ The audio queue is currently full!',
					flags: MessageFlags.Ephemeral,
				});
			}
		}

		BotLogs(interaction.guild.name, `${COLOR.gold}New TTS Added to Queue ${COLOR.gray}[${COLOR.white}${interaction.user.tag}(${entry.type}) - ${entry.name}${COLOR.gray}]`);

		await interaction.reply({
			content: `📣 Added TTS to the queue: "${text}" (\`${lang}\` via \`${engine}\`)`,
			flags: MessageFlags.Ephemeral,
		});
	},
};
