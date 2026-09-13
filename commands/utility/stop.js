const { SlashCommandBuilder } = require('discord.js');
const { executeAction } = require('./queue.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('stop')
		.setDescription('Stop playback and clear the audio queue')
		.setDescriptionLocalizations({ th: 'หยุดและล้างคิวเสียงทั้งหมด' })
		.setDMPermission(false),

	async execute(interaction, dependencies = {}) {
		return await executeAction(interaction, 'clear', dependencies);
	},
};
