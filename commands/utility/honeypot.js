const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const database = require('../../database.js');
const { BotLogs, COLOR } = require('../../bot_functions.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('honeypot')
		.setDescription('Configure honeypot decoy channel settings')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addSubcommand(subcommand =>
			subcommand
				.setName('set')
				.setDescription('Set the honeypot decoy channel')
				.addChannelOption(option =>
					option
						.setName('channel')
						.setDescription('The decoy text channel')
						.addChannelTypes(ChannelType.GuildText)
						.setRequired(true),
				),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('disable')
				.setDescription('Disable the honeypot decoy channel'),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('status')
				.setDescription('View the honeypot settings status'),
		),

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();
		const guildId = interaction.guild.id;

		if (!interaction.client.honeypots) {
			interaction.client.honeypots = new Map();
		}

		if (subcommand === 'set') {
			const channel = interaction.options.getChannel('channel');
			await database.setGuildVar(guildId, 'honeypot_channel_id', channel.id);

			interaction.client.honeypots.set(guildId, channel.id);

			BotLogs(interaction.guild.name, `${COLOR.dark_purple}Honeypot channel set to: ${COLOR.gray}[${COLOR.white}#${channel.name} (${channel.id})${COLOR.gray}]`);

			return await interaction.reply({
				content: `✅ **Honeypot channel has been set to** <#${channel.id}>. Any non-admin user sending messages there will be instantly banned.`,
				flags: MessageFlags.Ephemeral,
			});
		}

		if (subcommand === 'disable') {
			await database.deleteGuildVar(guildId, 'honeypot_channel_id');
			interaction.client.honeypots.delete(guildId);

			BotLogs(interaction.guild.name, `${COLOR.dark_purple}Honeypot channel disabled`);

			return await interaction.reply({
				content: '✅ **Honeypot channel monitoring has been disabled.**',
				flags: MessageFlags.Ephemeral,
			});
		}

		if (subcommand === 'status') {
			const currentChannelId = await database.getGuildVar(guildId, 'honeypot_channel_id') || interaction.client.honeypots.get(guildId);
			if (currentChannelId) {
				return await interaction.reply({
					content: `🛡️ **Honeypot Status:** Enabled\nDecoy Channel: <#${currentChannelId}> (\`${currentChannelId}\`)\n\n*Note: Real bots, webhook messages, administrators, and moderators will be bypassed.*`,
					flags: MessageFlags.Ephemeral,
				});
			}
			else {
				return await interaction.reply({
					content: '🛡️ **Honeypot Status:** Disabled\nUse `/honeypot set` to configure a decoy channel.',
					flags: MessageFlags.Ephemeral,
				});
			}
		}
	},
};
