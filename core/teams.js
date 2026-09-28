const crypto = require('node:crypto');
const { creationKey, withCreationReceipt } = require('./workspace-creation');
const { reportedProgress } = require('./project-insights');
const { query, transaction } = require('./db.js');
const { newId } = require('./ids.js');
const notifications = require('./notifications.js');
const projectReminders = require('./project-reminders.js');
const { hasLegacyCompanySchema, companyEligibilitySql, requireTeamCompanyAccess } = require('./company-access.js');

const TEAM_ROLES = ['owner', 'admin', 'member'];
const TEAM_COLORS = ['indigo', 'blue', 'cyan', 'emerald', 'amber', 'rose', 'violet'];
const MANAGER_ROLES = new Set(['owner', 'admin']);

function codedError(code, message = code, details) {
	const error = new Error(message);
	error.code = code;
	if (details) Object.assign(error, details);
	return error;
}

function assertEnabled() {
	if (process.env.MEGU_PROJECT_TEAMS_ENABLED === '0') throw codedError('teams_disabled');
}

function assertDiscordEnabled() {
	assertEnabled();
	if (process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED === '0') throw codedError('team_discord_disabled');
}

function assertKnownFields(input, allowed) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw codedError('request_body_invalid');
	const known = new Set(allowed);
	const unknown = Object.keys(input).find(key => !known.has(key));
	if (unknown) throw codedError('unknown_field', 'unknown_field', { field: unknown });
}

function cleanText(value) {
	return String(value ?? '').trim();
}

function notificationText(value) {
	return cleanText(value).replace(/[\r\n]+/g, ' ').replaceAll('@', '@\u200b').slice(0, 180);
}

function requiredText(value, field, max) {
	const next = cleanText(value);
	if (!next) throw codedError(`${field}_required`);
	if (next.length > max) throw codedError(`${field}_too_long`);
	return next;
}

function optionalText(value, field, max) {
	const next = cleanText(value);
	if (next.length > max) throw codedError(`${field}_too_long`);
	return next;
}

function token() {
	return crypto.randomBytes(32).toString('base64url');
}

function tokenHash(value) {
	return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function teamRow(row) {
	if (!row) return null;
	return {
		id: row.id,
		companyId: row.company_id || null,
		company: row.company_id ? { id:row.company_id,name:row.company_name || null,lifecycle:row.company_lifecycle || null } : null,
		name: row.name,
		description: row.description || '',
		color: row.color,
		createdBy: row.created_by,
		revision: Number(row.revision || 0),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		archivedAt: row.archived_at || null,
		discordGuild: row.discord_guild_id ? {
			id: row.discord_guild_id,
			name: row.discord_guild_name || 'Discord server',
			icon: row.discord_guild_icon || null,
			connectedAt: row.discord_connected_at || null,
		} : null,
		role: row.role || null,
		memberCount: row.member_count == null ? undefined : Number(row.member_count),
		projectCount: row.project_count == null ? undefined : Number(row.project_count),
	};
}

function memberRow(row) {
	const member = {
		userId: row.user_id,
		displayName: row.display_name,
		avatarUrl: row.avatar_url || null,
		role: row.role,
		joinedAt: row.joined_at,
	};
	if (row.affected_project_count != null) {
		member.removalImpact = {
			projectCount: Number(row.affected_project_count),
			assignmentCount: Number(row.affected_assignment_count || 0),
		};
	}
	return member;
}

function capabilities(team, role) {
	const active = !team.archivedAt && team.company?.lifecycle !== 'archived';
	return {
		canEdit: active && MANAGER_ROLES.has(role),
		canCreateProject: active && MANAGER_ROLES.has(role),
		canManageMembers: active && MANAGER_ROLES.has(role),
		canManageAdmins: active && role === 'owner',
		canManageJoinLink: active && MANAGER_ROLES.has(role),
		canTransferOwnership: active && role === 'owner',
		canArchive: active && role === 'owner',
		canRestore: Boolean(team.archivedAt) && team.company?.lifecycle !== 'archived' && role === 'owner',
		canConnectDiscord: active && !team.companyId && role === 'owner' && process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED !== '0',
		canBrowseDiscordMembers: active && MANAGER_ROLES.has(role) && process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED !== '0',
	};
}

async function accessById(client, teamId, userId, { lock = false, allowArchived = true } = {}) {
	const company = await requireTeamCompanyAccess(client, String(teamId || ''), userId, { lock, write: lock || !allowArchived });
	const result = await client.query(
		`SELECT t.*, m.role FROM teams t
		 JOIN team_memberships m ON m.team_id=t.id AND m.user_id=$2 AND m.revoked_at IS NULL
		 WHERE t.id=$1 ${allowArchived ? '' : 'AND t.archived_at IS NULL'} ${lock ? 'FOR UPDATE OF t' : ''}`,
		[String(teamId || ''), userId],
	);
	if (!result.rows[0]) throw codedError('team_not_found');
	return teamRow({ ...result.rows[0],company_name:company?.name,company_lifecycle:company?.lifecycle });
}

function requireManager(team) {
	if (!MANAGER_ROLES.has(team.role)) throw codedError('team_forbidden');
}

function requireWritable(team) {
	if (team.archivedAt) throw codedError('team_archived');
}

async function addEvent(client, teamId, actorUserId, eventType, payload = {}) {
	await client.query(
		'INSERT INTO team_events (id,team_id,actor_user_id,event_type,payload) VALUES ($1,$2,$3,$4,$5)',
		[newId('tev'), teamId, actorUserId || null, eventType, JSON.stringify(payload)],
	);
}

function applicationRoot() {
	return String(process.env.FRONTEND_URL || '').replace(/\/$/, '');
}

async function requesterName(client, userId) {
	const result = await client.query('SELECT display_name FROM users WHERE id=$1', [userId]);
	return notificationText(result.rows[0]?.display_name || 'A Megu user');
}

async function enqueueTeamJoinNotification(client, { team, request, ownerUserId }) {
	const name = await requesterName(client, request.user_id);
	const root = applicationRoot();
	return notifications.enqueueWithClient(client, {
		userId: ownerUserId,
		eventType: 'team_join_requested',
		dedupeKey: `team-join-requested:${request.id}:${request.request_cycle}:${ownerUserId}`,
		payload: {
			teamId: team.id,
			teamRequestId: request.id,
			requestCycle: Number(request.request_cycle),
			subjectEn: `Join request for ${notificationText(team.name)}`,
			subjectTh: `คำขอเข้าร่วม ${notificationText(team.name)}`,
			bodyEn: `${name} requested to join ${notificationText(team.name)}. Review the request in team settings.`,
			bodyTh: `${name} ขอเข้าร่วม ${notificationText(team.name)} ตรวจสอบคำขอได้ในการตั้งค่าทีม`,
			ctaLabelEn: 'Review request', ctaLabelTh: 'ตรวจสอบคำขอ',
			ctaUrl: root ? `${root}/teams/${team.id}/manage?tab=requests` : null,
		},
	});
}

async function createTeam(input = {}, { requireRequestKey = false } = {}) {
	const fields = teamCreationFields(input);
	const key = creationKey(input.requestKey, requireRequestKey);
	const { discordGuildName, discordGuildIcon, ...payload } = fields;
	return transaction(client => withCreationReceipt(client, { key, actorId: input.ownerUserId, kind: 'team', payload },
		() => insertTeam(client, fields, input.ownerUserId),
		result => accessById(client, result.team.id, input.ownerUserId)));
}

// Internal transaction entry point for atomic role-based team creation.
async function createTeamWithClient(client, input = {}, actorUserId = input.ownerUserId) {
	return insertTeam(client, teamCreationFields(input), actorUserId);
}

function teamCreationFields(input) {
	assertEnabled();
	assertKnownFields(input, ['ownerUserId', 'name', 'description', 'color', 'discordGuildId', 'discordGuildName', 'discordGuildIcon', 'requestKey']);
	const name = requiredText(input.name, 'team_name', 120);
	const description = optionalText(input.description, 'team_description', 4000);
	const color = cleanText(input.color) || 'indigo';
	if (!TEAM_COLORS.includes(color)) throw codedError('team_color_invalid');
	const discordGuildId = cleanText(input.discordGuildId) || null;
	if (discordGuildId && !/^\d{17,20}$/.test(discordGuildId)) throw codedError('discord_guild_invalid');
	if (discordGuildId) assertDiscordEnabled();
	const discordGuildName = discordGuildId ? requiredText(input.discordGuildName, 'discord_guild_name', 120) : null;
	const discordGuildIcon = discordGuildId ? optionalText(input.discordGuildIcon, 'discord_guild_icon', 500) || null : null;
	return { ownerUserId: input.ownerUserId, name, description, color, discordGuildId, discordGuildName, discordGuildIcon };
}

async function insertTeam(client, { ownerUserId, name, description, color, discordGuildId, discordGuildName, discordGuildIcon }, actorUserId) {
	const id = newId('tem');
	const inserted = await client.query(
		`INSERT INTO teams (id,name,description,color,created_by,discord_guild_id,discord_guild_name,discord_guild_icon,discord_connected_by,discord_connected_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $6::text IS NULL THEN NULL ELSE now() END) RETURNING *`,
		[id, name, description, color, actorUserId, discordGuildId, discordGuildName, discordGuildIcon, discordGuildId ? actorUserId : null],
	);
	await client.query("INSERT INTO team_memberships (team_id,user_id,role) VALUES ($1,$2,'owner')", [id, ownerUserId]);
	await require('./team-membership-sources').grantManualSource(client, id, ownerUserId, actorUserId, 'team_created');
	await addEvent(client, id, actorUserId, 'team_created', { name, color, discordGuildId });
	const team = teamRow({ ...inserted.rows[0], role: 'owner', member_count: 1, project_count: 0 });
	return { team, capabilities: capabilities(team, 'owner') };
}

async function listTeamsForUser(userId, { includeArchived = false, discordGuildId = null } = {}) {
	const guildFilter = cleanText(discordGuildId);
	if (guildFilter && !/^\d{17,20}$/.test(guildFilter)) throw codedError('discord_guild_invalid');
	const result = await query(
		`SELECT t.*, m.role,
		 (SELECT count(*)::int FROM team_memberships tm WHERE tm.team_id=t.id AND tm.revoked_at IS NULL) AS member_count,
		 (SELECT count(*)::int FROM projects p JOIN project_memberships pm ON pm.project_id=p.id
		  WHERE p.team_id=t.id AND pm.user_id=$1 AND pm.revoked_at IS NULL) AS project_count
		 FROM teams t JOIN team_memberships m ON m.team_id=t.id AND m.user_id=$1 AND m.revoked_at IS NULL
		 WHERE ($2::boolean OR t.archived_at IS NULL) AND ($3='' OR t.discord_guild_id=$3)
		 AND ${await companyEligibilitySql({query},'t', '$1')}
		 ORDER BY t.archived_at NULLS FIRST, lower(t.name), t.id`,
		[userId, includeArchived, guildFilter],
	);
	return { teams: result.rows.map(teamRow), enabled: process.env.MEGU_PROJECT_TEAMS_ENABLED !== '0' };
}

async function getTeam(teamId, userId, { summary = false } = {}) {
	const team = await accessById({ query }, teamId, userId);
	if (summary) return { team, me:{userId,role:team.role}, capabilities:capabilities(team,team.role) };
	const [projects, transfer] = await Promise.all([
		query(
			`SELECT p.id,p.code,p.title,p.description,p.status,p.updated_at,p.deadline_at,pm.role,
			 count(pt.id) FILTER (WHERE pt.archived_at IS NULL)::int AS topic_count,
			 sum(pt.progress) FILTER (WHERE pt.archived_at IS NULL) AS progress_sum
			 FROM projects p JOIN project_memberships pm ON pm.project_id=p.id AND pm.user_id=$2 AND pm.revoked_at IS NULL
			 LEFT JOIN project_topics pt ON pt.project_id=p.id
			 WHERE p.team_id=$1 GROUP BY p.id,pm.role ORDER BY p.updated_at DESC`,
			[team.id, userId],
		),
		query(
			`SELECT x.*,u.display_name AS proposed_owner_name FROM team_ownership_transfers x
			 JOIN users u ON u.id=x.proposed_owner_id
			 WHERE x.team_id=$1 AND x.accepted_at IS NULL AND x.cancelled_at IS NULL AND x.expires_at>now()
			 AND ($2=x.current_owner_id OR $2=x.proposed_owner_id) LIMIT 1`,
			[team.id, userId],
		),
	]);
	return {
		team,
		me: { userId, role: team.role },
		capabilities: capabilities(team, team.role),
		projects: projects.rows.map(row => ({
			id: row.id, code: row.code, title: row.title, description: row.description,
			status: row.status, updatedAt: row.updated_at, deadlineAt: row.deadline_at,
			role: row.role, topicCount: Number(row.topic_count || 0), progress: reportedProgress(row.progress_sum, row.topic_count) ?? 0,
		})),
		ownershipTransfer: transfer.rows[0] ? {
			id: transfer.rows[0].id, currentOwnerId: transfer.rows[0].current_owner_id,
			proposedOwnerId: transfer.rows[0].proposed_owner_id,
			proposedOwnerName: transfer.rows[0].proposed_owner_name,
			expiresAt: transfer.rows[0].expires_at,
		} : null,
	};
}

async function updateTeam(teamId, actorUserId, input = {}) {
	assertEnabled();
	assertKnownFields(input, ['name', 'description', 'color', 'expectedRevision']);
	return transaction(async client => {
		const team = await accessById(client, teamId, actorUserId, { lock: true });
		requireManager(team);
		requireWritable(team);
		if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== team.revision) throw codedError('revision_conflict');
		const name = Object.hasOwn(input, 'name') ? requiredText(input.name, 'team_name', 120) : team.name;
		const description = Object.hasOwn(input, 'description') ? optionalText(input.description, 'team_description', 4000) : team.description;
		const color = Object.hasOwn(input, 'color') ? cleanText(input.color) : team.color;
		if (!TEAM_COLORS.includes(color)) throw codedError('team_color_invalid');
		const changed = await client.query(
			'UPDATE teams SET name=$2,description=$3,color=$4,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',
			[team.id, name, description, color],
		);
		await addEvent(client, team.id, actorUserId, 'team_updated', { name, color });
		const next = teamRow({ ...changed.rows[0], role: team.role });
		return { team: next, capabilities: capabilities(next, team.role) };
	});
}

async function connectDiscordGuild(teamId, actorUserId, input = {}) {
	assertDiscordEnabled();
	assertKnownFields(input, ['guildId', 'guildName', 'guildIcon', 'expectedRevision']);
	const guildId = requiredText(input.guildId, 'discord_guild_id', 20);
	if (!/^\d{17,20}$/.test(guildId)) throw codedError('discord_guild_invalid');
	const guildName = requiredText(input.guildName, 'discord_guild_name', 120);
	const guildIcon = optionalText(input.guildIcon, 'discord_guild_icon', 500) || null;
	return transaction(async client => {
		const located = await client.query('SELECT * FROM teams WHERE id=$1', [teamId]);
		if (located.rows[0]?.company_id && located.rows[0].discord_guild_id !== guildId) throw codedError('company_team_transfer_unsupported');
		const team = await accessById(client, teamId, actorUserId, { lock: true });
		if (team.companyId && team.discordGuild?.id !== guildId) throw codedError('company_team_transfer_unsupported');
		requireWritable(team);
		if (team.role !== 'owner') throw codedError('team_forbidden');
		if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== team.revision) throw codedError('revision_conflict');
		if (team.discordGuild?.id !== guildId && (await client.query('SELECT 1 FROM server_role_mappings m WHERE m.team_id=$1 AND (m.retired_at IS NULL OR EXISTS(SELECT 1 FROM team_membership_sources s WHERE s.mapping_id=m.id AND s.revoked_at IS NULL)) LIMIT 1', [team.id])).rowCount) throw codedError('team_role_mapping_connected');
		const changed = await client.query(
			`UPDATE teams SET discord_guild_id=$2,discord_guild_name=$3,discord_guild_icon=$4,
			 discord_connected_by=$5,discord_connected_at=now(),revision=revision+1,updated_at=now()
			 WHERE id=$1 RETURNING *`,
			[team.id, guildId, guildName, guildIcon, actorUserId],
		);
		await addEvent(client, team.id, actorUserId, 'team_discord_connected', { guildId });
		return { team: teamRow({ ...changed.rows[0], role: team.role }), capabilities: capabilities(team, team.role) };
	});
}

async function disconnectDiscordGuild(teamId, actorUserId, input = {}) {
	assertDiscordEnabled();
	assertKnownFields(input, ['expectedRevision']);
	return transaction(async client => {
		const team = await accessById(client, teamId, actorUserId, { lock: true });
		if (team.companyId) throw codedError('company_team_disconnect_unsupported');
		requireWritable(team);
		if (team.role !== 'owner') throw codedError('team_forbidden');
		if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== team.revision) throw codedError('revision_conflict');
		const previousGuildId = team.discordGuild?.id || null;
		if ((await client.query('SELECT 1 FROM server_role_mappings m WHERE m.team_id=$1 AND (m.retired_at IS NULL OR EXISTS(SELECT 1 FROM team_membership_sources s WHERE s.mapping_id=m.id AND s.revoked_at IS NULL)) LIMIT 1', [team.id])).rowCount) throw codedError('team_role_mapping_connected');
		const changed = await client.query(
			`UPDATE teams SET discord_guild_id=NULL,discord_guild_name=NULL,discord_guild_icon=NULL,
			 discord_connected_by=NULL,discord_connected_at=NULL,revision=revision+1,updated_at=now()
			 WHERE id=$1 RETURNING *`,
			[team.id],
		);
		await addEvent(client, team.id, actorUserId, 'team_discord_disconnected', { guildId: previousGuildId });
		return { team: teamRow({ ...changed.rows[0], role: team.role }), capabilities: capabilities(team, team.role) };
	});
}

async function listDiscordCandidates(teamId, actorUserId, guildId, candidates = []) {
	assertDiscordEnabled();
	const team = await accessById({ query }, teamId, actorUserId, { allowArchived: false });
	requireManager(team);
	if (!team.discordGuild || team.discordGuild.id !== String(guildId || '')) throw codedError('discord_guild_mismatch');
	const bounded = (Array.isArray(candidates) ? candidates : []).slice(0, 100).map(candidate => ({
		discordUserId: cleanText(candidate.id),
		displayName: cleanText(candidate.displayName || candidate.username).slice(0, 120),
		avatarUrl: cleanText(candidate.avatarUrl).slice(0, 500) || null,
		roleIds: [...new Set(Array.isArray(candidate.roles) ? candidate.roles.map(String) : [])].slice(0, 100),
	})).filter(candidate => /^\d{17,20}$/.test(candidate.discordUserId));
	if (!bounded.length) return { team, candidates: [] };
	const ids = bounded.map(candidate => candidate.discordUserId);
	const accounts = await query(
		`SELECT i.provider_uid,i.user_id,m.role AS team_role,r.id AS request_id,r.status AS request_status,
		 EXISTS (SELECT 1 FROM team_membership_suppressions s WHERE s.team_id=$1 AND s.user_id=i.user_id AND s.cleared_at IS NULL) AS restore_required
		 FROM identities i
		 LEFT JOIN team_memberships m ON m.team_id=$1 AND m.user_id=i.user_id AND m.revoked_at IS NULL
		 LEFT JOIN team_join_requests r ON r.team_id=$1 AND r.user_id=i.user_id
		 WHERE i.provider='discord' AND i.provider_uid=ANY($2::text[])`,
		[team.id, ids],
	);
	const byDiscordId = new Map(accounts.rows.map(row => [row.provider_uid, row]));
	return {
		team,
		candidates: bounded.map(candidate => {
			const account = byDiscordId.get(candidate.discordUserId);
			return {
				...candidate,
				linkedAccount: Boolean(account),
				userId: account?.user_id || null,
				teamRole: account?.team_role || null,
				requestId: account?.request_status === 'pending' ? account.request_id : null,
				requestStatus: account?.request_status || null,
				restoreRequired: Boolean(account?.restore_required),
			};
		}),
	};
}

async function listGuildWorkspace(guildId, actorUserId, options) {
	assertDiscordEnabled();
	const id = requiredText(guildId, 'discord_guild_id', 20);
	if (!/^\d{17,20}$/.test(id)) throw codedError('discord_guild_invalid');
	// Legacy callers retain their combined response; focused routes fetch only
	// one bounded section. Authorization stays in SQL, before pagination.
	const section = options?.section || 'all';
	const limit = options?.limit == null ? 30 : Number(options.limit);
	const offset = options?.offset == null ? 0 : Number(options.offset);
	if (options && (!['teams', 'projects'].includes(section) || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000)) throw codedError('workspace_page_invalid');
	const pageSql = options ? ' LIMIT $3 OFFSET $4' : '';
	const params = options ? [id, actorUserId, limit + 1, offset] : [id, actorUserId];
	const [teamResult, projectResult] = await Promise.all([
		section === 'projects' ? Promise.resolve({ rows: [] }) : query(
			`SELECT t.*,tm.role,
			 (SELECT count(*)::int FROM team_memberships x WHERE x.team_id=t.id AND x.revoked_at IS NULL) AS member_count,
			 (SELECT count(*)::int FROM projects p JOIN project_memberships pm ON pm.project_id=p.id
			  WHERE p.team_id=t.id AND pm.user_id=$2 AND pm.revoked_at IS NULL) AS project_count
			 FROM teams t JOIN team_memberships tm ON tm.team_id=t.id AND tm.user_id=$2 AND tm.revoked_at IS NULL
			 WHERE t.discord_guild_id=$1 AND t.archived_at IS NULL AND ${await companyEligibilitySql({query},'t', '$2')} ORDER BY lower(t.name),t.id${pageSql}`,
			params,
		),
		section === 'teams' ? Promise.resolve({ rows: [] }) : query(
			`SELECT p.id,p.code,p.title,p.status,p.updated_at,pm.role,t.id AS team_id,t.name AS team_name,t.color AS team_color
			 FROM projects p JOIN teams t ON t.id=p.team_id
			 JOIN team_memberships tm ON tm.team_id=t.id AND tm.user_id=$2 AND tm.revoked_at IS NULL
			 JOIN project_memberships pm ON pm.project_id=p.id AND pm.user_id=$2 AND pm.revoked_at IS NULL
			 WHERE t.discord_guild_id=$1 AND t.archived_at IS NULL AND ${await companyEligibilitySql({query},'t', '$2')}
			 ORDER BY p.updated_at DESC,p.id${pageSql}`,
			params,
		),
	]);
	const hasMore = options && (section === 'teams' ? teamResult : projectResult).rows.length > limit;
	if (options) {
		teamResult.rows = teamResult.rows.slice(0, limit);
		projectResult.rows = projectResult.rows.slice(0, limit);
	}
	return {
		...(options ? { section, nextOffset: hasMore ? offset + limit : null } : {}),
		teams: teamResult.rows.map(teamRow),
		projects: projectResult.rows.map(row => ({
			id: row.id, code: row.code, title: row.title, status: row.status, updatedAt: row.updated_at, role: row.role,
			team: { id: row.team_id, name: row.team_name, color: row.team_color },
		})),
	};
}

function parseLimit(value) {
	const number = Number(value || 30);
	return Number.isInteger(number) ? Math.min(100, Math.max(1, number)) : 30;
}

async function listTeamMembers(teamId, actorUserId, options = {}) {
	const team = await accessById({ query }, teamId, actorUserId);
	const search = cleanText(options.search);
	if (search.length > 120) throw codedError('search_too_long');
	const limit = parseLimit(options.limit);
	const offset = Math.max(0, Number(options.offset) || 0);
	const result = await query(
		`SELECT m.*,u.display_name,
		 EXISTS (SELECT 1 FROM team_membership_sources s WHERE s.team_id=m.team_id AND s.user_id=m.user_id AND s.kind='manual' AND s.revoked_at IS NULL) AS has_manual_source,
		 EXISTS (SELECT 1 FROM team_membership_sources s WHERE s.team_id=m.team_id AND s.user_id=m.user_id AND s.kind='discord_role' AND s.revoked_at IS NULL) AS has_role_source,
		 EXISTS (SELECT 1 FROM team_membership_suppressions s WHERE s.team_id=m.team_id AND s.user_id=m.user_id AND s.cleared_at IS NULL) AS suppressed,
		 COALESCE((SELECT NULLIF(i.avatar_url,'') FROM identities i WHERE i.user_id=u.id AND i.provider='discord' ORDER BY i.id LIMIT 1),u.avatar_url) AS avatar_url,
		 CASE WHEN $5::boolean OR m.user_id=$6 THEN (
			 SELECT count(DISTINCT pm.project_id)::int FROM project_memberships pm JOIN projects p ON p.id=pm.project_id
			 WHERE p.team_id=m.team_id AND pm.user_id=m.user_id AND pm.revoked_at IS NULL
		 ) END AS affected_project_count,
		 CASE WHEN $5::boolean OR m.user_id=$6 THEN (
			 SELECT count(DISTINCT a.topic_id)::int FROM project_topic_assignees a
			 JOIN projects p ON p.id=a.project_id JOIN project_memberships pm ON pm.project_id=p.id AND pm.user_id=a.user_id AND pm.revoked_at IS NULL
			 JOIN project_topics pt ON pt.id=a.topic_id AND pt.archived_at IS NULL
			 WHERE p.team_id=m.team_id AND a.user_id=m.user_id
		 ) END AS affected_assignment_count,
		 count(*) OVER()::int AS total
		 FROM team_memberships m JOIN users u ON u.id=m.user_id
		 WHERE m.team_id=$1 AND m.revoked_at IS NULL AND ($2='' OR lower(u.display_name) LIKE '%'||lower($2)||'%')
		 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,lower(u.display_name),u.id
		 LIMIT $3 OFFSET $4`,
		[team.id, search, limit, offset, MANAGER_ROLES.has(team.role), actorUserId],
	);
	return {
		members: result.rows.map(row => ({ ...memberRow(row),
			membershipSources: { manual: row.has_manual_source, discordRole: row.has_role_source },
			canRetainManual: capabilities(team, team.role).canManageMembers && (team.role === 'owner' || row.role === 'member') && !row.has_manual_source && !row.suppressed,
		})), total: Number(result.rows[0]?.total || 0),
		nextOffset: offset + result.rows.length < Number(result.rows[0]?.total || 0) ? offset + result.rows.length : null,
		team, capabilities: capabilities(team, team.role),
	};
}

async function retainManualMember(teamId, memberUserId, actorUserId, input = {}) {
	assertEnabled();
	assertKnownFields(input, ['confirmed', 'expectedRevision']);
	if (input.confirmed !== true) throw codedError('team_manual_confirmation_required');
	return transaction(async client => {
		const team = await accessById(client, teamId, actorUserId, { lock: true });
		requireManager(team); requireWritable(team);
		if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== team.revision) throw codedError('revision_conflict');
		const member = (await client.query('SELECT role FROM team_memberships WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL FOR UPDATE', [team.id, memberUserId])).rows[0];
		if (!member) throw codedError('team_member_not_found');
		if (team.role !== 'owner' && member.role !== 'member') throw codedError('team_forbidden');
		const sources = require('./team-membership-sources');
		if (await sources.isMembershipSuppressed(client, team.id, memberUserId)) throw codedError('team_member_restore_confirmation_required');
		const manual = (await client.query("SELECT 1 FROM team_membership_sources WHERE team_id=$1 AND user_id=$2 AND kind='manual' AND revoked_at IS NULL", [team.id, memberUserId])).rows.length > 0;
		if (manual) return { retained: true, alreadyManual: true, revision: team.revision };
		await sources.grantManualSource(client, team.id, memberUserId, actorUserId, 'explicit_retention');
		await client.query('UPDATE teams SET revision=revision+1,updated_at=now() WHERE id=$1', [team.id]);
		await addEvent(client, team.id, actorUserId, 'team_member_retained_manually', { userId: memberUserId });
		return { retained: true, alreadyManual: false, revision: team.revision + 1 };
	});
}

async function updateMemberRole(teamId, memberUserId, actorUserId, input = {}) {
	assertEnabled();
	assertKnownFields(input, ['role', 'expectedRevision']);
	if (!['admin', 'member'].includes(input.role)) throw codedError('team_role_invalid');
	return transaction(async client => {
		const team = await accessById(client, teamId, actorUserId, { lock: true });
		requireWritable(team);
		if (team.role !== 'owner') throw codedError('team_forbidden');
		if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== team.revision) throw codedError('revision_conflict');
		const found = await client.query('SELECT * FROM team_memberships WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL FOR UPDATE', [team.id, memberUserId]);
		const member = found.rows[0];
		if (!member) throw codedError('team_member_not_found');
		if (member.role === 'owner') throw codedError('team_owner_transfer_required');
		await client.query('UPDATE team_memberships SET role=$3 WHERE team_id=$1 AND user_id=$2', [team.id, memberUserId, input.role]);
		await require('./team-goal-lifecycle').reconcileMember(client, team.id, memberUserId, actorUserId);
		await client.query('UPDATE teams SET revision=revision+1,updated_at=now() WHERE id=$1', [team.id]);
		await addEvent(client, team.id, actorUserId, 'team_member_role_changed', { userId: memberUserId, from: member.role, to: input.role });
		return { member: { userId: memberUserId, role: input.role }, revision: team.revision + 1 };
	});
}

// Internal mutation primitive. Callers establish authority/source retirement;
// the team lock and ownership checks are repeated here before any revocation.
async function revokeTeamEligibilityWithClient(client, teamId, memberUserId, actorUserId) {
	const team = (await client.query('SELECT id,revision FROM teams WHERE id=$1 FOR UPDATE', [teamId])).rows[0];
	if (!team) throw codedError('team_not_found');
	const member = (await client.query('SELECT role FROM team_memberships WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL FOR UPDATE', [teamId, memberUserId])).rows[0];
	if (!member) return { removed: false, revision: team.revision, impact: { projectCount: 0, assignmentCount: 0 } };
	if (member.role === 'owner') throw codedError('team_owner_transfer_required');
	const owned = await client.query(
		'SELECT count(*)::int AS n FROM projects WHERE team_id=$1 AND owner_user_id=$2',
		[teamId, memberUserId],
	);
	if (owned.rows[0].n > 0) throw codedError('team_project_owner_transfer_required', 'team_project_owner_transfer_required', { projectCount: owned.rows[0].n });
	const impact = await client.query(
		`SELECT count(DISTINCT pm.project_id)::int AS projects,
		 count(DISTINCT a.topic_id) FILTER (WHERE pt.id IS NOT NULL)::int AS assignments
		 FROM project_memberships pm JOIN projects p ON p.id=pm.project_id
		 LEFT JOIN project_topic_assignees a ON a.project_id=pm.project_id AND a.user_id=pm.user_id
		 LEFT JOIN project_topics pt ON pt.id=a.topic_id AND pt.archived_at IS NULL
		 WHERE p.team_id=$1 AND pm.user_id=$2 AND pm.revoked_at IS NULL`,
		[teamId, memberUserId],
	);
	await client.query(
		`DELETE FROM project_topic_assignees a USING projects p
		 WHERE a.project_id=p.id AND p.team_id=$1 AND a.user_id=$2`,
		[teamId, memberUserId],
	);
	await client.query(
		`UPDATE project_memberships pm SET revoked_at=now() FROM projects p
		 WHERE pm.project_id=p.id AND p.team_id=$1 AND pm.user_id=$2 AND pm.revoked_at IS NULL`,
		[teamId, memberUserId],
	);
	await client.query('UPDATE team_memberships SET revoked_at=now() WHERE team_id=$1 AND user_id=$2', [teamId, memberUserId]);
	await require('./team-goal-lifecycle').reconcileMember(client, teamId, memberUserId, actorUserId);
	await client.query('UPDATE teams SET revision=revision+1,updated_at=now() WHERE id=$1', [teamId]);
	return { removed: true, revision: team.revision + 1, impact: { projectCount: impact.rows[0].projects, assignmentCount: impact.rows[0].assignments } };
}

async function removeTeamMember(teamId, memberUserId, actorUserId, input = {}) {
	assertEnabled();
	assertKnownFields(input, ['expectedRevision']);
	return transaction(async client => {
		const team = await accessById(client, teamId, actorUserId, { lock: true });
		requireWritable(team);
		if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== team.revision) throw codedError('revision_conflict');
		const found = await client.query('SELECT * FROM team_memberships WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL FOR UPDATE', [team.id, memberUserId]);
		const member = found.rows[0];
		if (!member) throw codedError('team_member_not_found');
		const self = memberUserId === actorUserId;
		if (member.role === 'owner') throw codedError('team_owner_transfer_required');
		if (!self) {
			requireManager(team);
			if (team.role === 'admin' && member.role !== 'member') throw codedError('team_forbidden');
		}
		const result = await revokeTeamEligibilityWithClient(client, team.id, memberUserId, actorUserId);
		await require('./team-membership-sources').suppressMembership(client, team.id, memberUserId, actorUserId, self ? 'member_left' : 'member_removed');
		await addEvent(client, team.id, actorUserId, self ? 'team_member_left' : 'team_member_removed', {
			userId: memberUserId, ...result.impact,
		});
		return result;
	});
}

async function createJoinLink(teamId, actorUserId) {
	assertEnabled();
	return transaction(async client => {
		const team = await accessById(client, teamId, actorUserId, { lock: true });
		requireManager(team);
		requireWritable(team);
		const previous = await client.query('SELECT id FROM team_join_links WHERE team_id=$1 AND revoked_at IS NULL FOR UPDATE', [team.id]);
		await client.query('UPDATE team_join_links SET revoked_at=now() WHERE team_id=$1 AND revoked_at IS NULL', [team.id]);
		if (previous.rows.length) {
			await client.query(
				"UPDATE team_join_requests SET status='rejected',reviewed_at=now(),reviewed_by=$2,rejection_reason='link_rotated' WHERE team_id=$1 AND status='pending' AND originating_link_id=ANY($3::text[])",
				[team.id, actorUserId, previous.rows.map(row => row.id)],
			);
		}
		const plain = token();
		const linkId = newId('tjl');
		await client.query(
			"INSERT INTO team_join_links (id,team_id,token_hash,expires_at,created_by) VALUES ($1,$2,$3,now()+interval '7 days',$4)",
			[linkId, team.id, tokenHash(plain), actorUserId],
		);
		await addEvent(client, team.id, actorUserId, 'team_join_link_created');
		return { token: plain, expiresInDays: 7 };
	});
}

async function revokeJoinLink(teamId, actorUserId) {
	assertEnabled();
	return transaction(async client => {
		const team = await accessById(client, teamId, actorUserId, { lock: true });
		requireManager(team);
		requireWritable(team);
		const links = await client.query('SELECT id FROM team_join_links WHERE team_id=$1 AND revoked_at IS NULL FOR UPDATE', [team.id]);
		await client.query('UPDATE team_join_links SET revoked_at=now() WHERE team_id=$1 AND revoked_at IS NULL', [team.id]);
		if (links.rows.length) {
			await client.query(
				"UPDATE team_join_requests SET status='rejected',reviewed_at=now(),reviewed_by=$2,rejection_reason='link_revoked' WHERE team_id=$1 AND status='pending' AND originating_link_id=ANY($3::text[])",
				[team.id, actorUserId, links.rows.map(row => row.id)],
			);
		}
		await addEvent(client, team.id, actorUserId, 'team_join_link_revoked');
		return { revoked: true };
	});
}

async function joinLinkRecord(client, plain, { lock = false } = {}) {
	const value = requiredText(plain, 'invitation_token', 200);
	const legacy = await hasLegacyCompanySchema(client);
	if (lock && legacy) {
		// Company first, then team/link, matching all scoped membership mutations.
		await client.query(`SELECT c.id FROM companies c
		 WHERE c.id=(SELECT t.company_id FROM team_join_links l JOIN teams t ON t.id=l.team_id WHERE l.token_hash=$1) FOR UPDATE OF c`, [tokenHash(value)]);
	}
	const result = await client.query(
		`SELECT l.*,t.name,t.description,t.color,t.archived_at${legacy ? ',t.company_id,c.lifecycle AS company_lifecycle' : ''} FROM team_join_links l JOIN teams t ON t.id=l.team_id
		 ${legacy ? 'LEFT JOIN companies c ON c.id=t.company_id' : ''}
		 WHERE l.token_hash=$1 ${lock ? 'FOR UPDATE OF l,t' : ''}`,
		[tokenHash(value)],
	);
	const link = result.rows[0];
	if (!link) throw codedError('invitation_not_found');
	if (link.revoked_at || new Date(link.expires_at) <= new Date()) throw codedError('invitation_expired');
	if (link.archived_at) throw codedError('team_archived');
	if (link.company_lifecycle === 'archived') throw codedError('company_archived');
	return link;
}

async function previewJoinToken(plain) {
	const link = await joinLinkRecord({ query }, plain);
	return { team: { id: link.team_id, name: link.name, description: link.description, color: link.color }, expiresAt: link.expires_at };
}

async function requestTeamJoin(plain, actorUserId) {
	assertEnabled();
	return transaction(async client => {
		const link = await joinLinkRecord(client, plain, { lock: true });
		let companyApprovalRequired = false;
		if (link.company_id) {
			const eligibility = await client.query('SELECT 1 FROM company_memberships WHERE company_id=$1 AND user_id=$2 AND revoked_at IS NULL', [link.company_id,actorUserId]);
			if (!eligibility.rowCount) {
				await require('./companies').requestAccessWithClient(client,link.company_id,actorUserId,{ teamLinkId: link.id });
				companyApprovalRequired = true;
			}
		}
		const member = await client.query('SELECT 1 FROM team_memberships WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL', [link.team_id, actorUserId]);
		if (member.rows[0] && !companyApprovalRequired) return { status: 'approved', team: { id: link.team_id, name: link.name } };
		const existing = await client.query('SELECT * FROM team_join_requests WHERE team_id=$1 AND user_id=$2 FOR UPDATE', [link.team_id, actorUserId]);
		if (existing.rows[0]?.status === 'pending' && existing.rows[0].originating_link_id === link.id) return { status: 'pending', companyApprovalRequired };
		const pending = await client.query(
			"SELECT count(*)::int AS n FROM team_join_requests WHERE team_id=$1 AND user_id<>$2 AND status='pending'",
			[link.team_id, actorUserId],
		);
		if (pending.rows[0].n >= 200) throw codedError('team_join_request_limit');
		let request;
		if (existing.rows[0]) {
			const changed = await client.query(
				"UPDATE team_join_requests SET status='pending',originating_link_id=$3,requested_at=now(),reviewed_at=NULL,reviewed_by=NULL,rejection_reason=NULL,request_cycle=request_cycle+1 WHERE team_id=$1 AND user_id=$2 RETURNING *",
				[link.team_id, actorUserId, link.id],
			);
			request = changed.rows[0];
		}
		else {
			const inserted = await client.query('INSERT INTO team_join_requests (id,team_id,user_id,originating_link_id) VALUES ($1,$2,$3,$4) RETURNING *', [newId('tjr'), link.team_id, actorUserId, link.id]);
			request = inserted.rows[0];
		}
		await addEvent(client, link.team_id, actorUserId, 'team_join_requested');
		const owner = await client.query("SELECT user_id FROM team_memberships WHERE team_id=$1 AND role='owner' AND revoked_at IS NULL", [link.team_id]);
		if (owner.rows[0]) await enqueueTeamJoinNotification(client, {
			team: { id: link.team_id, name: link.name }, request, ownerUserId: owner.rows[0].user_id,
		});
		return { status: 'pending', companyApprovalRequired, team: { id: link.team_id, name: link.name } };
	});
}

async function listJoinRequests(teamId, actorUserId) {
	const team = await accessById({ query }, teamId, actorUserId);
	requireManager(team);
	const [requests, link] = await Promise.all([
		query(
			`SELECT r.id,r.user_id,r.status,r.requested_at,u.display_name,
			 EXISTS (SELECT 1 FROM team_membership_suppressions s WHERE s.team_id=r.team_id AND s.user_id=r.user_id AND s.cleared_at IS NULL) AS restore_required,
			 COALESCE((SELECT NULLIF(i.avatar_url,'') FROM identities i WHERE i.user_id=u.id AND i.provider='discord' ORDER BY i.id LIMIT 1),u.avatar_url) AS avatar_url
			 FROM team_join_requests r JOIN users u ON u.id=r.user_id
			 JOIN team_join_links l ON l.id=r.originating_link_id
			 WHERE r.team_id=$1 AND r.status='pending' AND l.revoked_at IS NULL AND l.expires_at>now()
			 ORDER BY r.requested_at,r.id`,
			[team.id],
		),
		query('SELECT expires_at AS "expiresAt" FROM team_join_links WHERE team_id=$1 AND revoked_at IS NULL AND expires_at>now() LIMIT 1', [team.id]),
	]);
	return {
		requests: requests.rows.map(row => ({ id: row.id, userId: row.user_id, displayName: row.display_name, avatarUrl: row.avatar_url, status: row.status, requestedAt: row.requested_at, restoreRequired: row.restore_required })),
		teamRevision: team.revision,
		link: link.rows[0] || null,
	};
}

async function reviewJoinRequest(teamId, requestId, actorUserId, input = {}) {
	assertEnabled();
	assertKnownFields(input, ['action', 'role', 'confirmRestore', 'expectedRevision']);
	if (input.confirmRestore != null && typeof input.confirmRestore !== 'boolean') throw codedError('request_body_invalid');
	if (!['approve', 'reject'].includes(input.action)) throw codedError('review_action_invalid');
	return transaction(async client => {
		const team = await accessById(client, teamId, actorUserId, { lock: true });
		requireManager(team);
		requireWritable(team);
		const desiredRole = input.role || 'member';
		if (!['member', 'admin'].includes(desiredRole)) throw codedError('team_role_invalid');
		if (team.role === 'admin' && desiredRole !== 'member') throw codedError('team_forbidden');
		const result = await client.query(
			`SELECT r.*,l.revoked_at AS link_revoked_at,l.expires_at AS link_expires_at
			 FROM team_join_requests r LEFT JOIN team_join_links l ON l.id=r.originating_link_id
			 WHERE r.team_id=$1 AND r.id=$2 FOR UPDATE OF r`,
			[team.id, requestId],
		);
		const request = result.rows[0];
		if (!request) throw codedError('invitation_not_found');
		if (request.status !== 'pending') return { status: request.status };
		if (request.link_revoked_at || !request.link_expires_at || new Date(request.link_expires_at) <= new Date()) throw codedError('invitation_expired');
		let clearedSuppressions = [];
		if (input.action === 'approve') {
			await requireTeamCompanyAccess(client,team.id,request.user_id,{ write: true, notFound: 'company_membership_required' });
			clearedSuppressions = await require('./team-membership-sources').restoreSuppressedMembership(client, team.id, request.user_id, actorUserId, input.confirmRestore, { expectedRevision: input.expectedRevision, teamRevision: team.revision });
			const count = await client.query('SELECT count(*)::int AS n FROM team_memberships WHERE team_id=$1 AND revoked_at IS NULL', [team.id]);
			if (count.rows[0].n >= 500) throw codedError('team_member_limit');
			await client.query(
				`INSERT INTO team_memberships (team_id,user_id,role) VALUES ($1,$2,$3)
				 ON CONFLICT (team_id,user_id) DO UPDATE SET role=$3,revoked_at=NULL,joined_at=now()`,
				[team.id, request.user_id, desiredRole],
			);
			await require('./team-membership-sources').grantManualSource(client, team.id, request.user_id, actorUserId, 'join_approved', { requestId: request.id });
		}
		const status = input.action === 'approve' ? 'approved' : 'rejected';
		await client.query('UPDATE team_join_requests SET status=$2,reviewed_at=now(),reviewed_by=$3 WHERE id=$1', [request.id, status, actorUserId]);
		await client.query('UPDATE teams SET revision=revision+1,updated_at=now() WHERE id=$1', [team.id]);
		await addEvent(client, team.id, actorUserId, status === 'approved' ? 'team_join_approved' : 'team_join_rejected', { userId: request.user_id, role: status === 'approved' ? desiredRole : undefined, clearedSuppressions });
		return { status, revision: team.revision + 1 };
	});
}

async function proposeOwnershipTransfer(teamId, actorUserId, input = {}) {
	assertEnabled();
	assertKnownFields(input, ['proposedOwnerId', 'expectedRevision']);
	const proposedOwnerId = requiredText(input.proposedOwnerId, 'proposed_owner_id', 100);
	return transaction(async client => {
		const team = await accessById(client, teamId, actorUserId, { lock: true });
		requireWritable(team);
		if (team.role !== 'owner') throw codedError('team_forbidden');
		if (proposedOwnerId === actorUserId) throw codedError('ownership_transfer_self');
		if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== team.revision) throw codedError('revision_conflict');
		const member = await client.query('SELECT 1 FROM team_memberships WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL', [team.id, proposedOwnerId]);
		if (!member.rows[0]) throw codedError('team_member_not_found');
		await requireTeamCompanyAccess(client,team.id,proposedOwnerId,{ write:true,notFound:'team_member_not_found' });
		await require('./team-membership-sources').requireManualMembership(client, team.id, proposedOwnerId);
		await client.query('UPDATE team_ownership_transfers SET cancelled_at=now() WHERE team_id=$1 AND accepted_at IS NULL AND cancelled_at IS NULL', [team.id]);
		const id = newId('tot');
		await client.query(
			"INSERT INTO team_ownership_transfers (id,team_id,current_owner_id,proposed_owner_id,expires_at) VALUES ($1,$2,$3,$4,now()+interval '7 days')",
			[id, team.id, actorUserId, proposedOwnerId],
		);
		await client.query('UPDATE teams SET revision=revision+1,updated_at=now() WHERE id=$1', [team.id]);
		await addEvent(client, team.id, actorUserId, 'team_ownership_transfer_proposed', { proposedOwnerId });
		return { transfer: { id, proposedOwnerId }, revision: team.revision + 1 };
	});
}

async function cancelOwnershipTransfer(teamId, transferId, actorUserId) {
	assertEnabled();
	return transaction(async client => {
		const team = await accessById(client, teamId, actorUserId, { lock: true });
		if (team.role !== 'owner') throw codedError('team_forbidden');
		const changed = await client.query(
			'UPDATE team_ownership_transfers SET cancelled_at=now() WHERE id=$1 AND team_id=$2 AND accepted_at IS NULL AND cancelled_at IS NULL RETURNING id',
			[transferId, team.id],
		);
		if (!changed.rows[0]) throw codedError('ownership_transfer_not_found');
		await client.query('UPDATE teams SET revision=revision+1,updated_at=now() WHERE id=$1', [team.id]);
		await addEvent(client, team.id, actorUserId, 'team_ownership_transfer_cancelled');
		return { cancelled: true, revision: team.revision + 1 };
	});
}

async function acceptOwnershipTransfer(teamId, transferId, actorUserId) {
	assertEnabled();
	return transaction(async client => {
		const team = await accessById(client, teamId, actorUserId, { lock: true });
		requireWritable(team);
		const result = await client.query('SELECT * FROM team_ownership_transfers WHERE id=$1 AND team_id=$2 FOR UPDATE', [transferId, team.id]);
		const transfer = result.rows[0];
		if (!transfer) throw codedError('ownership_transfer_not_found');
		if (transfer.accepted_at || transfer.cancelled_at) throw codedError('ownership_transfer_stale');
		if (new Date(transfer.expires_at) <= new Date()) throw codedError('ownership_transfer_expired');
		if (transfer.proposed_owner_id !== actorUserId) throw codedError('team_forbidden');
		const active = await client.query('SELECT 1 FROM team_memberships WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL', [team.id, actorUserId]);
		if (!active.rows[0]) throw codedError('team_member_not_found');
		await require('./team-membership-sources').requireManualMembership(client, team.id, actorUserId);
		await client.query("UPDATE team_memberships SET role='admin' WHERE team_id=$1 AND user_id=$2", [team.id, transfer.current_owner_id]);
		await client.query("UPDATE team_memberships SET role='owner' WHERE team_id=$1 AND user_id=$2", [team.id, actorUserId]);
		await client.query(
			`UPDATE notification_deliveries d SET status='skipped',locked_at=NULL,last_error='Team ownership changed'
			 FROM notification_events e WHERE d.event_id=e.id AND e.event_type='team_join_requested'
			 AND e.user_id=$2 AND e.payload->>'teamId'=$1 AND d.status IN ('pending','failed','sending')`,
			[team.id, transfer.current_owner_id],
		);
		const pendingRequests = await client.query(
			`SELECT r.* FROM team_join_requests r JOIN team_join_links l ON l.id=r.originating_link_id
			 WHERE r.team_id=$1 AND r.status='pending' AND l.revoked_at IS NULL AND l.expires_at>now()`,
			[team.id],
		);
		for (const request of pendingRequests.rows) await enqueueTeamJoinNotification(client, {
			team, request, ownerUserId: actorUserId,
		});
		await client.query('UPDATE team_ownership_transfers SET accepted_at=now() WHERE id=$1', [transfer.id]);
		await client.query('UPDATE teams SET revision=revision+1,updated_at=now() WHERE id=$1', [team.id]);
		await addEvent(client, team.id, actorUserId, 'team_ownership_transferred', { previousOwnerId: transfer.current_owner_id });
		return { accepted: true, revision: team.revision + 1 };
	});
}

async function archiveTeam(teamId, actorUserId, input = {}) {
	assertEnabled();
	assertKnownFields(input, ['expectedRevision']);
	return transaction(async client => {
		const team = await accessById(client, teamId, actorUserId, { lock: true });
		if (team.role !== 'owner') throw codedError('team_forbidden');
		if (team.archivedAt) return { team };
		if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== team.revision) throw codedError('revision_conflict');
		await client.query('UPDATE teams SET archived_at=now(),revision=revision+1,updated_at=now() WHERE id=$1', [team.id]);
		await require('./team-goal-lifecycle').archiveForTeam(client, team.id, actorUserId);
		const links = await client.query('UPDATE team_join_links SET revoked_at=now() WHERE team_id=$1 AND revoked_at IS NULL RETURNING id', [team.id]);
		if (links.rows.length) {
			await client.query(
				"UPDATE team_join_requests SET status='rejected',reviewed_at=now(),reviewed_by=$2,rejection_reason='team_archived' WHERE team_id=$1 AND status='pending'",
				[team.id, actorUserId],
			);
		}
		await client.query("UPDATE project_reminder_jobs SET status='cancelled',completed_at=now() WHERE project_id IN (SELECT id FROM projects WHERE team_id=$1) AND status='pending'", [team.id]);
		await addEvent(client, team.id, actorUserId, 'team_archived');
		return { team: { ...team, archivedAt: new Date().toISOString(), revision: team.revision + 1 } };
	});
}

async function restoreTeam(teamId, actorUserId, input = {}) {
	assertEnabled();
	assertKnownFields(input, ['expectedRevision']);
	return transaction(async client => {
		const team = await accessById(client, teamId, actorUserId, { lock: true });
		if (team.role !== 'owner') throw codedError('team_forbidden');
		if (!team.archivedAt) return { team };
		if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== team.revision) throw codedError('revision_conflict');
		const changed = await client.query('UPDATE teams SET archived_at=NULL,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *', [team.id]);
		const activeProjects = await client.query("SELECT id FROM projects WHERE team_id=$1 AND status='active' ORDER BY id FOR UPDATE", [team.id]);
		for (const project of activeProjects.rows) {
			await projectReminders.rebuildForProjectWithClient(client, project.id);
		}
		await addEvent(client, team.id, actorUserId, 'team_restored');
		return { team: teamRow({ ...changed.rows[0], role: team.role }) };
	});
}

module.exports = {
	TEAM_ROLES, TEAM_COLORS, createTeam, createTeamWithClient, listTeamsForUser, getTeam, updateTeam,
	listTeamMembers, updateMemberRole, removeTeamMember, retainManualMember, revokeTeamEligibilityWithClient,
	createJoinLink, revokeJoinLink, previewJoinToken, requestTeamJoin, listJoinRequests, reviewJoinRequest,
	proposeOwnershipTransfer, cancelOwnershipTransfer, acceptOwnershipTransfer, archiveTeam, restoreTeam,
	connectDiscordGuild, disconnectDiscordGuild, listDiscordCandidates, listGuildWorkspace,
	accessById, capabilities,
	validate: { assertKnownFields },
};
