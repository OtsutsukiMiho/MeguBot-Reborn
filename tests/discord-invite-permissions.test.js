const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const { createBotInviteUrl } = require('../backend/web/bot-invite.js');

const clientId = '111111111111111111';
const guildId = '222222222222222222';
const invite = new URL(createBotInviteUrl(clientId, guildId));
const requested = new PermissionsBitField(invite.searchParams.get('permissions'));
const expectedNames = [
	'ViewChannel',
	'SendMessages',
	'SendMessagesInThreads',
	'CreatePrivateThreads',
	'ManageThreads',
	'ManageMessages',
	'ReadMessageHistory',
	'EmbedLinks',
	'UseExternalEmojis',
	'AddReactions',
	'ManageRoles',
	'ViewAuditLog',
	'Connect',
	'Speak',
	'MoveMembers',
];
const required = new PermissionsBitField(expectedNames.map(name => PermissionFlagsBits[name]));

assert.equal(invite.origin, 'https://discord.com');
assert.equal(invite.pathname, '/api/oauth2/authorize');
assert.equal(invite.searchParams.get('client_id'), clientId);
assert.equal(invite.searchParams.get('guild_id'), guildId);
assert.equal(invite.searchParams.get('scope'), 'bot applications.commands');
assert.deepEqual(requested.toArray().sort(), [...expectedNames].sort(), 'decoded invite permissions preserve the expected capabilities');
assert.equal(requested.bitfield, required.bitfield, 'invite requests exactly the named feature permissions');

for (const name of [
	'Administrator',
	'KickMembers',
	'BanMembers',
	'ModerateMembers',
	'ManageGuild',
	'ManageChannels',
	'ManageWebhooks',
	'MentionEveryone',
	'AttachFiles',
	'CreateInstantInvite',
	'MuteMembers',
	'DeafenMembers',
	'ManageEvents',
]) {
	assert.equal(requested.has(PermissionFlagsBits[name]), false, `invite does not request ${name}`);
}

// The landing pages' invite lets Discord ask which server.
const anyServer = new URL(createBotInviteUrl(clientId));
assert.equal(anyServer.searchParams.get('guild_id'), null);
assert.equal(anyServer.searchParams.get('permissions'), invite.searchParams.get('permissions'));

const webSource = fs.readFileSync(require.resolve('../backend/web/web.js'), 'utf8');
assert.equal((webSource.match(/createBotInviteUrl\(clientId,\s*gid\)/g) || []).length, 2, 'both guild-list branches use the shared invite builder');
assert.doesNotMatch(webSource, /permissions=8/, 'guild-list code no longer hardcodes Administrator');

console.log('Discord bot invite passed: least-privilege permission bitfield, preserved scopes, and both guild-list paths.');
