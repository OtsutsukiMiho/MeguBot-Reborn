const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getReadyVoiceConnection } = require('../../backend/bot/voice_connection.js');

const { BotLogs, COLOR } = require('../../backend/bot/bot_functions.js');

module.exports = {
	data: new SlashCommandBuilder().setName('join').setDescription('Connect to your current voice channel.'),
	async execute(interaction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const voiceChannel = interaction.member.voice.channel;
		if (!voiceChannel) return await interaction.editReply('❌ You need to join a voice channel first!');

		try {
			await getReadyVoiceConnection(interaction.guild, voiceChannel, {
				onError: ({ error, status }) => BotLogs(
					interaction.guild.name,
					`${COLOR.red}Voice connection error ${COLOR.gray}[${status || 'unknown'}]${COLOR.red}: ${COLOR.white}${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500)}`,
				),
			});
		}
		catch (error) {
			BotLogs(interaction.guild.name, `${COLOR.red}Could not join ${COLOR.white}${voiceChannel.name}${COLOR.red}: ${error.cause?.message || error.message}`);
			return await interaction.editReply('❌ I could not establish a Discord voice connection. Please try again.');
		}

		BotLogs(interaction.guild.name, `${COLOR.blue}✅ Connected to the voice channel! ${COLOR.gray}[${COLOR.white}${voiceChannel.name}${COLOR.gray}]`);
		await interaction.editReply('✅ Connected to the voice channel!');
	},
};
