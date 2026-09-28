'use strict';
const assert = require('node:assert/strict');
const { isDisposableTestDatabase } = require('./test-database');
const core = require('../core');
let userId;
let projectId;

async function main() {
	const url = process.env.MEGU_TEST_DATABASE_URL || process.env.MEGU_DATABASE_URL;
	assert.ok(isDisposableTestDatabase(url), 'Explicit local *_test database required');
	process.env.MEGU_DATABASE_URL = url;
	await core.initCoreSchema();
	userId = (await core.users.loginWithIdentity({ provider: 'discord', providerUid: `completion-${Date.now()}`, displayName: 'Completion test' })).user.id;
	const project = await core.projects.createProject({ ownerUserId: userId, title: 'Completion snapshots', timezone: 'Asia/Bangkok' });
	projectId = project.id;
	await core.projects.setProjectState(project.code, userId, { status: 'active', expectedRevision: 0 });
	let topic = (await core.projects.createTopic(project.code, userId, { title: 'Snapshot task', deadlineAt: '2000-01-01', deadlinePrecision: 'date', assigneeUserIds: [userId] })).topic;
	const approve = async key => {
		topic = (await core.projects.reportProgress(project.code, topic.id, userId, { progress: 90, summary: 'Ready', requestReview: true, expectedRevision: topic.revision, idempotencyKey: key })).topic;
		topic = (await core.projects.reviewTopic(project.code, topic.id, userId, { action: 'approve', expectedRevision: topic.revision })).topic;
	};
	await approve('completion-first');
	assert.equal(new Date(topic.completionDeadlineAt).toISOString(), '2000-01-01T16:59:59.999Z');
	assert.equal(topic.completionTimezone, 'Asia/Bangkok');
	const firstCompletion = new Date(topic.completedAt).toISOString();
	let detail = await core.projects.getProjectByCode(project.code, userId);
	assert.equal(detail.insights.onTime.count, 0);
	assert.equal(detail.insights.onTime.total, 1);
	await core.projects.updateTopic(project.code, topic.id, userId, { deadlineAt: '2100-01-01', deadlinePrecision: 'date', expectedRevision: topic.revision });
	detail = await core.projects.getProjectByCode(project.code, userId);
	topic = detail.topics[0];
	assert.equal(detail.insights.onTime.count, 0, 'Moving a deadline after completion must not rewrite the result');
	assert.equal(new Date(topic.completedAt).toISOString(), firstCompletion);
	topic = (await core.projects.reviewTopic(project.code, topic.id, userId, { action: 'reopen', reason: 'Additional work', progress: 80, expectedRevision: topic.revision })).topic;
	assert.equal(topic.completedAt, null);
	assert.equal(topic.completionDeadlineAt, null);
	assert.equal((await core.projects.getProjectByCode(project.code, userId)).insights.onTime.total, 0);
	await approve('completion-second');
	assert.equal(new Date(topic.completionDeadlineAt).toISOString(), '2100-01-01T16:59:59.999Z');
	detail = await core.projects.getProjectByCode(project.code, userId);
	assert.equal(detail.insights.onTime.count, 1);
	const events = await core.db.query("SELECT payload FROM project_events WHERE project_id=$1 AND event_type='topic_completed' ORDER BY created_at,id", [projectId]);
	assert.equal(events.rows.length, 2);
	assert.ok(events.rows.some(row => row.payload.completedAt === firstCompletion));
	assert.ok(events.rows.some(row => row.payload.completionDeadlineAt === '2000-01-01T16:59:59.999Z'));
	console.log('Completion lifecycle passed: timezone deadline, immutable snapshot, reopen, recompletion and retained events');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
	try {
		if (projectId) {
			await core.db.query('DELETE FROM project_topic_assignees WHERE project_id=$1', [projectId]);
			await core.db.query('DELETE FROM project_progress_reports WHERE project_id=$1', [projectId]);
			await core.db.query('DELETE FROM projects WHERE id=$1', [projectId]);
		}
		if (userId) await core.db.query('DELETE FROM users WHERE id=$1', [userId]);
	} finally { await core.db.close(); }
});
