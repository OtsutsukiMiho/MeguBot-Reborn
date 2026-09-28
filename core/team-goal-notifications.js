'use strict';
const { transaction } = require('./db');
const notifications = require('./notifications');

async function enqueueChangeWithClient(client, { teamId, goalId, version, revision, recipients, actorId, reminderEnd = null, baseUrl = process.env.FRONTEND_URL || '' }) {
	if (process.env.MEGU_TEAM_GOALS_ENABLED !== '1' || process.env.MEGU_PROJECT_TEAMS_ENABLED === '0') return 0;
	let queued = 0;
	for (const userId of new Set(recipients.filter(id => id && id !== actorId))) {
		const eventType = reminderEnd ? 'team_goal_due' : 'team_goal_changed';
		const payload = { teamId, goalId, goalVersion: version,
			...(reminderEnd ? { periodEnd: reminderEnd } : { goalRevision: revision }),
			subjectEn: 'Goal update', subjectTh: 'ความเคลื่อนไหวของเป้าหมาย',
			bodyEn: reminderEnd ? 'An agreed goal period has ended. Open your private goal to review the next step.' : 'There is an update to a goal you participate in. Open your private goal to review it.',
			bodyTh: reminderEnd ? 'ช่วงเวลาที่ตกลงไว้ของเป้าหมายสิ้นสุดแล้ว เปิดเป้าหมายส่วนตัวเพื่อพิจารณาขั้นตอนถัดไป' : 'มีความเคลื่อนไหวของเป้าหมายที่คุณมีส่วนร่วม เปิดเป้าหมายส่วนตัวเพื่อตรวจสอบ',
			ctaLabelEn: 'Open goal', ctaLabelTh: 'เปิดเป้าหมาย',
			ctaUrl: baseUrl ? `${String(baseUrl).replace(/\/$/, '')}/teams/${encodeURIComponent(teamId)}/goals/${encodeURIComponent(goalId)}` : null };
		const result = await notifications.enqueueWithClient(client, { userId, eventType, payload,
			dedupeKey: `${eventType}:${goalId}:${version}:${reminderEnd || revision}:${userId}` });
		if (result.created) queued++;
	}
	return queued;
}

async function eligible(client, row) {
	if (process.env.MEGU_TEAM_GOALS_ENABLED !== '1' || process.env.MEGU_PROJECT_TEAMS_ENABLED === '0') return false;
	const p = row.payload;
	if (!p || typeof p.goalId !== 'string' || typeof p.teamId !== 'string' || !Number.isSafeInteger(p.goalVersion) || p.goalVersion < 1) return false;
	if (!(await client.query("SELECT to_regclass('public.team_goals') AS table_name")).rows[0]?.table_name) return false;
	const result = await client.query(`SELECT g.revision,g.subject_id,v.reviewer_id,v.lifecycle,v.needs_reviewer,v.period_end::text,
	 v.period_end < (now() AT TIME ZONE v.timezone)::date AS period_due,
	 sm.user_id AS subject_active,rm.user_id AS reviewer_active,
	 prefs.mode,
	 EXISTS(SELECT 1 FROM identities i WHERE i.user_id=$3 AND i.provider='discord') AS has_discord,
	 EXISTS(SELECT 1 FROM identities i WHERE i.user_id=$3 AND i.provider='google' AND i.email_verified AND i.email IS NOT NULL) AS has_email
	 FROM team_goals g JOIN team_goal_versions v ON v.goal_id=g.id AND v.version=g.current_version
	 JOIN teams t ON t.id=g.team_id AND t.archived_at IS NULL
	 JOIN team_memberships me ON me.team_id=t.id AND me.user_id=$3 AND me.revoked_at IS NULL
	 LEFT JOIN team_memberships sm ON sm.team_id=t.id AND sm.user_id=g.subject_id AND sm.revoked_at IS NULL
	 LEFT JOIN team_memberships rm ON rm.team_id=t.id AND rm.user_id=v.reviewer_id AND rm.revoked_at IS NULL AND rm.role IN ('owner','admin')
	 LEFT JOIN notification_preferences prefs ON prefs.user_id=$3
	 WHERE g.id=$1 AND g.team_id=$2 AND g.current_version=$4
	 AND (g.subject_id=$3 OR (v.reviewer_id=$3 AND me.role IN ('owner','admin') AND v.reviewer_id<>g.subject_id))`, [p.goalId, p.teamId, row.user_id, p.goalVersion]);
	const goal = result.rows[0];
	if (!goal || goal.lifecycle === 'archived') return false;
	const channels = notifications.channelsFor(goal.mode || (goal.has_discord ? 'discord' : goal.has_email ? 'email' : 'off'), { hasDiscord: goal.has_discord, hasEmail: goal.has_email });
	if (!channels.includes(row.channel)) return false;
	if (row.event_type === 'team_goal_changed') return Number.isSafeInteger(p.goalRevision) && goal.revision === p.goalRevision;
	return row.event_type === 'team_goal_due' && goal.period_due && p.periodEnd === goal.period_end && !goal.needs_reviewer && goal.subject_active
		&& (!goal.reviewer_id || (goal.reviewer_active && goal.reviewer_id !== goal.subject_id)) && ['active', 'submitted'].includes(goal.lifecycle)
		&& (goal.lifecycle !== 'submitted' || row.user_id !== goal.subject_id);
}

async function queueDue({ now = new Date(), baseUrl = process.env.FRONTEND_URL || '', limit = 50 } = {}) {
	if (process.env.MEGU_TEAM_GOALS_ENABLED !== '1' || process.env.MEGU_PROJECT_TEAMS_ENABLED === '0') return { queued: 0, goals: 0 };
	const current = new Date(now); if (!Number.isFinite(current.getTime())) throw new Error('goal_reminder_time_invalid');
	return transaction(async client => {
		// Reuse the established goal identity lock; bounded sweeps need no new worker.
		await client.query("SELECT pg_advisory_xact_lock(hashtext('team-goals-identity'))");
		if (!(await client.query("SELECT to_regclass('public.team_goals') AS table_name")).rows[0]?.table_name) return { queued: 0, goals: 0 };
		const due = await client.query(`SELECT g.id,g.team_id,g.current_version,g.revision,v.period_end::text,recipient.user_id
		 FROM team_goals g JOIN team_goal_versions v ON v.goal_id=g.id AND v.version=g.current_version
		 JOIN teams t ON t.id=g.team_id AND t.archived_at IS NULL
		 JOIN team_memberships sm ON sm.team_id=t.id AND sm.user_id=g.subject_id AND sm.revoked_at IS NULL
		 LEFT JOIN team_memberships rm ON rm.team_id=t.id AND rm.user_id=v.reviewer_id AND rm.revoked_at IS NULL AND rm.role IN ('owner','admin')
		 JOIN LATERAL (SELECT g.subject_id AS user_id WHERE v.lifecycle='active' UNION SELECT v.reviewer_id) recipient ON recipient.user_id IS NOT NULL
		 WHERE v.lifecycle IN ('active','submitted') AND NOT v.needs_reviewer AND (v.reviewer_id IS NULL OR (rm.user_id IS NOT NULL AND v.reviewer_id<>g.subject_id))
		 AND v.period_end < ($1::timestamptz AT TIME ZONE v.timezone)::date
		 AND NOT EXISTS(SELECT 1 FROM notification_events e WHERE e.event_type='team_goal_due' AND e.user_id=recipient.user_id
		  AND e.payload->>'goalId'=g.id AND e.payload->>'goalVersion'=g.current_version::text AND e.payload->>'periodEnd'=v.period_end::text)
		 ORDER BY v.period_end,g.id,recipient.user_id LIMIT $2`, [current.toISOString(), Math.min(200, Math.max(1, Math.trunc(Number(limit)) || 50))]);
		let queued = 0;
		for (const goal of due.rows) {
			if (!await require('./company-access').notificationScopeEligible(client, { user_id: goal.user_id, payload: { teamId: goal.team_id } })) continue;
			queued += await enqueueChangeWithClient(client, { teamId: goal.team_id, goalId: goal.id, version: goal.current_version, revision: goal.revision, recipients: [goal.user_id], reminderEnd: goal.period_end, baseUrl });
		}
		return { queued, goals: due.rows.length };
	});
}

module.exports = { enqueueChangeWithClient, eligible, queueDue };
