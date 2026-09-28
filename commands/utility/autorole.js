const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const database = require('../../backend/database/database.js');
const { BotLogs, COLOR } = require('../../backend/bot/bot_functions.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('autorole')
		.setDescription('Configure auto-role assignment for new members and bots')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addSubcommand(subcommand =>
			subcommand
				.setName('add')
				.setDescription('Add an auto-role to assign upon joining')
				.addRoleOption(option =>
					option
						.setName('role')
						.setDescription('The role to assign')
						.setRequired(true),
				)
				.addStringOption(option =>
					option
						.setName('target')
						.setDescription('Target membership type (Humans or Bots)')
						.addChoices(
							{ name: '👤 Humans (Default)', value: 'human' },
							{ name: '🤖 Bots', value: 'bot' },
						)
						.setRequired(false),
				),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('remove')
				.setDescription('Remove an auto-role from the assignment list')
				.addRoleOption(option =>
					option
						.setName('role')
						.setDescription('The role to remove')
						.setRequired(true),
				)
				.addStringOption(option =>
					option
						.setName('target')
						.setDescription('Target membership type')
						.addChoices(
							{ name: '👤 Humans', value: 'human' },
							{ name: '🤖 Bots', value: 'bot' },
						)
						.setRequired(false),
				),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('status')
				.setDescription('View current auto-role configuration for this server'),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('clear')
				.setDescription('Clear all configured auto-roles')
				.addStringOption(option =>
					option
						.setName('target')
						.setDescription('Which list to clear')
						.addChoices(
							{ name: '👤 Humans Only', value: 'human' },
							{ name: '🤖 Bots Only', value: 'bot' },
							{ name: '⚡ All Auto-roles', value: 'all' },
						)
						.setRequired(false),
				),
		),

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();
		const guildId = interaction.guild.id;
		const before = await database.getAllGuildVars(guildId);
		// Match the join handler's effective grants without promoting a dormant
		// legacy role when the modern list is populated.
		let humanRoles = Array.isArray(before.autorole_ids) && before.autorole_ids.length
			? [...before.autorole_ids] : (before.autorole_id ? [before.autorole_id] : []);
		let botRoles = Array.isArray(before.bot_autorole_ids) ? [...before.bot_autorole_ids] : [];
		const desired = {
			autorole_id: before.autorole_id ?? null,
			autorole_ids: before.autorole_ids ?? [],
			bot_autorole_ids: before.bot_autorole_ids ?? [],
		};
		const saveRoles = async () => {
			if (await database.compareAndSetGuildRoleVars(guildId, before, desired)) return true;
			await interaction.reply({
				content: '❌ Auto-role settings changed while this command was running. Check /autorole status and try again.',
				flags: MessageFlags.Ephemeral,
			});
			return false;
		};

		// 1. ADD Subcommand
		if (subcommand === 'add') {
			const role = interaction.options.getRole('role');
			const target = interaction.options.getString('target') || 'human';

			const botMember = interaction.guild.members.me;
			if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
				return await interaction.reply({
					content: '❌ **Error:** I need the **Manage Roles** permission to set up auto-roles.',
					flags: MessageFlags.Ephemeral,
				});
			}

			if (botMember.roles.highest.position <= role.position) {
				return await interaction.reply({
					content: `❌ **Error:** The role <@&${role.id}> is positioned higher than or equal to my highest role.`,
					flags: MessageFlags.Ephemeral,
				});
			}

			if (target === 'bot') {
				if (!botRoles.includes(role.id)) botRoles.push(role.id);
				desired.bot_autorole_ids = botRoles;
			} else {
				if (!humanRoles.includes(role.id)) humanRoles.push(role.id);
				desired.autorole_ids = humanRoles;
				desired.autorole_id = role.id;
			}
			if (!await saveRoles()) return;

			BotLogs(interaction.guild.name, `${COLOR.green}Auto-role added (${target}): ${COLOR.white}${role.name} (${role.id})`);

			return await interaction.reply({
				content: `✅ Added <@&${role.id}> to **${target === 'bot' ? '🤖 Bot' : '👤 Human'} Auto-roles**! New ${target === 'bot' ? 'bots' : 'members'} will automatically receive this role upon joining.`,
				flags: MessageFlags.Ephemeral,
			});
		}

		// 2. REMOVE Subcommand
		if (subcommand === 'remove') {
			const role = interaction.options.getRole('role');
			const target = interaction.options.getString('target') || 'human';

			if (target === 'bot') {
				desired.bot_autorole_ids = botRoles.filter(id => id !== role.id);
			} else {
				humanRoles = humanRoles.filter(id => id !== role.id);
				desired.autorole_ids = humanRoles;
				desired.autorole_id = humanRoles[0] || null;
			}
			if (!await saveRoles()) return;

			return await interaction.reply({
				content: `✅ Removed <@&${role.id}> from **${target === 'bot' ? '🤖 Bot' : '👤 Human'} Auto-roles**.`,
				flags: MessageFlags.Ephemeral,
			});
		}

		// 3. STATUS Subcommand
		if (subcommand === 'status') {
			const humanList = humanRoles.length > 0 ? humanRoles.map(id => `<@&${id}>`).join(', ') : '*None*';
			const botList = botRoles.length > 0 ? botRoles.map(id => `<@&${id}>`).join(', ') : '*None*';

			const embed = new EmbedBuilder()
				.setTitle(`🎖️ Auto-Role Status — ${interaction.guild.name}`)
				.setColor(0x10B981)
				.addFields(
					{ name: '👤 Human Auto-Roles', value: humanList, inline: false },
					{ name: '🤖 Bot Auto-Roles', value: botList, inline: false },
				)
				.setFooter({ text: 'Use /autorole add or /autorole remove to configure' })
				.setTimestamp();

			return await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
		}

		// 4. CLEAR Subcommand
		if (subcommand === 'clear') {
			const target = interaction.options.getString('target') || 'all';

			if (target === 'human' || target === 'all') {
				desired.autorole_ids = [];
				desired.autorole_id = null;
			}
			if (target === 'bot' || target === 'all') {
				desired.bot_autorole_ids = [];
			}
			if (!await saveRoles()) return;

			return await interaction.reply({
				content: `🧹 **Cleared ${target === 'all' ? 'all' : (target === 'bot' ? '🤖 Bot' : '👤 Human')} auto-roles.**`,
				flags: MessageFlags.Ephemeral,
			});
		}
	},
};
