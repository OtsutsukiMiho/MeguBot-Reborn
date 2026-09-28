'use strict';
const assert = require('node:assert/strict');
const db = require('../core/db');
const { isDisposableTestDatabase } = require('./test-database');
(async () => {
	assert.ok(isDisposableTestDatabase(process.env.MEGU_TEST_DATABASE_URL));
	process.env.MEGU_DATABASE_URL = process.env.MEGU_TEST_DATABASE_URL; process.env.MEGU_TEAM_GOALS_ENABLED = '1';
	await require('../core/schema').initCoreSchema();
	const client = await db.getPool().connect(), originalTransaction = db.transaction, originalQuery = db.query;
	try {
		await client.query('BEGIN'); db.transaction = fn => fn(client); db.query = (...args) => client.query(...args);
		const sources = require('../core/team-membership-sources'), projects = require('../core/projects'), goals = require('../core/team-goals');
		const teamId = `retire_${Date.now()}`, mappingId = `${teamId}_mapping`, guild = '833333333333333333';
		const [owner, derived, retained, projectOwner] = ['owner', 'derived', 'retained', 'projectOwner'].map(id => `${teamId}_${id}`);
		for (const user of [owner, derived, retained, projectOwner]) await client.query('INSERT INTO users(id,display_name) VALUES ($1,$1)', [user]);
		await client.query('INSERT INTO teams(id,name,created_by,discord_guild_id) VALUES ($1,$1,$2,$3)', [teamId, owner, guild]);
		for (const [user, role] of [[owner, 'owner'], [derived, 'member'], [retained, 'member'], [projectOwner, 'admin']]) await client.query('INSERT INTO team_memberships(team_id,user_id,role) VALUES ($1,$2,$3)', [teamId, user, role]);
		for (const user of [owner, retained, projectOwner]) await sources.grantManualSource(client, teamId, user, owner, 'fixture_manual');
		await client.query("INSERT INTO server_role_mappings(id,guild_id,kind,team_id,mode,created_by) VALUES ($1,$2,'team',$3,'automatic',$4)", [mappingId, guild, teamId, owner]);
		const addSource = (user, cycle = 1) => client.query("INSERT INTO team_membership_sources(id,team_id,user_id,kind,source_key,mapping_id,cycle,origin) VALUES ($1,$2,$3,'discord_role',$4,$4,$5,'fixture_automatic')", [`${user}_source_${cycle}`, teamId, user, mappingId, cycle]);
		for (const user of [owner, derived, retained, projectOwner]) await addSource(user);
		const project = await projects.createProject({ ownerUserId: owner, title: 'Source retirement', teamId, timezone: 'UTC' });
		const topic = (await projects.createTopic(project.code, owner, { title: 'Retained history', expectedRevision: 0 })).topic;
		for (const user of [derived, retained]) {
			await client.query("INSERT INTO project_memberships(project_id,user_id,role) VALUES ($1,$2,'member')", [project.id, user]);
			await client.query('INSERT INTO project_topic_assignees(project_id,topic_id,user_id) VALUES ($1,$2,$3)', [project.id, topic.id, user]);
		}
		const owned = await projects.createProject({ ownerUserId: projectOwner, title: 'Ownership block', teamId, timezone: 'UTC' });
		await client.query("DELETE FROM team_membership_sources WHERE team_id=$1 AND user_id=$2 AND kind='manual'", [teamId, projectOwner]);
		const goal = await goals.createGoal(teamId, owner, { subjectId: derived, reviewerId: owner, title: 'Retained goal', successDescription: 'Accepted delivery', periodStart: '2026-09-01', periodEnd: '2026-09-30', timezone: 'UTC', measurement: { kind: 'milestone', criteria: 'Accepted' } });
		await goals.transitionGoal(goal.id, owner, { action: 'propose', expectedRevision: 0, version: 1 });
		await goals.transitionGoal(goal.id, derived, { action: 'accept', expectedRevision: 1, version: 1 });
		await goals.transitionGoal(goal.id, owner, { action: 'accept', expectedRevision: 2, version: 1 });
		assert.equal((await sources.retireMappingSource(client, teamId, retained, mappingId, owner, 'role_not_held')).state, 'preserved');
		assert.equal((await client.query('SELECT revoked_at FROM team_memberships WHERE team_id=$1 AND user_id=$2', [teamId, retained])).rows[0].revoked_at, null);
		assert.equal((await client.query('SELECT revoked_at FROM project_memberships WHERE project_id=$1 AND user_id=$2', [project.id, retained])).rows[0].revoked_at, null);
		assert.equal((await client.query('SELECT count(*)::int AS n FROM project_topic_assignees WHERE user_id=$1', [retained])).rows[0].n, 1);
		const retired = await sources.retireMappingSource(client, teamId, derived, mappingId, owner, 'role_not_held');
		assert.deepEqual(retired, { state: 'revoked', projectCount: 1, assignmentCount: 1 });
		assert.ok((await client.query('SELECT revoked_at FROM team_memberships WHERE team_id=$1 AND user_id=$2', [teamId, derived])).rows[0].revoked_at);
		assert.ok((await client.query('SELECT revoked_at FROM project_memberships WHERE project_id=$1 AND user_id=$2', [project.id, derived])).rows[0].revoked_at);
		assert.equal((await client.query('SELECT count(*)::int AS n FROM project_topic_assignees WHERE user_id=$1', [derived])).rows[0].n, 0);
		assert.equal((await client.query('SELECT lifecycle FROM team_goal_versions WHERE goal_id=$1', [goal.id])).rows[0].lifecycle, 'cancelled');
		assert.equal(await sources.isMembershipSuppressed(client, teamId, derived), false, 'Automatic retirement must not invent a manual-removal suppression');
		assert.deepEqual(await sources.retireMappingSource(client, teamId, derived, mappingId, owner, 'duplicate'), { state: 'none' });
		assert.deepEqual(await sources.retireMappingSource(client, teamId, projectOwner, mappingId, owner, 'role_not_held'), { state: 'blocked', reason: 'team_project_owner_transfer_required' });
		assert.equal((await client.query('SELECT owner_user_id FROM projects WHERE id=$1', [owned.id])).rows[0].owner_user_id, projectOwner);
		assert.equal((await client.query('SELECT revoked_at FROM team_memberships WHERE team_id=$1 AND user_id=$2', [teamId, projectOwner])).rows[0].revoked_at, null);
		await client.query("DELETE FROM team_membership_sources WHERE team_id=$1 AND user_id=$2 AND kind='manual'", [teamId, owner]);
		assert.deepEqual(await sources.retireMappingSource(client, teamId, owner, mappingId, owner, 'role_not_held'), { state: 'blocked', reason: 'team_owner_transfer_required' });
		for (const user of [owner, projectOwner]) {
			const source = (await client.query('SELECT revoked_at,metadata FROM team_membership_sources WHERE team_id=$1 AND user_id=$2 AND mapping_id=$3', [teamId, user, mappingId])).rows[0];
			assert.equal(source.revoked_at, null); assert.ok(source.metadata.blockedRevocation.reason);
		}
		assert.equal((await client.query('SELECT count(*)::int AS n FROM team_events WHERE team_id=$1 AND event_type=\'role_source_retired\'', [teamId])).rows[0].n, 2);
		const mappings = require('../core/server-role-mappings');
		await client.query("UPDATE server_role_mappings SET mode='approval',revision=1 WHERE id=$1", [mappingId]);
		await assert.rejects(mappings.removeTeamMapping(teamId, owner, { expectedRevision: 1 }), { code: 'role_mapping_automatic_not_supported' });
		const teams = require('../core/teams');
		await client.query('UPDATE server_role_mappings SET retired_at=now() WHERE id=$1', [mappingId]);
		await assert.rejects(teams.disconnectDiscordGuild(teamId, owner, { expectedRevision: (await client.query('SELECT revision FROM teams WHERE id=$1', [teamId])).rows[0].revision }), { code: 'team_role_mapping_connected' });
		await client.query('UPDATE server_role_mappings SET retired_at=NULL WHERE id=$1', [mappingId]);
		for (const user of [owner, projectOwner]) {
			await sources.grantManualSource(client, teamId, user, owner, 'explicit_fixture_retention');
			assert.equal((await sources.retireMappingSource(client, teamId, user, mappingId, owner, 'mapping_disabled')).state, 'preserved');
		}
		assert.deepEqual(await mappings.removeTeamMapping(teamId, owner, { expectedRevision: 1 }), { removed: true });
		assert.ok((await client.query('SELECT retired_at FROM server_role_mappings WHERE id=$1', [mappingId])).rows[0].retired_at);
		assert.equal((await mappings.getTeamMapping(teamId, owner)).mapping, null);
		const revision = (await client.query('SELECT revision FROM teams WHERE id=$1', [teamId])).rows[0].revision;
		await teams.disconnectDiscordGuild(teamId, owner, { expectedRevision: revision });
		assert.equal((await client.query('SELECT discord_guild_id FROM teams WHERE id=$1', [teamId])).rows[0].discord_guild_id, null);
		assert.equal((await client.query('SELECT guild_id FROM server_role_mappings WHERE id=$1', [mappingId])).rows[0].guild_id, guild, 'Safe detach must preserve the old mapping server snapshot');
		await teams.connectDiscordGuild(teamId, owner, { guildId: guild, guildName: 'Fixture server', expectedRevision: revision + 1 });
		const roleId = '844444444444444444';
		const deps = { verify: async userId => ({ available: true, userId, guildId: guild, isMember: true, isBot: false, canManageServer: true }), listRoles: async () => ({ available: true, guildId: guild, roles: [{ id: roleId, guildId: guild, name: 'Delivery role', managed: false }] }) };
		const next = await mappings.proposeTeamMapping(guild, teamId, owner, { roleIds: [roleId], expectedRevision: 0 }, deps);
		assert.notEqual(next.id, mappingId); assert.equal((await mappings.getTeamMapping(teamId, owner)).mapping.id, next.id);
		assert.equal((await mappings.getServerTeamMapping(guild, teamId, owner, deps)).mapping.id, next.id);
		assert.equal((await client.query('SELECT count(*)::int AS n FROM team_membership_sources WHERE mapping_id=$1', [mappingId])).rows[0].n, 4, 'Historical source FKs continue referencing the retired mapping');
		console.log('Role source retirement passed: other/manual source retention, final eligibility/project/assignment revocation, preserved goals/history, no automatic suppression, idempotency and durable team/project ownership blocks.');
	} finally { db.transaction = originalTransaction; db.query = originalQuery; await client.query('ROLLBACK'); client.release(); await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
