'use strict';
const assert = require('node:assert/strict');
const db = require('../core/db');
const { isDisposableTestDatabase } = require('./test-database');
(async () => {
	assert.ok(isDisposableTestDatabase(process.env.MEGU_TEST_DATABASE_URL)); process.env.MEGU_DATABASE_URL = process.env.MEGU_TEST_DATABASE_URL; process.env.MEGU_TEAM_ROLE_SYNC_ENABLED = '1'; process.env.FRONTEND_URL = 'https://fixture.example.invalid';
	await require('../core/schema').initCoreSchema();
	const client = await db.getPool().connect(), originalTransaction = db.transaction, originalQuery = db.query;
	try {
		await client.query('BEGIN'); db.transaction = fn => fn(client); db.query = (...args) => client.query(...args);
		const { reconcileMappingMember } = require('../core/server-role-reconciliation'), sources = require('../core/team-membership-sources'), sync = require('../core/server-role-sync'), outbox = require('../core/notifications');
		const prefix = `alerts_${Date.now()}`, owner = `${prefix}_owner`, manager = `${prefix}_manager`, member = `${prefix}_member`, mappingId = `${prefix}_mapping`, guildId = '866666666666666666', roleId = '877777777777777777';
		const identities = new Map([[owner,'811111111111111111'],[manager,'822222222222222222'],[member,'833333333333333333']]);
		for (const [user, uid] of identities) {
			await client.query('INSERT INTO users(id,display_name) VALUES ($1,$1)', [user]);
			await client.query("INSERT INTO identities(id,user_id,provider,provider_uid,email,email_verified) VALUES ($1,$2,'discord',$3,NULL,false),($4,$2,'google',$4,'fixture@example.invalid',true)", [`${user}_discord`,user,uid,`${user}_google`]);
			await client.query("INSERT INTO notification_preferences(user_id,mode,locale) VALUES ($1,'both',$2)", [user,user === member ? 'th' : 'en']);
		}
		await client.query("INSERT INTO teams(id,name,created_by,discord_guild_id) VALUES ($1,'Secret team title',$2,$3)", [prefix,owner,guildId]);
		await client.query("INSERT INTO team_memberships(team_id,user_id,role) VALUES ($1,$2,'owner')", [prefix,owner]); await sources.grantManualSource(client,prefix,owner,owner,'fixture');
		await client.query("INSERT INTO server_role_mappings(id,guild_id,kind,team_id,mode,enabled,revision,delegation_version,created_by,owner_consent_by,owner_consent_at,server_consent_by,server_consent_at) VALUES ($1,$2,'team',$3,'automatic',true,1,1,$4,$4,now(),$5,now())", [mappingId,guildId,prefix,owner,manager]);
		await client.query("INSERT INTO server_role_mapping_roles(mapping_id,role_id,name_snapshot) VALUES ($1,$2,'Secret role name')", [mappingId,roleId]);
		const proof = userId => ({ available:true,userId,guildId,discordUserId:identities.get(userId),isMember:true,isBot:false,canManageServer:userId===manager,roleIds:userId===member?[roleId]:[] });
		const run = (held=true) => reconcileMappingMember({mappingId,userId:member,expectedRevision:1,authority:proof(manager),observation:{...proof(member),roleIds:held?[roleId]:[]}});
		const events = async type => (await client.query('SELECT * FROM notification_events WHERE event_type=$1 AND payload->>\'mappingId\'=$2 ORDER BY created_at,id',[type,mappingId])).rows;
		await run(); await run(); assert.equal((await events('team_role_membership_changed')).length,1);
		let rows=(await outbox.claimPending(200)).filter(row=>row.payload.mappingId===mappingId); assert.equal(rows.length,2); assert.ok(rows.every(row=>row.payload.locale==='th'));
		await client.query("UPDATE notification_preferences SET mode='off' WHERE user_id=$1",[member]); assert.equal(await outbox.recheckClaimed(rows[0].id),false,'Preference changes after claim invalidate delivery');
		await client.query("UPDATE notification_preferences SET mode='both' WHERE user_id=$1",[member]);
		await run(false); assert.equal(await outbox.recheckClaimed(rows[1].id),false,'A grant notice cannot dispatch after final-source retirement');
		await run(); rows=(await outbox.claimPending(200)).filter(row=>row.payload.mappingId===mappingId); assert.ok(rows.some(row=>row.payload.change==='granted')); assert.ok(!rows.some(row=>row.payload.change==='revoked'),'A role return obsoletes the prior revocation notice');
		await client.query('UPDATE server_role_mappings SET enabled=false WHERE id=$1',[mappingId]); for(const row of rows) assert.equal(await outbox.recheckClaimed(row.id),false); await client.query('UPDATE server_role_mappings SET enabled=true WHERE id=$1',[mappingId]);
		await sync.scheduleMissingSweeps(); await client.query("UPDATE server_role_sync_jobs SET next_attempt_at='infinity' WHERE mapping_id=$1 AND user_id IS NULL",[mappingId]);
		await sync.enqueue(mappingId,member); await sync.runOnce({verify:async()=>({available:false})});
		let attention=await events('team_role_sync_attention'); assert.equal(attention.length,2); assert.deepEqual(new Set(attention.map(event=>event.user_id)),new Set([owner,manager]));
		await sync.enqueue(mappingId,member); await sync.runOnce({verify:async()=>({available:false})}); assert.equal((await events('team_role_sync_attention')).length,2,'Coalesced outage retries produce one notice per responsible recipient');
		rows=(await outbox.claimPending(200)).filter(row=>row.event_type==='team_role_sync_attention'&&row.payload.mappingId===mappingId); assert.equal(rows.length,4);
		await sync.enqueue(mappingId,member); await sync.runOnce({verify:async userId=>proof(userId)}); for(const row of rows) assert.equal(await outbox.recheckClaimed(row.id),false,'Recovery obsoletes a claimed degraded notice');
		await sync.enqueue(mappingId,member); await sync.runOnce({verify:async()=>({available:false})}); assert.equal((await events('team_role_sync_attention')).length,4,'A new outage after successful recovery opens a new attention cycle');
		await client.query("INSERT INTO team_membership_sources(id,team_id,user_id,kind,source_key,mapping_id,cycle,origin) VALUES ($1,$2,$3,'discord_role',$4,$4,1,'legacy_fixture')",[`${owner}_source`,prefix,owner,mappingId]);
		await client.query("UPDATE team_membership_sources SET revoked_at=now(),revocation_reason='legacy_fixture' WHERE team_id=$1 AND user_id=$2 AND kind='manual' AND revoked_at IS NULL",[prefix,owner]);
		await sources.retireMappingSource(client,prefix,owner,mappingId,owner,'role_not_held'); await sources.retireMappingSource(client,prefix,owner,mappingId,owner,'duplicate');
		assert.equal((await events('team_role_sync_attention')).filter(event=>event.payload.sourceId).length,2,'Ownership blockage deduplicates per source cycle and responsible recipient');
		rows=(await outbox.claimPending(200)).filter(row=>row.payload.sourceId===`${owner}_source`); assert.equal(rows.length,4);
		await sources.grantManualSource(client,prefix,owner,owner,'explicit_retention'); await sources.retireMappingSource(client,prefix,owner,mappingId,owner,'resolved'); for(const row of rows) assert.equal(await outbox.recheckClaimed(row.id),false);
		for(const event of [...await events('team_role_membership_changed'),...await events('team_role_sync_attention')]) {
			const payload=JSON.stringify(event.payload); for(const secret of ['Secret team title','Secret role name','fixture@example.invalid']) assert.ok(!payload.includes(secret));
			assert.ok(!['title','roleIds','projectId','goalId','values','ratings','note','roster'].some(key=>Object.hasOwn(event.payload,key))); assert.ok(outbox.render(event).body.length>0);
		}
		console.log('Role outbox passed: generic bilingual privacy, preferences/channels, source-cycle deduplication, current grant/revocation/config dispatch checks, coalesced/new outage cycles, recovery invalidation and owner-safe blocked notices. No external delivery.');
	} finally {db.transaction=originalTransaction;db.query=originalQuery;await client.query('ROLLBACK');client.release();await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
