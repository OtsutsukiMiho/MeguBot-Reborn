'use strict';
const assert = require('node:assert/strict');
const db = require('../core/db');
const { initCoreSchema } = require('../core/schema');
const { isDisposableTestDatabase } = require('./test-database');

(async () => {
	assert.ok(isDisposableTestDatabase(process.env.MEGU_DATABASE_URL), 'Explicit local test database required');
	await initCoreSchema();
	const client = await db.getPool().connect();
	const originalQuery = db.query;
	const originalTransaction = db.transaction;
	try {
		await client.query('BEGIN');
		db.query = (...args) => client.query(...args);
		db.transaction = async fn => {
			await client.query('SAVEPOINT title_operation');
			try { const value = await fn(client); await client.query('RELEASE SAVEPOINT title_operation'); return value; }
			catch (error) { await client.query('ROLLBACK TO SAVEPOINT title_operation'); throw error; }
		};
		const { getTitleConfiguration, setTitleConfiguration, getTeamMemberTitles, getTeamMemberTitlesBatch } = require('../core/server-role-titles');
		const prefix = `title_${Date.now()}`;
		const guildId = '991122334455667788';
		const roleId = '991122334455667789';
		const [owner, member, outsider] = ['owner', 'member', 'outsider'].map(name => `${prefix}_${name}`);
		for (const id of [owner, member, outsider]) await client.query('INSERT INTO users(id,display_name) VALUES ($1,$1)', [id]);
		await client.query('INSERT INTO teams(id,name,created_by,discord_guild_id) VALUES ($1,$1,$2,$3)', [prefix, owner, guildId]);
		for (const [user, role] of [[owner, 'owner'], [member, 'member']]) await client.query('INSERT INTO team_memberships(team_id,user_id,role) VALUES ($1,$2,$3)', [prefix, user, role]);
		let roleName = 'CEO';
		let memberRoles = [roleId];
		const deps = {
			verify: async (userId, guildId) => ({ available: true, userId, guildId, isMember: true, isBot: false, canManageServer: userId === outsider, roleIds: userId === member ? memberRoles : [] }),
			listRoles: async guildId => ({ available: true, guildId, roles: [{ id: roleId, guildId, name: roleName }, { id: guildId, guildId, name: '@everyone' }] }),
		};
		assert.deepEqual(await getTitleConfiguration(guildId, outsider, deps), { guildId, guild: { id: guildId, name: null, icon: null }, revision: 0, enabled: false, roles: [] });
		await assert.rejects(getTitleConfiguration(guildId, owner, deps), { code: 'team_forbidden' });
		await assert.rejects(setTitleConfiguration(guildId, outsider, { roleIds: [guildId], expectedRevision: 0 }, deps), { code: 'discord_role_ineligible' });
		await assert.rejects(setTitleConfiguration(guildId, outsider, { roleIds: [roleId], expectedRevision: 0, admin: true }, deps), { code: 'unknown_field' });
		const config = await setTitleConfiguration(guildId, outsider, { roleIds: [roleId, roleId], expectedRevision: 0 }, deps);
		assert.equal(config.revision, 1); assert.deepEqual(config.roles, [{ id: roleId, name: 'CEO' }]);
		await assert.rejects(setTitleConfiguration(guildId, outsider, { roleIds: [roleId], expectedRevision: 0 }, deps), { code: 'revision_conflict' });
		assert.deepEqual(await getTeamMemberTitles(prefix, owner, member, deps), { titles: [{ roleId, name: 'CEO' }] });
		assert.deepEqual((await getTeamMemberTitlesBatch(prefix, owner, [member, member], deps)).members, [{ userId: member, titles: [{ roleId, name: 'CEO' }] }], 'Repeated IDs produce one result');
		await assert.rejects(getTeamMemberTitlesBatch(prefix, owner, Array(21).fill(member), deps), { code: 'member_user_id_required' });
		await assert.rejects(getTeamMemberTitlesBatch(prefix, owner, [member, outsider], deps), { code: 'team_member_not_found' });
		const batchIds = Array.from({ length: 7 }, (_, i) => `${prefix}_batch_${i}`);
		for (const id of batchIds) {
			await client.query('INSERT INTO users(id,display_name) VALUES ($1,$1)', [id]);
			await client.query("INSERT INTO team_memberships(team_id,user_id,role) VALUES ($1,$2,'member')", [prefix, id]);
		}
		let running = 0; let peak = 0;
		const batch = await getTeamMemberTitlesBatch(prefix, owner, batchIds, { ...deps, verify: async (userId, guild) => {
			if (userId === owner) return deps.verify(userId, guild);
			running++; peak = Math.max(peak, running);
			await new Promise(resolve => setImmediate(resolve));
			running--;
			if (userId === batchIds[0]) throw new Error('Discord timeout');
			return { available: true, userId, guildId: guild, isMember: true, roleIds: [roleId] };
		} });
		assert.equal(peak, 4, 'Live member checks use bounded concurrency');
		assert.equal(batch.members[0].unavailable, true);
		assert.ok(batch.members.slice(1).every(row => row.titles[0].name === 'CEO'), 'One failed lookup does not mislabel other verified members');
		assert.equal((await client.query('SELECT role FROM team_memberships WHERE team_id=$1 AND user_id=$2', [prefix, member])).rows[0].role, 'member', 'CEO title cannot promote a member');
		assert.equal((await client.query('SELECT count(*)::int AS n FROM project_memberships WHERE user_id=$1', [member])).rows[0].n, 0, 'Title never adds project membership');
		await assert.rejects(getTeamMemberTitles(prefix, outsider, member, deps), { code: 'team_not_found' });
		await assert.rejects(getTeamMemberTitles(prefix, owner, outsider, deps), { code: 'team_member_not_found' });
		roleName = 'Director';
		assert.deepEqual(await getTeamMemberTitles(prefix, owner, member, deps), { titles: [{ roleId, name: 'Director' }] }, 'Rename changes the live badge, not identity');
		memberRoles = [];
		assert.deepEqual(await getTeamMemberTitles(prefix, owner, member, deps), { titles: [] });
		memberRoles = [roleId];
		await assert.rejects(getTeamMemberTitles(prefix, owner, member, { ...deps, listRoles: async guild => {
			const roles = await deps.listRoles(guild);
			await client.query('UPDATE team_memberships SET revoked_at=now() WHERE team_id=$1 AND user_id=$2', [prefix, member]);
			return roles;
		} }), { code: 'team_member_not_found' }, 'Membership revoked during Discord lookup must be rechecked before displaying titles');
		await client.query('UPDATE team_memberships SET revoked_at=NULL WHERE team_id=$1 AND user_id=$2', [prefix, member]);
		assert.deepEqual(await getTeamMemberTitles(prefix, owner, member, { ...deps, listRoles: async () => ({ available: true, guildId, roles: [{ id: roleId, guildId: '998877665544332211', name: 'Forged title' }] }) }), { titles: [] }, 'Wrong-guild role snapshots never supply badges');
		await assert.rejects(getTeamMemberTitles(prefix, owner, member, { ...deps, listRoles: async () => ({ available: false }) }), { code: 'discord_guilds_unavailable' });
		assert.equal((await getTitleConfiguration(guildId, outsider, deps)).enabled, true, 'Outage does not remove configuration');
		const removed = await setTitleConfiguration(guildId, outsider, { roleIds: [], expectedRevision: 1 }, { ...deps, listRoles: async () => { throw new Error('Clearing requires no role discovery'); } });
		assert.equal(removed.enabled, false); assert.equal(removed.revision, 2);
		assert.deepEqual(await getTeamMemberTitles(prefix, owner, member, deps), { titles: [] });
		assert.equal((await client.query('SELECT count(*)::int AS n FROM server_role_events WHERE guild_id=$1', [guildId])).rows[0].n, 2);
		await assert.rejects(getTitleConfiguration(guildId, outsider, { verify: async () => ({ available: true, userId: outsider, guildId: 'wrong', isMember: true, canManageServer: true }) }), { code: 'team_forbidden' });
		process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED = '0';
		await assert.rejects(getTeamMemberTitles(prefix, owner, member, deps), { code: 'team_discord_disabled' });
		delete process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED;
		console.log('Server role titles passed: live authority, scoped display-only badges, revisions, rename/loss/outage, clearing and audit');
	} finally {
		db.query = originalQuery; db.transaction = originalTransaction;
		await client.query('ROLLBACK'); client.release(); await db.close();
	}
})().catch(error => { console.error(error); process.exitCode = 1; });
