const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ChannelType } = require('discord.js');
const database = require('../../database.js');
const { BotLogs, COLOR } = require('../../bot_functions.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('leave')
		.setDescription('Configure leave message settings for members who leave')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addSubcommand(subcommand =>
			subcommand
				.setName('set')
				.setDescription('Set leave message channel and edit template')
				.addChannelOption(option =>
					option
						.setName('channel')
						.setDescription('The text channel to send leave notifications in')
						.addChannelTypes(ChannelType.GuildText)
						.setRequired(true),
				),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('disable')
				.setDescription('Disable leave messages'),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('status')
				.setDescription('View the leave message status'),
		),

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();
		const guildId = interaction.guild.id;

		if (subcommand === 'set') {
			const channel = interaction.options.getChannel('channel');

			const currentTemplate = await database.getGuildVar(guildId, 'leave_message_template') || '{username} has left {server}.';

			const modal = new ModalBuilder()
				.setCustomId(`leave_modal_${channel.id}`)
				.setTitle('Setup Leave Message');

			const templateInput = new TextInputBuilder()
				.setCustomId('leave_message_input')
				.setLabel('Leave Message Template')
				.setStyle(TextInputStyle.Paragraph)
				.setPlaceholder('Tokens: {member} (mention), {username} (name), {server} (server)')
				.setValue(currentTemplate)
				.setRequired(true)
				.setMaxLength(2000);

			const actionRow = new ActionRowBuilder().addComponents(templateInput);
			modal.addComponents(actionRow);

			return await interaction.showModal(modal);
		}

		if (subcommand === 'disable') {
			await database.deleteGuildVar(guildId, 'leave_channel_id');
			await database.deleteGuildVar(guildId, 'leave_message_template');
			BotLogs(interaction.guild.name, `${COLOR.red}Leave messages disabled`);

			return await interaction.reply({
				content: '✅ **Leave messages have been disabled.**',
				flags: MessageFlags.Ephemeral,
			});
		}

		if (subcommand === 'status') {
			const leaveChannelId = await database.getGuildVar(guildId, 'leave_channel_id');
			const template = await database.getGuildVar(guildId, 'leave_message_template');

			if (leaveChannelId && template) {
				return await interaction.reply({
					content: `🛡️ **Leave Messages Status:** Enabled\nChannel: <#${leaveChannelId}> (\`${leaveChannelId}\`)\nTemplate: \`\`\`${template}\`\`\``,
					flags: MessageFlags.Ephemeral,
				});
			}
			else {
				return await interaction.reply({
					content: '🛡️ **Leave Messages Status:** Disabled\nUse `/leave set` to configure.',
					flags: MessageFlags.Ephemeral,
				});
			}
		}
	},
};
