'use strict';
const assert = require('node:assert/strict');
const db = require('../core/db');
const { isDisposableTestDatabase } = require('./test-database');
(async () => {
	assert.ok(isDisposableTestDatabase(process.env.MEGU_TEST_DATABASE_URL));
	process.env.MEGU_DATABASE_URL = process.env.MEGU_TEST_DATABASE_URL; process.env.MEGU_TEAM_ROLE_SYNC_ENABLED = '1';
	await require('../core/schema').initCoreSchema();
	const client = await db.getPool().connect(), originalTransaction = db.transaction, originalQuery = db.query;
	try {
		await client.query('BEGIN'); db.transaction = fn => fn(client); db.query = (...args) => client.query(...args);
		const sync = require('../core/server-role-sync'), sources = require('../core/team-membership-sources');
		const prefix = `worker_${Date.now()}`, mappingId = `${prefix}_mapping`, owner = `${prefix}_owner`, manager = `${prefix}_manager`, guildId = '866666666666666666', roleId = '877777777777777777';
		const members = Array.from({ length: 8 }, (_, i) => `${prefix}_member_${i}`), identities = new Map();
		for (const [i, user] of [owner, manager, ...members].entries()) {
			await client.query('INSERT INTO users(id,display_name) VALUES ($1,$1)', [user]);
			const uid = String(800000000000000000n + BigInt(i)); identities.set(user, uid);
			await client.query("INSERT INTO identities(id,user_id,provider,provider_uid) VALUES ($1,$2,'discord',$3)", [`${user}_identity`, user, uid]);
		}
		await client.query('INSERT INTO teams(id,name,created_by,discord_guild_id) VALUES ($1,$1,$2,$3)', [prefix, owner, guildId]);
		await client.query("INSERT INTO team_memberships(team_id,user_id,role) VALUES ($1,$2,'owner')", [prefix, owner]);
		await sources.grantManualSource(client, prefix, owner, owner, 'fixture');
		await client.query("INSERT INTO server_role_mappings(id,guild_id,kind,team_id,mode,enabled,revision,delegation_version,created_by,owner_consent_by,owner_consent_at,server_consent_by,server_consent_at) VALUES ($1,$2,'team',$3,'automatic',true,1,1,$4,$4,now(),$5,now())", [mappingId, guildId, prefix, owner, manager]);
		await client.query("INSERT INTO server_role_mapping_roles(mapping_id,role_id,name_snapshot) VALUES ($1,$2,'Delivery')", [mappingId, roleId]);
		// The worker claims the oldest global job. Include earlier suites' missing
		// sweeps, then defer them within this rolled-back fixture transaction.
		await sync.scheduleMissingSweeps();
		await client.query("UPDATE server_role_sync_jobs SET next_attempt_at='infinity' WHERE mapping_id<>$1", [mappingId]);
		const verify = async (userId, guild, { management }) => ({ available: true, userId, guildId: guild, discordUserId: identities.get(userId), isMember: true, isBot: false, canManageServer: management && userId === manager, roleIds: members.includes(userId) ? [roleId] : [] });
		const read = async user => (await client.query('SELECT * FROM server_role_sync_jobs WHERE mapping_id=$1 AND user_id IS NOT DISTINCT FROM $2', [mappingId, user])).rows[0];
		const count = async () => (await client.query('SELECT count(*)::int AS n FROM team_membership_sources WHERE mapping_id=$1 AND revoked_at IS NULL', [mappingId])).rows[0].n;
		process.env.MEGU_TEAM_ROLE_SYNC_ENABLED = '';
		assert.deepEqual(await sync.runOnce({ verify }), { processed: 0, disabled: true }); assert.equal(await sync.enqueue(mappingId), false);
		process.env.MEGU_TEAM_ROLE_SYNC_ENABLED = '1';
		assert.equal((await sync.runOnce({ verify, limit: 3 })).processed, 3);
		let sweep = await read(null); assert.equal(sweep.state, 'pending'); assert.ok(sweep.cursor_user_id); assert.equal(sweep.lease_token, null);
		let batches = 1;
		while ((await read(null)).state === 'pending') { assert.ok(batches++ < 8); assert.ok((await sync.runOnce({ verify, limit: 3 })).processed <= 3); }
		assert.equal(await count(), 8); sweep = await read(null); assert.equal(sweep.state, 'idle'); assert.ok(sweep.last_success_at);
		assert.equal((await sync.runOnce({ verify })).processed, 0, 'Completed periodic sweep is not immediately repeated');
		await sync.enqueue(mappingId, members[0]); await sync.enqueue(mappingId, members[0]);
		assert.equal((await read(members[0])).generation, 2, 'Repeated member events coalesce into one newer generation');
		assert.equal((await sync.runOnce({ verify: async () => ({ available: false }) })).degraded, true);
		assert.equal(await count(), 8); assert.equal((await read(members[0])).state, 'degraded'); assert.ok((await read(members[0])).last_error);
		await sync.enqueue(mappingId, members[0]);
		let replaced = false;
		const staleVerify = async (...args) => { if (!replaced) { replaced = true; await sync.enqueue(mappingId, members[0]); } return { ...(await verify(...args)), roleIds: [] }; };
		assert.equal((await sync.runOnce({ verify: staleVerify })).stale, true); assert.equal(await count(), 8, 'Superseded provider result cannot retire a source');
		assert.equal((await sync.runOnce({ verify })).done, true);
		await sync.enqueue(mappingId, members[0]);
		let expired = false;
		const expireVerify = async (...args) => { if (!expired) { expired = true; await client.query("UPDATE server_role_sync_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE mapping_id=$1 AND user_id=$2", [mappingId, members[0]]); } return { ...(await verify(...args)), roleIds: [] }; };
		assert.equal((await sync.runOnce({ verify: expireVerify })).stale, true); assert.equal(await count(), 8, 'Expired worker cannot apply a late provider result');
		assert.equal((await sync.runOnce({ verify })).done, true, 'Expired lease is reclaimed after interrupted processing');
		await sync.enqueue(mappingId, members[0]);
		assert.equal((await sync.runOnce({ verify: async (...args) => ({ ...(await verify(...args)), roleIds: [] }) })).done, true); assert.equal(await count(), 7);
		await sync.enqueue(mappingId, members[0]); assert.equal((await sync.runOnce({ verify })).done, true); assert.equal(await count(), 8);
		await sync.enqueue(mappingId, members[1]);
		await sources.suppressMembership(client, prefix, members[1], owner, 'explicit_removal');
		await sync.runOnce({ verify }); assert.equal(await count(), 7);
		const survivor = `${prefix}_survivor`;
		await client.query("INSERT INTO users(id,display_name,created_at) VALUES ($1,$1,now()-interval '1 day')", [survivor]);
		await sync.enqueue(mappingId, members[4]);
		assert.equal((await require('../core/account-merge').mergeAccounts({ userIdA: members[4], userIdB: survivor })).survivorId, survivor);
		assert.equal(await read(members[4]), undefined);
		assert.equal((await read(null)).state, 'pending');
		assert.equal((await client.query('SELECT count(*)::int AS n FROM team_membership_sources WHERE mapping_id=$1 AND user_id=$2 AND revoked_at IS NULL', [mappingId, survivor])).rows[0].n, 1, 'Actual account merge retains derived provenance and invalidates old user jobs');
		// Keep the coalesced sweep dormant while testing another pair of event scopes.
		await client.query("UPDATE server_role_sync_jobs SET next_attempt_at='infinity' WHERE mapping_id=$1 AND user_id IS NULL", [mappingId]);
		await sync.enqueue(mappingId, members[2]); await sync.enqueue(mappingId, members[3]);
		await sync.mergeJobs(client, members[2], members[3]);
		assert.equal(await read(members[2]), undefined); assert.equal(await read(members[3]), undefined); assert.equal((await read(null)).state, 'pending');
		await client.query('UPDATE server_role_mappings SET enabled=false,revision=revision+1 WHERE id=$1', [mappingId]);
		await sync.enqueue(mappingId);
		let calls = 0;
		while ((await read(null)).state === 'pending') { await sync.runOnce({ verify: () => { calls++; throw new Error('Retirement needs no Discord call'); } }); }
		assert.equal(calls, 0); assert.equal(await count(), 0);
		await client.query("INSERT INTO team_membership_sources(id,team_id,user_id,kind,source_key,mapping_id,cycle,origin) VALUES ($1,$2,$3,'discord_role',$4,$4,1,'legacy_fixture')", [`${owner}_derived`, prefix, owner, mappingId]);
		await client.query("UPDATE team_membership_sources SET revoked_at=now(),revocation_reason='legacy_fixture' WHERE team_id=$1 AND user_id=$2 AND kind='manual' AND revoked_at IS NULL", [prefix, owner]);
		await sync.enqueue(mappingId, owner); await sync.runOnce();
		assert.equal((await read(owner)).state, 'blocked'); assert.equal((await read(owner)).counts.blocked, 1);
		assert.equal(await count(), 1); assert.equal((await sync.runOnce()).processed, 0, 'Ownership blockers do not produce a tight retry loop');
		await sources.grantManualSource(client, prefix, owner, owner, 'explicit_retention');
		await sync.enqueue(mappingId, owner); await sync.runOnce(); assert.equal(await count(), 0);
		console.log('Durable role sync passed: bounded checkpoint continuation, periodic deduplication, member coalescing, outage preservation, generation/expiry fencing, crash recovery, confirmed loss/restoration, suppression, merged jobs and local retirement without Discord.');
	} finally { db.transaction = originalTransaction; db.query = originalQuery; await client.query('ROLLBACK'); client.release(); await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
