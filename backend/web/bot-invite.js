const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');

// These cover the bot's current message/reaction, voice, and role features,
// and the private thread each bill opens for the people on it. Manage
// Channels stays out on purpose: without it the thread opens in the channel
// the command was used in, and an admin who wants one bills channel grants
// it themselves.
// Optional kick/ban/timeout features require manual Discord permission grants.
// Manage Roles remains subject to Discord role hierarchy.
const BOT_INVITE_PERMISSION_BITS = new PermissionsBitField([
	PermissionFlagsBits.ViewChannel,
	PermissionFlagsBits.SendMessages,
	PermissionFlagsBits.SendMessagesInThreads,
	PermissionFlagsBits.CreatePrivateThreads,
	PermissionFlagsBits.ManageThreads,
	PermissionFlagsBits.ManageMessages,
	PermissionFlagsBits.ReadMessageHistory,
	PermissionFlagsBits.EmbedLinks,
	PermissionFlagsBits.UseExternalEmojis,
	PermissionFlagsBits.AddReactions,
	PermissionFlagsBits.ManageRoles,
	PermissionFlagsBits.ViewAuditLog,
	PermissionFlagsBits.Connect,
	PermissionFlagsBits.Speak,
	PermissionFlagsBits.MoveMembers,
]).bitfield.toString();

/** Without a guild id, Discord asks which server to add Megu to. */
function createBotInviteUrl(clientId, guildId = null) {
	const guild = guildId ? `&guild_id=${guildId}` : '';
	return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${BOT_INVITE_PERMISSION_BITS}&scope=bot%20applications.commands${guild}`;
}

module.exports = { createBotInviteUrl };
