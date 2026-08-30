const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const database = require('../../backend/database/database.js');
const { BotLogs, COLOR } = require('../../backend/bot/bot_functions.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('nick')
		.setDescription('View or change custom nicknames used by Megu Bot TTS')
		.addSubcommand(subcommand =>
			subcommand
				.setName('set')
				.setDescription('Set a custom TTS nickname')
				.addStringOption(option =>
					option
						.setName('name')
						.setDescription('Your new TTS spoken nickname')
						.setMaxLength(100)
						.setRequired(true),
				)
				.addUserOption(option =>
					option
						.setName('user')
						.setDescription('Target user (Admin/ManageNicknames only)')
						.setRequired(false),
				),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('reset')
				.setDescription('Reset a custom TTS nickname back to default')
				.addUserOption(option =>
					option
						.setName('user')
						.setDescription('Target user to reset (Admin/ManageNicknames only)')
						.setRequired(false),
				),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('view')
				.setDescription('View current TTS nickname for yourself or a user')
				.addUserOption(option =>
					option
						.setName('user')
						.setDescription('User to check')
						.setRequired(false),
				),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('list')
				.setDescription('List all custom TTS nicknames set in this server (Admin only)'),
		),

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();
		const guildId = interaction.guild.id;

		// 1. SET Subcommand
		if (subcommand === 'set') {
			const newName = interaction.options.getString('name').trim();
			const targetUser = interaction.options.getUser('user') || interaction.user;
			const isSelf = targetUser.id === interaction.user.id;

			if (!isSelf) {
				const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.Administrator)
					|| interaction.member.permissions.has(PermissionFlagsBits.ManageNicknames);
				if (!hasPermission) {
					return await interaction.reply({
						content: '❌ You need **Manage Nicknames** or **Administrator** permission to set nicknames for other members.',
						flags: MessageFlags.Ephemeral,
					});
				}
			}

			const previousName = await database.getUserNick(guildId, targetUser.id);
			await database.setUserNick(guildId, targetUser.id, newName);

			BotLogs(interaction.guild.name, `${COLOR.dark_purple}TTS Nickname Updated: ${COLOR.gray}[${COLOR.white}${targetUser.tag}${COLOR.gray}] ${COLOR.dark_purple}changed from ${COLOR.gray}[${COLOR.white}${previousName}${COLOR.gray}] ${COLOR.dark_purple}to ${COLOR.gray}[${COLOR.white}${newName}${COLOR.gray}] by ${COLOR.white}${interaction.user.tag}`);

			return await interaction.reply({
				content: isSelf
					? `✅ Your TTS nickname is now set to **"${newName}"**`
					: `✅ TTS nickname for <@${targetUser.id}> set to **"${newName}"**`,
				flags: MessageFlags.Ephemeral,
			});
		}

		// 2. RESET Subcommand
		if (subcommand === 'reset') {
			const targetUser = interaction.options.getUser('user') || interaction.user;
			const isSelf = targetUser.id === interaction.user.id;

			if (!isSelf) {
				const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.Administrator)
					|| interaction.member.permissions.has(PermissionFlagsBits.ManageNicknames);
				if (!hasPermission) {
					return await interaction.reply({
						content: '❌ You need **Manage Nicknames** or **Administrator** permission to reset nicknames for other members.',
						flags: MessageFlags.Ephemeral,
					});
				}
			}

			if (database.deleteUserNick) {
				await database.deleteUserNick(guildId, targetUser.id);
			}

			return await interaction.reply({
				content: isSelf
					? '✅ Your TTS nickname has been reset back to your default Discord name.'
					: `✅ TTS nickname for <@${targetUser.id}> reset back to default.`,
				flags: MessageFlags.Ephemeral,
			});
		}

		// 3. VIEW Subcommand
		if (subcommand === 'view') {
			const targetUser = interaction.options.getUser('user') || interaction.user;
			const isSelf = targetUser.id === interaction.user.id;
			const nick = await database.getUserNick(guildId, targetUser.id);
			const hasCustom = nick && nick !== 'ใครไม่รู้';

			return await interaction.reply({
				content: isSelf
					? (hasCustom ? `ℹ️ Your custom TTS nickname is **"${nick}"**` : 'ℹ️ You do not have a custom TTS nickname set (using your default Discord name).')
					: (hasCustom ? `ℹ️ Custom TTS nickname for <@${targetUser.id}> is **"${nick}"**` : `ℹ️ <@${targetUser.id}> does not have a custom TTS nickname set.`),
				flags: MessageFlags.Ephemeral,
			});
		}

		// 4. LIST Subcommand
		if (subcommand === 'list') {
			const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.Administrator)
				|| interaction.member.permissions.has(PermissionFlagsBits.ManageNicknames);
			if (!hasPermission) {
				return await interaction.reply({
					content: '❌ You need **Manage Nicknames** or **Administrator** permission to view the server nickname roster.',
					flags: MessageFlags.Ephemeral,
				});
			}

			const allNicks = database.getAllGuildNicks ? await database.getAllGuildNicks(guildId) : {};
			const entries = Object.entries(allNicks || {}).filter(([, name]) => name && name !== 'ใครไม่รู้');

			if (entries.length === 0) {
				return await interaction.reply({
					content: 'ℹ️ **No custom TTS nicknames configured in this server.**',
					flags: MessageFlags.Ephemeral,
				});
			}

			const listStr = entries.slice(0, 25).map(([uId, name], idx) => {
				return `\`${idx + 1}.\` <@${uId}> → **"${name}"**`;
			}).join('\n');

			const remaining = entries.length - 25;
			const extra = remaining > 0 ? `\n*...and ${remaining} more members*` : '';

			const embed = new EmbedBuilder()
				.setTitle(`📝 Custom TTS Nicknames — ${interaction.guild.name}`)
				.setColor(0x8B5CF6)
				.setDescription(listStr + extra)
				.setFooter({ text: `Total Custom Nicknames: ${entries.length}` })
				.setTimestamp();

			return await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
		}
	},
};
