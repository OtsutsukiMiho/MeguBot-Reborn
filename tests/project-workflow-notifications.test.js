'use strict';
const assert = require('node:assert/strict');
const { resolveTestDatabaseUrl } = require('./test-database');
const { Client } = require('pg');
const { postgresConnectionOptions } = require('../core/postgres-connection');
// Validate the driver's effective destination BEFORE loading any core/database code.
const url = resolveTestDatabaseUrl(process.env);
const destination = new Client(postgresConnectionOptions(url)).connectionParameters;
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(destination.host), 'Loopback test database required');
assert.ok(destination.database.endsWith('_test'), 'Disposable _test database required');
process.env.MEGU_DATABASE_URL = url;
process.env.FRONTEND_URL = 'https://megu.test';
process.env.PG_POOL_MAX = '3'; // Exercise real independent PostgreSQL connections, not a one-client queue.
const core = require('../core');
const workflow = require('../core/project-workflow-notifications');
const { createDispatcher } = require('../adapters/notifications/dispatcher');
const { deliverNotice } = require('../adapters/notifications/discord-delivery');
const users = [], projects = [], teams = [];
let serial = 0;
const seed = BigInt(Date.now()) * 1000n;
const q = (sql, args) => core.db.query(sql, args);
async function user(mode = 'discord', locale = 'en') {
	const n = ++serial;
	const login = await core.users.loginWithIdentity({ provider: mode === 'email' ? 'google' : 'discord',
		providerUid: mode === 'email' ? `workflow-${seed}-${n}` : String(100000000000000000n + seed + BigInt(n)),
		email: mode === 'email' ? `workflow-${seed}-${n}@example.test` : null, emailVerified: mode === 'email', displayName: `Fixture ${n}` });
	users.push(login.user.id);
	if (mode === 'both') await core.users.linkIdentity(login.user.id, { provider: 'google', providerUid: `workflow-mail-${seed}-${n}`, email: `workflow-${seed}-${n}@example.test`, emailVerified: true });
	await core.users.setNotificationPreferences(login.user.id, { mode, locale });
	return login.user.id;
}
async function project(owner, members, { status = 'active', settings = true, teamId } = {}) {
	const p = await core.projects.createProject({ ownerUserId: owner, title: 'Private project', timezone: 'Asia/Bangkok', ...(teamId ? { teamId } : {}) });
	projects.push(p.id);
	for (const [id, role] of members) await q("INSERT INTO project_memberships(project_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(project_id,user_id) DO UPDATE SET role=$3,revoked_at=NULL", [p.id, id, role]);
	if (status === 'active') await core.projects.setProjectState(p.code, owner, { status, expectedRevision: 0 });
	if (settings) {
		const rev = (await q('SELECT revision FROM projects WHERE id=$1', [p.id])).rows[0].revision;
		await core.projects.updateProjectNotificationSettings(p.code, owner, { enabled: true, dmEnabled: true, blockerNotifications: false, reminder48h: false, reminder24h: false, expectedRevision: rev });
	}
	return p;
}
async function topic(p, actor, assignees, title = 'Private topic') {
	return (await core.projects.createTopic(p.code, actor, { title, description: 'NEVER_SEND_DESCRIPTION', assigneeUserIds: assignees })).topic;
}
async function events(p, type, t) {
	return (await q(`SELECT * FROM notification_events WHERE payload->>'projectId'=$1
	 AND ($2::text IS NULL OR event_type=$2) AND ($3::text IS NULL OR payload->>'topicId'=$3) ORDER BY created_at,id`, [p.id, type || null, t?.id || null])).rows;
}
async function row(event, channel = 'discord', client = { query: q }) {
	return (await client.query(`SELECT d.id,d.channel,d.status,d.attempts,e.event_type,e.payload,e.user_id FROM notification_deliveries d
	 JOIN notification_events e ON e.id=d.event_id WHERE e.id=$1 AND d.channel=$2`, [event.id, channel])).rows[0];
}
async function ready(event, channel = 'discord') { const delivery = await row(event, channel); return delivery ? workflow.prepareWithClient({ query: q }, delivery) : null; }
async function assertCopy(event, en, th) {
	const prepared = await ready(event); assert.ok(prepared);
	for (const [locale, intent] of [['en', en], ['th', th]]) {
		const content = core.notifications.render({ ...prepared, payload: { ...prepared.payload, locale } });
		assert.ok(content.body.includes(intent));
		assert.equal(content.ctaLabel, locale === 'th' ? 'เปิดหัวข้องาน' : 'Open topic');
		assert.ok(!/NEVER_SEND|Fixture|blocker|review notes/.test(content.body));
	}
}
async function report(p, t, actor, review = false) {
	return core.projects.reportProgress(p.code, t.id, actor, { progress: 90, summary: 'NEVER_SEND_REPORT', requestReview: review, expectedRevision: t.revision, idempotencyKey: `workflow-report-${++serial}` });
}
async function decision(p, t, actor, action) {
	return (await core.projects.reviewTopic(p.code, t.id, actor, { action, reason: 'NEVER_SEND_REASON', ...(action === 'reopen' ? { progress: 80 } : {}), expectedRevision: t.revision })).topic;
}
async function clearFixtureQueue() { await q("DELETE FROM notification_events WHERE user_id=ANY($1::text[])", [users]); }
async function main() {
	const actual = (await q('SELECT current_database() AS name')).rows[0].name;
	assert.equal(actual, destination.database, 'Connected database must be the validated disposable target');
	await core.initCoreSchema();
	const owner = await user(), lead = await user(), a = await user('both', 'th'), b = await user(), viewer = await user(), off = await user('off'), email = await user('email');
	const members = [[lead, 'lead'], [a, 'member'], [b, 'member'], [viewer, 'viewer'], [off, 'member'], [email, 'member']];
	const p = await project(owner, members);
	let t = await topic(p, owner, [owner, a, a, b]);
	let notices = await events(p, 'project_topic_assigned', t);
	assert.deepEqual(notices.map(e => e.user_id).sort(), [a, b].sort(), 'dedupe assignees and exclude actor');
	assert.ok(notices.every(e => e.payload.topicRevision === 0 && e.payload.projectEventId));
	for (const event of notices) {
		assert.equal(event.dedupe_key, `project-topic:project_topic_assigned:${p.id}:${t.id}:0:${event.user_id}`);
		assert.deepEqual(Object.keys(event.payload).sort(), ['identities', 'locale', 'projectEventId', 'projectId', 'topicId', 'topicRevision'].sort(), 'reference-only frozen payload');
	}
	const aNotice = notices.find(e => e.user_id === a);
	await assertCopy(aNotice, 'You were assigned this topic.', 'คุณได้รับมอบหมายหัวข้องานนี้');
	assert.deepEqual((await q('SELECT channel FROM notification_deliveries WHERE event_id=$1 ORDER BY channel', [aNotice.id])).rows.map(r => r.channel), ['discord', 'email']);
	const frozen = core.notifications.render(await ready(aNotice));
	assert.equal(frozen.ctaLabel, 'เปิดหัวข้องาน'); assert.match(frozen.body, /คุณได้รับมอบหมาย/);
	assert.ok(!/NEVER_SEND/.test(frozen.body));
	assert.equal(new URL(frozen.ctaUrl).searchParams.get('topic'), t.id);
	// No notices from unchanged membership, removals, or primary-only edits.
	t = (await core.projects.setTopicAssignees(p.code, t.id, owner, { userIds: [owner, a, b], primaryUserId: a, expectedRevision: t.revision })).topic;
	t = (await core.projects.setTopicAssignees(p.code, t.id, owner, { userIds: [owner, a, b], primaryUserId: a, expectedRevision: t.revision })).topic;
	t = (await core.projects.setTopicAssignees(p.code, t.id, owner, { userIds: [a], primaryUserId: a, expectedRevision: t.revision })).topic;
	assert.equal((await events(p, 'project_topic_assigned', t)).length, 2);
	assert.equal(await ready(notices.find(e => e.user_id === b)), null, 'removed assignee suppressed');
	assert.ok(await ready(aNotice), 'unrelated revisions preserve assignment notice');
	t = (await core.projects.setTopicAssignees(p.code, t.id, owner, { userIds: [a, b], expectedRevision: t.revision })).topic;
	notices = await events(p, 'project_topic_assigned', t);
	assert.equal(notices.length, 3); assert.equal(await ready(notices.find(e => e.user_id === b && e.payload.topicRevision === 0)), null, 'new assignment supersedes removed/readded notice');
	// Reports only notify on a real transition into review. Audience never grows.
	t = (await report(p, t, a)).topic;
	assert.equal((await events(p, 'project_topic_review_requested', t)).length, 0);
	const input = { progress: 90, summary: 'NEVER_SEND_REPORT', requestReview: true, expectedRevision: t.revision, idempotencyKey: `workflow-concurrent-${++serial}` };
	const concurrent = await Promise.all([core.projects.reportProgress(p.code, t.id, a, input), core.projects.reportProgress(p.code, t.id, a, input)]);
	assert.equal(concurrent[0].report.id, concurrent[1].report.id); t = concurrent[0].topic;
	const reviewNotices = await events(p, 'project_topic_review_requested', t);
	assert.deepEqual(reviewNotices.map(e => e.user_id).sort(), [owner, lead].sort());
	assert.ok(await ready(reviewNotices[0]));
	await assertCopy(reviewNotices[0], 'This topic is ready for review.', 'หัวข้องานนี้รอตรวจแล้ว');
	t = (await report(p, t, a, true)).topic;
	assert.equal((await events(p, 'project_topic_review_requested', t)).length, 2, 'same-cycle review report does not duplicate');
	assert.ok(await ready(reviewNotices[0]), 'same-cycle report does not invalidate');
	t = (await core.projects.updateTopic(p.code, t.id, owner, { title: '@everyone **Safe** <tag>', expectedRevision: t.revision })).topic;
	const renamed = core.notifications.render(await ready(reviewNotices[0]));
	assert.match(renamed.body, /＠everyone Safe tag/); assert.ok(!renamed.body.includes('@everyone'));
	await q("UPDATE project_memberships SET role='lead' WHERE project_id=$1 AND user_id=$2", [p.id, b]);
	assert.equal((await events(p, 'project_topic_review_requested', t)).length, 2, 'new lead does not join frozen audience');
	await q("UPDATE project_memberships SET role='member' WHERE project_id=$1 AND user_id=$2", [p.id, lead]);
	assert.equal(await ready(reviewNotices.find(e => e.user_id === lead)), null, 'former lead no longer eligible');
	t = await decision(p, t, owner, 'return');
	assert.equal(await ready(reviewNotices.find(e => e.user_id === owner)), null, 'return supersedes review request');
	const returned = await events(p, 'project_topic_returned', t);
	assert.deepEqual(returned.map(e => e.user_id).sort(), [a, b].sort());
	assert.ok(await ready(returned[0]));
	await assertCopy(returned[0], 'This topic was returned for changes.', 'หัวข้องานนี้ถูกส่งกลับให้แก้ไข');
	t = (await report(p, t, a)).topic; assert.ok(await ready(returned[0]), 'ordinary progress retains return');
	t = (await report(p, t, a, true)).topic; assert.equal(await ready(returned[0]), null, 'new review cycle supersedes return');
	t = await decision(p, t, owner, 'return');
	const secondReturn = (await events(p, 'project_topic_returned', t)).filter(e => e.payload.topicRevision === t.revision);
	assert.equal(secondReturn.length, 2); assert.ok(await ready(secondReturn[0]));
	assert.equal(await ready(returned[0]), null, 'return -> resubmit -> return does not revive prior cycle');
	t = (await report(p, t, a, true)).topic;
	t = await decision(p, t, owner, 'approve');
	const approved = await events(p, 'project_topic_approved', t);
	assert.deepEqual(approved.map(e => e.user_id).sort(), [a, b].sort()); assert.ok(await ready(approved[0]));
	assert.equal(await ready(aNotice), null, 'assignment notices never deliver for completed work');
	await assertCopy(approved[0], 'This topic was approved and completed.', 'หัวข้องานนี้ได้รับอนุมัติและเสร็จแล้ว');
	const snapshots = (await q('SELECT completed_at,completion_deadline_at,completion_deadline_precision,completion_timezone FROM project_topics WHERE id=$1', [t.id])).rows[0];
	assert.ok(snapshots.completed_at); assert.equal(snapshots.completion_timezone, 'Asia/Bangkok');
	t = (await core.projects.updateTopic(p.code, t.id, owner, { title: 'Approved edited title', expectedRevision: t.revision })).topic;
	assert.ok(await ready(approved[0]), 'metadata does not stale approval');
	assert.deepEqual((await q('SELECT completed_at,completion_deadline_at,completion_deadline_precision,completion_timezone FROM project_topics WHERE id=$1', [t.id])).rows[0], snapshots);
	t = await decision(p, t, owner, 'reopen');
	assert.equal(await ready(approved[0]), null);
	const reopened = await events(p, 'project_topic_reopened', t);
	assert.deepEqual(reopened.map(e => e.user_id).sort(), [a, b].sort()); assert.ok(await ready(reopened[0]));
	await assertCopy(reopened[0], 'This topic was reopened.', 'หัวข้องานนี้ถูกเปิดกลับมาทำต่อ');
	t = (await report(p, t, a, true)).topic; assert.equal(await ready(reopened[0]), null);
	// A withdrawal then another review request must not resurrect the old request.
	const lastReview = (await events(p, 'project_topic_review_requested', t)).filter(e => e.payload.topicRevision === t.revision);
	t = (await report(p, t, a)).topic; assert.equal(await ready(lastReview[0]), null);
	t = (await report(p, t, a, true)).topic; assert.equal(await ready(lastReview[0]), null);
	const eventCount = (await events(p, null, t)).length;
	t = (await core.projects.updateTopic(p.code, t.id, owner, { archived: true, expectedRevision: t.revision })).topic;
	t = (await core.projects.updateTopic(p.code, t.id, owner, { archived: false, expectedRevision: t.revision })).topic;
	assert.equal((await events(p, null, t)).length, eventCount, 'archive/restore has no workflow hook');
	// An assignee who is also a lead is one recipient; a lead acting on their own work is excluded.
	let overlap = await topic(p, owner, [a, b]);
	overlap = (await report(p, overlap, a, true)).topic;
	assert.equal((await events(p, 'project_topic_review_requested', overlap)).filter(e => e.user_id === b).length, 1);
	overlap = await decision(p, overlap, b, 'return');
	assert.deepEqual((await events(p, 'project_topic_returned', overlap)).map(e => e.user_id), [a]);
	// No generation while planning/paused, missing/disabled settings, or dm=false; no activation backfill.
	for (const options of [{ status: 'planning' }, { settings: false }]) {
		const other = await project(owner, members, options); await topic(other, owner, [a]);
		assert.equal((await events(other)).length, 0);
		if (options.status) await core.projects.setProjectState(other.code, owner, { status: 'active', expectedRevision: (await q('SELECT revision FROM projects WHERE id=$1', [other.id])).rows[0].revision });
		assert.equal((await events(other)).length, 0);
	}
	for (const field of ['enabled', 'dm_enabled']) {
		await q(`UPDATE project_notification_settings SET ${field}=false WHERE project_id=$1`, [p.id]);
		const suppressed = await topic(p, owner, [a]); assert.equal((await events(p, null, suppressed)).length, 0);
		await q(`UPDATE project_notification_settings SET ${field}=true WHERE project_id=$1`, [p.id]);
	}
	await q("UPDATE projects SET status='paused' WHERE id=$1", [p.id]);
	const paused = await topic(p, owner, [a]); assert.equal((await events(p, null, paused)).length, 0);
	await q("UPDATE projects SET status='active' WHERE id=$1", [p.id]); assert.equal((await events(p, null, paused)).length, 0);
	// All modes and identities. Off creates no delivery; there is no email fallback from discord-only.
	const preferencesTopic = await topic(p, owner, [a, b, email, off]);
	const prefEvents = await events(p, 'project_topic_assigned', preferencesTopic);
	for (const [id, expected] of [[a, ['discord', 'email']], [b, ['discord']], [email, ['email']], [off, []]]) {
		const event = prefEvents.find(e => e.user_id === id); assert.ok(event);
		assert.deepEqual((await q('SELECT channel FROM notification_deliveries WHERE event_id=$1 ORDER BY channel', [event.id])).rows.map(r => r.channel), expected);
	}
	const bothEvent = prefEvents.find(e => e.user_id === a);
	await core.users.setNotificationPreferences(a, { mode: 'email', locale: 'th' });
	assert.equal(await ready(bothEvent, 'discord'), null); assert.ok(await ready(bothEvent, 'email'));
	await core.users.setNotificationPreferences(a, { mode: 'off', locale: 'th' }); assert.equal(await ready(bothEvent, 'email'), null);
	await core.users.setNotificationPreferences(a, { mode: 'both', locale: 'th' });
	await q("UPDATE identities SET email_verified=false WHERE user_id=$1 AND provider='google'", [a]); assert.equal(await ready(bothEvent, 'email'), null);
	await q("UPDATE identities SET email_verified=true WHERE user_id=$1 AND provider='google'", [a]);
	await q("UPDATE identities SET email='changed@example.test' WHERE user_id=$1 AND provider='google'", [a]); assert.equal(await ready(bothEvent, 'email'), null);
	await q("UPDATE identities SET email=$2 WHERE user_id=$1 AND provider='google'", [a, `workflow-${seed}-3@example.test`]);
	const originalIdentity = (await q("SELECT * FROM identities WHERE user_id=$1 AND provider='discord'", [a])).rows[0];
	assert.equal((await core.users.unlinkIdentity(a, 'discord')).unlinked, true); assert.equal(await ready(bothEvent), null);
	await q('INSERT INTO identities SELECT (jsonb_populate_record(NULL::identities,$1::jsonb)).*', [originalIdentity]);
	await q("UPDATE identities SET provider_uid=provider_uid || '9' WHERE user_id=$1 AND provider='discord'", [a]); assert.equal(await ready(bothEvent), null);
	await q("UPDATE identities SET provider_uid=left(provider_uid,length(provider_uid)-1) WHERE user_id=$1 AND provider='discord'", [a]);
	await q("UPDATE project_memberships SET revoked_at=now() WHERE project_id=$1 AND user_id=$2", [p.id, a]); assert.equal(await ready(bothEvent), null);
	await q('UPDATE project_memberships SET revoked_at=NULL WHERE project_id=$1 AND user_id=$2', [p.id, a]);
	await q("UPDATE projects SET status='paused' WHERE id=$1", [p.id]); assert.equal(await ready(bothEvent), null);
	await q("UPDATE projects SET status='active' WHERE id=$1", [p.id]);
	await q('UPDATE project_topics SET archived_at=now() WHERE id=$1', [preferencesTopic.id]); assert.equal(await ready(bothEvent), null);
	await q('UPDATE project_topics SET archived_at=NULL WHERE id=$1', [preferencesTopic.id]);
	// Current Team boundary is checked independently of retained project membership.
	const { team } = await core.teams.createTeam({ ownerUserId: owner, name: 'Workflow team' }); teams.push(team.id);
	await q("INSERT INTO team_memberships(team_id,user_id,role) VALUES($1,$2,'member')", [team.id, a]);
	await q('UPDATE projects SET team_id=$2 WHERE id=$1', [p.id, team.id]); assert.ok(await ready(bothEvent));
	await q('UPDATE team_memberships SET revoked_at=now() WHERE team_id=$1 AND user_id=$2', [team.id, a]); assert.equal(await ready(bothEvent), null);
	await q('UPDATE team_memberships SET revoked_at=NULL WHERE team_id=$1 AND user_id=$2', [team.id, a]);
	await q('UPDATE teams SET archived_at=now() WHERE id=$1', [team.id]); assert.equal(await ready(bothEvent), null);
	await q('UPDATE teams SET archived_at=NULL WHERE id=$1', [team.id]); await q('UPDATE projects SET team_id=NULL WHERE id=$1', [p.id]);
	// Retained Company policy is exercised transactionally, without reviving it globally.
	const rollbackCompany = new Error('rollback Company fixture');
	await assert.rejects(core.db.transaction(async client => {
		await require('../core/company-schema').installCompanySchema(client);
		const company = `com_workflow_${seed}`;
		await client.query("INSERT INTO companies(id,discord_guild_id,name,lifecycle) VALUES($1,$2,'Private Company','active')", [company, String(seed)]);
		await client.query("INSERT INTO company_memberships(company_id,user_id,role) VALUES($1,$2,'member')", [company, a]);
		await client.query('UPDATE teams SET company_id=$2 WHERE id=$1', [team.id, company]);
		await client.query('UPDATE projects SET team_id=$2 WHERE id=$1', [p.id, team.id]);
		const d = await row(bothEvent, 'discord', client); assert.ok(await workflow.prepareWithClient(client, d));
		await client.query('UPDATE company_memberships SET revoked_at=now() WHERE company_id=$1 AND user_id=$2', [company, a]);
		assert.equal(await workflow.prepareWithClient(client, d), null);
		await client.query('UPDATE company_memberships SET revoked_at=NULL WHERE company_id=$1 AND user_id=$2', [company, a]);
		await client.query("UPDATE companies SET lifecycle='archived',archived_at=now() WHERE id=$1", [company]);
		assert.equal(await workflow.prepareWithClient(client, d), null);
		throw rollbackCompany;
	}), e => e === rollbackCompany);
	// Persistence failure rolls back actual mutation + audit + outbox using the same client.
	const originalEnqueue = core.notifications.enqueueWithClient;
	const before = (await q('SELECT revision FROM projects WHERE id=$1', [p.id])).rows[0].revision;
	const beforeEvents = (await q('SELECT count(*)::int AS n FROM project_events WHERE project_id=$1', [p.id])).rows[0].n;
	const beforeNotices = (await events(p)).length;
	try {
		core.notifications.enqueueWithClient = async (client, options) => { await originalEnqueue(client, options); throw new Error('fixture outbox failure'); };
		await assert.rejects(topic(p, owner, [a], 'Must roll back'), /fixture outbox failure/);
	} finally { core.notifications.enqueueWithClient = originalEnqueue; }
	assert.equal((await q("SELECT count(*)::int AS n FROM project_topics WHERE project_id=$1 AND title='Must roll back'", [p.id])).rows[0].n, 0);
	assert.equal((await q('SELECT revision FROM projects WHERE id=$1', [p.id])).rows[0].revision, before);
	assert.equal((await q('SELECT count(*)::int AS n FROM project_events WHERE project_id=$1', [p.id])).rows[0].n, beforeEvents);
	assert.equal((await events(p)).length, beforeNotices);
	let rollbackTopic = await topic(p, owner, [a], 'Rollback boundaries');
	async function expectWorkflowRollback(operation) {
		const beforeTopic = (await q('SELECT * FROM project_topics WHERE id=$1', [rollbackTopic.id])).rows[0];
		const beforeEvents = (await q('SELECT count(*)::int AS n FROM project_events WHERE project_id=$1', [p.id])).rows[0].n;
		const beforeReports = (await q('SELECT count(*)::int AS n FROM project_progress_reports WHERE topic_id=$1', [rollbackTopic.id])).rows[0].n;
		const beforeNotices = (await events(p)).length;
		try {
			core.notifications.enqueueWithClient = async (client, options) => { await originalEnqueue(client, options); throw new Error('fixture outbox failure'); };
			await assert.rejects(operation(), /fixture outbox failure/);
		} finally { core.notifications.enqueueWithClient = originalEnqueue; }
		assert.deepEqual((await q('SELECT * FROM project_topics WHERE id=$1', [rollbackTopic.id])).rows[0], beforeTopic);
		assert.equal((await q('SELECT count(*)::int AS n FROM project_events WHERE project_id=$1', [p.id])).rows[0].n, beforeEvents);
		assert.equal((await q('SELECT count(*)::int AS n FROM project_progress_reports WHERE topic_id=$1', [rollbackTopic.id])).rows[0].n, beforeReports);
		assert.equal((await events(p)).length, beforeNotices);
	}
	await expectWorkflowRollback(() => core.projects.setTopicAssignees(p.code, rollbackTopic.id, owner, { userIds: [a, b], expectedRevision: rollbackTopic.revision }));
	assert.deepEqual((await q('SELECT user_id FROM project_topic_assignees WHERE topic_id=$1', [rollbackTopic.id])).rows.map(r => r.user_id), [a]);
	await expectWorkflowRollback(() => report(p, rollbackTopic, a, true));
	rollbackTopic = (await report(p, rollbackTopic, a, true)).topic;
	await expectWorkflowRollback(() => decision(p, rollbackTopic, owner, 'return'));
	const createRevision = (await q('SELECT revision FROM projects WHERE id=$1', [p.id])).rows[0].revision;
	const creationRace = await Promise.allSettled([1, 2].map(() => core.projects.createTopic(p.code, owner, { title: 'Concurrent creation', assigneeUserIds: [a], expectedRevision: createRevision })));
	assert.equal(creationRace.filter(r => r.status === 'fulfilled').length, 1);
	assert.equal(creationRace.find(r => r.status === 'rejected').reason.code, 'revision_conflict');
	const latestAssignment = (await events(p, 'project_topic_assigned')).find(e => e.payload.topicRevision === 0 && e.payload.topicId !== preferencesTopic.id && e.user_id === a);
	await core.db.transaction(async client => {
		const source = latestAssignment.payload;
		await Promise.all([1, 2].map(() => workflow.enqueueWithClient(client, { project: { id: p.id, status: 'active' }, topic: { id: source.topicId, revision: source.topicRevision }, eventId: source.projectEventId, eventType: latestAssignment.event_type, recipients: [a, a] })));
	});
	assert.equal((await q('SELECT count(*)::int AS n FROM notification_events WHERE dedupe_key=$1', [latestAssignment.dedupe_key])).rows[0].n, 1);
	assert.equal((await q('SELECT count(*)::int AS n FROM notification_deliveries WHERE event_id=$1', [latestAssignment.id])).rows[0].n, 2);
	// Existing audit/notification actor references move together across a real account merge.
	const mergedActor = await user('email');
	await q("INSERT INTO project_memberships(project_id,user_id,role) VALUES($1,$2,'lead')", [p.id, mergedActor]);
	const mergeTopic = await topic(p, mergedActor, [owner]);
	const mergeNotice = (await events(p, 'project_topic_assigned', mergeTopic))[0]; assert.ok(await ready(mergeNotice));
	await core.accountMerge.mergeAccounts({ userIdA: owner, userIdB: mergedActor });
	assert.equal((await q('SELECT actor_user_id FROM project_events WHERE id=$1', [mergeNotice.payload.projectEventId])).rows[0].actor_user_id, owner);
	assert.equal(await ready(mergeNotice), null, 'canonical merged actor cannot receive own workflow notice');
	// Actual queue leases: two workers, reclaim/restart, stale-worker fence and bounded retries.
	await clearFixtureQueue();
	const deliveryTopic = await topic(p, owner, [b]);
	const freshEvent = (await events(p, 'project_topic_assigned', deliveryTopic))[0];
	const claims = await Promise.all([core.notifications.claimPending(100), core.notifications.claimPending(100)]);
	const ownClaims = claims.flat().filter(r => r.payload?.topicId === deliveryTopic.id);
	assert.equal(ownClaims.length, 1); const claimed = ownClaims[0];
	assert.equal(await core.notifications.recheckClaimed(claimed.id), true);
	assert.ok(await core.notifications.prepareWorkflowDelivery({ deliveryId: claimed.id, channel: 'discord', attempt: 1 }, (await q("SELECT provider_uid FROM identities WHERE user_id=$1 AND provider='discord'", [b])).rows[0].provider_uid));
	await q("UPDATE notification_deliveries SET locked_at=now()-interval '6 minutes' WHERE id=$1", [claimed.id]);
	await core.db.close(); // process-style restart: durable queue is not in memory.
	const reclaimed = (await core.notifications.claimPending(100)).find(r => r.id === claimed.id); assert.equal(reclaimed.attempts, 1);
	await core.notifications.markSent(claimed.id, 1);
	assert.equal((await row(freshEvent)).status, 'sending', 'stale worker cannot acknowledge reclaimed lease');
	await core.notifications.markFailed(claimed.id, new Error('timeout'), 1, 2);
	assert.equal((await row(freshEvent)).status, 'failed');
	await q("UPDATE notification_deliveries SET next_attempt_at=now(),attempts=7 WHERE id=$1", [claimed.id]);
	const final = (await core.notifications.claimPending(100)).find(r => r.id === claimed.id); assert.equal(final.attempts, 7);
	await core.notifications.markFailed(claimed.id, new Error('API outage'), final.attempts, 8);
	assert.equal((await row(freshEvent)).status, 'skipped');
	// Positive send + lost IPC acknowledgement retries: deliberately at-least-once, not exactly-once.
	await clearFixtureQueue(); const lostTopic = await topic(p, owner, [b]); const lostEvent = (await events(p, 'project_topic_assigned', lostTopic))[0];
	let calls = 0;
	const dispatcher = createDispatcher({ sendDiscord: async () => { calls++; if (calls === 1) throw new Error('lost acknowledgement after send'); return { delivered: 1, blocked: false }; } });
	await dispatcher.drain(); assert.equal((await row(lostEvent)).status, 'failed');
	await q('UPDATE notification_deliveries SET next_attempt_at=now() WHERE event_id=$1', [lostEvent.id]);
	await dispatcher.drain(); assert.equal(calls, 2); assert.equal((await row(lostEvent)).status, 'sent');
	// Eligibility changes AFTER claim, including a real DB revocation while Discord fetch waits.
	for (const change of ['preference', 'identity', 'access-during-fetch']) {
		await clearFixtureQueue(); const boundaryTopic = await topic(p, owner, [b]);
		const event = (await events(p, 'project_topic_assigned', boundaryTopic))[0];
		const claimedBoundary = (await core.notifications.claimPending(100)).find(d => d.payload?.topicId === boundaryTopic.id);
		const ref = { deliveryId: claimedBoundary.id, channel: 'discord', attempt: 1 };
		const uid = (await q("SELECT provider_uid FROM identities WHERE user_id=$1 AND provider='discord'", [b])).rows[0].provider_uid;
		if (change === 'preference') {
			await core.users.setNotificationPreferences(b, { mode: 'off', locale: 'en' });
			assert.equal(await core.notifications.prepareWorkflowDelivery(ref, uid), null);
			await core.users.setNotificationPreferences(b, { mode: 'discord', locale: 'en' });
		} else if (change === 'identity') {
			await q("UPDATE identities SET provider_uid=provider_uid || '9' WHERE user_id=$1 AND provider='discord'", [b]);
			assert.equal(await core.notifications.prepareWorkflowDelivery(ref, uid), null);
			await q("UPDATE identities SET provider_uid=left(provider_uid,length(provider_uid)-1) WHERE user_id=$1 AND provider='discord'", [b]);
		} else {
			let fetched, release, sends = 0;
			const fetching = new Promise(r => { fetched = r; }), gate = new Promise(r => { release = r; });
			const pending = deliverNotice({ recipients: [uid], message: 'must not send', workflowDelivery: ref }, {
				users: { cache: new Map(), fetch: async () => { fetched(); await gate; return { send: async () => { sends++; } }; } },
				discordCall: async (_label, call, fallback) => { try { return await call(); } catch { return fallback; } }, isBlocked: () => false,
				prepareWorkflow: core.notifications.prepareWorkflowDelivery, noticeComponents: () => [], wait: async () => {},
			});
			await fetching; await q('UPDATE project_memberships SET revoked_at=now() WHERE project_id=$1 AND user_id=$2', [p.id, b]);
			release(); assert.equal((await pending).outcome, 'ineligible'); assert.equal(sends, 0);
			await q('UPDATE project_memberships SET revoked_at=NULL WHERE project_id=$1 AND user_id=$2', [p.id, b]);
		}
		assert.equal((await row(event)).status, 'skipped');
	}
	// Verified email delivery uses the current authorised title and account address.
	await clearFixtureQueue(); const emailTopic = await topic(p, owner, [email]);
	const emailEvent = (await events(p, 'project_topic_assigned', emailTopic))[0];
	const emailSends = [];
	await createDispatcher({ sendDiscord: async () => { throw new Error('email-only must not call Discord'); }, sendEmail: async content => { emailSends.push(content); } }).drain();
	assert.equal(emailSends.length, 1); assert.equal(emailSends[0].ctaLabel, 'Open topic');
	assert.ok(!emailSends[0].body.includes('NEVER_SEND_DESCRIPTION')); assert.equal((await row(emailEvent, 'email')).status, 'sent');
	await clearFixtureQueue(); const revokedMailTopic = await topic(p, owner, [email]);
	const revokedMailEvent = (await events(p, 'project_topic_assigned', revokedMailTopic))[0];
	const originalClaim = core.notifications.claimPending;
	try {
		core.notifications.claimPending = async () => {
			const claimed = await originalClaim();
			await q("UPDATE identities SET email_verified=false WHERE user_id=$1 AND provider='google'", [email]);
			return claimed;
		};
		await createDispatcher({ sendDiscord: async () => { throw new Error('unexpected Discord'); }, sendEmail: async content => { emailSends.push(content); } }).drain();
	} finally { core.notifications.claimPending = originalClaim; }
	assert.equal(emailSends.length, 1); assert.equal((await row(revokedMailEvent, 'email')).status, 'skipped');
	// The help text covers all five intents without introducing preference controls.
	const en = require('../app/copy/en'), th = require('../app/copy/th');
	for (const word of ['assignments', 'review', 'returned', 'approval', 'reopened']) assert.ok(en.projects.dmHint.includes(word));
	for (const word of ['มอบหมาย', 'ตรวจ', 'ส่งกลับ', 'อนุมัติ', 'เปิดกลับ']) assert.ok(th.projects.dmHint.includes(word));
	console.log('PASS: all five workflow hooks; recipient/actor/merge, preferences, identity/access/privacy, cycle freshness, atomic rollback, concurrent replay/claims, restart/reclaim, bounded retries and lost acknowledgement');
}
async function cleanup() {
	await q('DELETE FROM project_topic_assignees WHERE project_id=ANY($1::text[])', [projects]);
	await q('DELETE FROM project_progress_reports WHERE project_id=ANY($1::text[])', [projects]);
	await q('DELETE FROM project_events WHERE project_id=ANY($1::text[])', [projects]);
	await q('DELETE FROM projects WHERE id=ANY($1::text[])', [projects]);
	await q('DELETE FROM teams WHERE id=ANY($1::text[])', [teams]);
	await q('DELETE FROM account_merges WHERE survivor_user_id=ANY($1::text[])', [users]);
	await q('DELETE FROM user_aliases WHERE user_id=ANY($1::text[]) OR old_user_id=ANY($1::text[])', [users]);
	await q('DELETE FROM users WHERE id=ANY($1::text[])', [users]);
}
main().then(cleanup).then(() => core.db.close()).catch(async error => {
	console.error(error); await cleanup().catch(() => {}); await core.db.close().catch(() => {}); process.exitCode = 1;
});
