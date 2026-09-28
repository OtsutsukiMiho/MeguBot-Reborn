'use strict';
const assert = require('node:assert/strict');
const db = require('../core/db');
const { isDisposableTestDatabase } = require('./test-database');
(async () => {
	assert.ok(isDisposableTestDatabase(process.env.MEGU_TEST_DATABASE_URL)); process.env.MEGU_DATABASE_URL = process.env.MEGU_TEST_DATABASE_URL; process.env.MEGU_TEAM_ROLE_SYNC_ENABLED = '1';
	await require('../core/schema').initCoreSchema();
	const client = await db.getPool().connect(), originalTransaction = db.transaction, originalQuery = db.query;
	try {
		await client.query('BEGIN'); db.transaction = fn => fn(client); db.query = (...args) => client.query(...args);
		const users = require('../core/users'), sync = require('../core/server-role-sync'), sources = require('../core/team-membership-sources');
		const prefix = `events_${Date.now()}`, owner = `${prefix}_owner`, manager = `${prefix}_manager`, mappingId = `${prefix}_mapping`, guildId = '866666666666666666', roleId = '877777777777777777', memberUid = '833333333333333333';
		for (const [user, uid] of [[owner,'811111111111111111'],[manager,'822222222222222222']]) { await client.query('INSERT INTO users(id,display_name) VALUES ($1,$1)', [user]); await client.query("INSERT INTO identities(id,user_id,provider,provider_uid) VALUES ($1,$2,'discord',$3)", [`${user}_identity`, user, uid]); }
		await client.query('INSERT INTO teams(id,name,created_by,discord_guild_id) VALUES ($1,$1,$2,$3)', [prefix, owner, guildId]);
		await client.query("INSERT INTO team_memberships(team_id,user_id,role) VALUES ($1,$2,'owner')", [prefix, owner]); await sources.grantManualSource(client, prefix, owner, owner, 'fixture');
		await client.query("INSERT INTO server_role_mappings(id,guild_id,kind,team_id,mode,enabled,revision,delegation_version,created_by,owner_consent_by,owner_consent_at,server_consent_by,server_consent_at) VALUES ($1,$2,'team',$3,'automatic',true,1,1,$4,$4,now(),$5,now())", [mappingId, guildId, prefix, owner, manager]);
		await client.query("INSERT INTO server_role_mapping_roles(mapping_id,role_id,name_snapshot) VALUES ($1,$2,'Before rename')", [mappingId, roleId]);
		const count = async () => (await client.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
		let before = await count(); assert.equal(await sync.enqueueDiscordMember(guildId, '899999999999999999'), 0); assert.equal(await count(), before, 'Gateway role holders never create placeholder accounts');
		const signed = await users.loginWithIdentity({ provider: 'discord', providerUid: memberUid, displayName: 'First sign in' }); assert.equal(signed.created, true);
		const member = signed.user.id;
		const job = async () => (await client.query('SELECT * FROM server_role_sync_jobs WHERE mapping_id=$1 AND user_id=$2', [mappingId, member])).rows[0];
		assert.equal((await job()).state, 'pending');
		assert.equal((await client.query('SELECT count(*)::int AS n FROM team_memberships WHERE team_id=$1 AND user_id=$2', [prefix, member])).rows[0].n, 0);
		let roleHeld = false;
		const verify = async (userId, guild, { management }) => { const identity = (await client.query("SELECT provider_uid FROM identities WHERE user_id=$1 AND provider='discord'", [userId])).rows[0]; return { available: true, userId, guildId: guild, discordUserId: identity?.provider_uid, isMember: true, isBot: false, canManageServer: management && userId === manager, roleIds: userId === member && roleHeld ? [roleId] : [] }; };
		await sync.runOnce({ verify }); await sync.runOnce({ verify });
		assert.equal((await client.query('SELECT count(*)::int AS n FROM team_memberships WHERE team_id=$1 AND user_id=$2', [prefix, member])).rows[0].n, 0, 'A role event/first sign-in receipt is not positive proof');
		roleHeld = true; assert.ok(await sync.enqueueDiscordMember(guildId, memberUid, [roleId])); await sync.runOnce({ verify });
		assert.equal((await client.query('SELECT role FROM team_memberships WHERE team_id=$1 AND user_id=$2', [prefix, member])).rows[0].role, 'member');
		const generation = (await job()).generation; assert.equal((await users.loginWithIdentity({ provider: 'discord', providerUid: memberUid, displayName: 'Return sign in' })).created, false); assert.equal((await job()).generation, generation + 1);
		await users.linkIdentity(member, { provider: 'google', providerUid: `${prefix}_google`, email: 'fixture@example.invalid', emailVerified: true });
		assert.equal((await users.unlinkIdentity(member, 'discord')).unlinked, true); assert.equal((await job()).state, 'pending');
		await sync.runOnce({ verify }); assert.ok((await client.query('SELECT revoked_at FROM team_memberships WHERE team_id=$1 AND user_id=$2', [prefix, member])).rows[0].revoked_at);
		assert.deepEqual(await users.unlinkIdentity(member, 'google'), { unlinked: false, reason: 'last-identity' });
		assert.equal((await users.linkIdentity(member, { provider: 'discord', providerUid: memberUid })).linked, true); assert.equal((await job()).state, 'pending'); await sync.runOnce({ verify });
		assert.equal((await client.query('SELECT revoked_at FROM team_memberships WHERE team_id=$1 AND user_id=$2', [prefix, member])).rows[0].revoked_at, null);
		assert.equal(await sync.refreshRoleSnapshot(guildId, roleId, 'After rename'), 1);
		assert.equal((await client.query('SELECT revision FROM server_role_mappings WHERE id=$1', [mappingId])).rows[0].revision, 1, 'Cosmetic rename does not change authorization');
		assert.equal(await sync.refreshRoleSnapshot('899999999999999999', roleId, 'Forged rename'), 0);
		roleHeld = false; assert.ok(await sync.enqueueGuild(guildId)); await sync.runOnce({ verify });
		assert.ok((await client.query('SELECT revoked_at FROM team_memberships WHERE team_id=$1 AND user_id=$2', [prefix, member])).rows[0].revoked_at, 'Guild/role change recovery still uses fresh role absence');
		await sync.enqueueDiscordMember(guildId, '822222222222222222', ['888888888888888888']);
		assert.equal((await client.query('SELECT state FROM server_role_sync_jobs WHERE mapping_id=$1 AND user_id IS NULL', [mappingId])).rows[0].state, 'pending', 'Manager authority changes invalidate the entire mapping, even for an unselected role');
		console.log('Role recovery events passed: no placeholders/proof from events, sign-in/link/unlink scheduling, fresh application, source-only restoration, last identity protection, cosmetic snapshots, wrong guild isolation and whole-mapping authority recovery.');
	} finally { db.transaction = originalTransaction; db.query = originalQuery; await client.query('ROLLBACK'); client.release(); await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
