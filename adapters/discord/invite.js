const { PermissionsBitField } = require('discord.js');

// What Megu asks for when a server adds it.
//
// It used to ask for Administrator (`permissions=8`). That is the one grant a
// careful server owner refuses on sight, and it is the wrong grant anyway: an
// administrator bot that is compromised, or simply buggy, can do anything to
// the server. Each entry below is here because a feature calls it.
const BOT_PERMISSION_REASONS = {
	ViewChannel: 'every feature',
	SendMessages: 'replies, reminders, welcome and project channel posts',
	SendMessagesInThreads: 'replies inside threads',
	EmbedLinks: 'welcome cards, queue views',
	AttachFiles: 'payment evidence cards',
	ReadMessageHistory: 'reaction roles find their message',
	AddReactions: 'reaction roles',
	ManageMessages: '/purge and auto-mod deletions',
	ManageRoles: 'autorole and reaction roles',
	ManageNicknames: '/nick',
	ModerateMembers: 'auto-mod timeout',
	KickMembers: 'auto-mod and honeypot',
	BanMembers: 'auto-mod and honeypot',
	ViewAuditLog: 'moderation logs',
	Connect: 'voice announcements and TTS',
	Speak: 'voice announcements and TTS',
	MoveMembers: 'AFK bring-back',
};
const BOT_PERMISSIONS = Object.keys(BOT_PERMISSION_REASONS);

const BOT_PERMISSION_BITS = new PermissionsBitField(BOT_PERMISSIONS.map(name => PermissionsBitField.Flags[name])).bitfield.toString();

function botInviteUrl(clientId, guildId) {
	const params = new URLSearchParams({
		client_id: String(clientId || ''),
		permissions: BOT_PERMISSION_BITS,
		scope: 'bot applications.commands',
	});
	if (guildId) {
		params.set('guild_id', String(guildId));
		params.set('disable_guild_select', 'true');
	}
	return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

module.exports = { BOT_PERMISSIONS, BOT_PERMISSION_REASONS, BOT_PERMISSION_BITS, botInviteUrl };
