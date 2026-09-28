'use strict';

const { query, transaction } = require('./db');
const { newId } = require('./ids');
const crypto = require('node:crypto');
const notifications = require('./notifications');

function codedError(code) { return Object.assign(new Error(code), { code }); }
function assertEnabled() {
	if (process.env.MEGU_COMPANIES_ENABLED !== '1') throw codedError('companies_disabled');
}
function fields(input, allowed) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw codedError('request_body_invalid');
	if (Object.keys(input).some(key => !allowed.includes(key))) throw codedError('unknown_field');
}
function nameText(value) {
	if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) throw codedError('company_name_invalid');
	return value.trim();
}
function rowToCompany(row) {
	return { id: row.id, name: row.name, discordGuildId: row.discord_guild_id, icon: row.icon,
		lifecycle: row.lifecycle, revision: row.revision, role: row.role,
		createdAt: row.created_at, archivedAt: row.archived_at };
}
function capabilities(company) {
	const owner = company.role === 'owner';
	const manager = owner || company.role === 'admin';
	const active = company.lifecycle === 'active';
	return { canManage: active && manager, canCreateTeam: active && manager,
		canManageAdmins: active && owner, canTransferOwnership: active && owner,
		canArchive: active && owner, canRestore: company.lifecycle === 'archived' && owner };
}
async function access(client, companyId, userId, { lock = false } = {}) {
	const result = await client.query(`SELECT c.*,m.role FROM companies c
		JOIN company_memberships m ON m.company_id=c.id AND m.user_id=$2 AND m.revoked_at IS NULL
		WHERE c.id=$1 ${lock ? 'FOR UPDATE OF c' : ''}`, [companyId, userId]);
	if (!result.rowCount) throw codedError('company_not_found');
	return rowToCompany(result.rows[0]);
}
async function event(client, companyId, actor, type, payload = {}) {
	await client.query('INSERT INTO company_events(id,company_id,actor_user_id,event_type,payload) VALUES ($1,$2,$3,$4,$5)',
		[newId('cev'), companyId, actor, type, JSON.stringify(payload)]);
}
function pageOptions(input = {}) {
	const limit = input.limit == null ? 25 : Number(input.limit);
	if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw codedError('page_limit_invalid');
	let cursor = null;
	if (input.cursor) {
		try {
			cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
			if (!Array.isArray(cursor) || cursor.length !== 2 || cursor.some(v => typeof v !== 'string' || v.length > 200)) throw new Error();
		} catch { throw codedError('page_cursor_invalid'); }
	}
	return { limit, cursor };
}
function paginate(rows, limit) {
	const more = rows.length > limit;
	const items = rows.slice(0, limit);
	const last = items[items.length - 1];
	return { items, nextCursor: more ? Buffer.from(JSON.stringify([last.name, last.id])).toString('base64url') : null };
}

async function listCompanies(userId, options = {}) {
	assertEnabled();
	const { limit, cursor } = pageOptions(options);
	const result = await query(`SELECT c.*,m.role FROM companies c JOIN company_memberships m
		ON m.company_id=c.id AND m.user_id=$1 AND m.revoked_at IS NULL
		WHERE ($2::text IS NULL OR (c.name,c.id)>($2,$3))
		ORDER BY c.name,c.id LIMIT $4`, [userId, cursor?.[0] ?? null, cursor?.[1] ?? null, limit + 1]);
	const page = paginate(result.rows, limit);
	return { companies: page.items.map(rowToCompany), nextCursor: page.nextCursor };
}

async function getCompany(companyId, userId) {
	assertEnabled();
	const company = await access({ query }, companyId, userId);
	const transfer = await query(`SELECT id,current_owner_id,proposed_owner_id,expires_at FROM company_ownership_transfers
		WHERE company_id=$1 AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at>now()
		AND (current_owner_id=$2 OR proposed_owner_id=$2)`, [companyId, userId]);
	return { company, capabilities: capabilities(company), ownershipTransfer: transfer.rows[0] ? {
		id: transfer.rows[0].id, currentOwnerId: transfer.rows[0].current_owner_id,
		proposedOwnerId: transfer.rows[0].proposed_owner_id, expiresAt: transfer.rows[0].expires_at,
	} : null };
}

/** verifyOwner is a server-owned adapter callback, never HTTP input. It must
 * freshly verify bot presence and the linked Discord identity's guild ownership.
 */
async function claimCompany(userId, input, verifyOwner) {
	assertEnabled();
	fields(input, ['guildId']);
	if (!/^\d{17,20}$/.test(input.guildId || '')) throw codedError('discord_guild_invalid');
	if (typeof verifyOwner !== 'function') throw codedError('discord_verification_unavailable');
	const verified = await verifyOwner(userId, input.guildId);
	if (!verified?.available) throw codedError('discord_verification_unavailable');
	if (verified.guildId !== input.guildId || verified.userId !== userId || verified.isOwner !== true || verified.botPresent !== true) {
		throw codedError('company_claim_forbidden');
	}
	const name = nameText(verified.name);
	return transaction(async client => {
		await client.query(`INSERT INTO companies(id,discord_guild_id,name,icon) VALUES ($1,$2,$3,$4)
			ON CONFLICT(discord_guild_id) DO NOTHING`, [newId('com'), input.guildId, name, verified.icon || null]);
		const row = (await client.query('SELECT * FROM companies WHERE discord_guild_id=$1 FOR UPDATE', [input.guildId])).rows[0];
		if (row.lifecycle !== 'unclaimed') {
			const owner = await client.query("SELECT 1 FROM company_memberships WHERE company_id=$1 AND user_id=$2 AND role='owner' AND revoked_at IS NULL", [row.id, userId]);
			if (!owner.rowCount) throw codedError('company_already_claimed');
			const company = rowToCompany({ ...row, role: 'owner' });
			return { company, capabilities: capabilities(company) };
		}
		await client.query(`INSERT INTO company_memberships(company_id,user_id,role) VALUES ($1,$2,'owner')
			ON CONFLICT(company_id,user_id) DO UPDATE SET role='owner',revoked_at=NULL`, [row.id, userId]);
		const updated = await client.query(`UPDATE companies SET lifecycle='active',name=$2,icon=$3,
			revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`, [row.id, name, verified.icon || null]);
		await event(client, row.id, userId, 'company_claimed');
		const company = rowToCompany({ ...updated.rows[0], role: 'owner' });
		return { company, capabilities: capabilities(company) };
	});
}

async function updateCompany(companyId, userId, input) {
	assertEnabled();
	fields(input, ['name', 'expectedRevision']);
	const name = nameText(input.name);
	return transaction(async client => {
		const company = await access(client, companyId, userId, { lock: true });
		requireManager(company);
		if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== company.revision) throw codedError('company_revision_conflict');
		const result = await client.query('UPDATE companies SET name=$2,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *', [companyId, name]);
		await event(client, companyId, userId, 'company_updated', { name });
		const next = rowToCompany({ ...result.rows[0], role: company.role });
		return { company: next, capabilities: capabilities(next) };
	});
}

async function listCompanyTeams(companyId, userId, options = {}) {
	assertEnabled();
	const { limit, cursor } = pageOptions(options);
	// One transaction prevents a membership revocation between scope check and list.
	return transaction(async client => {
		const company = await access(client, companyId, userId, { lock: true });
		const manager = ['owner', 'admin'].includes(company.role) && options.ownOnly !== 'true' && options.ownOnly !== true;
		const result = await client.query(`SELECT t.id,t.name,t.description,t.color,t.archived_at,m.role
			FROM teams t LEFT JOIN team_memberships m ON m.team_id=t.id AND m.user_id=$2 AND m.revoked_at IS NULL
			WHERE t.company_id=$1 AND ($3::boolean OR m.user_id IS NOT NULL)
			AND ($4::text IS NULL OR (t.name,t.id)>($4,$5)) ORDER BY t.name,t.id LIMIT $6`,
		[companyId, userId, manager, cursor?.[0] ?? null, cursor?.[1] ?? null, limit + 1]);
		const page = paginate(result.rows, limit);
		return { teams: page.items.map(row => ({ id: row.id, name: row.name, color: row.color,
			archivedAt: row.archived_at, role: row.role, canOpen: Boolean(row.role) })), nextCursor: page.nextCursor };
	});
}

function requireManager(company, { writable = true, owner = false } = {}) {
	if (owner ? company.role !== 'owner' : !['owner','admin'].includes(company.role)) throw codedError('company_forbidden');
	if (writable && company.lifecycle !== 'active') throw codedError('company_not_active');
}
function revision(company, expected) {
	if (!Number.isInteger(expected) || expected !== company.revision) throw codedError('company_revision_conflict');
}
async function bump(client, company) {
	await client.query('UPDATE companies SET revision=revision+1,updated_at=now() WHERE id=$1', [company.id]);
	return company.revision + 1;
}
function safeNotificationName(value) { return String(value).replaceAll('@', '@\u200b').replace(/[\r\n]/g, ' ').slice(0, 120); }
function tokenHash(value) {
	if (typeof value !== 'string' || value.length < 32 || value.length > 100) throw codedError('company_invitation_not_found');
	return crypto.createHash('sha256').update(value).digest('hex');
}

async function createCompanyTeam(companyId, userId, input) {
	assertEnabled();
	fields(input, ['name','description','color','ownerUserId','expectedRevision']);
	const name = nameText(input.name);
	const description = typeof input.description === 'string' ? input.description.trim() : '';
	if (description.length > 4000) throw codedError('team_description_too_long');
	const color = input.color || 'indigo';
	if (!['indigo','blue','cyan','emerald','amber','rose','violet'].includes(color)) throw codedError('team_color_invalid');
	return transaction(async client => {
		const company = await access(client, companyId, userId, { lock: true });
		requireManager(company);
		revision(company, input.expectedRevision);
		const ownerId = input.ownerUserId || userId;
		const member = await client.query('SELECT 1 FROM company_memberships WHERE company_id=$1 AND user_id=$2 AND revoked_at IS NULL', [companyId, ownerId]);
		if (!member.rowCount) throw codedError('company_member_not_found');
		const id = newId('tem');
		await client.query(`INSERT INTO teams(id,name,description,color,created_by,company_id,discord_guild_id,discord_guild_name,discord_guild_icon,discord_connected_by,discord_connected_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$5,now())`, [id,name,description,color,userId,companyId,company.discordGuildId,company.name,company.icon]);
		await client.query("INSERT INTO team_memberships(team_id,user_id,role) VALUES ($1,$2,'owner')", [id,ownerId]);
		await require('./team-membership-sources').grantManualSource(client, id, ownerId, userId, 'legacy_team_created');
		await client.query("INSERT INTO team_events(id,team_id,actor_user_id,event_type,payload) VALUES ($1,$2,$3,'team_created',$4)",
			[newId('tev'),id,userId,JSON.stringify({ name, color, companyId, ownerUserId: ownerId })]);
		await event(client,companyId,userId,'company_team_created',{ teamId: id, ownerUserId: ownerId });
		return { team: { id, name, companyId, color, role: ownerId === userId ? 'owner' : null }, revision: await bump(client,company) };
	});
}

async function listMembers(companyId, userId, options = {}) {
	assertEnabled();
	const { limit, cursor } = pageOptions(options);
	const search = String(options.search || '').trim();
	if (search.length > 120) throw codedError('search_too_long');
	return transaction(async client => {
		const company = await access(client,companyId,userId,{ lock: true });
		requireManager(company,{ writable: false });
		const result = await client.query(`SELECT u.id,u.display_name AS name,m.role,m.joined_at,
		 COALESCE((SELECT NULLIF(i.avatar_url,'') FROM identities i WHERE i.user_id=u.id AND i.provider='discord' ORDER BY i.id LIMIT 1),u.avatar_url) AS avatar_url
		 FROM company_memberships m JOIN users u ON u.id=m.user_id
		 WHERE m.company_id=$1 AND m.revoked_at IS NULL AND ($2='' OR strpos(lower(u.display_name),lower($2))>0)
		 AND ($3::text IS NULL OR (u.display_name,u.id)>($3,$4)) ORDER BY u.display_name,u.id LIMIT $5`,
		[companyId,search,cursor?.[0] ?? null,cursor?.[1] ?? null,limit+1]);
		const page = paginate(result.rows,limit);
		return { members: page.items.map(row => ({ userId: row.id, displayName: row.name, role: row.role, avatarUrl: row.avatar_url, joinedAt: row.joined_at })), nextCursor: page.nextCursor, revision: company.revision };
	});
}

async function updateMemberRole(companyId, memberId, userId, input) {
	assertEnabled();
	fields(input,['role','expectedRevision']);
	if (!['admin','member'].includes(input.role)) throw codedError('company_role_invalid');
	return transaction(async client => {
		const company = await access(client,companyId,userId,{ lock: true });
		requireManager(company,{ owner: true }); revision(company,input.expectedRevision);
		const found = await client.query('SELECT role FROM company_memberships WHERE company_id=$1 AND user_id=$2 AND revoked_at IS NULL FOR UPDATE', [companyId,memberId]);
		if (!found.rowCount) throw codedError('company_member_not_found');
		if (found.rows[0].role === 'owner') throw codedError('company_owner_transfer_required');
		await client.query('UPDATE company_memberships SET role=$3 WHERE company_id=$1 AND user_id=$2', [companyId,memberId,input.role]);
		await event(client,companyId,userId,'company_member_role_changed',{ userId: memberId, role: input.role });
		return { role: input.role, revision: await bump(client,company) };
	});
}

async function removeMember(companyId, memberId, userId, input) {
	assertEnabled(); fields(input,['expectedRevision']);
	return transaction(async client => {
		const company = await access(client,companyId,userId,{ lock: true });
		if (company.lifecycle !== 'active') throw codedError('company_not_active');
		revision(company,input.expectedRevision);
		const found = await client.query('SELECT role FROM company_memberships WHERE company_id=$1 AND user_id=$2 AND revoked_at IS NULL FOR UPDATE', [companyId,memberId]);
		if (!found.rowCount) throw codedError('company_member_not_found');
		if (found.rows[0].role === 'owner') throw codedError('company_owner_transfer_required');
		if (memberId !== userId) {
			requireManager(company);
			if (company.role === 'admin' && found.rows[0].role !== 'member') throw codedError('company_forbidden');
		}
		// All membership/project mutation paths acquire the ancestor company first.
		await client.query('SELECT id FROM teams WHERE company_id=$1 ORDER BY id FOR UPDATE', [companyId]);
		const owned = await client.query(`SELECT 1 FROM team_memberships m JOIN teams t ON t.id=m.team_id
		 WHERE t.company_id=$1 AND m.user_id=$2 AND m.role='owner' AND m.revoked_at IS NULL
		 UNION ALL SELECT 1 FROM projects p JOIN teams t ON t.id=p.team_id WHERE t.company_id=$1 AND p.owner_user_id=$2 LIMIT 1`, [companyId,memberId]);
		if (owned.rowCount) throw codedError('company_work_owner_transfer_required');
		await client.query(`SELECT p.id FROM projects p JOIN teams t ON t.id=p.team_id WHERE t.company_id=$1 ORDER BY p.id FOR UPDATE OF p`, [companyId]);
		const assignments = await client.query(`DELETE FROM project_topic_assignees a USING projects p,teams t
		 WHERE a.project_id=p.id AND p.team_id=t.id AND t.company_id=$1 AND a.user_id=$2`, [companyId,memberId]);
		const projects = await client.query(`UPDATE project_memberships m SET revoked_at=now() FROM projects p,teams t
		 WHERE m.project_id=p.id AND p.team_id=t.id AND t.company_id=$1 AND m.user_id=$2 AND m.revoked_at IS NULL`, [companyId,memberId]);
		const teamMemberships = await client.query(`UPDATE team_memberships m SET revoked_at=now() FROM teams t
		 WHERE m.team_id=t.id AND t.company_id=$1 AND m.user_id=$2 AND m.revoked_at IS NULL RETURNING m.team_id`, [companyId,memberId]);
		for (const row of teamMemberships.rows) await require('./team-membership-sources').suppressMembership(client, row.team_id, memberId, userId, 'legacy_workspace_member_removed');
		await client.query('UPDATE teams SET revision=revision+1,updated_at=now() WHERE id=ANY($1::text[])', [teamMemberships.rows.map(row => row.team_id)]);
		await client.query('UPDATE company_memberships SET revoked_at=now() WHERE company_id=$1 AND user_id=$2', [companyId,memberId]);
		await client.query("UPDATE company_join_requests SET status='rejected',reviewed_at=now(),reviewed_by=$3,rejection_reason='member_removed' WHERE company_id=$1 AND user_id=$2 AND status='pending'", [companyId,memberId,userId]);
		await client.query('UPDATE company_ownership_transfers SET cancelled_at=now() WHERE company_id=$1 AND proposed_owner_id=$2 AND accepted_at IS NULL AND cancelled_at IS NULL', [companyId,memberId]);
		const impact = { teams: teamMemberships.rowCount, projects: projects.rowCount, assignments: assignments.rowCount };
		await event(client,companyId,userId,'company_member_removed',{ userId: memberId, ...impact });
		return { removed: true, impact, revision: await bump(client,company) };
	});
}

async function createJoinLink(companyId,userId,input = {}) {
	assertEnabled(); fields(input,['expectedRevision']);
	return transaction(async client => {
		const company = await access(client,companyId,userId,{ lock: true });
		requireManager(company); revision(company,input.expectedRevision);
		await client.query('UPDATE company_join_links SET revoked_at=now() WHERE company_id=$1 AND revoked_at IS NULL', [companyId]);
		await client.query("UPDATE company_join_requests SET status='rejected',reviewed_at=now(),reviewed_by=$2,rejection_reason='link_rotated' WHERE company_id=$1 AND status='pending' AND company_link_id IS NOT NULL", [companyId,userId]);
		const token = crypto.randomBytes(32).toString('base64url');
		const result = await client.query("INSERT INTO company_join_links(id,company_id,token_hash,expires_at,created_by) VALUES ($1,$2,$3,now()+interval '7 days',$4) RETURNING expires_at", [newId('cjl'),companyId,tokenHash(token),userId]);
		await event(client,companyId,userId,'company_join_link_created');
		return { token, expiresAt: result.rows[0].expires_at, revision: await bump(client,company) };
	});
}

async function revokeJoinLink(companyId,userId,input = {}) {
	assertEnabled(); fields(input,['expectedRevision']);
	return transaction(async client => {
		const company = await access(client,companyId,userId,{ lock: true });
		requireManager(company); revision(company,input.expectedRevision);
		await client.query('UPDATE company_join_links SET revoked_at=now() WHERE company_id=$1 AND revoked_at IS NULL', [companyId]);
		await client.query("UPDATE company_join_requests SET status='rejected',reviewed_at=now(),reviewed_by=$2,rejection_reason='link_disabled' WHERE company_id=$1 AND status='pending' AND company_link_id IS NOT NULL", [companyId,userId]);
		await event(client,companyId,userId,'company_join_link_revoked');
		return { revoked: true, revision: await bump(client,company) };
	});
}

async function linkRecord(client,token,{ lock = false } = {}) {
	const result = await client.query(`SELECT l.*,c.name,c.discord_guild_id,c.lifecycle FROM company_join_links l JOIN companies c ON c.id=l.company_id
		WHERE l.token_hash=$1 ${lock ? 'FOR UPDATE OF c' : ''}`, [tokenHash(token)]);
	const row = result.rows[0];
	if (!row || row.revoked_at || new Date(row.expires_at)<=new Date() || row.lifecycle !== 'active') throw codedError('company_invitation_not_found');
	return row;
}
async function previewJoinToken(token) {
	assertEnabled();
	const row = await linkRecord({ query },token);
	return { company: { id: row.company_id, name: row.name }, expiresAt: row.expires_at };
}

async function enqueueJoinNotice(client,company,request) {
	const approvers = await client.query("SELECT user_id FROM company_memberships WHERE company_id=$1 AND role IN ('owner','admin') AND revoked_at IS NULL", [company.id]);
	const root = String(process.env.FRONTEND_URL || '').replace(/\/$/,'');
	for (const approver of approvers.rows) await notifications.enqueueWithClient(client, {
		userId: approver.user_id, eventType: 'company_join_requested',
		dedupeKey: `company-join:${request.id}:${request.request_cycle}:${approver.user_id}`,
		payload: { companyId: company.id, companyRequestId: request.id, requestCycle: request.request_cycle,
			subjectEn: `Join request for ${safeNotificationName(company.name)}`, subjectTh: `คำขอเข้าร่วม ${safeNotificationName(company.name)}`,
			bodyEn: 'Someone requested access to your company workspace. Review their request in Megu.',
			bodyTh: 'มีผู้ขอเข้าร่วมพื้นที่ทำงานของบริษัท ตรวจสอบคำขอได้ใน Megu',
			ctaLabelEn: 'Review request', ctaLabelTh: 'ตรวจสอบคำขอ', ctaUrl: root ? `${root}/companies/${company.id}/requests` : null },
	});
}

// Internal transaction helper also used by a company-backed team's join link.
async function requestAccessWithClient(client,companyId,userId,{ companyLinkId = null, teamLinkId = null } = {}) {
	const company = (await client.query('SELECT * FROM companies WHERE id=$1 FOR UPDATE', [companyId])).rows[0];
	if (!company || company.lifecycle !== 'active') throw codedError('company_not_active');
	if (Boolean(companyLinkId) === Boolean(teamLinkId)) throw codedError('company_invitation_not_found');
	const source = await client.query(`SELECT 1 FROM company_join_links WHERE id=$2 AND company_id=$1 AND revoked_at IS NULL AND expires_at>now()
	 UNION ALL SELECT 1 FROM team_join_links l JOIN teams t ON t.id=l.team_id
	 WHERE l.id=$3 AND t.company_id=$1 AND t.archived_at IS NULL AND l.revoked_at IS NULL AND l.expires_at>now()`, [companyId,companyLinkId,teamLinkId]);
	if (!source.rowCount) throw codedError('company_invitation_not_found');
	const member = await client.query('SELECT 1 FROM company_memberships WHERE company_id=$1 AND user_id=$2 AND revoked_at IS NULL', [companyId,userId]);
	if (member.rowCount) return { status: 'approved' };
	const existing = (await client.query('SELECT * FROM company_join_requests WHERE company_id=$1 AND user_id=$2 FOR UPDATE', [companyId,userId])).rows[0];
	if (existing?.status === 'pending') {
		const valid = await client.query(`SELECT 1 FROM company_join_requests r WHERE r.id=$1 AND ${validRequestSourceSql}`, [existing.id]);
		if (valid.rowCount) return { status: 'pending', requestId: existing.id };
	}
	const count = await client.query("SELECT count(*)::int AS n FROM company_join_requests WHERE company_id=$1 AND user_id<>$2 AND status='pending'", [companyId,userId]);
	if (count.rows[0].n >= 1000) throw codedError('company_request_limit');
	const result = await client.query(`INSERT INTO company_join_requests(id,company_id,user_id,company_link_id,team_link_id)
		VALUES ($1,$2,$3,$4,$5) ON CONFLICT(company_id,user_id) DO UPDATE SET status='pending',company_link_id=$4,team_link_id=$5,
		requested_at=now(),reviewed_at=NULL,reviewed_by=NULL,rejection_reason=NULL,request_cycle=company_join_requests.request_cycle+1 RETURNING *`,
	[newId('cjr'),companyId,userId,companyLinkId,teamLinkId]);
	await event(client,companyId,userId,'company_join_requested');
	await enqueueJoinNotice(client,company,result.rows[0]);
	return { status: 'pending', requestId: result.rows[0].id };
}

async function requestJoin(token,userId) {
	assertEnabled();
	return transaction(async client => {
		const link = await linkRecord(client,token,{ lock: true });
		return requestAccessWithClient(client,link.company_id,userId,{ companyLinkId: link.id });
	});
}

const validRequestSourceSql = `( (r.company_link_id IS NOT NULL AND EXISTS (SELECT 1 FROM company_join_links l WHERE l.id=r.company_link_id AND l.company_id=r.company_id AND l.revoked_at IS NULL AND l.expires_at>now()))
	OR (r.team_link_id IS NOT NULL AND EXISTS (SELECT 1 FROM team_join_links l JOIN teams t ON t.id=l.team_id WHERE l.id=r.team_link_id AND t.company_id=r.company_id AND t.archived_at IS NULL AND l.revoked_at IS NULL AND l.expires_at>now())) )`;

async function listJoinRequests(companyId,userId,options = {}) {
	assertEnabled(); const { limit,cursor } = pageOptions(options);
	return transaction(async client => {
		const company = await access(client,companyId,userId,{ lock: true }); requireManager(company,{ writable: false });
		const result = await client.query(`SELECT r.*,u.display_name AS name,
		 COALESCE((SELECT NULLIF(i.avatar_url,'') FROM identities i WHERE i.user_id=u.id AND i.provider='discord' ORDER BY i.id LIMIT 1),u.avatar_url) AS avatar_url
		 FROM company_join_requests r JOIN users u ON u.id=r.user_id
		 WHERE r.company_id=$1 AND r.status='pending' AND ${validRequestSourceSql}
		 AND ($2::text IS NULL OR (u.display_name,r.id)>($2,$3)) ORDER BY u.display_name,r.id LIMIT $4`, [companyId,cursor?.[0] ?? null,cursor?.[1] ?? null,limit+1]);
		const page = paginate(result.rows,limit);
		const link = await client.query('SELECT expires_at FROM company_join_links WHERE company_id=$1 AND revoked_at IS NULL AND expires_at>now()', [companyId]);
		return { requests: page.items.map(row => ({ id: row.id, userId: row.user_id, displayName: row.name, avatarUrl: row.avatar_url,
			requestCycle: row.request_cycle, requestedAt: row.requested_at, status: row.status })), nextCursor: page.nextCursor,
			link: link.rows[0] ? { expiresAt: link.rows[0].expires_at } : null, revision: company.revision };
	});
}

async function reviewJoinRequest(companyId,requestId,userId,input,verifyMember) {
	assertEnabled(); fields(input,['action','role','requestCycle']);
	if (!['approve','reject'].includes(input.action)) throw codedError('review_action_invalid');
	const role = input.role || 'member';
	if (!['member','admin'].includes(role)) throw codedError('company_role_invalid');
	// Verify outside the transaction, then recheck actor, request version and scope
	// after acquiring the company lock. No network call holds a database client.
	const before = await access({ query },companyId,userId); requireManager(before);
	if (role === 'admin' && before.role !== 'owner') throw codedError('company_forbidden');
	const pending = (await query(`SELECT r.* FROM company_join_requests r WHERE r.company_id=$1 AND r.id=$2 AND ${validRequestSourceSql}`, [companyId,requestId])).rows[0];
	if (!pending) throw codedError('company_request_not_found');
	if (input.action === 'approve' && pending.status === 'pending') {
		const verified = typeof verifyMember === 'function' ? await verifyMember(pending.user_id,before.discordGuildId) : null;
		if (!verified?.available) throw codedError('discord_verification_unavailable');
		if (verified.userId !== pending.user_id || verified.guildId !== before.discordGuildId || verified.isMember !== true || verified.isBot === true) throw codedError('company_discord_membership_required');
	}
	return transaction(async client => {
		const company = await access(client,companyId,userId,{ lock: true }); requireManager(company);
		if (role === 'admin' && company.role !== 'owner') throw codedError('company_forbidden');
		const request = (await client.query(`SELECT r.* FROM company_join_requests r WHERE r.company_id=$1 AND r.id=$2 AND ${validRequestSourceSql} FOR UPDATE OF r`, [companyId,requestId])).rows[0];
		if (!request) throw codedError('company_request_not_found');
		if (!Number.isInteger(input.requestCycle) || request.request_cycle !== input.requestCycle || request.request_cycle !== pending.request_cycle || request.user_id !== pending.user_id) throw codedError('company_revision_conflict');
		if (request.status !== 'pending') return { status: request.status };
		if (input.action === 'approve') await client.query(`INSERT INTO company_memberships(company_id,user_id,role) VALUES ($1,$2,$3)
		 ON CONFLICT(company_id,user_id) DO UPDATE SET role=CASE WHEN company_memberships.revoked_at IS NULL THEN company_memberships.role ELSE $3 END,revoked_at=NULL,joined_at=now()`, [companyId,request.user_id,role]);
		const status = input.action === 'approve' ? 'approved' : 'rejected';
		await client.query('UPDATE company_join_requests SET status=$2,reviewed_at=now(),reviewed_by=$3 WHERE id=$1', [request.id,status,userId]);
		await event(client,companyId,userId,`company_join_${status}`,{ userId: request.user_id });
		return { status, revision: await bump(client,company) };
	});
}

async function proposeOwnershipTransfer(companyId,userId,input) {
	assertEnabled(); fields(input,['proposedOwnerId','expectedRevision']);
	if (typeof input.proposedOwnerId !== 'string' || !input.proposedOwnerId || input.proposedOwnerId.length>100) throw codedError('company_member_not_found');
	return transaction(async client => {
		const company = await access(client,companyId,userId,{ lock: true }); requireManager(company,{ owner: true }); revision(company,input.expectedRevision);
		if (input.proposedOwnerId === userId) throw codedError('ownership_transfer_self');
		const member = await client.query('SELECT 1 FROM company_memberships WHERE company_id=$1 AND user_id=$2 AND revoked_at IS NULL', [companyId,input.proposedOwnerId]);
		if (!member.rowCount) throw codedError('company_member_not_found');
		await client.query('UPDATE company_ownership_transfers SET cancelled_at=now() WHERE company_id=$1 AND accepted_at IS NULL AND cancelled_at IS NULL', [companyId]);
		const id = newId('cot');
		await client.query("INSERT INTO company_ownership_transfers(id,company_id,current_owner_id,proposed_owner_id,expires_at) VALUES ($1,$2,$3,$4,now()+interval '7 days')", [id,companyId,userId,input.proposedOwnerId]);
		await event(client,companyId,userId,'company_transfer_proposed',{ proposedOwnerId: input.proposedOwnerId });
		return { transfer: { id, proposedOwnerId: input.proposedOwnerId }, revision: await bump(client,company) };
	});
}

async function resolveOwnershipTransfer(companyId,transferId,userId,input = {}) {
	assertEnabled(); fields(input,['action']);
	const { action } = input;
	if (!['accept','cancel'].includes(action)) throw codedError('review_action_invalid');
	return transaction(async client => {
		const company = await access(client,companyId,userId,{ lock: true });
		if (company.lifecycle !== 'active') throw codedError('company_not_active');
		const transfer = (await client.query('SELECT * FROM company_ownership_transfers WHERE company_id=$1 AND id=$2 FOR UPDATE', [companyId,transferId])).rows[0];
		if (!transfer || ![transfer.current_owner_id,transfer.proposed_owner_id].includes(userId)) throw codedError('company_transfer_not_found');
		if (transfer.accepted_at || transfer.cancelled_at || new Date(transfer.expires_at)<=new Date()) throw codedError('company_transfer_stale');
		if (action === 'cancel') {
			requireManager(company,{ owner: true });
			await client.query('UPDATE company_ownership_transfers SET cancelled_at=now() WHERE id=$1', [transferId]);
		} else {
			if (transfer.proposed_owner_id !== userId) throw codedError('company_forbidden');
			const demoted = await client.query("UPDATE company_memberships SET role='admin' WHERE company_id=$1 AND user_id=$2 AND role='owner' AND revoked_at IS NULL", [companyId,transfer.current_owner_id]);
			if (!demoted.rowCount) throw codedError('company_transfer_stale');
			await client.query("UPDATE company_memberships SET role='owner' WHERE company_id=$1 AND user_id=$2 AND revoked_at IS NULL", [companyId,userId]);
			await client.query('UPDATE company_ownership_transfers SET accepted_at=now() WHERE id=$1', [transferId]);
		}
		await event(client,companyId,userId,`company_transfer_${action}`);
		return { status: action === 'accept' ? 'accepted' : 'cancelled', revision: await bump(client,company) };
	});
}

async function companyForGuildWrite(client,guildId,userId) {
	const found = await client.query('SELECT id FROM companies WHERE discord_guild_id=$1', [guildId]);
	if (!found.rowCount) {
		if (process.env.MEGU_COMPANIES_ENABLED === '1') throw codedError('company_setup_required');
		return null;
	}
	const company = await access(client,found.rows[0].id,userId,{ lock: true });
	// A persisted company cannot be bypassed by switching off the new UI flag.
	requireManager(company);
	return company;
}

async function setArchived(companyId,userId,input) {
	assertEnabled(); fields(input,['archived','expectedRevision']);
	if (typeof input.archived !== 'boolean') throw codedError('request_body_invalid');
	return transaction(async client => {
		const company = await access(client,companyId,userId,{ lock: true }); requireManager(company,{ writable: false, owner: true }); revision(company,input.expectedRevision);
		if (company.lifecycle === 'unclaimed') throw codedError('company_not_active');
		await client.query("UPDATE companies SET lifecycle=$2,archived_at=CASE WHEN $2='archived' THEN now() ELSE NULL END WHERE id=$1", [companyId,input.archived ? 'archived' : 'active']);
		if (input.archived) {
			await client.query('UPDATE company_join_links SET revoked_at=now() WHERE company_id=$1 AND revoked_at IS NULL', [companyId]);
			await client.query("UPDATE company_join_requests SET status='rejected',reviewed_at=now(),reviewed_by=$2,rejection_reason='company_archived' WHERE company_id=$1 AND status='pending'", [companyId,userId]);
			await client.query('UPDATE company_ownership_transfers SET cancelled_at=now() WHERE company_id=$1 AND accepted_at IS NULL AND cancelled_at IS NULL', [companyId]);
		}
		await event(client,companyId,userId,input.archived ? 'company_archived' : 'company_restored');
		return { archived: input.archived, revision: await bump(client,company) };
	});
}

module.exports = { assertEnabled, access, capabilities, claimCompany, getCompany, listCompanies, listCompanyTeams, updateCompany,
	createCompanyTeam, listMembers, updateMemberRole, removeMember, createJoinLink, revokeJoinLink, previewJoinToken, requestJoin,
	requestAccessWithClient, validRequestSourceSql, listJoinRequests, reviewJoinRequest, proposeOwnershipTransfer, resolveOwnershipTransfer, setArchived, companyForGuildWrite };
