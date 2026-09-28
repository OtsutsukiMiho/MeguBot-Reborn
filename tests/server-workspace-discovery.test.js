'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const iconSource = fs.readFileSync(require.resolve('../app/lib/discord-guild-icon.js'), 'utf8');
const guildIconUrl = vm.runInNewContext(iconSource.replace('export function', 'function') + '; guildIconUrl');
assert.equal(guildIconUrl({ id: '1', icon: null }), null);
assert.equal(guildIconUrl({ id: '1', icon: 'hash' }), 'https://cdn.discordapp.com/icons/1/hash.png?size=128');
assert.equal(guildIconUrl({ id: '1', icon: 'a_hash' }), 'https://cdn.discordapp.com/icons/1/a_hash.gif?size=128');
assert.equal(guildIconUrl({ id: '1', icon: 'https://cdn.discordapp.com/icon.png' }), 'https://cdn.discordapp.com/icon.png');
const source = fs.readFileSync(require.resolve('../backend/web/web.js'), 'utf8');
const start = source.indexOf('async function listManagedDiscordGuildsForTeams(');
const end = source.indexOf("app.use('/api/megu'", start);
assert.ok(start >= 0 && end > start);
let restores = 0;
let available = true;
const admin = { id: '123456789012345678', name: 'Managed' };
const member = { id: '223456789012345678', name: 'Member server' };
const absent = { id: '323456789012345678', name: 'No bot' };
const discover = vm.runInNewContext(`${source.slice(start, end)}; listManagedDiscordGuildsForTeams`, {
	Date, RESTORE_COOLDOWN_MS: 10000,
	restoreDiscordConnection: async (_user, session) => { restores++; session.discordGuildsVerifiedAt = Date.now(); },
	sendIpcRequest: async request => {
		assert.equal(request.type, 'check_guilds_presence');
		return available ? { presence: { [admin.id]: true, [member.id]: true } } : null;
	},
});
(async () => {
	const session = { meguUserId: 'user', discordGuildsVerifiedAt: Date.now(), adminGuilds: [admin], allGuilds: [admin, member, absent] };
	const ids = result => Array.from(result.guilds, guild => guild.id);
	assert.deepEqual(ids(await discover(session)), [admin.id], 'Default remains management-only');
	assert.deepEqual(ids(await discover(session, { managedOnly: false })), [admin.id, member.id], 'Ordinary-member discovery includes only servers with the bot');
	assert.equal(restores, 0);
	session.discordGuildsVerifiedAt = 0;
	await discover(session, { managedOnly: false });
	assert.equal(restores, 1);
	session.discordReconnectRequired = true;
	assert.equal((await discover(session, { managedOnly: false })).available, false);
	session.discordReconnectRequired = false;
	available = false;
	assert.equal((await discover(session)).available, false);
	assert.equal((await discover({})).available, false);
	console.log('Server discovery passed: ordinary membership, management isolation, freshness, reconnect and bot outage');
})().catch(error => { console.error(error); process.exitCode = 1; });
