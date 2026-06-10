const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ChannelType } = require('discord.js');
const database = require('../../database.js');
const { BotLogs, COLOR } = require('../../bot_functions.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('welcome')
		.setDescription('Configure welcome message settings for new members')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addSubcommand(subcommand =>
			subcommand
				.setName('set')
				.setDescription('Set welcome message channel and edit template')
				.addChannelOption(option =>
					option
						.setName('channel')
						.setDescription('The text channel to send welcomes in')
						.addChannelTypes(ChannelType.GuildText)
						.setRequired(true),
				),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('disable')
				.setDescription('Disable welcome messages'),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('status')
				.setDescription('View the welcome message status'),
		),

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();
		const guildId = interaction.guild.id;

		if (subcommand === 'set') {
			const channel = interaction.options.getChannel('channel');

			const currentTemplate = await database.getGuildVar(guildId, 'welcome_message_template') || 'Welcome {member} to {server}!';

			const modal = new ModalBuilder()
				.setCustomId(`welcome_modal_${channel.id}`)
				.setTitle('Setup Welcome Message');

			const templateInput = new TextInputBuilder()
				.setCustomId('welcome_message_input')
				.setLabel('Welcome Message Template')
				.setStyle(TextInputStyle.Paragraph)
				.setPlaceholder('Tokens: {member} (mention user), {server} (server name)')
				.setValue(currentTemplate)
				.setRequired(true)
				.setMaxLength(2000);

			const actionRow = new ActionRowBuilder().addComponents(templateInput);
			modal.addComponents(actionRow);

			return await interaction.showModal(modal);
		}

		if (subcommand === 'disable') {
			await database.deleteGuildVar(guildId, 'welcome_channel_id');
			await database.deleteGuildVar(guildId, 'welcome_message_template');
			BotLogs(interaction.guild.name, `${COLOR.red}Welcome messages disabled`);

			return await interaction.reply({
				content: '✅ **Welcome messages have been disabled.**',
				flags: MessageFlags.Ephemeral,
			});
		}

		if (subcommand === 'status') {
			const welcomeChannelId = await database.getGuildVar(guildId, 'welcome_channel_id');
			const template = await database.getGuildVar(guildId, 'welcome_message_template');

			if (welcomeChannelId && template) {
				return await interaction.reply({
					content: `🛡️ **Welcome Messages Status:** Enabled\nChannel: <#${welcomeChannelId}> (\`${welcomeChannelId}\`)\nTemplate: \`\`\`${template}\`\`\``,
					flags: MessageFlags.Ephemeral,
				});
			}
			else {
				return await interaction.reply({
					content: '🛡️ **Welcome Messages Status:** Disabled\nUse `/welcome set` to configure.',
					flags: MessageFlags.Ephemeral,
				});
			}
		}
	},
};
