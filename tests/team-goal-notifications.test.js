'use strict';
const assert = require('node:assert/strict');
const db = require('../core/db');
const { isDisposableTestDatabase } = require('./test-database');
(async () => {
	assert.ok(isDisposableTestDatabase(process.env.MEGU_TEST_DATABASE_URL));
	process.env.MEGU_DATABASE_URL = process.env.MEGU_TEST_DATABASE_URL; process.env.MEGU_TEAM_GOALS_ENABLED = '1';
	await require('../core/schema').initCoreSchema();
	const client = await db.getPool().connect(), originalTransaction = db.transaction, originalQuery = db.query;
	try {
		await client.query('BEGIN');
		db.query = (...args) => client.query(...args);
		db.transaction = async fn => {
			await client.query('SAVEPOINT notification_operation');
			try { const result = await fn(client); await client.query('RELEASE SAVEPOINT notification_operation'); return result; }
			catch (error) { await client.query('ROLLBACK TO SAVEPOINT notification_operation'); throw error; }
		};
		const goals = require('../core/team-goals'), outbox = require('../core/notifications'), reminders = require('../core/team-goal-notifications');
		const teamId = `goal_notify_${Date.now()}`, owner = `${teamId}_owner`, subject = `${teamId}_subject`, reviewer = `${teamId}_reviewer`, survivor = `${teamId}_survivor`;
		for (const user of [owner, subject, reviewer, survivor]) {
			await client.query('INSERT INTO users(id,display_name) VALUES ($1,$1)', [user]);
			if (user !== survivor) await client.query("INSERT INTO identities(id,user_id,provider,provider_uid) VALUES ($1,$2,'discord',$2)", [`${user}_discord`, user]);
			await client.query("INSERT INTO notification_preferences(user_id,mode,locale) VALUES ($1,'discord','en')", [user]);
		}
		await client.query("INSERT INTO identities(id,user_id,provider,provider_uid,email,email_verified) VALUES ($1,$2,'google',$2,'fixture@example.invalid',true)", [`${owner}_google`, owner]);
		await client.query("UPDATE notification_preferences SET mode='both',locale='th' WHERE user_id=$1", [owner]);
		await client.query('INSERT INTO teams(id,name,created_by) VALUES ($1,$1,$2)', [teamId, owner]);
		for (const [user, role] of [[owner, 'owner'], [subject, 'member'], [reviewer, 'admin']]) await client.query('INSERT INTO team_memberships(team_id,user_id,role) VALUES ($1,$2,$3)', [teamId, user, role]);
		const end = new Date(Date.now() - 86400000).toISOString().slice(0, 10), start = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
		const input = { subjectId: subject, reviewerId: owner, title: 'Private goal title', successDescription: 'Private agreement', periodStart: start, periodEnd: end, timezone: 'Asia/Bangkok', measurement: { kind: 'numeric', direction: 'increase', baseline: 0, target: 30, unit: 'private unit' }, requestKey: teamId };
		const goal = await goals.createGoal(teamId, owner, input);
		assert.deepEqual(await goals.createGoal(teamId, owner, input), goal);
		const notices = async () => (await client.query("SELECT e.*,d.id AS delivery_id,d.channel,d.status FROM notification_events e LEFT JOIN notification_deliveries d ON d.event_id=e.id WHERE e.payload->>'goalId'=$1 ORDER BY e.created_at,e.id", [goal.id])).rows;
		assert.equal((await notices()).length, 1, 'Creation replay cannot duplicate its notice');
		const creation = (await outbox.claimPending(200)).find(row => row.payload.goalId === goal.id); assert.ok(creation);
		await goals.transitionGoal(goal.id, owner, { action: 'propose', version: 1, expectedRevision: 0 });
		assert.equal(await outbox.recheckClaimed(creation.id), false, 'Progressed goals invalidate older notices after claim');
		const proposal = (await outbox.claimPending(200)).find(row => row.payload.goalId === goal.id); assert.ok(proposal);
		await client.query("UPDATE notification_preferences SET mode='off' WHERE user_id=$1", [subject]);
		assert.equal(await outbox.recheckClaimed(proposal.id), false, 'Preference changes are rechecked immediately before dispatch');
		await client.query("UPDATE notification_preferences SET mode='discord' WHERE user_id=$1", [subject]);
		await goals.transitionGoal(goal.id, subject, { action: 'accept', version: 1, expectedRevision: 1 });
		const ownerNotice = (await notices()).filter(row => row.payload.goalRevision === 2); assert.equal(ownerNotice.length, 2);
		assert.deepEqual(ownerNotice.map(row => row.channel).sort(), ['discord', 'email']); assert.equal(ownerNotice[0].payload.locale, 'th');
		await goals.transitionGoal(goal.id, owner, { action: 'accept', version: 1, expectedRevision: 2 });
		assert.equal((await reminders.queueDue({ now: `${end}T16:59:59Z`, baseUrl: 'https://fixture.example.invalid' })).queued, 0, 'Inclusive period end has not passed in Bangkok yet');
		assert.equal((await reminders.queueDue({ now: `${end}T17:00:00Z`, baseUrl: 'https://fixture.example.invalid', limit: 1 })).queued, 1);
		assert.equal((await reminders.queueDue({ now: `${end}T17:00:00Z`, baseUrl: 'https://fixture.example.invalid', limit: 1 })).queued, 1, 'A bounded sweep advances past already recorded recipients');
		assert.equal((await reminders.queueDue({ baseUrl: 'https://fixture.example.invalid' })).queued, 0);
		const due = (await outbox.claimPending(200)).filter(row => row.payload.goalId === goal.id && row.event_type === 'team_goal_due'); assert.equal(due.length, 3);
		await goals.transitionGoal(goal.id, subject, { action: 'evidence', version: 1, expectedRevision: 3, value: 21, note: 'Private evidence note', links: ['https://private.example.invalid/evidence'] });
		assert.equal(await outbox.recheckClaimed(due[0].id), true, 'An evidence update does not obsolete a period reminder');
		await goals.reassignReviewer(goal.id, owner, { expectedRevision: 4, reviewerId: reviewer, reason: 'Private reassignment reason' });
		for (const row of due) assert.equal(await outbox.recheckClaimed(row.id), false, 'Reassignment invalidates pending reminders and former reviewer recipients');
		await goals.transitionGoal(goal.id, subject, { action: 'accept', version: 1, expectedRevision: 5 });
		await goals.transitionGoal(goal.id, reviewer, { action: 'accept', version: 1, expectedRevision: 6 });
		assert.equal((await reminders.queueDue()).queued, 1, 'Newly accepted reviewer gets its own deduplicated period notice');
		const reassignedDue = (await outbox.claimPending(200)).find(row => row.user_id === reviewer && row.event_type === 'team_goal_due'); assert.ok(reassignedDue);
		await goals.transitionGoal(goal.id, subject, { action: 'cancel', version: 1, expectedRevision: 7, reason: 'Private cancellation' });
		assert.equal(await outbox.recheckClaimed(reassignedDue.id), false); assert.equal((await reminders.queueDue()).queued, 0);
		const cancellation = (await outbox.claimPending(200)).find(row => row.payload.goalId === goal.id && row.payload.goalRevision === 8); assert.ok(cancellation);
		await client.query("UPDATE team_memberships SET role='member' WHERE team_id=$1 AND user_id=$2", [teamId, reviewer]);
		assert.equal(await outbox.recheckClaimed(cancellation.id), false, 'Reviewer demotion after claim blocks delivery');
		await client.query("UPDATE team_memberships SET role='admin' WHERE team_id=$1 AND user_id=$2", [teamId, reviewer]);
		const assessed = await goals.createGoal(teamId, owner, { ...input, requestKey: undefined });
		for (const [actor, payload] of [
			[owner, { action: 'propose', expectedRevision: 0 }], [subject, { action: 'accept', expectedRevision: 1 }],
			[owner, { action: 'accept', expectedRevision: 2 }],
			[subject, { action: 'submit', expectedRevision: 3, selfReview: 'Private self review' }],
			[owner, { action: 'review', expectedRevision: 4, outcome: 'not_met', explanation: 'Private assessment', nextStep: 'Private next step' }],
		]) await goals.transitionGoal(assessed.id, actor, { ...payload, version: 1 });
		const publication = (await client.query("SELECT payload FROM notification_events WHERE payload->>'goalId'=$1 AND payload->>'goalRevision'='5'", [assessed.id])).rows;
		assert.equal(publication.length, 1);
		for (const secret of ['Private self review', 'not_met', 'Private assessment', 'Private next step']) assert.ok(!JSON.stringify(publication[0].payload).includes(secret));
		for (const row of await notices()) {
			assert.ok([owner, subject, reviewer].includes(row.user_id));
			const payload = JSON.stringify(row.payload);
			for (const secret of [input.title, input.successDescription, 'private unit', 'Private evidence note', 'private.example.invalid', 'Private reassignment reason', 'Private cancellation']) assert.ok(!payload.includes(secret));
			assert.ok(!['value', 'outcome', 'rating', 'measurement', 'note', 'explanation'].some(key => Object.hasOwn(row.payload, key)));
			assert.ok(outbox.render(row).body.includes(row.payload.locale === 'th' ? 'เป้าหมาย' : 'goal'));
		}
		const personal = await goals.createGoal(teamId, subject, { ...input, reviewerId: null, requestKey: undefined });
		await goals.transitionGoal(personal.id, subject, { action: 'propose', version: 1, expectedRevision: 0 });
		await goals.transitionGoal(personal.id, subject, { action: 'accept', version: 1, expectedRevision: 1 });
		const sweep = require('../adapters/notifications/project-deadlines').createProjectDeadlineSweep({ baseUrl: 'https://fixture.example.invalid' });
		await sweep.runOnce(); await sweep.runOnce();
		assert.equal((await client.query("SELECT count(*)::int AS n FROM notification_events WHERE event_type='team_goal_due' AND payload->>'goalId'=$1", [personal.id])).rows[0].n, 1, 'Existing scheduler includes one durable personal reminder across repeated ticks');
		await client.query("UPDATE users SET created_at=created_at-interval '1 day' WHERE id=$1", [survivor]);
		assert.equal((await require('../core/account-merge').mergeAccounts({ userIdA: subject, userIdB: survivor })).survivorId, survivor);
		assert.equal((await reminders.queueDue()).queued, 0, 'Merged recipient retains its original cycle receipt');
		const personalDue = (await outbox.claimPending(200)).find(row => row.payload.goalId === personal.id); assert.ok(personalDue);
		await client.query('UPDATE teams SET archived_at=now() WHERE id=$1', [teamId]);
		assert.equal(await outbox.recheckClaimed(personalDue.id), false);
		process.env.MEGU_TEAM_GOALS_ENABLED = '0'; assert.deepEqual(await reminders.queueDue(), { queued: 0, goals: 0 });
		console.log('Goal notifications passed: generic bilingual private notices, retry/cycle deduplication, timezone end boundary, bounded sweep, preferences, post-claim revision/consent/role/archive checks and merged receipts. No external sends.');
	} finally { db.transaction = originalTransaction; db.query = originalQuery; await client.query('ROLLBACK'); client.release(); await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
