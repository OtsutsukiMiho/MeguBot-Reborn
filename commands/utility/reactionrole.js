const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const database = require('../../database.js');
const { BotLogs, COLOR } = require('../../bot_functions.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('reactionrole')
		.setDescription('Configure reaction roles')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addSubcommand(subcommand =>
			subcommand
				.setName('add')
				.setDescription('Add a reaction role mapping')
				.addStringOption(option =>
					option
						.setName('message_id')
						.setDescription('The ID of the message to react to')
						.setRequired(true),
				)
				.addStringOption(option =>
					option
						.setName('emoji')
						.setDescription('The emoji to use (standard or custom)')
						.setRequired(true),
				)
				.addRoleOption(option =>
					option
						.setName('role')
						.setDescription('The role to assign')
						.setRequired(true),
				)
				.addChannelOption(option =>
					option
						.setName('channel')
						.setDescription('The channel the message is in (optional, auto-reacts if supplied)')
						.addChannelTypes(ChannelType.GuildText)
						.setRequired(false),
				),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('remove')
				.setDescription('Remove a reaction role mapping')
				.addStringOption(option =>
					option
						.setName('message_id')
						.setDescription('The ID of the message')
						.setRequired(true),
				)
				.addStringOption(option =>
					option
						.setName('emoji')
						.setDescription('The emoji mapped to the role')
						.setRequired(true),
				),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('list')
				.setDescription('List all configured reaction roles'),
		),

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();
		const guildId = interaction.guild.id;

		if (subcommand === 'add') {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			const messageId = interaction.options.getString('message_id');
			const emojiInput = interaction.options.getString('emoji');
			const role = interaction.options.getRole('role');
			const channel = interaction.options.getChannel('channel');

			const botMember = interaction.guild.members.me;
			if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
				return await interaction.editReply('❌ **Error:** I need the **Manage Roles** permission to assign reaction roles.');
			}

			if (botMember.roles.highest.position <= role.position) {
				return await interaction.editReply(`❌ **Error:** The role <@&${role.id}> is higher than or equal to my highest role.`);
			}

			let emojiKey = emojiInput;
			const customEmojiMatch = emojiInput.match(/<?a?:?\w+:(\d+)>?/);
			if (customEmojiMatch) {
				emojiKey = customEmojiMatch[1];
			}

			if (channel) {
				try {
					const targetMsg = await channel.messages.fetch(messageId);
					await targetMsg.react(emojiInput);
				}
				catch (error) {
					BotLogs(interaction.guild.name, `${COLOR.yellow}Warning: Failed to fetch message/react in channel: ${error.toString()}`);
				}
			}

			try {
				const rawMap = await database.getGuildVar(guildId, 'reaction_roles');
				const mappings = rawMap ? JSON.parse(rawMap) : {};

				if (!mappings[messageId]) {
					mappings[messageId] = {};
				}

				mappings[messageId][emojiKey] = role.id;

				await database.setGuildVar(guildId, 'reaction_roles', JSON.stringify(mappings));

				BotLogs(interaction.guild.name, `${COLOR.green}Reaction role added: Message ${messageId}, Emoji ${emojiKey} -> Role ${role.name}`);

				return await interaction.editReply({
					content: `✅ **Reaction role successfully added!**\n- Message ID: \`${messageId}\`\n- Emoji: ${emojiInput}\n- Role: <@&${role.id}>`,
				});
			}
			catch (error) {
				BotLogs(interaction.guild.name, `${COLOR.red}Error saving reaction role: ${error.toString()}`);
				return await interaction.editReply('❌ **Error:** Failed to save the reaction role mapping.');
			}
		}

		if (subcommand === 'remove') {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			const messageId = interaction.options.getString('message_id');
			const emojiInput = interaction.options.getString('emoji');

			let emojiKey = emojiInput;
			const customEmojiMatch = emojiInput.match(/<?a?:?\w+:(\d+)>?/);
			if (customEmojiMatch) {
				emojiKey = customEmojiMatch[1];
			}

			try {
				const rawMap = await database.getGuildVar(guildId, 'reaction_roles');
				if (!rawMap) {
					return await interaction.editReply('❌ No reaction role configurations found for this server.');
				}

				const mappings = JSON.parse(rawMap);
				if (!mappings[messageId] || !mappings[messageId][emojiKey]) {
					return await interaction.editReply('❌ No reaction role mapping found for that message and emoji.');
				}

				const removedRoleId = mappings[messageId][emojiKey];
				delete mappings[messageId][emojiKey];

				if (Object.keys(mappings[messageId]).length === 0) {
					delete mappings[messageId];
				}

				await database.setGuildVar(guildId, 'reaction_roles', JSON.stringify(mappings));

				BotLogs(interaction.guild.name, `${COLOR.red}Reaction role removed: Message ${messageId}, Emoji ${emojiKey}`);

				return await interaction.editReply({
					content: `✅ **Reaction role successfully removed!**\n- Message ID: \`${messageId}\`\n- Emoji: ${emojiInput}\n- Role previously assigned: <@&${removedRoleId}>`,
				});
			}
			catch (error) {
				BotLogs(interaction.guild.name, `${COLOR.red}Error deleting reaction role: ${error.toString()}`);
				return await interaction.editReply('❌ **Error:** Failed to remove the reaction role mapping.');
			}
		}

		if (subcommand === 'list') {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			try {
				const rawMap = await database.getGuildVar(guildId, 'reaction_roles');
				if (!rawMap) {
					return await interaction.editReply('ℹ️ No reaction roles configured on this server.');
				}

				const mappings = JSON.parse(rawMap);
				if (Object.keys(mappings).length === 0) {
					return await interaction.editReply('ℹ️ No reaction roles configured on this server.');
				}

				let responseText = '🎭 **Reaction Roles Configured:**\n\n';
				for (const [msgId, emojis] of Object.entries(mappings)) {
					responseText += `• **Message ID:** \`${msgId}\`\n`;
					for (const [emojiNameOrId, roleId] of Object.entries(emojis)) {
						const emojiDisplay = isNaN(emojiNameOrId) ? emojiNameOrId : `<:emoji:${emojiNameOrId}>`;
						responseText += `  - ${emojiDisplay} ➔ <@&${roleId}> (\`${roleId}\`)\n`;
					}
					responseText += '\n';
				}

				return await interaction.editReply({
					content: responseText,
				});
			}
			catch (error) {
				BotLogs(interaction.guild.name, `${COLOR.red}Error listing reaction roles: ${error.toString()}`);
				return await interaction.editReply('❌ **Error:** Failed to list reaction roles.');
			}
		}
	},
};
