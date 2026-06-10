const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { BotLogs, COLOR } = require('../../bot_functions.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('purge')
		.setDescription('Bulk delete messages in this channel')
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
		.addIntegerOption(option =>
			option.setName('amount')
				.setDescription('Number of messages to delete (1-100)')
				.setRequired(true)
				.setMinValue(1)
				.setMaxValue(100),
		),

	async execute(interaction) {
		const amount = interaction.options.getInteger('amount');
		const channel = interaction.channel;

		const botMember = interaction.guild.members.me;
		const botPermissions = channel.permissionsFor(botMember);
		if (!botPermissions || !botPermissions.has(PermissionFlagsBits.ManageMessages)) {
			return await interaction.reply({
				content: '❌ **Error:** I do not have permission to manage messages in this channel.',
				flags: MessageFlags.Ephemeral,
			});
		}

		try {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			const deleted = await channel.bulkDelete(amount, true);

			BotLogs(interaction.guild.name, `${COLOR.red}Messages purged: deleted ${COLOR.white}${deleted.size}${COLOR.red} messages in ${COLOR.white}#${channel.name}${COLOR.red} by ${COLOR.white}${interaction.user.tag}`);

			return await interaction.editReply({
				content: `✅ Successfully purged **${deleted.size}** messages!`,
			});
		}
		catch (error) {
			BotLogs(interaction.guild.name, `${COLOR.red}Error executing purge: ${error.toString()}`);
			return await interaction.editReply({
				content: '❌ Failed to purge messages. (Note: messages older than 14 days cannot be bulk-deleted).',
			});
		}
	},
};
