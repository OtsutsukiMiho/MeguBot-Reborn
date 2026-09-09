const { transaction } = require('./db.js');
const { newId } = require('./ids.js');
const notifications = require('./notifications.js');
const projectChannelNotifications = require('./project-channel-notifications.js');

const THRESHOLDS = [48, 24];
const FRESH_WINDOW_MS = 6 * 60 * 60 * 1000;

function safeNotificationText(value) {
	return String(value || '').trim().replace(/[\r\n]+/g, ' ').replaceAll('@', '@\u200b').slice(0, 180);
}

async function rebuildForTopicWithClient(client, projectId, topicId) {
	await client.query(
		"UPDATE project_reminder_jobs SET status='cancelled', completed_at=now() WHERE project_id=$1 AND topic_id=$2 AND status='pending'",
		[projectId, topicId],
	);
	const result = await client.query(
		`SELECT t.id, t.deadline_at, t.schedule_revision, t.archived_at, t.workflow,
		 s.enabled, s.reminder_48h, s.reminder_24h
		 FROM project_topics t LEFT JOIN project_notification_settings s ON s.project_id=t.project_id
		 WHERE t.project_id=$1 AND t.id=$2`,
		[projectId, topicId],
	);
	const topic = result.rows[0];
	if (!topic?.enabled || !topic.deadline_at || topic.archived_at || topic.workflow === 'completed') return;
	for (const hours of THRESHOLDS) {
		if (!topic[`reminder_${hours}h`]) continue;
		await client.query(
			`INSERT INTO project_reminder_jobs
			 (id, project_id, topic_id, threshold_hours, deadline_at, deadline_revision, run_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$5::timestamptz - make_interval(hours => $4))
			 ON CONFLICT (topic_id, threshold_hours, deadline_at, deadline_revision) DO NOTHING`,
			[newId('prm'), projectId, topicId, hours, topic.deadline_at, topic.schedule_revision],
		);
	}
}

async function rebuildForProjectWithClient(client, projectId) {
	await client.query(
		"UPDATE project_reminder_jobs SET status='cancelled', completed_at=now() WHERE project_id=$1 AND status='pending'",
		[projectId],
	);
	const topics = await client.query('SELECT id FROM project_topics WHERE project_id=$1', [projectId]);
	for (const topic of topics.rows) await rebuildForTopicWithClient(client, projectId, topic.id);
}

async function queueDue({ now = new Date(), baseUrl = '', limit = 50, projectId = null } = {}) {
	const current = now instanceof Date ? now : new Date(now);
	if (Number.isNaN(current.getTime())) throw new Error('project_reminder_time_invalid');
	return transaction(async client => {
		const due = await client.query(
		`SELECT j.*, p.code, p.title AS project_title, p.status AS project_status,
		 t.title AS topic_title, t.deadline_at AS current_deadline_at, t.schedule_revision,
		 t.workflow, t.archived_at, s.enabled, s.reminder_48h, s.reminder_24h,
		 s.dm_enabled, s.channel_enabled, s.guild_id, s.channel_id
		 FROM project_reminder_jobs j
		 JOIN projects p ON p.id=j.project_id
		 JOIN project_topics t ON t.project_id=j.project_id AND t.id=j.topic_id
		 LEFT JOIN project_notification_settings s ON s.project_id=j.project_id
			 WHERE j.status='pending' AND j.run_at <= $1
			 AND ($3::text IS NULL OR j.project_id=$3)
			 ORDER BY j.run_at, j.id FOR UPDATE OF j SKIP LOCKED LIMIT $2`,
			[current.toISOString(), Math.max(1, Math.min(200, Number(limit) || 50)), projectId],
		);
		let queued = 0;
		let skipped = 0;
		for (const job of due.rows) {
			const thresholdEnabled = job.threshold_hours === 48 ? job.reminder_48h : job.reminder_24h;
			const currentDeadline = job.current_deadline_at && new Date(job.current_deadline_at).getTime();
			const stale = !job.enabled || !thresholdEnabled || job.project_status !== 'active'
				|| job.archived_at || job.workflow === 'completed'
				|| Number(job.schedule_revision) !== Number(job.deadline_revision)
				|| currentDeadline !== new Date(job.deadline_at).getTime()
				|| current.getTime() - new Date(job.run_at).getTime() > FRESH_WINDOW_MS;
			if (stale) {
				await client.query("UPDATE project_reminder_jobs SET status='skipped', completed_at=$2 WHERE id=$1", [job.id, current.toISOString()]);
				skipped++;
				continue;
			}
			const assignees = await client.query(
				`SELECT a.user_id FROM project_topic_assignees a
				 JOIN project_memberships m ON m.project_id=a.project_id AND m.user_id=a.user_id
				 WHERE a.project_id=$1 AND a.topic_id=$2 AND m.revoked_at IS NULL`,
				[job.project_id, job.topic_id],
			);
			const root = String(baseUrl || '').replace(/\/$/, '');
			for (const assignee of (job.dm_enabled !== false ? assignees.rows : [])) {
				const result = await notifications.enqueueWithClient(client, {
					userId: assignee.user_id,
					eventType: 'project_deadline_reminder',
					dedupeKey: `project-deadline:${job.id}:${assignee.user_id}`,
					payload: {
						projectId: job.project_id,
						subjectEn: `${job.threshold_hours}h until ${safeNotificationText(job.topic_title)} is due`,
						subjectTh: `เหลือ ${job.threshold_hours} ชม. ก่อนส่ง ${safeNotificationText(job.topic_title)}`,
						bodyEn: `${safeNotificationText(job.project_title)} · Open your private project to review the deadline.`,
						bodyTh: `${safeNotificationText(job.project_title)} · เปิดโปรเจกต์ส่วนตัวเพื่อตรวจวันกำหนดส่ง`,
						ctaLabelEn: 'Open project', ctaLabelTh: 'เปิดโปรเจกต์',
						ctaUrl: root ? `${root}/p/${job.code}?view=topics` : null,
					},
				});
				if (result.created) queued++;
			}
			if (job.channel_enabled && job.guild_id && job.channel_id) {
				const result = await projectChannelNotifications.enqueueWithClient(client, {
					projectId: job.project_id, eventType: 'project_deadline_reminder',
					guildId: job.guild_id, channelId: job.channel_id,
					dedupeKey: `project-channel-deadline:${job.id}`,
					payload: {
						message: `⏳ ${safeNotificationText(job.project_title)} · ${safeNotificationText(job.topic_title)} is due in ${job.threshold_hours}h / ครบกำหนดใน ${job.threshold_hours} ชม.`,
						ctaLabel: 'Open project', ctaUrl: root ? `${root}/p/${job.code}?view=topics` : null,
					},
				});
				if (result.created) queued++;
			}
			await client.query("UPDATE project_reminder_jobs SET status='queued', completed_at=$2 WHERE id=$1", [job.id, current.toISOString()]);
		}
		return { queued, skipped, jobs: due.rows.length };
	});
}

module.exports = {
	THRESHOLDS,
	FRESH_WINDOW_MS,
	rebuildForTopicWithClient,
	rebuildForProjectWithClient,
	queueDue,
};
