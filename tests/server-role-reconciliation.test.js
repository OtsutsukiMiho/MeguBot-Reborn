'use strict';
const assert = require('node:assert/strict');
const db = require('../core/db');
const { isDisposableTestDatabase } = require('./test-database');
(async () => {
	assert.ok(isDisposableTestDatabase(process.env.MEGU_TEST_DATABASE_URL));
	process.env.MEGU_DATABASE_URL = process.env.MEGU_TEST_DATABASE_URL;
	await require('../core/schema').initCoreSchema();
	const client = await db.getPool().connect(), originalTransaction = db.transaction;
	try {
		await client.query('BEGIN'); db.transaction = fn => fn(client);
		const { reconcileMappingMember } = require('../core/server-role-reconciliation');
		const sources = require('../core/team-membership-sources');
		const prefix = `sync_${Date.now()}`, mappingId = `${prefix}_mapping`, guildId = '866666666666666666', roleId = '877777777777777777';
		const owner = `${prefix}_owner`, userId = `${prefix}_member`, manager = `${prefix}_manager`;
		const identities = new Map([[owner, '811111111111111111'], [userId, '822222222222222222'], [manager, '833333333333333333']]);
		for (const [user, uid] of identities) {
			await client.query('INSERT INTO users(id,display_name) VALUES ($1,$1)', [user]);
			await client.query("INSERT INTO identities(id,user_id,provider,provider_uid) VALUES ($1,$2,'discord',$3)", [`${user}_identity`, user, uid]);
		}
		await client.query('INSERT INTO teams(id,name,created_by,discord_guild_id) VALUES ($1,$1,$2,$3)', [prefix, owner, guildId]);
		await client.query("INSERT INTO team_memberships(team_id,user_id,role) VALUES ($1,$2,'owner')", [prefix, owner]);
		await sources.grantManualSource(client, prefix, owner, owner, 'fixture');
		await client.query("INSERT INTO server_role_mappings(id,guild_id,kind,team_id,mode,enabled,revision,delegation_version,created_by,owner_consent_by,owner_consent_at,server_consent_by,server_consent_at) VALUES ($1,$2,'team',$3,'automatic',true,1,1,$4,$4,now(),$5,now())", [mappingId, guildId, prefix, owner, manager]);
		await client.query("INSERT INTO server_role_mapping_roles(mapping_id,role_id,name_snapshot) VALUES ($1,$2,'Delivery')", [mappingId, roleId]);
		await client.query("INSERT INTO server_role_mapping_roles(mapping_id,role_id,name_snapshot) VALUES ($1,'888888888888888888','Alternative')", [mappingId]);
		const observation = { available: true, userId, guildId, discordUserId: identities.get(userId), isMember: true, isBot: false, roleIds: [roleId] };
		const authority = { available: true, userId: manager, guildId, discordUserId: identities.get(manager), isMember: true, isBot: false, canManageServer: true };
		const run = (changes = {}) => reconcileMappingMember({ mappingId, userId, expectedRevision: 1, observation, authority, ...changes });
		const sourceCount = async () => (await client.query('SELECT count(*)::int AS n FROM team_membership_sources WHERE mapping_id=$1 AND revoked_at IS NULL', [mappingId])).rows[0].n;
		process.env.MEGU_TEAM_ROLE_SYNC_ENABLED = '';
		assert.deepEqual(await run(), { state: 'preserved', reason: 'sync_disabled' }); assert.equal(await sourceCount(), 0);
		process.env.MEGU_TEAM_ROLE_SYNC_ENABLED = '1';
		for (const changes of [{ observation: { ...observation, available: false } }, { observation: { ...observation, partial: true } }, { observation: { ...observation, discordUserId: '899999999999999999' } }, { observation: { ...observation, guildId: '899999999999999999' } }, { observation: { ...observation, isBot: undefined } }, { authority: { ...authority, canManageServer: false } }, { authority: { ...authority, discordUserId: '899999999999999999' } }]) {
			assert.equal((await run(changes)).state, 'preserved'); assert.equal(await sourceCount(), 0);
		}
		assert.equal((await run({ expectedRevision: 0 })).state, 'stale');
		assert.deepEqual(await run(), { state: 'granted', restored: false }); assert.equal(await sourceCount(), 1);
		assert.equal((await client.query('SELECT role FROM team_memberships WHERE team_id=$1 AND user_id=$2', [prefix, userId])).rows[0].role, 'member');
		assert.deepEqual(await run(), { state: 'unchanged' });
		assert.deepEqual(await run({ observation: { ...observation, roleIds: ['888888888888888888'] } }), { state: 'unchanged' }, 'ANY match survives loss of one selected role');
		for (const changes of [{ observation: { ...observation, available: false, isMember: false } }, { observation: { ...observation, partial: true, roleIds: [] } }, { authority: { ...authority, available: false } }]) {
			assert.equal((await run(changes)).state, 'preserved'); assert.equal(await sourceCount(), 1);
		}
		// Real final-source loss revokes project access; a role return restores only Member.
		await client.query("INSERT INTO projects(id,code,owner_user_id,title,team_id,timezone) VALUES ($1,$2,$3,'History',$4,'UTC')", [`${prefix}_project`, prefix.toUpperCase(), owner, prefix]);
		await client.query("INSERT INTO project_memberships(project_id,user_id,role) VALUES ($1,$2,'member')", [`${prefix}_project`, userId]);
		assert.equal((await run({ observation: { ...observation, roleIds: [] } })).state, 'revoked'); assert.equal(await sourceCount(), 0);
		assert.deepEqual(await run(), { state: 'granted', restored: true });
		assert.ok((await client.query('SELECT revoked_at FROM project_memberships WHERE project_id=$1 AND user_id=$2', [`${prefix}_project`, userId])).rows[0].revoked_at);
		assert.equal((await client.query('SELECT max(cycle)::int AS n FROM team_membership_sources WHERE mapping_id=$1', [mappingId])).rows[0].n, 2);
		await sources.grantManualSource(client, prefix, userId, owner, 'explicit_retention');
		await client.query("UPDATE team_memberships SET role='admin' WHERE team_id=$1 AND user_id=$2", [prefix, userId]);
		assert.equal((await run({ observation: { ...observation, isBot: true } })).state, 'preserved'); assert.equal(await sourceCount(), 0);
		assert.equal((await run()).state, 'granted');
		assert.equal((await client.query('SELECT role FROM team_memberships WHERE team_id=$1 AND user_id=$2', [prefix, userId])).rows[0].role, 'admin');
		await client.query('UPDATE server_role_mappings SET enabled=false WHERE id=$1', [mappingId]);
		assert.equal((await run({ observation: null, authority: null })).state, 'preserved'); assert.equal(await sourceCount(), 0);
		await client.query('UPDATE server_role_mappings SET enabled=true WHERE id=$1', [mappingId]);
		await sources.suppressMembership(client, prefix, userId, owner, 'explicit_removal');
		assert.equal((await run()).state, 'none'); assert.equal(await sourceCount(), 0);
		await sources.restoreSuppressedMembership(client, prefix, userId, owner, true, { expectedRevision: 1, teamRevision: 1 });
		assert.equal((await run()).state, 'granted');
		await client.query("DELETE FROM identities WHERE user_id=$1 AND provider='discord'", [userId]);
		assert.equal((await run({ observation: null, authority: null })).state, 'revoked'); assert.equal(await sourceCount(), 0);
		await client.query("INSERT INTO identities(id,user_id,provider,provider_uid) VALUES ($1,$2,'discord',$3)", [`${userId}_identity`, userId, identities.get(userId)]);
		await client.query('INSERT INTO users(id,display_name) SELECT $1||g::text,$1||g::text FROM generate_series(1,499) g', [`${prefix}_capacity_`]);
		await client.query("INSERT INTO team_memberships(team_id,user_id,role) SELECT $1,$2||g::text,'member' FROM generate_series(1,499) g", [prefix, `${prefix}_capacity_`]);
		assert.deepEqual(await run(), { state: 'blocked', reason: 'team_member_limit' }); assert.equal(await sourceCount(), 0);
		await client.query('DELETE FROM team_memberships WHERE team_id=$1 AND user_id LIKE $2', [prefix, `${prefix}_capacity_%`]);
		await client.query("UPDATE team_membership_sources SET revoked_at=now(),revocation_reason='fixture' WHERE team_id=$1 AND user_id=$2 AND kind='manual'", [prefix, owner]);
		assert.equal((await run()).reason, 'owner_provenance_unavailable'); assert.equal(await sourceCount(), 0);
		await sources.grantManualSource(client, prefix, owner, owner, 'explicit_retention');
		assert.equal((await run()).state, 'granted');
		await client.query('UPDATE server_role_mappings SET owner_consent_by=$2 WHERE id=$1', [mappingId, manager]);
		assert.equal((await run({ observation: null, authority: null })).state, 'revoked'); assert.equal(await sourceCount(), 0);
		console.log('Role reconciliation passed: default-off, fresh exact identity/guild/authority, unavailable/partial preservation, ANY grants, source cycles, Member-only restoration, no project restoration, manual retention/suppression and owner provenance.');
	} finally { db.transaction = originalTransaction; await client.query('ROLLBACK'); client.release(); await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
