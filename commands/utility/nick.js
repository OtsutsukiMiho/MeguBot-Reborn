const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../../database.js');
const { BotLogs, COLOR } = require('../../bot_functions.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('nick')
		.setDescription('View or change your nickname for the bot TTS')
		.addStringOption(option =>
			option.setName('name')
				.setDescription('Your new nickname')
				.setRequired(false)
		),

	async execute(interaction) {
		const newName = interaction.options.getString('name');
		const guildId = interaction.guild.id;
		const userId = interaction.user.id;

		const tempName = await database.getUserNick(guildId, userId);

		if (!newName) {
			return await interaction.reply({ 
				content: `Your current nickname is **${tempName}**`, 
				flags: MessageFlags.Ephemeral 
			});
		}

		await database.setUserNick(guildId, userId, newName);

		BotLogs(interaction.guild.name, `${COLOR.dark_purple}Nickname Updated: ${COLOR.gray}[${COLOR.white}${interaction.user.tag}${COLOR.gray}] ${COLOR.dark_purple}changed their nickname from ${COLOR.gray}[${COLOR.white}${tempName}${COLOR.gray}] ${COLOR.dark_purple}to ${COLOR.gray}[${COLOR.white}${newName}${COLOR.gray}]`);

		return await interaction.reply({ 
			content: `✅ Your new nickname is **${newName}**`, 
			flags: MessageFlags.Ephemeral 
		});
	},
};
