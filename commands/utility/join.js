const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');

const { BotLogs, COLOR } = require('../../bot_functions.js');

module.exports = {
	data: new SlashCommandBuilder().setName('join').setDescription('Connect to your current voice channel.'),
	async execute(interaction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const voiceChannel = interaction.member.voice.channel;
		if (!voiceChannel) return await interaction.editReply('❌ You need to join a voice channel first!');

		joinVoiceChannel({
			channelId: voiceChannel.id,
			guildId: interaction.guild.id,
			adapterCreator: interaction.guild.voiceAdapterCreator,
		});

		BotLogs(interaction.guild.name, `${COLOR.blue}✅ Connected to the voice channel! ${COLOR.gray}[${COLOR.white}${voiceChannel.name}${COLOR.gray}]`);
		await interaction.editReply('✅ Connected to the voice channel!');
	},
};