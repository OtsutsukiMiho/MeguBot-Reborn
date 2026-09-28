'use strict';

const { query, transaction } = require('./db');
const { newId } = require('./ids');
const { validateRoleSelection } = require('./company-role-policy');
const { validate, accessById } = require('./teams');
const fail = code => { throw Object.assign(new Error(code), { code }); };

async function proposeTeamMapping(guildId, teamId, actorId, input, { verify, listRoles }) {
	if (process.env.MEGU_PROJECT_TEAMS_ENABLED === '0' || process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED === '0') fail('team_discord_disabled');
	validate.assertKnownFields(input, ['roleIds', 'expectedRevision', 'confirmSharedRoles']);
	if (!/^\d{17,20}$/.test(guildId)) fail('discord_guild_invalid');
	if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) fail('revision_conflict');
	if (input.confirmSharedRoles != null && typeof input.confirmSharedRoles !== 'boolean') fail('request_body_invalid');
	const authority = await verify?.(actorId, guildId, { management: true });
	if (!authority?.available) fail('discord_guilds_unavailable');
	if (authority.userId !== actorId || authority.guildId !== guildId || authority.isMember !== true || authority.isBot === true || authority.canManageServer !== true) fail('team_forbidden');
	const discovery = await listRoles?.(guildId);
	if (!discovery?.available || discovery.guildId !== guildId || !Array.isArray(discovery.roles)) fail('discord_guilds_unavailable');
	const roleIds = validateRoleSelection(guildId, input.roleIds, discovery.roles).sort();
	return transaction(async client => {
		// Serialize role-sharing checks across this server, then lock team before
		// mapping (the same order used by team lifecycle operations).
		await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`server-role-mappings:${guildId}`]);
		const team = (await client.query('SELECT id FROM teams WHERE id=$1 AND discord_guild_id=$2 AND archived_at IS NULL FOR UPDATE', [teamId, guildId])).rows[0];
		if (!team) fail('team_not_found');
		const existing = (await client.query("SELECT * FROM server_role_mappings WHERE team_id=$1 AND kind='team' AND retired_at IS NULL FOR UPDATE", [teamId])).rows[0];
		if (input.expectedRevision !== (existing?.revision ?? 0)) fail('revision_conflict');
		if (existing && existing.mode !== 'approval') fail('role_mapping_automatic_not_supported');
		const shared = await client.query(`SELECT 1 FROM server_role_mapping_roles r JOIN server_role_mappings m ON m.id=r.mapping_id
		 WHERE m.guild_id=$1 AND m.kind='team' AND m.retired_at IS NULL AND m.team_id<>$2 AND r.role_id=ANY($3::text[]) LIMIT 1`, [guildId, teamId, roleIds]);
		if (shared.rowCount && input.confirmSharedRoles !== true) fail('role_mapping_shared_confirmation_required');
		const id = existing?.id || newId('rmp');
		if (existing) {
			await client.query(`UPDATE server_role_mappings SET enabled=false,mode='approval',revision=revision+1,
			 owner_consent_by=NULL,owner_consent_at=NULL,server_consent_by=$2,server_consent_at=now(),updated_at=now() WHERE id=$1`, [id, actorId]);
			await client.query('DELETE FROM server_role_mapping_roles WHERE mapping_id=$1', [id]);
		} else {
			await client.query(`INSERT INTO server_role_mappings(id,guild_id,kind,team_id,created_by,server_consent_by,server_consent_at,revision)
			 VALUES ($1,$2,'team',$3,$4,$4,now(),1)`, [id, guildId, teamId, actorId]);
		}
		for (const roleId of roleIds) await client.query('INSERT INTO server_role_mapping_roles(mapping_id,role_id,name_snapshot) VALUES ($1,$2,$3)', [id, roleId, discovery.roles.find(role => role.id === roleId).name]);
		await client.query(`INSERT INTO team_events(id,team_id,actor_user_id,event_type,payload) VALUES ($1,$2,$3,'role_mapping_proposed',$4)`,
			[newId('tev'), teamId, actorId, JSON.stringify({ mappingId: id, roleIds, revision: (existing?.revision ?? 0) + 1 })]);
		return { id, guildId, teamId, roleIds, revision: (existing?.revision ?? 0) + 1, enabled: false, mode: 'approval', status: 'awaiting_owner_consent' };
	});
}

async function approveTeamMapping(teamId, actorId, input, { verify, listRoles }) {
	if (process.env.MEGU_PROJECT_TEAMS_ENABLED === '0' || process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED === '0') fail('team_discord_disabled');
	validate.assertKnownFields(input, ['expectedRevision']);
	if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) fail('revision_conflict');
	const team = await accessById({ query }, teamId, actorId, { allowArchived: false });
	if (team.role !== 'owner' || !team.discordGuild) fail('team_forbidden');
	const snapshot = (await query("SELECT * FROM server_role_mappings WHERE team_id=$1 AND kind='team' AND retired_at IS NULL", [teamId])).rows[0];
	if (!snapshot) fail('role_mapping_not_found');
	if (snapshot.mode !== 'approval') fail('role_mapping_automatic_not_supported');
	if (snapshot.revision !== input.expectedRevision) fail('revision_conflict');
	const guildId = team.discordGuild.id;
	for (const [userId, management] of [[actorId, false], [snapshot.server_consent_by, true]]) {
		const evidence = await verify?.(userId, guildId, { management });
		if (!evidence?.available) fail('discord_guilds_unavailable');
		if (evidence.userId !== userId || evidence.guildId !== guildId || evidence.isMember !== true || evidence.isBot === true || (management && evidence.canManageServer !== true)) fail('team_forbidden');
	}
	const discovery = await listRoles?.(guildId);
	if (!discovery?.available || discovery.guildId !== guildId || !Array.isArray(discovery.roles)) fail('discord_guilds_unavailable');
	return transaction(async client => {
		const lockedTeam = await accessById(client, teamId, actorId, { lock: true, allowArchived: false });
		if (lockedTeam.role !== 'owner' || lockedTeam.discordGuild?.id !== guildId) fail('team_forbidden');
		const mapping = (await client.query('SELECT * FROM server_role_mappings WHERE id=$1 AND retired_at IS NULL FOR UPDATE', [snapshot.id])).rows[0];
		if (!mapping || mapping.revision !== input.expectedRevision || mapping.server_consent_by !== snapshot.server_consent_by) fail('revision_conflict');
		if (mapping.mode !== 'approval') fail('role_mapping_automatic_not_supported');
		const selected = (await client.query('SELECT role_id FROM server_role_mapping_roles WHERE mapping_id=$1 ORDER BY role_id', [mapping.id])).rows.map(row => row.role_id);
		validateRoleSelection(guildId, selected, discovery.roles);
		await client.query(`UPDATE server_role_mappings SET enabled=true,owner_consent_by=$2,owner_consent_at=now(),revision=revision+1,updated_at=now() WHERE id=$1`, [mapping.id, actorId]);
		await client.query(`INSERT INTO team_events(id,team_id,actor_user_id,event_type,payload) VALUES ($1,$2,$3,'role_mapping_approved',$4)`,
			[newId('tev'), teamId, actorId, JSON.stringify({ mappingId: mapping.id, revision: mapping.revision + 1 })]);
		return { id: mapping.id, guildId, teamId, roleIds: selected, revision: mapping.revision + 1, enabled: true, mode: mapping.mode };
	});
}

async function getTeamMapping(teamId, actorId) {
	if (process.env.MEGU_PROJECT_TEAMS_ENABLED === '0' || process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED === '0') fail('team_discord_disabled');
	const team = await accessById({ query }, teamId, actorId);
	if (!['owner', 'admin'].includes(team.role)) fail('team_forbidden');
	return readTeamMapping(teamId);
}

// Server management may read this configuration for a known, bound team ID.
// This does not disclose the private team summary, roster, goals or projects.
async function getServerTeamMapping(guildId, teamId, actorId, { verify }) {
	if (process.env.MEGU_PROJECT_TEAMS_ENABLED === '0' || process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED === '0') fail('team_discord_disabled');
	if (!/^\d{17,20}$/.test(guildId)) fail('discord_guild_invalid');
	const authority = await verify?.(actorId, guildId, { management: true });
	if (!authority?.available) fail('discord_guilds_unavailable');
	if (authority.userId !== actorId || authority.guildId !== guildId || authority.isMember !== true || authority.isBot === true || authority.canManageServer !== true) fail('team_forbidden');
	const team = (await query('SELECT id FROM teams WHERE id=$1 AND discord_guild_id=$2 AND archived_at IS NULL', [teamId, guildId])).rows[0];
	if (!team) fail('team_not_found');
	return readTeamMapping(teamId, guildId);
}

async function readTeamMapping(teamId, guildId = null) {
	const mapping = (await query(`SELECT m.id,m.guild_id,m.revision,m.enabled,m.mode,m.owner_consent_at,m.server_consent_at,
	 EXISTS (SELECT 1 FROM team_memberships owner WHERE owner.team_id=m.team_id AND owner.user_id=m.owner_consent_by AND owner.role='owner' AND owner.revoked_at IS NULL) AS owner_consent_valid,
	 COALESCE(jsonb_agg(jsonb_build_object('id',r.role_id,'name',r.name_snapshot) ORDER BY r.role_id) FILTER (WHERE r.role_id IS NOT NULL),'[]'::jsonb) AS roles
	 FROM server_role_mappings m LEFT JOIN server_role_mapping_roles r ON r.mapping_id=m.id
	 WHERE m.team_id=$1 AND m.kind='team' AND m.retired_at IS NULL
	 AND ($2::text IS NULL OR (m.guild_id=$2 AND EXISTS (SELECT 1 FROM teams t WHERE t.id=m.team_id AND t.discord_guild_id=$2 AND t.archived_at IS NULL)))
	 GROUP BY m.id`, [teamId, guildId])).rows[0];
	return { mapping: mapping ? { id: mapping.id, guildId: mapping.guild_id, revision: mapping.revision, enabled: mapping.enabled && mapping.owner_consent_valid,
		mode: mapping.mode, roles: mapping.roles, ownerConsentAt: mapping.owner_consent_at, serverConsentAt: mapping.server_consent_at } : null };
}

async function removeTeamMapping(teamId, actorId, input) {
	if (process.env.MEGU_PROJECT_TEAMS_ENABLED === '0' || process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED === '0') fail('team_discord_disabled');
	validate.assertKnownFields(input, ['expectedRevision']);
	if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) fail('revision_conflict');
	return transaction(async client => {
		const team = await accessById(client, teamId, actorId, { lock: true, allowArchived: false });
		if (team.role !== 'owner') fail('team_forbidden');
		const mapping = (await client.query("SELECT * FROM server_role_mappings WHERE team_id=$1 AND kind='team' AND retired_at IS NULL FOR UPDATE", [teamId])).rows[0];
		if (!mapping) fail('role_mapping_not_found');
		if (mapping.revision !== input.expectedRevision) fail('revision_conflict');
		// Automatic grants require source reconciliation, which is not exposed yet.
		if (mapping.mode !== 'approval') fail('role_mapping_automatic_not_supported');
		const roles = (await client.query('SELECT role_id,name_snapshot FROM server_role_mapping_roles WHERE mapping_id=$1 ORDER BY role_id', [mapping.id])).rows;
		await client.query(`INSERT INTO team_events(id,team_id,actor_user_id,event_type,payload) VALUES ($1,$2,$3,'role_mapping_removed',$4)`,
			[newId('tev'), teamId, actorId, JSON.stringify({ mappingId: mapping.id, guildId: mapping.guild_id, roles, revision: mapping.revision })]);
		const history = (await client.query('SELECT count(*)>0 AS present,COALESCE(bool_or(revoked_at IS NULL),false) AS active FROM team_membership_sources WHERE mapping_id=$1', [mapping.id])).rows[0];
		if (history.active) fail('role_mapping_automatic_not_supported');
		if (history.present) await client.query('UPDATE server_role_mappings SET enabled=false,retired_at=now(),revision=revision+1,updated_at=now() WHERE id=$1', [mapping.id]);
		else await client.query('DELETE FROM server_role_mappings WHERE id=$1', [mapping.id]);
		return { removed: true };
	});
}

async function approveRoleMember(teamId, actorId, input, { verify }) {
	if (process.env.MEGU_PROJECT_TEAMS_ENABLED === '0' || process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED === '0') fail('team_discord_disabled');
	validate.assertKnownFields(input, ['userId', 'expectedRevision', 'restoreRemoved', 'expectedTeamRevision']);
	if (typeof input.userId !== 'string' || !input.userId || input.userId.length > 200) fail('member_user_id_required');
	if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) fail('revision_conflict');
	if (input.restoreRemoved != null && typeof input.restoreRemoved !== 'boolean') fail('request_body_invalid');
	const team = await accessById({ query }, teamId, actorId, { allowArchived: false });
	if (!['owner', 'admin'].includes(team.role) || !team.discordGuild) fail('team_forbidden');
	const guildId = team.discordGuild.id;
	const actor = await verify?.(actorId, guildId, { management: false });
	if (!actor?.available) fail('discord_guilds_unavailable');
	if (actor.userId !== actorId || actor.guildId !== guildId || actor.isMember !== true || actor.isBot === true) fail('team_forbidden');
	// Approval must target an existing Discord-linked account, never a placeholder.
	const identity = (await query("SELECT provider_uid FROM identities WHERE user_id=$1 AND provider='discord'", [input.userId])).rows[0];
	if (!identity) fail('role_member_sign_in_required');
	const evidence = await verify?.(input.userId, guildId, { management: false });
	if (!evidence?.available || !Array.isArray(evidence.roleIds)) fail('discord_guilds_unavailable');
	if (evidence.userId !== input.userId || evidence.guildId !== guildId || evidence.isMember !== true || evidence.isBot === true) fail('role_member_ineligible');
	return transaction(async client => {
		const lockedTeam = await accessById(client, teamId, actorId, { lock: true, allowArchived: false });
		if (!['owner', 'admin'].includes(lockedTeam.role) || lockedTeam.discordGuild?.id !== guildId) fail('team_forbidden');
		const mapping = (await client.query("SELECT * FROM server_role_mappings WHERE team_id=$1 AND kind='team' AND retired_at IS NULL FOR UPDATE", [teamId])).rows[0];
		if (!mapping || mapping.revision !== input.expectedRevision) fail('revision_conflict');
		const owner = (await client.query("SELECT user_id FROM team_memberships WHERE team_id=$1 AND role='owner' AND revoked_at IS NULL", [teamId])).rows[0];
		if (!mapping.enabled || mapping.mode !== 'approval' || mapping.owner_consent_by !== owner?.user_id) fail('role_mapping_consent_required');
		const matched = (await client.query('SELECT role_id FROM server_role_mapping_roles WHERE mapping_id=$1 AND role_id=ANY($2::text[])', [mapping.id, evidence.roleIds])).rows.map(row => row.role_id);
		if (!matched.length) fail('role_member_ineligible');
		const currentIdentity = (await client.query("SELECT provider_uid FROM identities WHERE user_id=$1 AND provider='discord' FOR SHARE", [input.userId])).rows[0];
		if (currentIdentity?.provider_uid !== identity.provider_uid) fail('role_member_ineligible');
		await require('./company-access').requireTeamCompanyAccess(client, teamId, input.userId, { write: true, notFound: 'company_membership_required' });
		const membership = (await client.query('SELECT role,revoked_at FROM team_memberships WHERE team_id=$1 AND user_id=$2 FOR UPDATE', [teamId, input.userId])).rows[0];
		if (membership && !membership.revoked_at) return { status: 'already_member', role: membership.role };
		if ((await client.query('SELECT 1 FROM server_role_suggestion_dismissals WHERE mapping_id=$1 AND discord_user_id=$2', [mapping.id, identity.provider_uid])).rows.length) fail('role_suggestion_dismissed');
		if (membership && input.restoreRemoved !== true) fail('role_member_restore_confirmation_required');
		if (membership && input.expectedTeamRevision !== lockedTeam.revision) fail('revision_conflict');
		const clearedSuppressions = await require('./team-membership-sources').restoreSuppressedMembership(client, teamId, input.userId, actorId, input.restoreRemoved, { errorCode: 'role_member_restore_confirmation_required', expectedRevision: input.expectedTeamRevision, teamRevision: lockedTeam.revision });
		const count = (await client.query('SELECT count(*)::int AS n FROM team_memberships WHERE team_id=$1 AND revoked_at IS NULL', [teamId])).rows[0].n;
		if (count >= 500) fail('team_member_limit');
		await client.query(`INSERT INTO team_memberships(team_id,user_id,role) VALUES ($1,$2,'member')
		 ON CONFLICT(team_id,user_id) DO UPDATE SET role='member',revoked_at=NULL,joined_at=now()`, [teamId, input.userId]);
		await require('./team-membership-sources').grantManualSource(client, teamId, input.userId, actorId, 'role_approved', { mappingId: mapping.id, mappingRevision: mapping.revision, roleIds: matched });
		await client.query('UPDATE teams SET revision=revision+1,updated_at=now() WHERE id=$1', [teamId]);
		await client.query(`INSERT INTO team_events(id,team_id,actor_user_id,event_type,payload) VALUES ($1,$2,$3,'role_member_approved',$4)`,
			[newId('tev'), teamId, actorId, JSON.stringify({ userId: input.userId, mappingId: mapping.id, mappingRevision: mapping.revision, roleIds: matched, source: 'manual_role_approval', restored: Boolean(membership) || clearedSuppressions.length > 0, clearedSuppressions })]);
		return { status: 'approved', role: 'member' };
	});
}

async function previewRoleMembers(teamId, actorId, input, { verify, listCandidates }) {
	validate.assertKnownFields(input, ['offset']);
	const offset = input.offset == null ? 0 : Number(input.offset);
	if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) fail('request_body_invalid');
	const { mapping } = await getTeamMapping(teamId, actorId);
	if (!mapping?.enabled || mapping.mode !== 'approval') fail('role_mapping_consent_required');
	const actor = await verify?.(actorId, mapping.guildId, { management: true });
	if (!actor?.available) fail('discord_guilds_unavailable');
	if (actor.userId !== actorId || actor.guildId !== mapping.guildId || actor.isMember !== true || actor.isBot === true || actor.canManageServer !== true) fail('team_forbidden');
	const roleIds = mapping.roles.map(role => role.id);
	if (!roleIds.length) fail('role_mapping_roles_required');
	const roster = await listCandidates?.({ guildId: mapping.guildId, roleIds, limit: 30, offset });
	if (!roster?.available || roster.guildId !== mapping.guildId || !Array.isArray(roster.members)) fail('discord_guilds_unavailable');
	const members = roster.members.slice(0, 30).filter(member => !member.isBot && Array.isArray(member.roles) && member.roles.some(id => roleIds.includes(id)));
	// Reuse the existing account lookup and recheck team access after the IPC wait.
	const { team, candidates } = await require('./teams').listDiscordCandidates(teamId, actorId, mapping.guildId, members);
	const removed = await query('SELECT user_id FROM team_memberships WHERE team_id=$1 AND user_id=ANY($2::text[]) AND revoked_at IS NOT NULL', [teamId, candidates.map(candidate => candidate.userId).filter(Boolean)]);
	const removedIds = new Set(removed.rows.map(row => row.user_id));
	const dismissed = await query('SELECT discord_user_id FROM server_role_suggestion_dismissals WHERE mapping_id=$1 AND discord_user_id=ANY($2::text[])', [mapping.id, candidates.map(candidate => candidate.discordUserId)]);
	const dismissedIds = new Set(dismissed.rows.map(row => row.discord_user_id));
	return { revision: mapping.revision, teamRevision: team.revision, partial: true,
		candidates: candidates.map(candidate => ({ ...candidate, restoreRequired: candidate.restoreRequired || removedIds.has(candidate.userId), dismissed: dismissedIds.has(candidate.discordUserId) })),
		nextOffset: Number.isSafeInteger(roster.nextOffset) && roster.nextOffset > offset && roster.nextOffset <= 100000 ? roster.nextOffset : null };
}

async function setRoleSuggestionDismissed(teamId, actorId, input, { verify }) {
	if (process.env.MEGU_PROJECT_TEAMS_ENABLED === '0' || process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED === '0') fail('team_discord_disabled');
	validate.assertKnownFields(input, ['discordUserId', 'dismissed', 'expectedRevision']);
	if (typeof input.discordUserId !== 'string' || !/^\d{17,20}$/.test(input.discordUserId) || typeof input.dismissed !== 'boolean') fail('request_body_invalid');
	if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) fail('revision_conflict');
	const team = await accessById({ query }, teamId, actorId, { allowArchived: false });
	if (!['owner', 'admin'].includes(team.role) || !team.discordGuild) fail('team_forbidden');
	const guildId = team.discordGuild.id;
	const actor = await verify?.(actorId, guildId, { management: true });
	if (!actor?.available) fail('discord_guilds_unavailable');
	if (actor.userId !== actorId || actor.guildId !== guildId || actor.isMember !== true || actor.isBot === true || actor.canManageServer !== true) fail('team_forbidden');
	return transaction(async client => {
		const lockedTeam = await accessById(client, teamId, actorId, { lock: true, allowArchived: false });
		if (!['owner', 'admin'].includes(lockedTeam.role) || lockedTeam.discordGuild?.id !== guildId) fail('team_forbidden');
		const mapping = (await client.query("SELECT * FROM server_role_mappings WHERE team_id=$1 AND kind='team' AND retired_at IS NULL FOR UPDATE", [teamId])).rows[0];
		if (!mapping || mapping.revision !== input.expectedRevision) fail('revision_conflict');
		const owner = (await client.query("SELECT user_id FROM team_memberships WHERE team_id=$1 AND role='owner' AND revoked_at IS NULL", [teamId])).rows[0];
		if (!mapping.enabled || mapping.mode !== 'approval' || mapping.owner_consent_by !== owner?.user_id) fail('role_mapping_consent_required');
		// Discord identity is stable across account merges and also covers people not yet signed in.
		let changed;
		if (input.dismissed) {
			const existing = (await client.query('SELECT 1 FROM server_role_suggestion_dismissals WHERE mapping_id=$1 AND discord_user_id=$2', [mapping.id, input.discordUserId])).rows.length;
			if (existing) return { dismissed: true };
			const count = (await client.query('SELECT count(*)::int AS n FROM server_role_suggestion_dismissals WHERE mapping_id=$1', [mapping.id])).rows[0].n;
			if (count >= 1000) fail('role_suggestion_limit');
			changed = await client.query('INSERT INTO server_role_suggestion_dismissals(mapping_id,discord_user_id,dismissed_by) VALUES ($1,$2,$3)', [mapping.id, input.discordUserId, actorId]);
		} else {
			changed = await client.query('DELETE FROM server_role_suggestion_dismissals WHERE mapping_id=$1 AND discord_user_id=$2', [mapping.id, input.discordUserId]);
		}
		if (changed.rowCount) await client.query(`INSERT INTO team_events(id,team_id,actor_user_id,event_type,payload) VALUES ($1,$2,$3,$4,$5)`,
			[newId('tev'), teamId, actorId, input.dismissed ? 'role_suggestion_dismissed' : 'role_suggestion_reset', JSON.stringify({ mappingId: mapping.id, mappingRevision: mapping.revision, discordUserId: input.discordUserId })]);
		return { dismissed: input.dismissed };
	});
}

module.exports = { proposeTeamMapping, approveTeamMapping, getTeamMapping, getServerTeamMapping, removeTeamMapping, approveRoleMember, previewRoleMembers, setRoleSuggestionDismissed };
