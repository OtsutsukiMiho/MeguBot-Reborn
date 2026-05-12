const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');

const { BotLogs, COLOR: COLOR } = require('../../bot_functions.js');

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

		const dbPath = `./database/nick/${interaction.guild.id}.json`;
		
		const dir = path.dirname(dbPath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		if (!fs.existsSync(dbPath)) {
			let nick = {
				users: []
			};
			fs.writeFileSync(dbPath, JSON.stringify(nick, null, 2));
			BotLogs("SYSTEM", `${COLOR.dark_purple}Created a nickname database for guild ${COLOR.gray}[${COLOR.white}${interaction.guild.name} (${interaction.guild.id})${COLOR.gray}]`);
		}

		const rawData = fs.readFileSync(dbPath, 'utf8');
		const jsonData = JSON.parse(rawData);

		const userIndex = jsonData.users.findIndex(u => u.id === interaction.user.id);
		const tempName = userIndex !== -1 ? jsonData.users[userIndex].name : "ไม่มีชื่อ";

		if (!newName) {
			return await interaction.reply({ 
				content: `Your current nickname is **${tempName}**`, 
				flags: MessageFlags.Ephemeral 
			});
		}

		if (userIndex !== -1) {
			jsonData.users[userIndex].name = newName;
		} else {
			jsonData.users.push({ id: interaction.user.id, name: newName });
		}

		fs.writeFileSync(dbPath, JSON.stringify(jsonData, null, 2));

		BotLogs(interaction.guild.name, `${COLOR.dark_purple}Nickname Updated: ${COLOR.gray}[${COLOR.white}${interaction.user.tag}${COLOR.gray}] ${COLOR.dark_purple}changed their nickname from ${COLOR.gray}[${COLOR.white}${tempName}${COLOR.gray}] ${COLOR.dark_purple}to ${COLOR.gray}[${COLOR.white}${newName}${COLOR.gray}]`);

		return await interaction.reply({ 
			content: `✅ Your new nickname is **${newName}**`, 
			flags: MessageFlags.Ephemeral 
		});
	},
};
