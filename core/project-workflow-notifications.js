'use strict';
const { createHash } = require('node:crypto');
const notifications = require('./notifications');
const { notificationScopeEligible } = require('./company-access');

const EVENTS = {
	project_topic_assigned: ['topic_created', 'assignments_changed'],
	project_topic_review_requested: ['progress_reported'],
	project_topic_returned: ['topic_returned'],
	project_topic_approved: ['topic_completed'],
	project_topic_reopened: ['topic_reopened'],
};
const COPY = {
	project_topic_assigned: ['You were assigned this topic. Open it to review the work.', 'คุณได้รับมอบหมายหัวข้องานนี้ เปิดเพื่อดูรายละเอียดงาน'],
	project_topic_review_requested: ['This topic is ready for review. Open it to review the work.', 'หัวข้องานนี้รอตรวจแล้ว เปิดเพื่อตรวจงาน'],
	project_topic_returned: ['This topic was returned for changes. Open it to read the feedback.', 'หัวข้องานนี้ถูกส่งกลับให้แก้ไข เปิดเพื่ออ่านข้อเสนอแนะ'],
	project_topic_approved: ['This topic was approved and completed. Open it to view the result.', 'หัวข้องานนี้ได้รับอนุมัติและเสร็จแล้ว เปิดเพื่อดูผล'],
	project_topic_reopened: ['This topic was reopened. Open it to review the next steps.', 'หัวข้องานนี้ถูกเปิดกลับมาทำต่อ เปิดเพื่อดูขั้นตอนถัดไป'],
};
function isWorkflow(type) { return Object.hasOwn(EVENTS, type); }
function identityFingerprint(identity, channel) {
	if (!identity) return null;
	const destination = channel === 'discord' ? identity.provider_uid : identity.email;
	if (!destination || (channel === 'email' && !identity.email_verified)) return null;
	return createHash('sha256').update(`${identity.id}\0${destination}`).digest('hex');
}
async function identitiesFor(client, userId) {
	const result = await client.query('SELECT id,provider,provider_uid,email,email_verified FROM identities WHERE user_id=$1', [userId]);
	return { discord: result.rows.find(i => i.provider === 'discord'), email: result.rows.find(i => i.provider === 'google' && i.email_verified && i.email) };
}

async function enqueueWithClient(client, { project, topic, eventId, eventType, recipients }) {
	if (!isWorkflow(eventType)) throw new Error('project_workflow_event_invalid');
	if (project.status !== 'active') return 0;
	const setting = (await client.query('SELECT enabled,dm_enabled FROM project_notification_settings WHERE project_id=$1', [project.id])).rows[0];
	if (!setting?.enabled || !setting.dm_enabled) return 0;
	const source = (await client.query('SELECT actor_user_id FROM project_events WHERE id=$1 AND project_id=$2 AND topic_id=$3', [eventId, project.id, topic.id])).rows[0];
	if (!source) throw new Error('project_workflow_source_invalid');
	let count = 0;
	for (const userId of new Set(recipients.filter(id => id && id !== source.actor_user_id))) {
		if (!await notificationScopeEligible(client, { user_id: userId, payload: { projectId: project.id } })) continue;
		const identities = await identitiesFor(client, userId);
		const result = await notifications.enqueueWithClient(client, { userId, eventType,
			dedupeKey: `project-topic:${eventType}:${project.id}:${topic.id}:${topic.revision}:${userId}`,
			payload: { projectId: project.id, topicId: topic.id, projectEventId: eventId, topicRevision: topic.revision,
				identities: { discord: identityFingerprint(identities.discord, 'discord'), email: identityFingerprint(identities.email, 'email') } } });
		if (result.created) count++;
	}
	return count;
}

function titleText(value) {
	return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[`*_~\\<>\[\]()]/g, '').replace(/@/g, '＠').replace(/\s+/g, ' ').trim().slice(0, 160);
}
function topicUrl(code, topicId) {
	try {
		const origin = new URL(process.env.FRONTEND_URL);
		if (!['http:', 'https:'].includes(origin.protocol)) return null;
		const url = new URL(`/p/${encodeURIComponent(code)}`, origin.origin);
		url.searchParams.set('view', 'topics'); url.searchParams.set('topic', topicId);
		return url.toString();
	} catch { return null; }
}

// Resolve current titles only after all recipient/event checks. No private
// feedback or personal names are stored in this notification's JSON.
async function prepareWithClient(client, row) {
	const p = row.payload;
	if (!isWorkflow(row.event_type) || !p || !['projectId', 'topicId', 'projectEventId'].every(key => typeof p[key] === 'string' && p[key])
		|| !Number.isSafeInteger(p.topicRevision) || p.topicRevision < 0 || !['discord', 'email'].includes(row.channel)) return null;
	const result = await client.query(`SELECT p.title AS project_title,p.code,p.status,t.title AS topic_title,t.topic_no,t.workflow,t.archived_at,
	 m.role,s.actor_user_id,s.event_type AS source_type,s.payload AS source_payload,prefs.mode,
	 EXISTS(SELECT 1 FROM project_topic_assignees a WHERE a.project_id=p.id AND a.topic_id=t.id AND a.user_id=$4) AS assigned
	 FROM projects p JOIN project_topics t ON t.project_id=p.id AND t.id=$2
	 JOIN project_events s ON s.project_id=p.id AND s.topic_id=t.id AND s.id=$3
	 JOIN project_memberships m ON m.project_id=p.id AND m.user_id=$4 AND m.revoked_at IS NULL
	 JOIN project_notification_settings settings ON settings.project_id=p.id AND settings.enabled AND settings.dm_enabled
	 LEFT JOIN notification_preferences prefs ON prefs.user_id=$4 WHERE p.id=$1`, [p.projectId, p.topicId, p.projectEventId, row.user_id]);
	const current = result.rows[0];
	if (!current || current.status !== 'active' || current.archived_at || current.actor_user_id === row.user_id
		|| !EVENTS[row.event_type].includes(current.source_type) || current.source_payload?.topicRevision !== p.topicRevision) return null;
	if (row.event_type === 'project_topic_review_requested') {
		if (!['owner', 'lead'].includes(current.role) || current.workflow !== 'in_review'
			|| current.source_payload.workflow !== 'in_review' || current.source_payload.previousWorkflow === 'in_review') return null;
	} else if (!current.assigned || current.role === 'viewer'
		|| (row.event_type === 'project_topic_assigned' && current.workflow === 'completed')
		|| (row.event_type === 'project_topic_approved' && current.workflow !== 'completed')
		|| (['project_topic_returned', 'project_topic_reopened'].includes(row.event_type) && !['not_started', 'in_progress'].includes(current.workflow))) return null;
	if (!await notificationScopeEligible(client, row)) return null;
	const identities = await identitiesFor(client, row.user_id);
	const available = { hasDiscord: Boolean(identities.discord), hasEmail: Boolean(identities.email) };
	const mode = current.mode || (available.hasDiscord ? 'discord' : available.hasEmail ? 'email' : 'off');
	if (!notifications.channelsFor(mode, available).includes(row.channel)
		|| !p.identities?.[row.channel] || identityFingerprint(identities[row.channel], row.channel) !== p.identities[row.channel]) return null;
	let superseded;
	if (row.event_type === 'project_topic_assigned') {
		superseded = await client.query(`SELECT 1 FROM notification_events e WHERE e.event_type='project_topic_assigned' AND e.user_id=$4
		 AND e.payload->>'projectId'=$1 AND e.payload->>'topicId'=$2 AND (e.payload->>'topicRevision')::int>$3 LIMIT 1`, [p.projectId, p.topicId, p.topicRevision, row.user_id]);
	} else {
		// Only review-cycle boundaries supersede decisions/review requests.
		// Ordinary reports and unrelated metadata revisions are deliberately ignored.
		superseded = await client.query(`SELECT 1 FROM project_events e WHERE e.project_id=$1 AND e.topic_id=$2
		 AND (e.payload->>'topicRevision')::int>$3 AND (e.event_type IN ('topic_returned','topic_completed','topic_reopened')
		 OR (e.event_type='progress_reported' AND ((e.payload->>'workflow')='in_review') IS DISTINCT FROM ((e.payload->>'previousWorkflow')='in_review'))) LIMIT 1`, [p.projectId, p.topicId, p.topicRevision]);
	}
	if (superseded.rowCount) return null;
	const url = topicUrl(current.code, p.topicId);
	if (!url) return null;
	const context = `${titleText(current.project_title)} · #${current.topic_no} ${titleText(current.topic_title)}`;
	return { ...row, discord_uid: identities.discord?.provider_uid, email: identities.email?.email,
		payload: { ...p, subjectEn: 'Project topic update', subjectTh: 'ความเคลื่อนไหวของหัวข้องาน',
			bodyEn: `${context}\n${COPY[row.event_type][0]}`, bodyTh: `${context}\n${COPY[row.event_type][1]}`,
			ctaLabelEn: 'Open topic', ctaLabelTh: 'เปิดหัวข้องาน', ctaUrl: url } };
}
module.exports = { isWorkflow, enqueueWithClient, prepareWithClient, identityFingerprint, titleText, topicUrl };
