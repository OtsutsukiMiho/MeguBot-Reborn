'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const db = require('../core/db');
const { initCoreSchema } = require('../core/schema');
const { isDisposableTestDatabase } = require('./test-database');
const service = require('../core/server-role-team-creation');

(async () => {
	assert.ok(isDisposableTestDatabase(process.env.MEGU_DATABASE_URL), 'Explicit disposable local database required');
	await initCoreSchema();
	const prefix = `rolecreate_${Date.now()}`;
	const actor = `${prefix}_admin`, owner = `${prefix}_owner`;
	const guildId = '981122334455667788';
	const roles = [0, 1, 2, 3].map((_, i) => ({ id: `98112233445566779${i}`, guildId, name: `Department ${i}` }));
	const deps = {
		verify: async (userId, guild) => ({ available: true, guildId: guild, userId, isMember: true, isBot: false, canManageServer: userId === actor, name: 'Test server' }),
		listRoles: async guild => ({ available: true, guildId: guild, roles }),
	};
	const input = { teams: roles.slice(0, 2).map(role => ({ roleId: role.id, name: role.name, ownerUserId: owner })) };
	try {
		for (const id of [actor, owner]) await db.query('INSERT INTO users(id,display_name) VALUES ($1,$1)', [id]);
		await db.query("INSERT INTO identities(id,user_id,provider,provider_uid) VALUES ($1,$2,'discord',$3)", [`${prefix}_identity`, owner, '981122334455667799']);
		const ownerDeps = { ...deps, listCandidates: async input => {
			assert.equal(input.limit, 30); assert.equal(input.query, 'Owner');
			return { available: true, guildId, members: [{ id: '981122334455667799', displayName: 'Owner', avatarUrl: '/avatar.png' }, { id: '981122334455667798', displayName: 'Unregistered' }, { id: '981122334455667799', isBot: true }], nextOffset: 30 };
		} };
		const ownerPage = await service.listRoleTeamOwners(guildId, actor, { query: ' Owner ' }, ownerDeps);
		assert.equal(ownerPage.partial, true); assert.equal(ownerPage.nextOffset, 30);
		assert.deepEqual(ownerPage.candidates.map(candidate => candidate.userId), [owner], 'Owner discovery excludes unregistered users and bots');
		await assert.rejects(service.listRoleTeamOwners(guildId, owner, {}, ownerDeps), { code: 'team_forbidden' });
		await assert.rejects(service.listRoleTeamOwners(guildId, actor, { offset: -1 }, ownerDeps), { code: 'request_body_invalid' });
		await assert.rejects(service.listRoleTeamOwners(guildId, actor, {}, { ...deps, listCandidates: async () => ({ available: true, guildId: 'wrong', members: [] }) }), { code: 'discord_guilds_unavailable' });
		await assert.rejects(service.listRoleTeamOwners(guildId, actor, {}, { ...deps, listCandidates: async () => ({ available: false }) }), { code: 'discord_guilds_unavailable' });
		await assert.rejects(service.previewTeamsFromRoles(guildId, owner, input, deps), { code: 'team_forbidden' });
		await assert.rejects(service.previewTeamsFromRoles(guildId, actor, { teams: [...input.teams, input.teams[0]] }, deps), { code: 'role_creation_selection_invalid' });
		await assert.rejects(service.previewTeamsFromRoles(guildId, actor, { teams: [{ ...input.teams[0], ownerUserId: actor }] }, deps), { code: 'role_creation_owner_ineligible' });
		await assert.rejects(service.previewTeamsFromRoles(guildId, actor, input, { ...deps, verify: async () => ({ available: true, userId: actor, guildId: 'wrong', isMember: true, canManageServer: true }) }), { code: 'team_forbidden' });
		await assert.rejects(service.previewTeamsFromRoles(guildId, actor, input, { ...deps, listRoles: async () => ({ available: false }) }), { code: 'discord_guilds_unavailable' });
		await assert.rejects(service.previewTeamsFromRoles(guildId, actor, input, { ...deps, listRoles: async () => ({ available: true, guildId, roles: roles.map(role => ({ ...role, guildId: 'wrong' })) }) }), { code: 'discord_role_ineligible' });
		await assert.rejects(service.previewTeamsFromRoles(guildId, actor, input, { ...deps, verify: async (id, guild) => ({ ...await deps.verify(id, guild), isBot: id === owner }) }), { code: 'role_creation_owner_ineligible' });
		const preview = await service.previewTeamsFromRoles(guildId, actor, input, deps);
		const request = { ...input, requestKey: randomUUID(), expectedPreview: preview.preview };
		roles[0].name = 'Renamed';
		await assert.rejects(service.createTeamsFromRoles(guildId, actor, request, deps), { code: 'revision_conflict' });
		roles[0].name = 'Department 0';
		// Fail the second insert in a real transaction: no first team, mapping or retry receipt may survive.
		await db.query(`CREATE FUNCTION ${prefix}_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
		 IF NEW.created_by='${actor}' AND NEW.name='Department 1' THEN RAISE EXCEPTION 'injected second-team failure'; END IF;
		 RETURN NEW; END $$`);
		try {
			await db.query(`CREATE TRIGGER ${prefix}_reject BEFORE INSERT ON teams FOR EACH ROW EXECUTE FUNCTION ${prefix}_reject()`);
			await assert.rejects(service.createTeamsFromRoles(guildId, actor, request, deps), /injected second-team failure/);
			assert.equal((await db.query('SELECT count(*)::int n FROM teams WHERE created_by=$1', [actor])).rows[0].n, 0);
			assert.equal((await db.query('SELECT count(*)::int n FROM server_role_mappings WHERE created_by=$1', [actor])).rows[0].n, 0);
			assert.equal((await db.query('SELECT count(*)::int n FROM server_role_team_creations WHERE actor_id=$1', [actor])).rows[0].n, 0);
		} finally {
			await db.query(`DROP TRIGGER IF EXISTS ${prefix}_reject ON teams`);
			await db.query(`DROP FUNCTION ${prefix}_reject()`);
		}
		const [created, concurrent] = await Promise.all([service.createTeamsFromRoles(guildId, actor, request, deps), service.createTeamsFromRoles(guildId, actor, request, deps)]);
		assert.deepEqual(created, concurrent, 'Concurrent same-key retries create exactly one batch');
		assert.equal(created.teams.length, 2);
		const ids = created.teams.map(team => team.id);
		assert.equal((await db.query('SELECT count(*)::int n FROM teams WHERE id=ANY($1::text[])', [ids])).rows[0].n, 2);
		const memberships = (await db.query('SELECT user_id,role FROM team_memberships WHERE team_id=ANY($1::text[])', [ids])).rows;
		assert.equal(memberships.length, 2); assert.ok(memberships.every(row => row.user_id === owner && row.role === 'owner'), 'Only explicitly chosen owners join; server admin gets no membership');
		assert.ok((await db.query('SELECT enabled,mode,owner_consent_by FROM server_role_mappings WHERE team_id=ANY($1::text[])', [ids])).rows.every(row => !row.enabled && row.mode === 'approval' && row.owner_consent_by === null), 'No silent mapping activation');
		await assert.rejects(service.createTeamsFromRoles(guildId, actor, { ...request, teams: [{ ...input.teams[0], name: 'Changed' }] }, deps), { code: 'idempotency_conflict' });
		await assert.rejects(service.createTeamsFromRoles(guildId, actor, { ...request, requestKey: randomUUID() }, deps), { code: 'role_creation_already_linked' });
		await assert.rejects(service.createTeamsFromRoles(guildId, owner, request, deps), { code: 'team_forbidden' });
		await db.query('UPDATE teams SET archived_at=now() WHERE id=$1', [ids[0]]);
		assert.deepEqual(await service.createTeamsFromRoles(guildId, actor, request, deps), created, 'Replay does not recreate archived teams');
		assert.ok((await db.query('SELECT archived_at FROM teams WHERE id=$1', [ids[0]])).rows[0].archived_at);
		const otherInput = { teams: [{ roleId: roles[2].id, name: 'Concurrent', ownerUserId: owner }] };
		const otherPreview = await service.previewTeamsFromRoles(guildId, actor, otherInput, deps);
		const raced = await Promise.allSettled([0, 1].map(() => service.createTeamsFromRoles(guildId, actor, { ...otherInput, requestKey: randomUUID(), expectedPreview: otherPreview.preview }, deps)));
		assert.equal(raced.filter(result => result.status === 'fulfilled').length, 1, 'Different-key concurrent imports do not duplicate a department');
		assert.equal(raced.find(result => result.status === 'rejected').reason.code, 'role_creation_already_linked');
		const atomicInput = { teams: [{ roleId: roles[3].id, name: 'Must roll back', ownerUserId: owner }, input.teams[0]] };
		await assert.rejects(service.previewTeamsFromRoles(guildId, actor, atomicInput, deps), { code: 'role_creation_already_linked' });
		assert.equal((await db.query('SELECT count(*)::int n FROM teams WHERE created_by=$1', [actor])).rows[0].n, 3);
		const previousFlag = process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED;
		try { process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED = '0'; await assert.rejects(service.createTeamsFromRoles(guildId, actor, request, deps), { code: 'team_discord_disabled' }); }
		finally { if (previousFlag === undefined) delete process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED; else process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED = previousFlag; }
		console.log('Role team creation passed: explicit owners, live authority, stale previews, no implicit access, retry/different-key concurrency and flags');
	} finally {
		await db.query('DELETE FROM server_role_team_creations WHERE actor_id=$1', [actor]);
		await db.query('DELETE FROM server_role_mappings WHERE created_by=$1', [actor]);
		await db.query('DELETE FROM team_events WHERE actor_user_id=$1', [actor]);
		await db.query('DELETE FROM team_memberships WHERE team_id IN (SELECT id FROM teams WHERE created_by=$1)', [actor]);
		await db.query('DELETE FROM teams WHERE created_by=$1', [actor]);
		await db.query('DELETE FROM identities WHERE user_id=$1', [owner]);
		await db.query('DELETE FROM users WHERE id=ANY($1::text[])', [[actor, owner]]);
		await db.getPool().end();
	}
})().catch(error => { console.error(error); process.exitCode = 1; });
