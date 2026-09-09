const crypto = require('node:crypto');
const { query, transaction } = require('./db.js');
const { newId, newProjectCode } = require('./ids.js');
const notifications = require('./notifications.js');
const projectReminders = require('./project-reminders.js');
const projectChannelNotifications = require('./project-channel-notifications.js');

const PROJECT_STATES = ['planning', 'active', 'paused', 'completed', 'cancelled'];
const PROJECT_TRANSITIONS = {
	planning: ['active', 'cancelled'],
	active: ['paused', 'completed', 'cancelled'],
	paused: ['active', 'completed', 'cancelled'],
	completed: ['active'],
	cancelled: ['active'],
};
const ROLES = ['owner', 'lead', 'member', 'viewer'];
const LEAD_ROLES = new Set(['owner', 'lead']);

function codedError(code, message = code) {
	const error = new Error(message);
	error.code = code;
	return error;
}

function text(value) {
	return String(value ?? '').trim();
}

// HTML date inputs can expose Buddhist-calendar years in some Thai browser
// locales. Treat those years as calendar labels, not Gregorian storage years,
// while leaving ordinary ISO/Gregorian dates untouched.
function normaliseCalendarDate(value) {
	const source = String(value ?? '').trim();
	const match = /^(\d{4})(-\d{2}-\d{2})(.*)$/.exec(source);
	if (!match) return source;
	const year = Number(match[1]);
	return year >= 2400 && year <= 2699 ? `${year - 543}${match[2]}${match[3]}` : source;
}

function assertKnownFields(input, allowed) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw codedError('request_body_invalid');
	const known = new Set(allowed);
	const unknown = Object.keys(input).find(key => !known.has(key));
	if (unknown) {
		const error = codedError('unknown_field');
		error.field = unknown;
		throw error;
	}
}

function notificationText(value) {
	return text(value).replace(/[\r\n]+/g, ' ').replaceAll('@', '@\u200b').slice(0, 180);
}

function requiredText(value, field, max) {
	const next = text(value);
	if (!next) throw codedError(`${field}_required`);
	if (next.length > max) throw codedError(`${field}_too_long`);
	return next;
}

function optionalText(value, field, max) {
	const next = text(value);
	if (next.length > max) throw codedError(`${field}_too_long`);
	return next;
}

function timezone(value) {
	const next = text(value) || 'Asia/Bangkok';
	try { new Intl.DateTimeFormat('en', { timeZone: next }).format(); }
	catch { throw codedError('timezone_invalid'); }
	return next;
}

function zonedDateBoundary(value, zone, end = false) {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normaliseCalendarDate(value).slice(0, 10));
	if (!match) return null;
	const [year, month, day] = match.slice(1).map(Number);
	const wanted = Date.UTC(year, month - 1, day, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
	});
	let guess = wanted;
	for (let i = 0; i < 3; i++) {
		const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(part => [part.type, part.value]));
		const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second), end ? 999 : 0);
		guess -= represented - wanted;
	}
	const finalParts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(part => [part.type, part.value]));
	if (Number(finalParts.year) !== year || Number(finalParts.month) !== month || Number(finalParts.day) !== day) return null;
	return new Date(guess).toISOString();
}

function localParts(value, zone) {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
	});
	return Object.fromEntries(formatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
}

function zonedLocalInstant(parts, zone, milliseconds = 0) {
	const wanted = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second), milliseconds);
	let guess = wanted;
	for (let i = 0; i < 3; i++) {
		const represented = localParts(new Date(guess), zone);
		const representedUtc = Date.UTC(Number(represented.year), Number(represented.month) - 1, Number(represented.day), Number(represented.hour), Number(represented.minute), Number(represented.second), milliseconds);
		guess -= representedUtc - wanted;
	}
	const final = localParts(new Date(guess), zone);
	if (['year', 'month', 'day', 'hour', 'minute', 'second'].some(key => Number(final[key]) !== Number(parts[key]))) throw codedError('timezone_schedule_invalid');
	return new Date(guess).toISOString();
}

function rezoneInstant(value, precision, oldZone, newZone, end = false) {
	if (!value) return null;
	const parts = localParts(value, oldZone);
	if (precision === 'date') {
		const boundary = zonedDateBoundary(`${parts.year}-${parts.month}-${parts.day}`, newZone, end);
		if (!boundary) throw codedError('timezone_schedule_invalid');
		return boundary;
	}
	return zonedLocalInstant(parts, newZone, new Date(value).getUTCMilliseconds());
}

function instant(value, field, precision, zone) {
	if (!value) return null;
	if (precision === 'date') {
		const boundary = zonedDateBoundary(value, zone, field === 'deadline_at' || field === 'due_at');
		if (!boundary) throw codedError(`${field}_invalid`);
		return boundary;
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) throw codedError(`${field}_invalid`);
	return date.toISOString();
}

function dates(input = {}, zone = 'Asia/Bangkok') {
	const startsPrecision = input.startsAt ? (input.startsPrecision === 'instant' ? 'instant' : 'date') : null;
	const deadlinePrecision = input.deadlineAt ? (input.deadlinePrecision === 'instant' ? 'instant' : 'date') : null;
	const startsAt = instant(input.startsAt, 'starts_at', startsPrecision, zone);
	const deadlineAt = instant(input.deadlineAt, 'deadline_at', deadlinePrecision, zone);
	if (startsAt && deadlineAt && startsAt > deadlineAt) throw codedError('date_order_invalid');
	return {
		startsAt,
		deadlineAt,
		startsPrecision,
		deadlinePrecision,
	};
}

function projectRow(row) {
	return row && {
		id: row.id, code: row.code, ownerUserId: row.owner_user_id, title: row.title,
		description: row.description, status: row.status, timezone: row.timezone,
		startsAt: row.starts_at, startsPrecision: row.starts_precision,
		deadlineAt: row.deadline_at, deadlinePrecision: row.deadline_precision,
		closeReason: row.close_reason, revision: row.revision,
		createdAt: row.created_at, updatedAt: row.updated_at, closedAt: row.closed_at,
		role: row.role, progress: Number(row.progress || 0), topicCount: Number(row.topic_count || 0),
		lastUpdatedAt: row.last_updated_at || row.updated_at, nextDueAt: row.next_due_at || null,
		assignedCount: Number(row.assigned_count || 0),
	};
}

function topicRow(row) {
	return row && {
		id: row.id, projectId: row.project_id, number: row.topic_no, title: row.title,
		description: row.description, workflow: row.workflow, progress: row.progress,
		blocked: row.blocked, blockerReason: row.blocker_reason,
		startsAt: row.starts_at, startsPrecision: row.starts_precision,
		deadlineAt: row.deadline_at, deadlinePrecision: row.deadline_precision,
		weight: Number(row.weight || 1), position: row.position, revision: row.revision,
		scheduleRevision: row.schedule_revision || 0, archivedAt: row.archived_at,
		createdAt: row.created_at, updatedAt: row.updated_at, assignees: [], latestReport: null,
	};
}

function reportRow(row) {
	return row && {
		id: row.id, topicId: row.topic_id, authorUserId: row.author_user_id,
		authorName: row.author_name, authorAvatarUrl: row.author_avatar_url, progress: row.progress, workflow: row.workflow,
		summary: row.summary, blocked: row.blocked, blockerReason: row.blocker_reason,
		changeReason: row.change_reason, correctionOfReportId: row.correction_of_report_id || null,
		createdAt: row.created_at,
	};
}

function eventRow(row) {
	return row && {
		id: row.id, topicId: row.topic_id, actorUserId: row.actor_user_id,
		actorName: row.actor_name, type: row.event_type, payload: row.payload,
		createdAt: row.created_at,
	};
}

function historyCursor(row) {
	return row ? Buffer.from(JSON.stringify({ at: new Date(row.created_at).toISOString(), id: row.id })).toString('base64url') : null;
}

function parseHistoryCursor(value) {
	if (!value) return null;
	if (String(value).length > 500) throw codedError('cursor_invalid');
	try {
		const cursor = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
		if (!cursor.id || Number.isNaN(new Date(cursor.at).getTime())) throw new Error('bad cursor');
		return cursor;
	}
	catch { throw codedError('cursor_invalid'); }
}

function historyLimit(value) {
	const number = Number(value || 30);
	return Number.isInteger(number) ? Math.max(1, Math.min(100, number)) : 30;
}

function memberRow(row) {
	return row && {
		userId: row.user_id,
		role: row.role,
		displayName: row.display_name,
		avatarUrl: row.avatar_url,
		joinedAt: row.created_at,
	};
}

function invitationRow(row) {
	return row && {
		id: row.id,
		provider: row.recipient_provider,
		recipient: row.recipient_value,
		role: row.role,
		expiresAt: row.expires_at,
		createdAt: row.created_at,
		revokedAt: row.revoked_at,
		acceptedAt: row.accepted_at,
		inviterName: row.inviter_name,
	};
}

function ownershipTransferRow(row) {
	return row && {
		id: row.id,
		currentOwnerId: row.current_owner_id,
		proposedOwnerId: row.proposed_owner_id,
		proposedOwnerName: row.proposed_owner_name,
		expiresAt: row.expires_at,
		createdAt: row.created_at,
	};
}

function notificationSettingsRow(row) {
	return {
		enabled: Boolean(row?.enabled),
		dmEnabled: row?.dm_enabled !== false,
		blockerNotifications: Boolean(row?.blocker_notifications),
		reminder48h: Boolean(row?.reminder_48h),
		reminder24h: Boolean(row?.reminder_24h),
		channelEnabled: Boolean(row?.channel_enabled),
		guildId: row?.guild_id || null,
		channelId: row?.channel_id || null,
		channelName: row?.channel_name || null,
		updatedAt: row?.updated_at || null,
	};
}

function milestoneRow(row) {
	return row && {
		id: row.id, projectId: row.project_id, title: row.title,
		dueAt: row.due_at, duePrecision: row.due_precision,
		state: row.state, reachedAt: row.reached_at, revision: row.revision,
		createdAt: row.created_at, updatedAt: row.updated_at,
	};
}

function dependencyRow(row) {
	if (!row) return null;
	let scheduleStatus = 'not_evaluated';
	if (row.predecessor_deadline_at && row.successor_starts_at) {
		scheduleStatus = new Date(row.successor_starts_at) < new Date(row.predecessor_deadline_at) ? 'warning' : 'aligned';
	}
	return {
		id: row.id,
		predecessorTopicId: row.predecessor_topic_id,
		successorTopicId: row.successor_topic_id,
		predecessor: { number: row.predecessor_topic_no, title: row.predecessor_title },
		successor: { number: row.successor_topic_no, title: row.successor_title },
		scheduleStatus,
		createdAt: row.created_at,
	};
}

async function createProject(input = {}) {
	assertKnownFields(input, ['ownerUserId', 'title', 'description', 'timezone', 'startsAt', 'startsPrecision', 'deadlineAt', 'deadlinePrecision']);
	const { ownerUserId, title, description, timezone: zone, startsAt, startsPrecision, deadlineAt, deadlinePrecision } = input;
	const projectTitle = requiredText(title, 'title', 120);
	const projectDescription = optionalText(description, 'description', 4000);
	const projectZone = timezone(zone);
	const schedule = dates({ startsAt, startsPrecision, deadlineAt, deadlinePrecision }, projectZone);

	return transaction(async (client) => {
		for (let attempt = 0; attempt < 6; attempt++) {
			const project = {
				id: newId('prj'), code: newProjectCode(), ownerUserId,
				title: projectTitle, description: projectDescription, timezone: projectZone, ...schedule,
			};
			const inserted = await client.query(
					`INSERT INTO projects
					 (id, code, owner_user_id, title, description, timezone, starts_at, starts_precision, deadline_at, deadline_precision)
					 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
					 ON CONFLICT (code) DO NOTHING RETURNING id`,
					[project.id, project.code, ownerUserId, projectTitle, projectDescription, projectZone,
						schedule.startsAt, schedule.startsPrecision, schedule.deadlineAt, schedule.deadlinePrecision],
				);
			if (!inserted.rows[0]) continue;
				await client.query(
					'INSERT INTO project_memberships (project_id, user_id, role) VALUES ($1, $2, \'owner\')',
					[project.id, ownerUserId],
				);
				await addEvent(client, project.id, null, ownerUserId, 'project_created', { title: projectTitle });
				return { ...project, status: 'planning', revision: 0, progress: 0, topicCount: 0, role: 'owner' };
		}
		throw codedError('project_code_unavailable');
	});
}

async function listProjectsForUser(userId, { includeClosed = true } = {}) {
	const result = await query(
		`SELECT p.*, m.role,
			 count(t.id) FILTER (WHERE t.archived_at IS NULL)::int AS topic_count,
		 COALESCE(round((sum(t.progress * t.weight) FILTER (WHERE t.archived_at IS NULL))::numeric /
		  NULLIF(sum(t.weight) FILTER (WHERE t.archived_at IS NULL), 0)), 0)::int AS progress,
			 max(COALESCE(t.updated_at, p.updated_at)) AS last_updated_at,
			 min(t.deadline_at) FILTER (WHERE t.archived_at IS NULL AND t.workflow <> 'completed') AS next_due_at,
		 (SELECT count(*)::int FROM project_topic_assignees mine
		   JOIN project_topics mt ON mt.id = mine.topic_id
		   WHERE mine.project_id = p.id AND mine.user_id = $1 AND mt.archived_at IS NULL) AS assigned_count
		 FROM projects p
		 JOIN project_memberships m ON m.project_id = p.id AND m.user_id = $1 AND m.revoked_at IS NULL
		 LEFT JOIN project_topics t ON t.project_id = p.id
		 WHERE ($2::boolean OR p.status NOT IN ('completed', 'cancelled'))
		 GROUP BY p.id, m.role ORDER BY p.updated_at DESC, p.id DESC`,
		[userId, includeClosed],
	);
	return result.rows.map(projectRow);
}

function directoryCursor(row) {
	return row ? Buffer.from(JSON.stringify({ at: new Date(row.updated_at).toISOString(), id: row.id })).toString('base64url') : null;
}

async function listProjectDirectory(userId, options = {}) {
	const bucket = ['active', 'closed'].includes(options.bucket) ? options.bucket : 'all';
	const search = text(options.search);
	if (search.length > 120) throw codedError('search_too_long');
	const cursor = parseHistoryCursor(options.cursor);
	const limit = historyLimit(options.limit);
	const [result, anyProjects] = await Promise.all([query(
		`SELECT p.*, m.role,
		 count(t.id) FILTER (WHERE t.archived_at IS NULL)::int AS topic_count,
		 min(t.deadline_at) FILTER (WHERE t.archived_at IS NULL AND t.workflow <> 'completed') AS next_due_at,
		 COALESCE(round((sum(t.progress * t.weight) FILTER (WHERE t.archived_at IS NULL))::numeric /
		  NULLIF(sum(t.weight) FILTER (WHERE t.archived_at IS NULL), 0)), 0)::int AS progress,
		 max(COALESCE(t.updated_at, p.updated_at)) AS last_updated_at,
		 (SELECT count(*)::int FROM project_topic_assignees mine
		   JOIN project_topics mt ON mt.id=mine.topic_id
		   WHERE mine.project_id=p.id AND mine.user_id=$1 AND mt.archived_at IS NULL) AS assigned_count
		 FROM projects p
		 JOIN project_memberships m ON m.project_id=p.id AND m.user_id=$1 AND m.revoked_at IS NULL
		 LEFT JOIN project_topics t ON t.project_id=p.id
		 WHERE ($2='all' OR ($2='closed' AND p.status IN ('completed','cancelled')) OR ($2='active' AND p.status NOT IN ('completed','cancelled')))
		 AND ($3='' OR lower(p.title) LIKE '%' || lower($3) || '%' OR lower(p.code) LIKE '%' || lower($3) || '%')
		 AND ($4::boolean=false OR EXISTS (SELECT 1 FROM project_topic_assignees mine JOIN project_topics mt ON mt.id=mine.topic_id WHERE mine.project_id=p.id AND mine.user_id=$1 AND mt.archived_at IS NULL))
		 AND ($5::timestamptz IS NULL OR (p.updated_at,p.id) < ($5::timestamptz,$6::text))
		 GROUP BY p.id,m.role ORDER BY p.updated_at DESC,p.id DESC LIMIT $7`,
		[userId, bucket, search, options.assignedOnly === true, cursor?.at || null, cursor?.id || '', limit + 1],
	), query('SELECT EXISTS (SELECT 1 FROM project_memberships WHERE user_id=$1 AND revoked_at IS NULL) AS present', [userId])]);
	const hasMore = result.rows.length > limit;
	const rows = result.rows.slice(0, limit);
	return { projects: rows.map(projectRow), nextCursor: hasMore ? directoryCursor(rows.at(-1)) : null, hasAnyProjects: anyProjects.rows[0].present };
}

async function accessByCode(client, code, userId, { lock = false } = {}) {
	const result = await client.query(
		`SELECT p.*, m.role FROM projects p
		 JOIN project_memberships m ON m.project_id = p.id AND m.user_id = $2 AND m.revoked_at IS NULL
		 WHERE p.code = $1 ${lock ? 'FOR UPDATE OF p' : ''}`,
		[String(code || '').toUpperCase(), userId],
	);
	if (!result.rows[0]) throw codedError('project_not_found');
	return projectRow(result.rows[0]);
}

async function getProjectByCode(code, userId) {
	const project = await accessByCode({ query }, code, userId);
	const [members, topics, assignees, reports, events, transfer, notificationSetting, dependencies, milestones] = await Promise.all([
		query(`SELECT m.user_id, m.role, m.created_at, u.display_name, COALESCE((SELECT NULLIF(i.avatar_url, '') FROM identities i WHERE i.user_id = u.id AND i.provider = 'discord' ORDER BY i.id LIMIT 1), u.avatar_url) AS avatar_url FROM project_memberships m
		 JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 AND m.revoked_at IS NULL
		 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'lead' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, u.display_name`, [project.id]),
		query('SELECT * FROM project_topics WHERE project_id = $1 ORDER BY archived_at NULLS FIRST, position, topic_no', [project.id]),
		query(`SELECT a.topic_id, a.user_id, a.is_primary, u.display_name, COALESCE((SELECT NULLIF(i.avatar_url, '') FROM identities i WHERE i.user_id = u.id AND i.provider = 'discord' ORDER BY i.id LIMIT 1), u.avatar_url) AS avatar_url
		 FROM project_topic_assignees a JOIN users u ON u.id = a.user_id
		 WHERE a.project_id = $1 ORDER BY a.is_primary DESC, u.display_name`, [project.id]),
		query(`SELECT DISTINCT ON (r.topic_id) r.*, u.display_name AS author_name, COALESCE((SELECT NULLIF(i.avatar_url, '') FROM identities i WHERE i.user_id = u.id AND i.provider = 'discord' ORDER BY i.id LIMIT 1), u.avatar_url) AS author_avatar_url
		 FROM project_progress_reports r JOIN users u ON u.id = r.author_user_id
		 WHERE r.project_id = $1 ORDER BY r.topic_id, r.created_at DESC, r.id DESC`, [project.id]),
		query(`SELECT e.id, e.topic_id, e.actor_user_id, e.event_type, e.payload, e.created_at,
		 u.display_name AS actor_name FROM project_events e LEFT JOIN users u ON u.id = e.actor_user_id
			 WHERE e.project_id = $1 ORDER BY e.created_at DESC, e.id DESC LIMIT 30`, [project.id]),
		query(`SELECT ot.*, u.display_name AS proposed_owner_name FROM project_ownership_transfers ot
			 JOIN users u ON u.id=ot.proposed_owner_id
			 WHERE ot.project_id=$1 AND ot.accepted_at IS NULL AND ot.cancelled_at IS NULL AND ot.expires_at > now()
			 AND ($2::text=ot.current_owner_id OR $2::text=ot.proposed_owner_id) LIMIT 1`, [project.id, userId]),
		query('SELECT * FROM project_notification_settings WHERE project_id=$1', [project.id]),
		query(`SELECT d.*, predecessor.topic_no AS predecessor_topic_no, predecessor.title AS predecessor_title,
		 predecessor.deadline_at AS predecessor_deadline_at, successor.topic_no AS successor_topic_no,
		 successor.title AS successor_title, successor.starts_at AS successor_starts_at
		 FROM project_dependencies d
		 JOIN project_topics predecessor ON predecessor.project_id=d.project_id AND predecessor.id=d.predecessor_topic_id
		 JOIN project_topics successor ON successor.project_id=d.project_id AND successor.id=d.successor_topic_id
		 WHERE d.project_id=$1 ORDER BY predecessor.topic_no, successor.topic_no, d.id`, [project.id]),
		query('SELECT * FROM project_milestones WHERE project_id=$1 ORDER BY due_at, id', [project.id]),
	]);
	const allTopics = topics.rows.map(topicRow);
	const topicList = allTopics.filter(topic => !topic.archivedAt);
	const archivedTopicList = allTopics.filter(topic => topic.archivedAt);
	const byTopic = new Map(allTopics.map(topic => [topic.id, topic]));
	for (const row of assignees.rows) byTopic.get(row.topic_id)?.assignees.push({
		userId: row.user_id, displayName: row.display_name, avatarUrl: row.avatar_url, primary: row.is_primary,
	});
	for (const row of reports.rows) if (byTopic.has(row.topic_id)) byTopic.get(row.topic_id).latestReport = reportRow(row);
	const denominator = topicList.reduce((sum, item) => sum + item.weight, 0);
	project.topicCount = topicList.length;
	project.progress = denominator ? Math.round(topicList.reduce((sum, item) => sum + item.progress * item.weight, 0) / denominator) : 0;
	return {
		project,
		me: { userId, role: project.role },
		members: members.rows.map(memberRow),
		topics: topicList,
		archivedTopics: archivedTopicList,
		events: events.rows.map(eventRow),
		ownershipTransfer: ownershipTransferRow(transfer.rows[0]),
		notificationSettings: notificationSettingsRow(notificationSetting.rows[0]),
		dependencies: dependencies.rows.map(dependencyRow),
		milestones: milestones.rows.map(milestoneRow),
	};
}

async function listProjectTopics(code, userId, { includeArchived = false } = {}) {
	const bundle = await getProjectByCode(code, userId);
	return { topics: includeArchived ? [...bundle.topics, ...bundle.archivedTopics] : bundle.topics };
}

async function getProjectTopic(code, topicId, userId) {
	const bundle = await getProjectByCode(code, userId);
	const topic = [...bundle.topics, ...bundle.archivedTopics].find(item => item.id === topicId);
	if (!topic) throw codedError('topic_not_found');
	return { topic };
}

async function addEvent(client, projectId, topicId, actorUserId, type, payload) {
	await client.query(
		'INSERT INTO project_events (id, project_id, topic_id, actor_user_id, event_type, payload) VALUES ($1,$2,$3,$4,$5,$6)',
		[newId('pev'), projectId, topicId, actorUserId, type, payload],
	);
}

async function listProjectEvents(code, actorUserId, options = {}) {
	const project = await accessByCode({ query }, code, actorUserId);
	const cursor = parseHistoryCursor(options.cursor);
	const limit = historyLimit(options.limit);
	const result = await query(
		`SELECT e.id, e.topic_id, e.actor_user_id, e.event_type, e.payload, e.created_at,
		 u.display_name AS actor_name FROM project_events e LEFT JOIN users u ON u.id=e.actor_user_id
		 WHERE e.project_id=$1 AND ($2::timestamptz IS NULL OR (e.created_at, e.id) < ($2::timestamptz, $3::text))
		 ORDER BY e.created_at DESC, e.id DESC LIMIT $4`,
		[project.id, cursor?.at || null, cursor?.id || '', limit + 1],
	);
	const hasMore = result.rows.length > limit;
	const rows = result.rows.slice(0, limit);
	return { events: rows.map(eventRow), nextCursor: hasMore ? historyCursor(rows.at(-1)) : null };
}

async function getProjectNotificationSettings(code, actorUserId) {
	const project = await accessByCode({ query }, code, actorUserId);
	const [result, failure] = await Promise.all([
		query('SELECT * FROM project_notification_settings WHERE project_id=$1', [project.id]),
		query(`SELECT channel, status, last_error, next_attempt_at, created_at FROM (
		 SELECT d.channel, d.status, d.last_error, d.next_attempt_at, d.created_at, d.id
		 FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id
		 WHERE e.payload->>'projectId'=$1
		 UNION ALL
		 SELECT 'discord_channel' AS channel, d.status, d.last_error, d.next_attempt_at, d.created_at, d.id
		 FROM project_channel_deliveries d WHERE d.project_id=$1
		 ) deliveries ORDER BY created_at DESC, id DESC LIMIT 1`, [project.id]),
	]);
	return {
		settings: notificationSettingsRow(result.rows[0]), canManage: project.role === 'owner',
		lastFailure: failure.rows[0]?.last_error && ['failed', 'skipped'].includes(failure.rows[0].status) ? {
			channel: failure.rows[0].channel, status: failure.rows[0].status,
			error: failure.rows[0].last_error, nextAttemptAt: failure.rows[0].next_attempt_at,
			createdAt: failure.rows[0].created_at,
		} : null,
	};
}

async function updateProjectNotificationSettings(code, actorUserId, input = {}) {
	assertKnownFields(input, ['enabled', 'blockerNotifications', 'reminder48h', 'reminder24h', 'channelEnabled', 'guildId', 'channelId', 'channelName', 'dmEnabled', 'expectedRevision']);
	return transaction(async client => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		if (project.role !== 'owner') throw codedError('project_forbidden');
		if (Number(input.expectedRevision) !== project.revision) throw codedError('revision_conflict');
		const enabled = input.enabled === true;
		const blockerNotifications = enabled && input.blockerNotifications === true;
		const reminder48h = enabled && input.reminder48h === true;
		const reminder24h = enabled && input.reminder24h === true;
		const channelEnabled = enabled && input.channelEnabled === true;
		const guildId = channelEnabled ? requiredText(input.guildId, 'guild_id', 20) : null;
		const channelId = channelEnabled ? requiredText(input.channelId, 'channel_id', 20) : null;
		const channelName = channelEnabled ? requiredText(input.channelName, 'channel_name', 100) : null;
		if (channelEnabled && (!/^\d{17,20}$/.test(guildId) || !/^\d{17,20}$/.test(channelId))) throw codedError('project_channel_invalid');
		const result = await client.query(
			`INSERT INTO project_notification_settings (project_id, enabled, blocker_notifications, reminder_48h, reminder_24h,
			 channel_enabled, guild_id, channel_id, channel_name, updated_by_user_id, dm_enabled)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (project_id) DO UPDATE SET
			 enabled=EXCLUDED.enabled, dm_enabled=EXCLUDED.dm_enabled, blocker_notifications=EXCLUDED.blocker_notifications,
			 reminder_48h=EXCLUDED.reminder_48h, reminder_24h=EXCLUDED.reminder_24h,
			 channel_enabled=EXCLUDED.channel_enabled, guild_id=EXCLUDED.guild_id,
			 channel_id=EXCLUDED.channel_id, channel_name=EXCLUDED.channel_name,
			 updated_by_user_id=EXCLUDED.updated_by_user_id, updated_at=now() RETURNING *`,
			[project.id, enabled, blockerNotifications, reminder48h, reminder24h, channelEnabled, guildId, channelId, channelName, actorUserId, input.dmEnabled !== false],
		);
		await projectReminders.rebuildForProjectWithClient(client, project.id);
		const updated = await client.query('UPDATE projects SET revision=revision+1, updated_at=now() WHERE id=$1 RETURNING revision', [project.id]);
		await addEvent(client, project.id, null, actorUserId, 'notification_settings_changed', { enabled, blockerNotifications, reminder48h, reminder24h, channelEnabled, guildId, channelId });
		return { settings: notificationSettingsRow(result.rows[0]), projectRevision: updated.rows[0].revision };
	});
}

const DEPENDENCY_SELECT = `SELECT d.*, predecessor.topic_no AS predecessor_topic_no,
 predecessor.title AS predecessor_title, predecessor.deadline_at AS predecessor_deadline_at,
 successor.topic_no AS successor_topic_no, successor.title AS successor_title,
 successor.starts_at AS successor_starts_at
 FROM project_dependencies d
 JOIN project_topics predecessor ON predecessor.project_id=d.project_id AND predecessor.id=d.predecessor_topic_id
 JOIN project_topics successor ON successor.project_id=d.project_id AND successor.id=d.successor_topic_id`;

function dependencyCreatesCycle(edges, predecessorId, successorId) {
	const outgoing = new Map();
	for (const edge of edges) {
		const list = outgoing.get(edge.predecessor_topic_id) || [];
		list.push(edge.successor_topic_id);
		outgoing.set(edge.predecessor_topic_id, list);
	}
	const pending = [successorId];
	const seen = new Set();
	while (pending.length) {
		const current = pending.pop();
		if (current === predecessorId) return true;
		if (seen.has(current)) continue;
		seen.add(current);
		pending.push(...(outgoing.get(current) || []));
	}
	return false;
}

async function createDependency(code, actorUserId, input = {}) {
	assertKnownFields(input, ['predecessorTopicId', 'successorTopicId', 'expectedRevision']);
	const predecessorTopicId = text(input.predecessorTopicId);
	const successorTopicId = text(input.successorTopicId);
	if (!predecessorTopicId || !successorTopicId) throw codedError('dependency_topics_required');
	if (predecessorTopicId === successorTopicId) throw codedError('dependency_self');
	return transaction(async client => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		assertLead(project);
		if (['completed', 'cancelled'].includes(project.status)) throw codedError('project_closed');
		if (Number(input.expectedRevision) !== project.revision) throw codedError('revision_conflict');
		const topics = await client.query(
			'SELECT id FROM project_topics WHERE project_id=$1 AND id=ANY($2::text[]) AND archived_at IS NULL',
			[project.id, [predecessorTopicId, successorTopicId]],
		);
		if (topics.rows.length !== 2) throw codedError('dependency_topic_invalid');
		const edges = await client.query('SELECT predecessor_topic_id, successor_topic_id FROM project_dependencies WHERE project_id=$1', [project.id]);
		if (edges.rows.some(edge => edge.predecessor_topic_id === predecessorTopicId && edge.successor_topic_id === successorTopicId)) {
			throw codedError('dependency_exists');
		}
		if (dependencyCreatesCycle(edges.rows, predecessorTopicId, successorTopicId)) throw codedError('dependency_cycle');
		const id = newId('pdp');
		await client.query(
			'INSERT INTO project_dependencies (id, project_id, predecessor_topic_id, successor_topic_id) VALUES ($1,$2,$3,$4)',
			[id, project.id, predecessorTopicId, successorTopicId],
		);
		const result = await client.query(`${DEPENDENCY_SELECT} WHERE d.project_id=$1 AND d.id=$2`, [project.id, id]);
		const updated = await client.query('UPDATE projects SET revision=revision+1, updated_at=now() WHERE id=$1 RETURNING revision', [project.id]);
		await addEvent(client, project.id, null, actorUserId, 'dependency_added', { id, predecessorTopicId, successorTopicId });
		return { dependency: dependencyRow(result.rows[0]), projectRevision: updated.rows[0].revision };
	});
}

async function removeDependency(code, dependencyId, actorUserId, input = {}) {
	assertKnownFields(input, ['expectedRevision']);
	return transaction(async client => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		assertLead(project);
		if (['completed', 'cancelled'].includes(project.status)) throw codedError('project_closed');
		if (Number(input.expectedRevision) !== project.revision) throw codedError('revision_conflict');
		const removed = await client.query(
			'DELETE FROM project_dependencies WHERE project_id=$1 AND id=$2 RETURNING id, predecessor_topic_id, successor_topic_id',
			[project.id, dependencyId],
		);
		if (!removed.rows[0]) throw codedError('dependency_not_found');
		const updated = await client.query('UPDATE projects SET revision=revision+1, updated_at=now() WHERE id=$1 RETURNING revision', [project.id]);
		await addEvent(client, project.id, null, actorUserId, 'dependency_removed', removed.rows[0]);
		return { removed: true, projectRevision: updated.rows[0].revision };
	});
}

async function listMilestones(code, actorUserId) {
	const project = await accessByCode({ query }, code, actorUserId);
	const result = await query('SELECT * FROM project_milestones WHERE project_id=$1 ORDER BY due_at, id', [project.id]);
	return { milestones: result.rows.map(milestoneRow), projectRevision: project.revision };
}

async function createMilestone(code, actorUserId, input = {}) {
	assertKnownFields(input, ['title', 'dueAt', 'duePrecision', 'expectedRevision']);
	const title = requiredText(input.title, 'milestone_title', 120);
	return transaction(async client => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		assertLead(project);
		if (['completed', 'cancelled'].includes(project.status)) throw codedError('project_closed');
		if (Number(input.expectedRevision) !== project.revision) throw codedError('revision_conflict');
		const count = await client.query('SELECT count(*)::int AS n FROM project_milestones WHERE project_id=$1', [project.id]);
		if (count.rows[0].n >= 100) throw codedError('milestone_limit');
		const duePrecision = input.duePrecision === 'instant' ? 'instant' : 'date';
		const dueAt = instant(input.dueAt, 'due_at', duePrecision, project.timezone);
		if (!dueAt) throw codedError('milestone_due_required');
		const id = newId('pms');
		const inserted = await client.query(
			`INSERT INTO project_milestones (id, project_id, title, due_at, due_precision)
			 VALUES ($1,$2,$3,$4,$5) RETURNING *`,
			[id, project.id, title, dueAt, duePrecision],
		);
		const updated = await client.query('UPDATE projects SET revision=revision+1, updated_at=now() WHERE id=$1 RETURNING revision', [project.id]);
		await addEvent(client, project.id, null, actorUserId, 'milestone_created', { milestoneId: id, title, dueAt });
		return { milestone: milestoneRow(inserted.rows[0]), projectRevision: updated.rows[0].revision };
	});
}

async function updateMilestone(code, milestoneId, actorUserId, input = {}) {
	assertKnownFields(input, ['title', 'dueAt', 'duePrecision', 'state', 'expectedRevision']);
	return transaction(async client => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		assertLead(project);
		if (['completed', 'cancelled'].includes(project.status)) throw codedError('project_closed');
		const found = await client.query('SELECT * FROM project_milestones WHERE project_id=$1 AND id=$2 FOR UPDATE', [project.id, milestoneId]);
		const milestone = milestoneRow(found.rows[0]);
		if (!milestone) throw codedError('milestone_not_found');
		if (Number(input.expectedRevision) !== milestone.revision) throw codedError('revision_conflict');
		const title = input.title == null ? milestone.title : requiredText(input.title, 'milestone_title', 120);
		const duePrecision = input.dueAt === undefined ? milestone.duePrecision : (input.duePrecision === 'instant' ? 'instant' : 'date');
		const dueAt = input.dueAt === undefined ? milestone.dueAt : instant(input.dueAt, 'due_at', duePrecision, project.timezone);
		if (!dueAt) throw codedError('milestone_due_required');
		const state = input.state == null ? milestone.state : text(input.state);
		if (!['open', 'reached'].includes(state)) throw codedError('milestone_state_invalid');
		const result = await client.query(
			`UPDATE project_milestones SET title=$3, due_at=$4, due_precision=$5, state=$6,
			 reached_at=CASE WHEN $6='reached' THEN COALESCE(reached_at, now()) ELSE NULL END,
			 revision=revision+1, updated_at=now() WHERE project_id=$1 AND id=$2 RETURNING *`,
			[project.id, milestoneId, title, dueAt, duePrecision, state],
		);
		await client.query('UPDATE projects SET revision=revision+1, updated_at=now() WHERE id=$1', [project.id]);
		await addEvent(client, project.id, null, actorUserId, 'milestone_updated', { milestoneId, title, dueAt, from: milestone.state, to: state });
		return { milestone: milestoneRow(result.rows[0]) };
	});
}

async function removeMilestone(code, milestoneId, actorUserId, input = {}) {
	assertKnownFields(input, ['expectedRevision']);
	return transaction(async client => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		assertLead(project);
		if (['completed', 'cancelled'].includes(project.status)) throw codedError('project_closed');
		const found = await client.query('SELECT * FROM project_milestones WHERE project_id=$1 AND id=$2 FOR UPDATE', [project.id, milestoneId]);
		const milestone = milestoneRow(found.rows[0]);
		if (!milestone) throw codedError('milestone_not_found');
		if (Number(input.expectedRevision) !== milestone.revision) throw codedError('revision_conflict');
		await client.query('DELETE FROM project_milestones WHERE project_id=$1 AND id=$2', [project.id, milestoneId]);
		const updated = await client.query('UPDATE projects SET revision=revision+1, updated_at=now() WHERE id=$1 RETURNING revision', [project.id]);
		await addEvent(client, project.id, null, actorUserId, 'milestone_removed', { milestoneId, title: milestone.title });
		return { removed: true, projectRevision: updated.rows[0].revision };
	});
}

async function updateProject(code, actorUserId, input = {}) {
	assertKnownFields(input, ['title', 'description', 'timezone', 'timezoneChangeMode', 'startsAt', 'startsPrecision', 'deadlineAt', 'deadlinePrecision', 'expectedRevision']);
	return transaction(async client => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		assertLead(project);
		if (['completed', 'cancelled'].includes(project.status)) throw codedError('project_closed');
		if (Number(input.expectedRevision) !== project.revision) throw codedError('revision_conflict');
		const nextTimezone = input.timezone == null ? project.timezone : timezone(input.timezone);
		const timezoneChanged = nextTimezone !== project.timezone;
		const timezoneChangeMode = text(input.timezoneChangeMode);
		if (timezoneChanged && !['keep_instants', 'keep_local'].includes(timezoneChangeMode)) throw codedError('timezone_change_mode_required');
		const title = input.title == null ? project.title : requiredText(input.title, 'title', 120);
		const description = input.description == null ? project.description : optionalText(input.description, 'description', 4000);
		let startsAt = input.startsAt === undefined ? project.startsAt : instant(input.startsAt, 'starts_at', input.startsAt ? (input.startsPrecision === 'instant' ? 'instant' : 'date') : null, nextTimezone);
		let deadlineAt = input.deadlineAt === undefined ? project.deadlineAt : instant(input.deadlineAt, 'deadline_at', input.deadlineAt ? (input.deadlinePrecision === 'instant' ? 'instant' : 'date') : null, nextTimezone);
		if (timezoneChanged && timezoneChangeMode === 'keep_local') {
			if (input.startsAt === undefined) startsAt = rezoneInstant(project.startsAt, project.startsPrecision, project.timezone, nextTimezone, false);
			if (input.deadlineAt === undefined) deadlineAt = rezoneInstant(project.deadlineAt, project.deadlinePrecision, project.timezone, nextTimezone, true);
		}
		if (startsAt && deadlineAt && new Date(startsAt) > new Date(deadlineAt)) throw codedError('date_order_invalid');
		const startsPrecision = input.startsAt === undefined ? project.startsPrecision : (input.startsAt ? (input.startsPrecision === 'instant' ? 'instant' : 'date') : null);
		const deadlinePrecision = input.deadlineAt === undefined ? project.deadlinePrecision : (input.deadlineAt ? (input.deadlinePrecision === 'instant' ? 'instant' : 'date') : null);
		const result = await client.query(
			`UPDATE projects SET title=$2, description=$3, starts_at=$4, starts_precision=$5,
			 deadline_at=$6, deadline_precision=$7, timezone=$8, revision=revision+1, updated_at=now()
			 WHERE id=$1 RETURNING *`,
			[project.id, title, description, startsAt, startsPrecision, deadlineAt, deadlinePrecision, nextTimezone],
		);
		if (timezoneChanged && timezoneChangeMode === 'keep_local') {
			const topics = await client.query('SELECT * FROM project_topics WHERE project_id=$1 FOR UPDATE', [project.id]);
			for (const topic of topics.rows) {
				const topicStart = rezoneInstant(topic.starts_at, topic.starts_precision, project.timezone, nextTimezone, false);
				const topicDeadline = rezoneInstant(topic.deadline_at, topic.deadline_precision, project.timezone, nextTimezone, true);
				await client.query('UPDATE project_topics SET starts_at=$3, deadline_at=$4, schedule_revision=schedule_revision+1, revision=revision+1, updated_at=now() WHERE project_id=$1 AND id=$2', [project.id, topic.id, topicStart, topicDeadline]);
			}
			const milestones = await client.query('SELECT * FROM project_milestones WHERE project_id=$1 FOR UPDATE', [project.id]);
			for (const milestone of milestones.rows) {
				const dueAt = rezoneInstant(milestone.due_at, milestone.due_precision, project.timezone, nextTimezone, true);
				await client.query('UPDATE project_milestones SET due_at=$3, revision=revision+1, updated_at=now() WHERE project_id=$1 AND id=$2', [project.id, milestone.id, dueAt]);
			}
			await projectReminders.rebuildForProjectWithClient(client, project.id);
		}
		await addEvent(client, project.id, null, actorUserId, timezoneChanged ? 'project_timezone_changed' : 'project_updated', { title, startsAt, deadlineAt, fromTimezone: project.timezone, timezone: nextTimezone, mode: timezoneChanged ? timezoneChangeMode : null });
		return projectRow({ ...result.rows[0], role: project.role });
	});
}

async function listTopicReports(code, topicId, actorUserId, options = {}) {
	const project = await accessByCode({ query }, code, actorUserId);
	const topic = await query('SELECT id FROM project_topics WHERE project_id=$1 AND id=$2', [project.id, topicId]);
	if (!topic.rows[0]) throw codedError('topic_not_found');
	const cursor = parseHistoryCursor(options.cursor);
	const limit = historyLimit(options.limit);
	const result = await query(
		`SELECT r.*, u.display_name AS author_name, COALESCE((SELECT NULLIF(i.avatar_url, '') FROM identities i WHERE i.user_id = u.id AND i.provider = 'discord' ORDER BY i.id LIMIT 1), u.avatar_url) AS author_avatar_url FROM project_progress_reports r JOIN users u ON u.id=r.author_user_id
		 WHERE r.project_id=$1 AND r.topic_id=$2
		 AND ($3::timestamptz IS NULL OR (r.created_at, r.id) < ($3::timestamptz, $4::text))
		 ORDER BY r.created_at DESC, r.id DESC LIMIT $5`,
		[project.id, topicId, cursor?.at || null, cursor?.id || '', limit + 1],
	);
	const hasMore = result.rows.length > limit;
	const rows = result.rows.slice(0, limit);
	return { reports: rows.map(reportRow), nextCursor: hasMore ? historyCursor(rows.at(-1)) : null };
}

async function updateTopic(code, topicId, actorUserId, input = {}) {
	assertKnownFields(input, ['title', 'description', 'startsAt', 'startsPrecision', 'deadlineAt', 'deadlinePrecision', 'position', 'archived', 'acknowledgeProjectDeadline', 'expectedRevision']);
	return transaction(async client => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		assertLead(project);
		if (['completed', 'cancelled'].includes(project.status)) throw codedError('project_closed');
		const found = await client.query('SELECT * FROM project_topics WHERE project_id=$1 AND id=$2 FOR UPDATE', [project.id, topicId]);
		const topic = topicRow(found.rows[0]);
		if (!topic) throw codedError('topic_not_found');
		if (Number(input.expectedRevision) !== topic.revision) throw codedError('revision_conflict');
		const title = input.title == null ? topic.title : requiredText(input.title, 'topic_title', 120);
		const description = input.description == null ? topic.description : optionalText(input.description, 'description', 4000);
		const startsAt = input.startsAt === undefined ? topic.startsAt : instant(input.startsAt, 'starts_at', input.startsAt ? (input.startsPrecision === 'instant' ? 'instant' : 'date') : null, project.timezone);
		const deadlineAt = input.deadlineAt === undefined ? topic.deadlineAt : instant(input.deadlineAt, 'deadline_at', input.deadlineAt ? (input.deadlinePrecision === 'instant' ? 'instant' : 'date') : null, project.timezone);
		if (startsAt && deadlineAt && new Date(startsAt) > new Date(deadlineAt)) throw codedError('date_order_invalid');
		if (deadlineAt && project.deadlineAt && new Date(deadlineAt) > new Date(project.deadlineAt) && input.acknowledgeProjectDeadline !== true) throw codedError('topic_deadline_override_required');
		const startsPrecision = input.startsAt === undefined ? topic.startsPrecision : (input.startsAt ? (input.startsPrecision === 'instant' ? 'instant' : 'date') : null);
		const deadlinePrecision = input.deadlineAt === undefined ? topic.deadlinePrecision : (input.deadlineAt ? (input.deadlinePrecision === 'instant' ? 'instant' : 'date') : null);
		const position = input.position === undefined ? topic.position : Number(input.position);
		if (!Number.isInteger(position) || position < 0) throw codedError('topic_position_invalid');
		const archivedAt = input.archived === undefined ? topic.archivedAt : input.archived ? new Date().toISOString() : null;
		const result = await client.query(
			`UPDATE project_topics SET title=$3, description=$4, starts_at=$5, starts_precision=$6,
			 deadline_at=$7, deadline_precision=$8, archived_at=$9, position=$10,
			 schedule_revision=schedule_revision + CASE
			  WHEN starts_at IS DISTINCT FROM $5::timestamptz OR starts_precision IS DISTINCT FROM $6::text
			    OR deadline_at IS DISTINCT FROM $7::timestamptz OR deadline_precision IS DISTINCT FROM $8::text
			  THEN 1 ELSE 0 END,
			 revision=revision+1, updated_at=now()
			 WHERE project_id=$1 AND id=$2 RETURNING *`,
			[project.id, topic.id, title, description, startsAt, startsPrecision, deadlineAt, deadlinePrecision, archivedAt, position],
		);
		await projectReminders.rebuildForTopicWithClient(client, project.id, topic.id);
		await client.query('UPDATE projects SET revision=revision+1, updated_at=now() WHERE id=$1', [project.id]);
		await addEvent(client, project.id, topic.id, actorUserId, input.archived === undefined ? 'topic_updated' : input.archived ? 'topic_archived' : 'topic_restored', { title, startsAt, deadlineAt, position, afterProjectTarget: Boolean(deadlineAt && project.deadlineAt && new Date(deadlineAt) > new Date(project.deadlineAt)) });
		return { topic: topicRow(result.rows[0]) };
	});
}

function assertLead(project) {
	if (!LEAD_ROLES.has(project.role)) throw codedError('project_forbidden');
}

function normaliseInviteRecipient(input = {}) {
	const provider = text(input.provider).toLowerCase();
	if (!['discord', 'email'].includes(provider)) throw codedError('invitation_provider_invalid');
	const recipient = text(input.recipient).toLowerCase();
	if (provider === 'discord' && !/^\d{17,20}$/.test(recipient)) throw codedError('invitation_recipient_invalid');
	if (provider === 'email' && (recipient.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))) {
		throw codedError('invitation_recipient_invalid');
	}
	return { provider, recipient };
}

function invitationToken() {
	return crypto.randomBytes(32).toString('base64url');
}

function invitationHash(token) {
	return crypto.createHash('sha256').update(token).digest('hex');
}

async function knownRecipientUserId(client, provider, recipient) {
	const result = provider === 'discord'
		? await client.query("SELECT user_id FROM identities WHERE provider='discord' AND provider_uid=$1", [recipient])
		: await client.query('SELECT user_id FROM identities WHERE lower(email)=$1 AND email_verified=true ORDER BY created_at LIMIT 1', [recipient]);
	return result.rows[0]?.user_id || null;
}

async function listProjectMembers(code, actorUserId) {
	const project = await accessByCode({ query }, code, actorUserId);
	const result = await query(
		`SELECT m.user_id, m.role, m.created_at, u.display_name, COALESCE((SELECT NULLIF(i.avatar_url, '') FROM identities i WHERE i.user_id = u.id AND i.provider = 'discord' ORDER BY i.id LIMIT 1), u.avatar_url) AS avatar_url
		 FROM project_memberships m JOIN users u ON u.id=m.user_id
		 WHERE m.project_id=$1 AND m.revoked_at IS NULL
		 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'lead' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, lower(u.display_name), u.id`,
		[project.id],
	);
	return { project: { code: project.code, role: project.role, revision: project.revision }, members: result.rows.map(memberRow) };
}

async function listProjectInvitations(code, actorUserId) {
	const project = await accessByCode({ query }, code, actorUserId);
	assertLead(project);
	const result = await query(
		`SELECT i.*, u.display_name AS inviter_name FROM project_invitations i
		 JOIN users u ON u.id=i.inviter_user_id
		 WHERE i.project_id=$1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
		 ORDER BY i.created_at DESC, i.id DESC`,
		[project.id],
	);
	return { invitations: result.rows.map(invitationRow) };
}

async function createInvitation(code, actorUserId, input = {}) {
	assertKnownFields(input, ['provider', 'recipient', 'role']);
	const { provider, recipient } = normaliseInviteRecipient(input);
	const role = text(input.role) || 'member';
	if (!['lead', 'member', 'viewer'].includes(role)) throw codedError('invitation_role_invalid');
	return transaction(async (client) => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		assertLead(project);
		if (project.role === 'lead' && role === 'lead') throw codedError('project_forbidden');
		if (['completed', 'cancelled'].includes(project.status)) throw codedError('project_closed');
		const active = await client.query('SELECT count(*)::int AS n FROM project_memberships WHERE project_id=$1 AND revoked_at IS NULL', [project.id]);
		if (active.rows[0].n >= 50) throw codedError('member_limit');
		const recipientUserId = await knownRecipientUserId(client, provider, recipient);
		if (recipientUserId) {
			const existing = await client.query('SELECT 1 FROM project_memberships WHERE project_id=$1 AND user_id=$2 AND revoked_at IS NULL', [project.id, recipientUserId]);
			if (existing.rows[0]) throw codedError('member_exists');
		}
		await client.query(
			`UPDATE project_invitations SET revoked_at=now()
			 WHERE project_id=$1 AND recipient_provider=$2 AND recipient_value=$3
			   AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= now()`,
			[project.id, provider, recipient],
		);
		const pending = await client.query(
			`SELECT 1 FROM project_invitations WHERE project_id=$1 AND recipient_provider=$2 AND recipient_value=$3
			 AND accepted_at IS NULL AND revoked_at IS NULL`,
			[project.id, provider, recipient],
		);
		if (pending.rows[0]) throw codedError('invitation_pending');
		const token = invitationToken();
		const inserted = await client.query(
			`INSERT INTO project_invitations
			 (id, project_id, inviter_user_id, recipient_user_id, recipient_provider, recipient_value, role, token_hash, expires_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now() + interval '7 days') RETURNING *`,
			[newId('pin'), project.id, actorUserId, recipientUserId, provider, recipient, role, invitationHash(token)],
		);
		await addEvent(client, project.id, null, actorUserId, 'member_invited', { invitationId: inserted.rows[0].id, role, provider });
		return { invitation: invitationRow(inserted.rows[0]), token };
	});
}

async function revokeInvitation(code, invitationId, actorUserId) {
	return transaction(async (client) => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		assertLead(project);
		const found = await client.query('SELECT * FROM project_invitations WHERE project_id=$1 AND id=$2 FOR UPDATE', [project.id, invitationId]);
		const invitation = found.rows[0];
		if (!invitation || invitation.accepted_at || invitation.revoked_at) throw codedError('invitation_not_found');
		if (project.role === 'lead' && invitation.role === 'lead') throw codedError('project_forbidden');
		await client.query('UPDATE project_invitations SET revoked_at=now() WHERE id=$1', [invitation.id]);
		await addEvent(client, project.id, null, actorUserId, 'invitation_revoked', { invitationId: invitation.id, role: invitation.role });
		return { revoked: true };
	});
}

async function proposeOwnershipTransfer(code, actorUserId, input = {}) {
	assertKnownFields(input, ['proposedOwnerId', 'expectedRevision']);
	const proposedOwnerId = requiredText(input.proposedOwnerId, 'proposed_owner_id', 100);
	return transaction(async client => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		if (project.role !== 'owner') throw codedError('project_forbidden');
		if (Number(input.expectedRevision) !== project.revision) throw codedError('revision_conflict');
		if (proposedOwnerId === actorUserId) throw codedError('ownership_transfer_self');
		const member = await client.query('SELECT role FROM project_memberships WHERE project_id=$1 AND user_id=$2 AND revoked_at IS NULL FOR UPDATE', [project.id, proposedOwnerId]);
		if (!member.rows[0]) throw codedError('member_not_found');
		await client.query(`UPDATE project_ownership_transfers SET cancelled_at=now()
			WHERE project_id=$1 AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at <= now()`, [project.id]);
		const pending = await client.query('SELECT 1 FROM project_ownership_transfers WHERE project_id=$1 AND accepted_at IS NULL AND cancelled_at IS NULL', [project.id]);
		if (pending.rows[0]) throw codedError('ownership_transfer_pending');
		const result = await client.query(
			`INSERT INTO project_ownership_transfers (id, project_id, current_owner_id, proposed_owner_id, expires_at)
			 VALUES ($1,$2,$3,$4,now() + interval '7 days') RETURNING *`,
			[newId('pot'), project.id, actorUserId, proposedOwnerId],
		);
		const updated = await client.query('UPDATE projects SET revision=revision+1, updated_at=now() WHERE id=$1 RETURNING revision', [project.id]);
		await addEvent(client, project.id, null, actorUserId, 'ownership_transfer_proposed', { proposedOwnerId });
		return { transfer: ownershipTransferRow(result.rows[0]), projectRevision: updated.rows[0].revision };
	});
}

async function cancelOwnershipTransfer(code, transferId, actorUserId) {
	return transaction(async client => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		if (project.role !== 'owner') throw codedError('project_forbidden');
		const found = await client.query('SELECT * FROM project_ownership_transfers WHERE project_id=$1 AND id=$2 FOR UPDATE', [project.id, transferId]);
		const transfer = found.rows[0];
		if (!transfer || transfer.accepted_at || transfer.cancelled_at) throw codedError('ownership_transfer_not_found');
		if (transfer.current_owner_id !== actorUserId) throw codedError('project_forbidden');
		await client.query('UPDATE project_ownership_transfers SET cancelled_at=now() WHERE id=$1', [transfer.id]);
		const updated = await client.query('UPDATE projects SET revision=revision+1, updated_at=now() WHERE id=$1 RETURNING revision', [project.id]);
		await addEvent(client, project.id, null, actorUserId, 'ownership_transfer_cancelled', { proposedOwnerId: transfer.proposed_owner_id });
		return { cancelled: true, projectRevision: updated.rows[0].revision };
	});
}

async function acceptOwnershipTransfer(code, transferId, actorUserId) {
	return transaction(async client => {
		const found = await client.query(
			`SELECT ot.*, p.code, p.owner_user_id FROM project_ownership_transfers ot
			 JOIN projects p ON p.id=ot.project_id WHERE p.code=$1 AND ot.id=$2 FOR UPDATE OF ot, p`,
			[String(code || '').toUpperCase(), transferId],
		);
		const transfer = found.rows[0];
		if (!transfer) throw codedError('project_not_found');
		if (transfer.proposed_owner_id !== actorUserId) throw codedError('project_not_found');
		if (transfer.accepted_at || transfer.cancelled_at) throw codedError('ownership_transfer_not_found');
		if (new Date(transfer.expires_at).getTime() <= Date.now()) throw codedError('ownership_transfer_expired');
		if (transfer.owner_user_id !== transfer.current_owner_id) throw codedError('ownership_transfer_stale');
		const recipient = await client.query('SELECT 1 FROM project_memberships WHERE project_id=$1 AND user_id=$2 AND revoked_at IS NULL FOR UPDATE', [transfer.project_id, actorUserId]);
		if (!recipient.rows[0]) throw codedError('project_not_found');
		await client.query("UPDATE project_memberships SET role='lead' WHERE project_id=$1 AND user_id=$2", [transfer.project_id, transfer.current_owner_id]);
		await client.query("UPDATE project_memberships SET role='owner' WHERE project_id=$1 AND user_id=$2", [transfer.project_id, actorUserId]);
		const projectResult = await client.query('UPDATE projects SET owner_user_id=$2, revision=revision+1, updated_at=now() WHERE id=$1 RETURNING *', [transfer.project_id, actorUserId]);
		await client.query('UPDATE project_ownership_transfers SET accepted_at=now() WHERE id=$1', [transfer.id]);
		await addEvent(client, transfer.project_id, null, actorUserId, 'ownership_transferred', { previousOwnerId: transfer.current_owner_id });
		return { project: projectRow({ ...projectResult.rows[0], role: 'owner' }) };
	});
}

async function acceptInvitation(tokenValue, actorUserId) {
	const token = requiredText(tokenValue, 'invitation_token', 200);
	return transaction(async (client) => {
		const result = await client.query(
			`SELECT i.*, p.code, p.status FROM project_invitations i
			 JOIN projects p ON p.id=i.project_id WHERE i.token_hash=$1 FOR UPDATE OF i, p`,
			[invitationHash(token)],
		);
		const invitation = result.rows[0];
		if (!invitation) throw codedError('invitation_not_found');
		if (invitation.revoked_at) throw codedError('invitation_revoked');
		if (invitation.accepted_at) throw codedError('invitation_used');
		if (new Date(invitation.expires_at).getTime() <= Date.now()) throw codedError('invitation_expired');
		if (['completed', 'cancelled'].includes(invitation.status)) throw codedError('project_closed');
		const identities = await client.query('SELECT provider, provider_uid, email, email_verified FROM identities WHERE user_id=$1', [actorUserId]);
		const matches = invitation.recipient_user_id
			? invitation.recipient_user_id === actorUserId
			: identities.rows.some(identity => invitation.recipient_provider === 'discord'
				? identity.provider === 'discord' && String(identity.provider_uid) === invitation.recipient_value
				: identity.email_verified && String(identity.email || '').toLowerCase() === invitation.recipient_value);
		if (!matches) throw codedError('invitation_recipient_mismatch');
		const memberCount = await client.query('SELECT count(*)::int AS n FROM project_memberships WHERE project_id=$1 AND revoked_at IS NULL', [invitation.project_id]);
		if (memberCount.rows[0].n >= 50) throw codedError('member_limit');
		const existing = await client.query('SELECT role, revoked_at FROM project_memberships WHERE project_id=$1 AND user_id=$2 FOR UPDATE', [invitation.project_id, actorUserId]);
		if (existing.rows[0] && !existing.rows[0].revoked_at) throw codedError('member_exists');
		await client.query(
			`INSERT INTO project_memberships (project_id, user_id, role) VALUES ($1,$2,$3)
			 ON CONFLICT (project_id, user_id) DO UPDATE SET role=EXCLUDED.role, revoked_at=NULL, created_at=now()`,
			[invitation.project_id, actorUserId, invitation.role],
		);
		await client.query('UPDATE project_invitations SET accepted_by_user_id=$2, accepted_at=now() WHERE id=$1', [invitation.id, actorUserId]);
		await client.query('UPDATE projects SET revision=revision+1, updated_at=now() WHERE id=$1', [invitation.project_id]);
		await addEvent(client, invitation.project_id, null, actorUserId, 'member_joined', { role: invitation.role });
		return { project: { code: invitation.code }, member: { userId: actorUserId, role: invitation.role } };
	});
}

async function updateMemberRole(code, memberUserId, actorUserId, input = {}) {
	assertKnownFields(input, ['role', 'expectedRevision']);
	const role = text(input.role);
	if (!['lead', 'member', 'viewer'].includes(role)) throw codedError('member_role_invalid');
	return transaction(async (client) => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		assertLead(project);
		if (['completed', 'cancelled'].includes(project.status)) throw codedError('project_closed');
		if (input.expectedRevision != null && Number(input.expectedRevision) !== project.revision) throw codedError('revision_conflict');
		const found = await client.query('SELECT * FROM project_memberships WHERE project_id=$1 AND user_id=$2 AND revoked_at IS NULL FOR UPDATE', [project.id, memberUserId]);
		const member = found.rows[0];
		if (!member) throw codedError('member_not_found');
		if (member.role === 'owner' || (project.role === 'lead' && (member.role === 'lead' || role === 'lead'))) throw codedError('project_forbidden');
		await client.query('UPDATE project_memberships SET role=$3 WHERE project_id=$1 AND user_id=$2', [project.id, memberUserId, role]);
		if (role === 'viewer') await client.query('DELETE FROM project_topic_assignees WHERE project_id=$1 AND user_id=$2', [project.id, memberUserId]);
		const updated = await client.query('UPDATE projects SET revision=revision+1, updated_at=now() WHERE id=$1 RETURNING revision', [project.id]);
		await addEvent(client, project.id, null, actorUserId, 'member_role_changed', { userId: memberUserId, from: member.role, to: role });
		return { member: { userId: memberUserId, role }, projectRevision: updated.rows[0].revision };
	});
}

async function removeProjectMember(code, memberUserId, actorUserId, input = {}) {
	assertKnownFields(input, ['expectedRevision']);
	return transaction(async (client) => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		const selfLeave = actorUserId === memberUserId;
		if (!selfLeave) assertLead(project);
		if (input.expectedRevision != null && Number(input.expectedRevision) !== project.revision) throw codedError('revision_conflict');
		const found = await client.query('SELECT * FROM project_memberships WHERE project_id=$1 AND user_id=$2 AND revoked_at IS NULL FOR UPDATE', [project.id, memberUserId]);
		const member = found.rows[0];
		if (!member) throw codedError('member_not_found');
		if (member.role === 'owner' || (!selfLeave && project.role === 'lead' && member.role === 'lead')) throw codedError('project_forbidden');
		await client.query('DELETE FROM project_topic_assignees WHERE project_id=$1 AND user_id=$2', [project.id, memberUserId]);
		await client.query('UPDATE project_memberships SET revoked_at=now() WHERE project_id=$1 AND user_id=$2', [project.id, memberUserId]);
		const updated = await client.query('UPDATE projects SET revision=revision+1, updated_at=now() WHERE id=$1 RETURNING revision', [project.id]);
		await addEvent(client, project.id, null, actorUserId, selfLeave ? 'member_left' : 'member_removed', { userId: memberUserId, role: member.role });
		return { removed: true, projectRevision: updated.rows[0].revision };
	});
}

async function setTopicAssignees(code, topicId, actorUserId, input = {}) {
	assertKnownFields(input, ['userIds', 'primaryUserId', 'expectedRevision']);
	return transaction(async (client) => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		assertLead(project);
		if (['completed', 'cancelled'].includes(project.status)) throw codedError('project_closed');
		const topicResult = await client.query('SELECT * FROM project_topics WHERE project_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE', [project.id, topicId]);
		const topic = topicRow(topicResult.rows[0]);
		if (!topic) throw codedError('topic_not_found');
		if (Number(input.expectedRevision) !== topic.revision) throw codedError('revision_conflict');
		const ids = [...new Set(Array.isArray(input.userIds) ? input.userIds.map(text).filter(Boolean) : [])];
		if (ids.length > 50) throw codedError('assignee_limit');
		let valid = [];
		if (ids.length) {
			const members = await client.query(
				`SELECT user_id, role FROM project_memberships
				 WHERE project_id=$1 AND user_id=ANY($2::text[]) AND revoked_at IS NULL AND role <> 'viewer'`,
				[project.id, ids],
			);
			valid = members.rows.map(row => row.user_id);
			if (valid.length !== ids.length) throw codedError('assignee_invalid');
		}
		const requestedPrimary = text(input.primaryUserId);
		if (requestedPrimary && !ids.includes(requestedPrimary)) throw codedError('assignee_invalid');
		const primary = requestedPrimary || null;
		await client.query('DELETE FROM project_topic_assignees WHERE project_id=$1 AND topic_id=$2', [project.id, topic.id]);
		for (const userId of ids) await client.query(
			'INSERT INTO project_topic_assignees (project_id, topic_id, user_id, is_primary) VALUES ($1,$2,$3,$4)',
			[project.id, topic.id, userId, userId === primary],
		);
		const changed = await client.query('UPDATE project_topics SET revision=revision+1, updated_at=now() WHERE project_id=$1 AND id=$2 RETURNING *', [project.id, topic.id]);
		await client.query('UPDATE projects SET revision=revision+1, updated_at=now() WHERE id=$1', [project.id]);
		await addEvent(client, project.id, topic.id, actorUserId, 'assignments_changed', { userIds: ids, primaryUserId: primary });
		return { topic: topicRow(changed.rows[0]), assignees: ids.map(userId => ({ userId, primary: userId === primary })) };
	});
}

async function createTopic(code, actorUserId, input = {}) {
	assertKnownFields(input, ['title', 'description', 'startsAt', 'startsPrecision', 'deadlineAt', 'deadlinePrecision', 'acknowledgeProjectDeadline', 'assigneeUserIds', 'expectedRevision']);
	const title = requiredText(input.title, 'topic_title', 120);
	const description = optionalText(input.description, 'description', 4000);
	return transaction(async (client) => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		const schedule = dates(input, project.timezone);
		assertLead(project);
		if (['completed', 'cancelled'].includes(project.status)) throw codedError('project_closed');
		if (schedule.deadlineAt && project.deadlineAt && new Date(schedule.deadlineAt) > new Date(project.deadlineAt) && input.acknowledgeProjectDeadline !== true) throw codedError('topic_deadline_override_required');
		if (input.expectedRevision != null && Number(input.expectedRevision) !== project.revision) throw codedError('revision_conflict');
		const count = await client.query(`SELECT
			count(*) FILTER (WHERE archived_at IS NULL)::int AS active_count,
			COALESCE(max(topic_no), 0)::int AS last_number,
			COALESCE(max(position), -1)::int AS last_position
			FROM project_topics WHERE project_id = $1`, [project.id]);
		if (count.rows[0].active_count >= 100) throw codedError('topic_limit');
		const topic = {
			id: newId('top'), projectId: project.id, number: count.rows[0].last_number + 1,
			title, description, workflow: 'not_started', progress: 0, blocked: false,
			position: count.rows[0].last_position + 1, revision: 0, assignees: [], ...schedule,
		};
		await client.query(
			`INSERT INTO project_topics
			 (id, project_id, topic_no, title, description, starts_at, starts_precision, deadline_at, deadline_precision, position)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			[topic.id, project.id, topic.number, title, description, schedule.startsAt, schedule.startsPrecision, schedule.deadlineAt, schedule.deadlinePrecision, topic.position],
		);
		const assigneeIds = [...new Set(Array.isArray(input.assigneeUserIds) ? input.assigneeUserIds : [actorUserId])].slice(0, 50);
		for (const [index, userId] of assigneeIds.entries()) {
			const member = await client.query('SELECT role FROM project_memberships WHERE project_id = $1 AND user_id = $2 AND revoked_at IS NULL', [project.id, userId]);
			if (!member.rows[0] || member.rows[0].role === 'viewer') throw codedError('assignee_invalid');
			await client.query('INSERT INTO project_topic_assignees (project_id, topic_id, user_id, is_primary) VALUES ($1,$2,$3,$4)', [project.id, topic.id, userId, index === 0]);
			topic.assignees.push({ userId, primary: index === 0 });
		}
		await projectReminders.rebuildForTopicWithClient(client, project.id, topic.id);
		await addEvent(client, project.id, topic.id, actorUserId, 'topic_created', { title, number: topic.number, startsAt: schedule.startsAt, deadlineAt: schedule.deadlineAt, afterProjectTarget: Boolean(schedule.deadlineAt && project.deadlineAt && new Date(schedule.deadlineAt) > new Date(project.deadlineAt)) });
		const updated = await client.query('UPDATE projects SET revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING revision', [project.id]);
		return { topic, projectRevision: updated.rows[0].revision };
	});
}

function normaliseReport(input = {}) {
	const progress = Number(input.progress);
	if (!Number.isInteger(progress) || progress < 0 || progress > 99) throw codedError('progress_invalid');
	const summary = requiredText(input.summary, 'summary', 4000);
	const blocked = input.blocked === true;
	const blockerReason = blocked ? requiredText(input.blockerReason, 'blocker_reason', 1000) : null;
	if (blocked && input.requestReview) throw codedError('blocked_review_invalid');
	return { progress, summary, blocked, blockerReason, workflow: input.requestReview ? 'in_review' : progress === 0 ? 'not_started' : 'in_progress', notifyLeads: input.notifyLeads === true, correctionOfReportId: text(input.correctionOfReportId) || null };
}

function hashMutation(value) {
	return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function reportProgress(code, topicId, actorUserId, input = {}) {
	assertKnownFields(input, ['progress', 'summary', 'requestReview', 'blocked', 'blockerReason', 'reason', 'notifyLeads', 'correctionOfReportId', 'expectedRevision', 'idempotencyKey']);
	const report = normaliseReport(input);
	const key = requiredText(input.idempotencyKey, 'idempotency_key', 160);
	return transaction(async (client) => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		const requestHash = hashMutation({ topicId, ...report, expectedRevision: Number(input.expectedRevision) });
		const prior = await client.query('SELECT request_hash, response FROM project_mutations WHERE project_id = $1 AND actor_user_id = $2 AND idempotency_key = $3', [project.id, actorUserId, key]);
		if (prior.rows[0]) {
			if (prior.rows[0].request_hash !== requestHash) throw codedError('idempotency_conflict');
			return prior.rows[0].response;
		}
		if (project.status !== 'active') throw codedError('project_not_active');
		const topicResult = await client.query('SELECT * FROM project_topics WHERE project_id = $1 AND id = $2 AND archived_at IS NULL FOR UPDATE', [project.id, topicId]);
		const topic = topicRow(topicResult.rows[0]);
		if (!topic) throw codedError('topic_not_found');
		if (topic.workflow === 'completed') throw codedError('topic_completed');
		if (Number(input.expectedRevision) !== topic.revision) throw codedError('revision_conflict');
		if (report.correctionOfReportId) {
			const corrected = await client.query('SELECT 1 FROM project_progress_reports WHERE id=$1 AND project_id=$2 AND topic_id=$3', [report.correctionOfReportId, project.id, topic.id]);
			if (!corrected.rows[0]) throw codedError('correction_report_invalid');
		}
		if (report.progress < topic.progress && !text(input.reason)) throw codedError('progress_decrease_reason_required');
		if (topic.blocked && !report.blocked && !text(input.reason)) throw codedError('blocker_clear_reason_required');
		if (!LEAD_ROLES.has(project.role)) {
			const assigned = await client.query('SELECT 1 FROM project_topic_assignees WHERE project_id = $1 AND topic_id = $2 AND user_id = $3', [project.id, topic.id, actorUserId]);
			if (!assigned.rows[0]) throw codedError('project_forbidden');
		}
		const inserted = await client.query(
			`INSERT INTO project_progress_reports
			 (id, project_id, topic_id, author_user_id, progress, workflow, summary, blocked, blocker_reason, change_reason, correction_of_report_id)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
			[newId('rep'), project.id, topic.id, actorUserId, report.progress, report.workflow, report.summary, report.blocked, report.blockerReason, text(input.reason) || null, report.correctionOfReportId],
		);
		const changed = await client.query(
			`UPDATE project_topics SET progress=$3, workflow=$4, blocked=$5, blocker_reason=$6,
			 revision=revision+1, updated_at=now() WHERE project_id=$1 AND id=$2 RETURNING *`,
			[project.id, topic.id, report.progress, report.workflow, report.blocked, report.blockerReason],
		);
		await addEvent(client, project.id, topic.id, actorUserId, 'progress_reported', {
			progress: report.progress, workflow: report.workflow, blocked: report.blocked, summary: report.summary,
			reason: text(input.reason) || null, correctionOfReportId: report.correctionOfReportId,
		});
		if (!topic.blocked && report.blocked && report.notifyLeads) {
			const setting = await client.query('SELECT enabled, blocker_notifications, dm_enabled FROM project_notification_settings WHERE project_id=$1', [project.id]);
			if (setting.rows[0]?.enabled && setting.rows[0]?.dm_enabled !== false && setting.rows[0]?.blocker_notifications) {
				const leads = await client.query("SELECT user_id FROM project_memberships WHERE project_id=$1 AND revoked_at IS NULL AND role IN ('owner','lead') AND user_id <> $2", [project.id, actorUserId]);
				const base = String(process.env.FRONTEND_URL || '').replace(/\/$/, '');
				for (const lead of leads.rows) await notifications.enqueueWithClient(client, {
					userId: lead.user_id,
					eventType: 'project_topic_blocked',
					dedupeKey: `project-blocked:${project.id}:${topic.id}:${topic.revision + 1}:${lead.user_id}`,
					payload: {
						projectId: project.id,
						subjectEn: `Blocked work in ${notificationText(project.title)}`,
						subjectTh: `งานติดปัญหาใน ${notificationText(project.title)}`,
						bodyEn: `${notificationText(topic.title)} was marked blocked. Open the private project for details.`,
						bodyTh: `${notificationText(topic.title)} ถูกระบุว่าติดปัญหา เปิดโปรเจกต์ส่วนตัวเพื่อดูรายละเอียด`,
						ctaLabelEn: 'Open project', ctaLabelTh: 'เปิดโปรเจกต์',
						ctaUrl: base ? `${base}/p/${project.code}?view=topics` : null,
					},
				});
			}
		}
		if (!topic.blocked && report.blocked) {
			const channel = await client.query('SELECT enabled, channel_enabled, guild_id, channel_id FROM project_notification_settings WHERE project_id=$1', [project.id]);
			if (channel.rows[0]?.enabled && channel.rows[0]?.channel_enabled) {
				const root = String(process.env.FRONTEND_URL || '').replace(/\/$/, '');
				await projectChannelNotifications.enqueueWithClient(client, {
					projectId: project.id, eventType: 'project_topic_blocked',
					guildId: channel.rows[0].guild_id, channelId: channel.rows[0].channel_id,
					dedupeKey: `project-channel-blocked:${project.id}:${topic.id}:${topic.revision + 1}`,
					payload: {
						message: `🚧 ${notificationText(project.title)} · ${notificationText(topic.title)} is blocked / ติดปัญหา\nOpen the private project for details.`,
						ctaLabel: 'Open project', ctaUrl: root ? `${root}/p/${project.code}?view=topics` : null,
					},
				});
			}
		}
		await client.query('UPDATE projects SET revision=revision+1, updated_at=now() WHERE id=$1', [project.id]);
		const response = { topic: topicRow(changed.rows[0]), report: reportRow(inserted.rows[0]) };
		await client.query(
			'INSERT INTO project_mutations (id, project_id, actor_user_id, idempotency_key, request_hash, response) VALUES ($1,$2,$3,$4,$5,$6)',
			[newId('pmu'), project.id, actorUserId, key, requestHash, response],
		);
		return response;
	});
}

async function reviewTopic(code, topicId, actorUserId, input = {}) {
	assertKnownFields(input, ['action', 'reason', 'progress', 'expectedRevision']);
	const action = text(input.action);
	if (!['approve', 'return', 'reopen'].includes(action)) throw codedError('review_action_invalid');
	return transaction(async (client) => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		assertLead(project);
		if (project.status !== 'active') throw codedError('project_not_active');
		const result = await client.query('SELECT * FROM project_topics WHERE project_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE', [project.id, topicId]);
		const topic = topicRow(result.rows[0]);
		if (!topic) throw codedError('topic_not_found');
		if (Number(input.expectedRevision) !== topic.revision) throw codedError('revision_conflict');
		let workflow;
		let progress;
		let reason = null;
		if (action === 'approve') {
			if (topic.workflow !== 'in_review' || topic.blocked) throw codedError('topic_not_reviewable');
			workflow = 'completed'; progress = 100;
		}
		else {
			reason = requiredText(input.reason, 'reason', 1000);
			if (action === 'return' && topic.workflow !== 'in_review') throw codedError('topic_not_reviewable');
			if (action === 'reopen' && topic.workflow !== 'completed') throw codedError('topic_not_completed');
			progress = action === 'reopen' ? Number(input.progress) : topic.progress;
			if (!Number.isInteger(progress) || progress < 0 || progress > 99) throw codedError('progress_invalid');
			workflow = 'in_progress';
		}
		const changed = await client.query('UPDATE project_topics SET workflow=$3, progress=$4, revision=revision+1, updated_at=now() WHERE project_id=$1 AND id=$2 RETURNING *', [project.id, topic.id, workflow, progress]);
		await projectReminders.rebuildForTopicWithClient(client, project.id, topic.id);
		await addEvent(client, project.id, topic.id, actorUserId, `topic_${action === 'return' ? 'returned' : action === 'reopen' ? 'reopened' : 'completed'}`, { reason, progress });
		await client.query('UPDATE projects SET revision=revision+1, updated_at=now() WHERE id=$1', [project.id]);
		return { topic: topicRow(changed.rows[0]) };
	});
}

async function setProjectState(code, actorUserId, input = {}) {
	assertKnownFields(input, ['status', 'reason', 'expectedRevision']);
	const next = text(input.status);
	if (!PROJECT_STATES.includes(next)) throw codedError('project_state_invalid');
	return transaction(async (client) => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		if (next === 'completed' || next === 'cancelled' || ['completed', 'cancelled'].includes(project.status)) {
			if (project.role !== 'owner') throw codedError('project_forbidden');
		}
		else assertLead(project);
		if (!(PROJECT_TRANSITIONS[project.status] || []).includes(next)) throw codedError('project_transition_invalid');
		if (Number(input.expectedRevision) !== project.revision) throw codedError('revision_conflict');
		let reason = optionalText(input.reason, 'reason', 1000) || null;
		if (next === 'cancelled') reason = requiredText(input.reason, 'reason', 1000);
		if (next === 'completed') {
			const open = await client.query("SELECT count(*)::int AS n FROM project_topics WHERE project_id=$1 AND archived_at IS NULL AND workflow <> 'completed'", [project.id]);
			if (open.rows[0].n > 0) reason = requiredText(input.reason, 'reason', 1000);
		}
		const changed = await client.query(
			`UPDATE projects SET status=$2, close_reason=$3, revision=revision+1, updated_at=now(),
			 closed_at=CASE WHEN $2 IN ('completed','cancelled') THEN now() ELSE NULL END WHERE id=$1 RETURNING *`,
			[project.id, next, reason],
		);
		if (['completed', 'cancelled'].includes(next)) {
			await client.query("UPDATE project_reminder_jobs SET status='cancelled', completed_at=now() WHERE project_id=$1 AND status='pending'", [project.id]);
		}
		else if (next === 'active' && ['completed', 'cancelled'].includes(project.status)) {
			await projectReminders.rebuildForProjectWithClient(client, project.id);
		}
		await addEvent(client, project.id, null, actorUserId, 'project_state_changed', { from: project.status, to: next, reason });
		return projectRow({ ...changed.rows[0], role: project.role });
	});
}

async function createJoinLink(code, actorUserId) {
	return transaction(async client => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		if (project.role !== 'owner') throw codedError('project_forbidden');
		if (['completed', 'cancelled'].includes(project.status)) throw codedError('project_closed');
		await client.query('UPDATE project_join_links SET revoked_at=now() WHERE project_id=$1 AND revoked_at IS NULL', [project.id]);
		const token = invitationToken();
		await client.query("INSERT INTO project_join_links (id,project_id,token_hash,expires_at) VALUES ($1,$2,$3,now()+interval '7 days')", [newId('pjl'),project.id,invitationHash(token)]);
		return { token };
	});
}

async function revokeJoinLink(code, actorUserId) {
	return transaction(async client => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		if (project.role !== 'owner') throw codedError('project_forbidden');
		await client.query('UPDATE project_join_links SET revoked_at=now() WHERE project_id=$1 AND revoked_at IS NULL', [project.id]);
		return { revoked: true };
	});
}

async function requestProjectJoin(token, actorUserId) {
	return transaction(async client => {
		const found = await client.query('SELECT p.* FROM projects p JOIN project_join_links l ON l.project_id=p.id WHERE l.token_hash=$1 FOR UPDATE OF p', [invitationHash(requiredText(token, 'invitation_token', 200))]);
		const project = found.rows[0];
		if (!project) throw codedError('invitation_not_found');
		const valid = await client.query('SELECT 1 FROM project_join_links WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()', [invitationHash(token)]);
		if (!valid.rows[0]) throw codedError('invitation_expired');
		if (['completed', 'cancelled'].includes(project.status)) throw codedError('project_closed');
		const member = await client.query('SELECT 1 FROM project_memberships WHERE project_id=$1 AND user_id=$2 AND revoked_at IS NULL', [project.id,actorUserId]);
		if (member.rows[0]) return { status: 'approved', project: { code: project.code } };
		const existing = await client.query('SELECT status FROM project_join_requests WHERE project_id=$1 AND user_id=$2', [project.id,actorUserId]);
		if (existing.rows[0]) return { status: existing.rows[0].status };
		const count = await client.query("SELECT count(*)::int AS n FROM project_join_requests WHERE project_id=$1 AND status='pending'", [project.id]);
		if (count.rows[0].n >= 200) throw codedError('member_limit');
		await client.query('INSERT INTO project_join_requests (id,project_id,user_id) VALUES ($1,$2,$3)', [newId('pjr'),project.id,actorUserId]);
		return { status: 'pending' };
	});
}

async function listJoinRequests(code, actorUserId) {
	const project = await accessByCode({ query }, code, actorUserId);
	if (project.role !== 'owner') throw codedError('project_forbidden');
	const requests = await query(`SELECT r.id,r.status,r.created_at AS "createdAt",u.display_name AS "displayName",
		COALESCE((SELECT i.avatar_url FROM identities i WHERE i.user_id=u.id AND i.provider='discord' ORDER BY i.id LIMIT 1),u.avatar_url) AS "avatarUrl"
		FROM project_join_requests r JOIN users u ON u.id=r.user_id WHERE r.project_id=$1 AND r.status='pending' ORDER BY r.created_at`, [project.id]);
	const link = await query('SELECT expires_at AS "expiresAt" FROM project_join_links WHERE project_id=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 1', [project.id]);
	return { requests: requests.rows, link: link.rows[0] || null };
}

async function reviewJoinRequest(code, requestId, actorUserId, input = {}) {
	assertKnownFields(input, ['action']);
	if (!['approve','reject'].includes(input.action)) throw codedError('review_action_invalid');
	return transaction(async client => {
		const project = await accessByCode(client, code, actorUserId, { lock: true });
		if (project.role !== 'owner') throw codedError('project_forbidden');
		if (['completed','cancelled'].includes(project.status)) throw codedError('project_closed');
		const found = await client.query('SELECT * FROM project_join_requests WHERE project_id=$1 AND id=$2 FOR UPDATE', [project.id,requestId]);
		const request = found.rows[0];
		if (!request) throw codedError('invitation_not_found');
		if (request.status !== 'pending') throw codedError('invitation_used');
		if (input.action === 'approve') {
			const existing = await client.query('SELECT 1 FROM project_memberships WHERE project_id=$1 AND user_id=$2 AND revoked_at IS NULL', [project.id,request.user_id]);
			if (!existing.rows[0]) {
				const count = await client.query('SELECT count(*)::int AS n FROM project_memberships WHERE project_id=$1 AND revoked_at IS NULL', [project.id]);
				if (count.rows[0].n >= 50) throw codedError('member_limit');
				await client.query("INSERT INTO project_memberships (project_id,user_id,role) VALUES ($1,$2,'member') ON CONFLICT (project_id,user_id) DO UPDATE SET role='member',revoked_at=NULL,created_at=now()", [project.id,request.user_id]);
				await client.query('UPDATE projects SET revision=revision+1,updated_at=now() WHERE id=$1', [project.id]);
				await addEvent(client, project.id, null, actorUserId, 'member_joined', { userId: request.user_id, role: 'member' });
			}
		}
		const status = input.action === 'approve' ? 'approved' : 'rejected';
		await client.query('UPDATE project_join_requests SET status=$2,reviewed_at=now() WHERE id=$1', [request.id,status]);
		return { status };
	});
}

module.exports = {
	createJoinLink, revokeJoinLink, requestProjectJoin, listJoinRequests, reviewJoinRequest,
	PROJECT_STATES, PROJECT_TRANSITIONS, ROLES, createProject, listProjectsForUser, listProjectDirectory,
	getProjectByCode, listProjectTopics, getProjectTopic, createTopic, reportProgress, reviewTopic, setProjectState,
	listProjectMembers, listProjectInvitations, createInvitation, revokeInvitation, acceptInvitation,
	proposeOwnershipTransfer, cancelOwnershipTransfer, acceptOwnershipTransfer,
	updateMemberRole, removeProjectMember, setTopicAssignees, listProjectEvents, listTopicReports,
	updateProject, updateTopic,
	getProjectNotificationSettings, updateProjectNotificationSettings,
	createDependency, removeDependency, listMilestones, createMilestone, updateMilestone, removeMilestone,
	// Exported for focused pure tests.
	validate: { timezone, dates, normaliseReport, normaliseInviteRecipient, dependencyCreatesCycle, rezoneInstant, assertKnownFields },
};
