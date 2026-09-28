'use strict';

const { query, transaction } = require('./db');
const { newId } = require('./ids');
const { validateRoleSelection } = require('./company-role-policy');
const { validate, accessById } = require('./teams');
const fail = code => { throw Object.assign(new Error(code), { code }); };

async function verifyActor(guildId, actorId, verify, management) {
	if (process.env.MEGU_PROJECT_TEAMS_ENABLED === '0' || process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED === '0') fail('team_discord_disabled');
	if (typeof guildId !== 'string' || !/^\d{17,20}$/.test(guildId)) fail('discord_guild_invalid');
	const result = await verify?.(actorId, guildId, { management });
	if (!result?.available) fail('discord_guilds_unavailable');
	if (result.userId !== actorId || result.guildId !== guildId || result.isMember !== true || result.isBot === true || (management && result.canManageServer !== true)) fail('team_forbidden');
	return result;
}

async function readConfiguration(client, guildId) {
	const mapping = (await client.query("SELECT id,revision,enabled FROM server_role_mappings WHERE guild_id=$1 AND kind='title'", [guildId])).rows[0];
	const roles = mapping ? (await client.query('SELECT role_id AS id,name_snapshot AS name FROM server_role_mapping_roles WHERE mapping_id=$1 ORDER BY role_id', [mapping.id])).rows : [];
	return { guildId, revision: mapping?.revision ?? 0, enabled: Boolean(mapping?.enabled), roles };
}

async function getTitleConfiguration(guildId, actorId, { verify }) {
	const actor = await verifyActor(guildId, actorId, verify, true);
	return transaction(async client => {
		await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`server-role-mappings:${guildId}`]);
		return { ...await readConfiguration(client, guildId), guild: { id: guildId, name: actor.name || null, icon: actor.icon || null } };
	});
}

async function setTitleConfiguration(guildId, actorId, input, { verify, listRoles }) {
	validate.assertKnownFields(input, ['roleIds', 'expectedRevision']);
	if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) fail('revision_conflict');
	if (!Array.isArray(input.roleIds) || input.roleIds.length > 50 || input.roleIds.some(id => typeof id !== 'string' || !/^\d{17,20}$/.test(id))) fail('role_mapping_roles_required');
	await verifyActor(guildId, actorId, verify, true);
	let selected = [];
	if (input.roleIds.length) {
		const discovery = await listRoles?.(guildId);
		if (!discovery?.available || discovery.guildId !== guildId || !Array.isArray(discovery.roles)) fail('discord_guilds_unavailable');
		const ids = validateRoleSelection(guildId, input.roleIds, discovery.roles).sort();
		selected = ids.map(id => ({ id, name: String(discovery.roles.find(role => role.id === id).name).slice(0, 120) }));
	}
	return transaction(async client => {
		await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`server-role-mappings:${guildId}`]);
		const previous = await readConfiguration(client, guildId);
		if (previous.revision !== input.expectedRevision) fail('revision_conflict');
		const mapping = (await client.query("SELECT id FROM server_role_mappings WHERE guild_id=$1 AND kind='title' FOR UPDATE", [guildId])).rows[0];
		const id = mapping?.id || newId('rmp');
		if (mapping) {
			await client.query(`UPDATE server_role_mappings SET enabled=$2,revision=revision+1,server_consent_by=$3,server_consent_at=now(),updated_at=now() WHERE id=$1`, [id, selected.length > 0, actorId]);
			await client.query('DELETE FROM server_role_mapping_roles WHERE mapping_id=$1', [id]);
		} else {
			await client.query(`INSERT INTO server_role_mappings(id,guild_id,kind,title,enabled,revision,created_by,server_consent_by,server_consent_at)
			 VALUES ($1,$2,'title','Discord titles',$3,1,$4,$4,now())`, [id, guildId, selected.length > 0, actorId]);
		}
		for (const role of selected) await client.query('INSERT INTO server_role_mapping_roles(mapping_id,role_id,name_snapshot) VALUES ($1,$2,$3)', [id, role.id, role.name]);
		await client.query(`INSERT INTO server_role_events(id,guild_id,actor_id,event_type,payload) VALUES ($1,$2,$3,'title_roles_changed',$4)`,
			[newId('sre'), guildId, actorId, JSON.stringify({ mappingId: id, revision: previous.revision + 1, previousRoleIds: previous.roles.map(role => role.id), roleIds: selected.map(role => role.id) })]);
		return { guildId, revision: previous.revision + 1, enabled: selected.length > 0, roles: selected };
	});
}

// Badges are derived display data only. No membership or authorization consumer uses them.
async function getTeamMemberTitles(teamId, actorId, subjectId, { verify, listRoles }) {
	const result = await getTeamMemberTitlesBatch(teamId, actorId, [subjectId], { verify, listRoles });
	if (result.members[0].unavailable) fail('discord_guilds_unavailable');
	return { titles: result.members[0].titles };
}

async function getTeamMemberTitlesBatch(teamId, actorId, userIds, { verify, listRoles }) {
	if (process.env.MEGU_PROJECT_TEAMS_ENABLED === '0' || process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED === '0') fail('team_discord_disabled');
	if (!Array.isArray(userIds) || !userIds.length || userIds.length > 20 || userIds.some(id => typeof id !== 'string' || !id || id.length > 200)) fail('member_user_id_required');
	const ids = [...new Set(userIds)];
	const team = await accessById({ query }, teamId, actorId, { allowArchived: false });
	const eligible = await query('SELECT user_id FROM team_memberships WHERE team_id=$1 AND user_id=ANY($2::text[]) AND revoked_at IS NULL', [teamId, ids]);
	if (eligible.rows.length !== ids.length) fail('team_member_not_found');
	const empty = () => ({ members: ids.map(userId => ({ userId, titles: [] })) });
	if (!team.discordGuild) return empty();
	const guildId = team.discordGuild.id;
	const actor = await verifyActor(guildId, actorId, verify, false);
	if (!(await query("SELECT 1 FROM server_role_mappings WHERE guild_id=$1 AND kind='title' AND enabled", [guildId])).rows.length) return empty();
	const discovery = await listRoles?.(guildId);
	if (!discovery?.available || discovery.guildId !== guildId || !Array.isArray(discovery.roles)) fail('discord_guilds_unavailable');
	const observations = new Map([[actorId, actor]]);
	let cursor = 0;
	// Bounded live lookups: do not fan out a 100-person UI page into 100 Discord calls at once.
	await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
		while (cursor < ids.length) {
			const id = ids[cursor++];
			if (id === actorId) continue;
			try { observations.set(id, await verify?.(id, guildId, { management: false })); }
			catch { observations.set(id, { available: false }); }
		}
	}));
	return transaction(async client => {
		const current = await accessById(client, teamId, actorId, { lock: true, allowArchived: false });
		if (current.discordGuild?.id !== guildId) fail('discord_guild_mismatch');
		if ((await client.query('SELECT user_id FROM team_memberships WHERE team_id=$1 AND user_id=ANY($2::text[]) AND revoked_at IS NULL', [teamId, ids])).rows.length !== ids.length) fail('team_member_not_found');
		const roles = (await client.query(`SELECT r.role_id FROM server_role_mapping_roles r JOIN server_role_mappings m ON m.id=r.mapping_id
		 WHERE m.guild_id=$1 AND m.kind='title' AND m.enabled ORDER BY r.role_id LIMIT 50`, [guildId])).rows;
		// Use live labels, not snapshots: a rename is never a new title or a new team.
		return { members: ids.map(userId => {
			const subject = observations.get(userId);
			if (!subject?.available || subject.userId !== userId || subject.guildId !== guildId || (subject.isMember === true && !Array.isArray(subject.roleIds))) return { userId, titles: [], unavailable: true };
			if (subject.isMember !== true || subject.isBot === true) return { userId, titles: [] };
			return { userId, titles: roles.flatMap(({ role_id: id }) => {
				const role = discovery.roles.find(item => item.id === id && item.guildId === guildId && !item.managed && id !== guildId);
				return role && subject.roleIds.includes(id) ? [{ roleId: id, name: String(role.name).slice(0, 120) }] : [];
			}) };
		}) };
	});
}

module.exports = { getTitleConfiguration, setTitleConfiguration, getTeamMemberTitles, getTeamMemberTitlesBatch };
