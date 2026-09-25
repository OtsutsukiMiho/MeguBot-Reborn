// The invite asks for what Megu uses, and never for Administrator.
const assert = require('node:assert');
const { PermissionsBitField } = require('discord.js');
const { botInviteUrl, BOT_PERMISSION_BITS, BOT_PERMISSION_REASONS } = require('../adapters/discord/invite.js');

const granted = new PermissionsBitField(BigInt(BOT_PERMISSION_BITS));
assert.strictEqual(granted.has(PermissionsBitField.Flags.Administrator, false), false, 'never Administrator');
for (const name of ['ViewChannel', 'SendMessages', 'Connect', 'Speak', 'ManageRoles']) {
	assert.ok(granted.has(PermissionsBitField.Flags[name], false), `${name} is requested`);
}
for (const [name, reason] of Object.entries(BOT_PERMISSION_REASONS)) {
	assert.ok(PermissionsBitField.Flags[name] !== undefined, `${name} is a real permission`);
	assert.ok(reason, `${name} says which feature needs it`);
}

const url = new URL(botInviteUrl('111', '222'));
assert.strictEqual(url.searchParams.get('permissions'), BOT_PERMISSION_BITS);
assert.strictEqual(url.searchParams.get('scope'), 'bot applications.commands');
assert.strictEqual(url.searchParams.get('guild_id'), '222');
assert.strictEqual(new URL(botInviteUrl('111')).searchParams.has('guild_id'), false);

console.log('invite passed — least privilege, every permission explained');
