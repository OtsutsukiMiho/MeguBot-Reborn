const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const database = require('../../database.js');
const { BotLogs, COLOR } = require('../../bot_functions.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('autorole')
		.setDescription('Configure auto-role settings for new members')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addSubcommand(subcommand =>
			subcommand
				.setName('set')
				.setDescription('Set the role to automatically assign to new members')
				.addRoleOption(option =>
					option
						.setName('role')
						.setDescription('The role to assign')
						.setRequired(true),
				),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('disable')
				.setDescription('Disable the auto-role feature'),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('status')
				.setDescription('View the auto-role configuration status'),
		),

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();
		const guildId = interaction.guild.id;

		if (subcommand === 'set') {
			const role = interaction.options.getRole('role');

			const botMember = interaction.guild.members.me;
			if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
				return await interaction.reply({
					content: '❌ **Error:** I need the **Manage Roles** permission to set up auto-roles.',
					flags: MessageFlags.Ephemeral,
				});
			}

			if (botMember.roles.highest.position <= role.position) {
				return await interaction.reply({
					content: `❌ **Error:** The role <@&${role.id}> is higher than or equal to my highest role. Move my role higher in the server settings to assign this role.`,
					flags: MessageFlags.Ephemeral,
				});
			}

			await database.setGuildVar(guildId, 'autorole_id', role.id);
			BotLogs(interaction.guild.name, `${COLOR.green}Auto-role configured to: ${COLOR.white}${role.name} (${role.id})`);

			return await interaction.reply({
				content: `✅ **Auto-role successfully configured to** <@&${role.id}>. New members will be assigned this role upon joining.`,
				flags: MessageFlags.Ephemeral,
			});
		}

		if (subcommand === 'disable') {
			await database.deleteGuildVar(guildId, 'autorole_id');
			BotLogs(interaction.guild.name, `${COLOR.red}Auto-role disabled`);

			return await interaction.reply({
				content: '✅ **Auto-role feature has been disabled.**',
				flags: MessageFlags.Ephemeral,
			});
		}

		if (subcommand === 'status') {
			const autoRoleId = await database.getGuildVar(guildId, 'autorole_id');
			if (autoRoleId) {
				return await interaction.reply({
					content: `🛡️ **Auto-role Status:** Enabled\nRole: <@&${autoRoleId}> (\`${autoRoleId}\`)`,
					flags: MessageFlags.Ephemeral,
				});
			}
			else {
				return await interaction.reply({
					content: '🛡️ **Auto-role Status:** Disabled\nUse `/autorole set` to configure.',
					flags: MessageFlags.Ephemeral,
				});
			}
		}
	},
};
