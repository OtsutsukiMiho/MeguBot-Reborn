const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');

// These cover the bot's current message/reaction, voice, and role features.
// Optional kick/ban/timeout features require manual Discord permission grants.
// Manage Roles remains subject to Discord role hierarchy.
const BOT_INVITE_PERMISSION_BITS = new PermissionsBitField([
	PermissionFlagsBits.ViewChannel,
	PermissionFlagsBits.SendMessages,
	PermissionFlagsBits.SendMessagesInThreads,
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

function createBotInviteUrl(clientId, guildId) {
	return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${BOT_INVITE_PERMISSION_BITS}&scope=bot%20applications.commands&guild_id=${guildId}`;
}

module.exports = { createBotInviteUrl };
