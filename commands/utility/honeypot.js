const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');
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
		const dbPath = `./database/variables/${interaction.guild.id}.json`;
		const dir = path.dirname(dbPath);

		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		let guildData = {};
		if (fs.existsSync(dbPath)) {
			try {
				guildData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
			}
			catch {
				// Safely ignore or parse corrupted JSON
			}
		}

		if (!interaction.client.honeypots) {
			interaction.client.honeypots = new Map();
		}

		if (subcommand === 'set') {
			const channel = interaction.options.getChannel('channel');
			guildData.honeypot_channel_id = channel.id;
			fs.writeFileSync(dbPath, JSON.stringify(guildData, null, 4));

			interaction.client.honeypots.set(interaction.guild.id, channel.id);

			BotLogs(interaction.guild.name, `${COLOR.dark_purple}Honeypot channel set to: ${COLOR.gray}[${COLOR.white}#${channel.name} (${channel.id})${COLOR.gray}]`);

			return await interaction.reply({
				content: `✅ **Honeypot channel has been set to** <#${channel.id}>. Any non-admin user sending messages there will be instantly banned.`,
				flags: MessageFlags.Ephemeral,
			});
		}

		if (subcommand === 'disable') {
			if (guildData.honeypot_channel_id) {
				delete guildData.honeypot_channel_id;
				fs.writeFileSync(dbPath, JSON.stringify(guildData, null, 4));
			}

			interaction.client.honeypots.delete(interaction.guild.id);

			BotLogs(interaction.guild.name, `${COLOR.dark_purple}Honeypot channel disabled`);

			return await interaction.reply({
				content: '✅ **Honeypot channel monitoring has been disabled.**',
				flags: MessageFlags.Ephemeral,
			});
		}

		if (subcommand === 'status') {
			const currentChannelId = guildData.honeypot_channel_id || interaction.client.honeypots.get(interaction.guild.id);
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
