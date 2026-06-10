const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');

const { BotLogs, COLOR } = require('../../bot_functions.js');

const soundsList = [
	{ name: 'เรียกไอบอล (Megu)', value: 'ball_megu' },
	{ name: 'Lin Gan Gu', value: 'lingangu' },
	{ name: 'Megatron', value: 'megatron' },
	{ name: 'Megu Racist', value: 'megu_racist' },
	{ name: 'Momoi Racist', value: 'momoi' },
	{ name: 'Your Phone Is Ringing', value: 'phone' },
	{ name: '9999 IQ', value: 'smort' },
	{ name: 'Viktor', value: 'viktor' },
	{ name: 'Wolf', value: 'wolf' },
	{ name: 'OIIA OIIA', value: 'spinning_cat' },
];

module.exports = {
	data: new SlashCommandBuilder().setName('play').setDescription('play a song')
		.addStringOption(option =>
			option.setName('sound')
				.setDescription('Search for a sound to play')
				.setRequired(true)
				.setAutocomplete(true),
		),

	async autocomplete(interaction) {
		const focusedValue = interaction.options.getFocused();

		const filtered = soundsList.filter(choice =>
			choice.name.toLowerCase().includes(focusedValue.toLowerCase()),
		);

		await interaction.respond(
			filtered.slice(0, 25).map(choice => ({ name: choice.name, value: choice.value })),
		);
	},

	async execute(interaction) {
		const voiceChannel = interaction.member.voice.channel;
		if (!voiceChannel) {
			return await interaction.reply({ content: '❌ You need to join a voice channel first!', flags: MessageFlags.Ephemeral });
		}

		const selectedSound = interaction.options.getString('sound');

		const connection = joinVoiceChannel({
			channelId: voiceChannel.id,
			guildId: interaction.guild.id,
			adapterCreator: interaction.guild.voiceAdapterCreator,
		});

		const soundPath = path.join(__dirname, '../../sounds', `${selectedSound}.mp3`);
		if (!fs.existsSync(soundPath)) {
			BotLogs('SYSTEM', `${COLOR.red}File Not Found: ${COLOR.white}${soundPath}`);
			return await interaction.reply({ content: `❌ Error: Could not find the file for \`${selectedSound}\`.`, flags: MessageFlags.Ephemeral });
		}

		const { addToQueue, generateUUID } = require('../../audio_queue.js');

		const entry = {
			uuid: generateUUID(),
			name: selectedSound,
			file: soundPath,
			type: 'AUDIO_MP3',
			guild: interaction.guild,
			sender: interaction.user,
			voice_channel: voiceChannel,
			connection: connection,
			volume: 0.5,
		};

		const result = addToQueue(interaction.guild.id, entry);

		if (!result.success) {
			if (result.reason === 'SPAM') {
				return await interaction.reply({ content: '❌ Spam detected: You have queued this sound too many times!', flags: MessageFlags.Ephemeral });
			}
			else {
				return await interaction.reply({ content: '❌ The audio queue is currently full!', flags: MessageFlags.Ephemeral });
			}
		}

		BotLogs(interaction.guild.name, `${COLOR.gold}New Audio Added to Queue ${COLOR.gray}[${COLOR.white}${interaction.user.tag}(${entry.type}) - ${entry.name}${COLOR.gray}]`);

		await interaction.reply({
			content: `✅ Added \`${entry.name}\` to the queue!`,
			flags: MessageFlags.Ephemeral,
		});
	},
};