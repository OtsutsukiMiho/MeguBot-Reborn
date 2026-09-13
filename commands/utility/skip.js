const { SlashCommandBuilder } = require('discord.js');
const { executeAction } = require('./queue.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('skip')
		.setDescription('Skip the current audio item')
		.setDescriptionLocalizations({ th: 'ข้ามรายการเสียงปัจจุบัน' })
		.setDMPermission(false),

	async execute(interaction, dependencies = {}) {
		return await executeAction(interaction, 'skip', dependencies);
	},
};
