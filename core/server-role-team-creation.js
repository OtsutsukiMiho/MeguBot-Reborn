'use strict';

const { createHash } = require('node:crypto');
const { query, transaction } = require('./db');
const { newId } = require('./ids');
const { validate, createTeamWithClient } = require('./teams');
const { validateRoleSelection } = require('./company-role-policy');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function selection(guildId, input, creating) {
	if (process.env.MEGU_PROJECT_TEAMS_ENABLED === '0' || process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED === '0') fail('team_discord_disabled');
	if (!/^\d{17,20}$/.test(guildId)) fail('discord_guild_invalid');
	validate.assertKnownFields(input, creating ? ['teams', 'requestKey', 'expectedPreview'] : ['teams']);
	if (!Array.isArray(input.teams) || !input.teams.length || input.teams.length > 10) fail('role_creation_selection_invalid');
	const teams = input.teams.map(item => {
		validate.assertKnownFields(item, ['roleId', 'name', 'ownerUserId']);
		if (typeof item.roleId !== 'string' || !/^\d{17,20}$/.test(item.roleId)) fail('discord_role_ineligible');
		if (typeof item.name !== 'string' || !item.name.trim()) fail('team_name_required');
		if (item.name.trim().length > 120) fail('team_name_too_long');
		if (typeof item.ownerUserId !== 'string' || !item.ownerUserId.trim() || item.ownerUserId.length > 200) fail('role_creation_owner_required');
		return { roleId: item.roleId, name: item.name.trim(), ownerUserId: item.ownerUserId.trim() };
	}).sort((a, b) => a.roleId.localeCompare(b.roleId));
	if (new Set(teams.map(item => item.roleId)).size !== teams.length) fail('role_creation_selection_invalid');
	if (creating && (typeof input.requestKey !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(input.requestKey))) fail('idempotency_key_invalid');
	if (creating && (typeof input.expectedPreview !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedPreview))) fail('revision_conflict');
	return teams;
}

async function authority(guildId, actorId, verify) {
	const result = await verify?.(actorId, guildId, { management: true });
	if (!result?.available) fail('discord_guilds_unavailable');
	if (result.userId !== actorId || result.guildId !== guildId || result.isMember !== true || result.isBot === true || result.canManageServer !== true) fail('team_forbidden');
	return result;
}

async function evidence(guildId, teams, deps) {
	const discovery = await deps.listRoles?.(guildId);
	if (!discovery?.available || discovery.guildId !== guildId || !Array.isArray(discovery.roles)) fail('discord_guilds_unavailable');
	validateRoleSelection(guildId, teams.map(item => item.roleId), discovery.roles);
	const owners = new Map();
	// At most ten owners, verified sequentially to bound Discord requests.
	for (const ownerId of new Set(teams.map(item => item.ownerUserId))) {
		const identity = (await query("SELECT i.provider_uid,u.display_name FROM identities i JOIN users u ON u.id=i.user_id WHERE i.user_id=$1 AND i.provider='discord'", [ownerId])).rows[0];
		if (!identity) fail('role_creation_owner_ineligible');
		const member = await deps.verify?.(ownerId, guildId, { management: false });
		if (!member?.available) fail('discord_guilds_unavailable');
		if (member.userId !== ownerId || member.guildId !== guildId || member.isMember !== true || member.isBot === true) fail('role_creation_owner_ineligible');
		owners.set(ownerId, identity);
	}
	const rows = teams.map(item => ({ ...item, roleName: discovery.roles.find(role => role.id === item.roleId).name, ownerName: owners.get(item.ownerUserId).display_name }));
	return { rows, owners, preview: hash(rows.map(row => ({ ...row, discordUserId: owners.get(row.ownerUserId).provider_uid }))) };
}

async function assertUnmapped(client, guildId, teams) {
	const exists = await client.query(`SELECT 1 FROM server_role_mapping_roles r JOIN server_role_mappings m ON m.id=r.mapping_id
	 WHERE m.guild_id=$1 AND m.kind='team' AND m.retired_at IS NULL AND r.role_id=ANY($2::text[]) LIMIT 1`, [guildId, teams.map(item => item.roleId)]);
	if (exists.rowCount) fail('role_creation_already_linked');
}

async function previewTeamsFromRoles(guildId, actorId, input, deps) {
	const teams = selection(guildId, input, false);
	await authority(guildId, actorId, deps.verify);
	const current = await evidence(guildId, teams, deps);
	await assertUnmapped({ query }, guildId, teams);
	return { guildId, teams: current.rows, preview: current.preview, mode: 'approval', status: 'awaiting_owner_consent' };
}

async function listRoleTeamOwners(guildId, actorId, input, deps) {
	if (process.env.MEGU_PROJECT_TEAMS_ENABLED === '0' || process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED === '0') fail('team_discord_disabled');
	if (!/^\d{17,20}$/.test(guildId)) fail('discord_guild_invalid');
	validate.assertKnownFields(input, ['query', 'offset']);
	const search = input.query == null ? '' : input.query;
	const offset = input.offset == null ? 0 : Number(input.offset);
	if (typeof search !== 'string' || search.length > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) fail('request_body_invalid');
	const actor = await authority(guildId, actorId, deps.verify);
	const roster = await deps.listCandidates?.({ guildId, query: search.trim(), offset, limit: 30 });
	if (!roster?.available || roster.guildId !== guildId || !Array.isArray(roster.members)) fail('discord_guilds_unavailable');
	const members = roster.members.slice(0, 30).filter(member => member.isBot !== true && /^\d{17,20}$/.test(member.id));
	const identities = await query("SELECT user_id,provider_uid FROM identities WHERE provider='discord' AND provider_uid=ANY($1::text[])", [members.map(member => member.id)]);
	const accounts = new Map(identities.rows.map(identity => [identity.provider_uid, identity.user_id]));
	await authority(guildId, actorId, deps.verify);
	return { guild: { id: guildId, name: actor.name || null, icon: actor.icon || null }, partial: true,
		candidates: [...new Map(members.filter(member => accounts.has(member.id)).map(member => [member.id, {
			userId: accounts.get(member.id), discordUserId: member.id,
			displayName: String(member.displayName || member.username || member.id).slice(0, 120), avatarUrl: typeof member.avatarUrl === 'string' ? member.avatarUrl.slice(0, 500) : null,
		}])).values()],
		nextOffset: Number.isSafeInteger(roster.nextOffset) && roster.nextOffset > offset && roster.nextOffset <= 100000 ? roster.nextOffset : null };
}

async function createTeamsFromRoles(guildId, actorId, input, deps) {
	const teams = selection(guildId, input, true);
	const actor = await authority(guildId, actorId, deps.verify);
	const requestHash = hash({ teams, expectedPreview: input.expectedPreview });
	const replay = row => {
		if (row.actor_id !== actorId || row.request_hash !== requestHash) fail('idempotency_conflict');
		return row.result;
	};
	const previous = (await query('SELECT * FROM server_role_team_creations WHERE guild_id=$1 AND request_key=$2', [guildId, input.requestKey])).rows[0];
	if (previous) return replay(previous);
	const current = await evidence(guildId, teams, deps);
	if (current.preview !== input.expectedPreview) fail('revision_conflict');
	await authority(guildId, actorId, deps.verify);
	return transaction(async client => {
		await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`server-role-mappings:${guildId}`]);
		const concurrent = (await client.query('SELECT * FROM server_role_team_creations WHERE guild_id=$1 AND request_key=$2', [guildId, input.requestKey])).rows[0];
		if (concurrent) return replay(concurrent);
		await assertUnmapped(client, guildId, teams);
		// Identity changes/account merges while Discord was consulted invalidate the preview.
		for (const [ownerId, identity] of [...current.owners].sort(([a], [b]) => a.localeCompare(b))) {
			const locked = (await client.query("SELECT provider_uid FROM identities WHERE user_id=$1 AND provider='discord' FOR SHARE", [ownerId])).rows[0];
			if (locked?.provider_uid !== identity.provider_uid) fail('revision_conflict');
		}
		const result = { guildId, teams: [] };
		for (const item of current.rows) {
			const { team } = await createTeamWithClient(client, { ownerUserId: item.ownerUserId, name: item.name, discordGuildId: guildId, discordGuildName: actor.name || 'Discord server', discordGuildIcon: actor.icon || null }, actorId);
			const mappingId = newId('rmp');
			await client.query(`INSERT INTO server_role_mappings(id,guild_id,kind,team_id,created_by,server_consent_by,server_consent_at,revision)
			 VALUES ($1,$2,'team',$3,$4,$4,now(),1)`, [mappingId, guildId, team.id, actorId]);
			await client.query('INSERT INTO server_role_mapping_roles(mapping_id,role_id,name_snapshot) VALUES ($1,$2,$3)', [mappingId, item.roleId, item.roleName]);
			await client.query(`INSERT INTO team_events(id,team_id,actor_user_id,event_type,payload) VALUES ($1,$2,$3,'role_mapping_proposed',$4)`, [newId('tev'), team.id, actorId, JSON.stringify({ mappingId, roleIds: [item.roleId], revision: 1 })]);
			result.teams.push({ id: team.id, name: team.name, roleId: item.roleId, mappingId, status: 'awaiting_owner_consent' });
		}
		await client.query('INSERT INTO server_role_team_creations(guild_id,request_key,actor_id,request_hash,result) VALUES ($1,$2,$3,$4,$5)', [guildId, input.requestKey, actorId, requestHash, JSON.stringify(result)]);
		return result;
	});
}

module.exports = { previewTeamsFromRoles, createTeamsFromRoles, listRoleTeamOwners };
