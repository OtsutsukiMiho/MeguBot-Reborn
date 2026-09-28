'use strict';
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { randomBytes } = require('node:crypto');
const { isDisposableTestDatabase } = require('./test-database');

(async () => {
	const source = process.env.MEGU_TEST_DATABASE_URL || process.env.MEGU_DATABASE_URL;
	assert.ok(isDisposableTestDatabase(source), 'Explicit local test database required');
	// Own a fresh database so committed concurrent transactions cannot touch
	// another test's fixtures or require disabling immutable-history triggers.
	const database = `megu_goal_race_${randomBytes(8).toString('hex')}_test`;
	const url = new URL(source); url.pathname = '/postgres';
	const admin = new Client({ connectionString: url.toString(), ssl: false });
	await admin.connect();
	let created = false;
	let blocker;
	let db;
	try {
		await admin.query(`CREATE DATABASE "${database}"`); created = true;
		url.pathname = `/${database}`;
		process.env.MEGU_DATABASE_URL = url.toString();
		process.env.MEGU_TEAM_GOALS_ENABLED = '1';
		process.env.MEGU_PROJECT_TEAMS_ENABLED = '1';
		process.env.PG_POOL_MAX = '4';
		db = require('../core/db');
		await require('../core/schema').initCoreSchema();
		await db.query("INSERT INTO users(id,display_name) VALUES ('owner','Owner'),('subject','Subject')");
		await db.query("INSERT INTO teams(id,name,created_by) VALUES ('team','Race team','owner')");
		await db.query("INSERT INTO team_memberships(team_id,user_id,role) VALUES ('team','owner','owner'),('team','subject','member')");
		const goals = require('../core/team-goals');
		const goal = await goals.createGoal('team', 'owner', { subjectId: 'subject', reviewerId: 'owner', title: 'Concurrent delivery', successDescription: 'Accepted delivery', periodStart: '2026-09-01', periodEnd: '2026-09-30', timezone: 'UTC', measurement: { kind: 'numeric', direction: 'increase', baseline: 0, target: 10, unit: 'items' } });
		await goals.transitionGoal(goal.id, 'owner', { action: 'propose', version: 1, expectedRevision: 0 });
		blocker = new Client({ connectionString: url.toString(), ssl: false }); await blocker.connect();
		const race = async (operations, idempotent = false) => {
			await blocker.query("BEGIN; SELECT pg_advisory_xact_lock(hashtext('team-goals-identity'))");
			const results = Promise.allSettled(operations.map(operation => operation()));
			try {
				const deadline = Date.now() + 5000;
				let waiting = 0;
				while (Date.now() < deadline) {
					waiting = (await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND wait_event='advisory'", [database])).rows[0].n;
					if (waiting === operations.length) break;
					await new Promise(resolve => setTimeout(resolve, 20));
				}
				assert.equal(waiting, operations.length, 'Both operations must be live on separate blocked connections');
			} finally { await blocker.query('ROLLBACK'); }
			const settled = await results;
			if (idempotent) {
				assert.equal(settled.filter(item => item.status === 'fulfilled').length, operations.length);
				assert.deepEqual(settled[0].value, settled[1].value);
				return settled[0].value;
			}
			assert.equal(settled.filter(item => item.status === 'fulfilled').length, 1);
			assert.deepEqual(settled.filter(item => item.status === 'rejected').map(item => item.reason.code), ['goal_revision_conflict']);
			return settled.findIndex(item => item.status === 'fulfilled');
		};
		const input = { subjectId: 'subject', reviewerId: 'owner', title: 'Retry safely', successDescription: 'One durable draft', periodStart: '2026-09-01', periodEnd: '2026-09-30', timezone: 'UTC', measurement: { kind: 'milestone', criteria: 'Accepted' }, requestKey: 'goal_retry_1234567890' };
		const receipt = await race([() => goals.createGoal('team', 'owner', input), () => goals.createGoal('team', 'owner', input)], true);
		assert.equal((await db.query('SELECT count(*)::int AS n FROM team_goals WHERE creation_request_key=$1', [input.requestKey])).rows[0].n, 1);
		assert.equal((await db.query('SELECT count(*)::int AS n FROM team_goal_events WHERE goal_id=$1', [receipt.id])).rows[0].n, 1);
		assert.equal((await db.query('SELECT count(*)::int AS n FROM team_goal_versions WHERE goal_id=$1', [receipt.id])).rows[0].n, 1);
		await goals.transitionGoal(receipt.id, 'subject', { action: 'edit', version: 1, expectedRevision: 0, title: 'Changed after creation', reason: 'Correction' });
		assert.deepEqual(await goals.createGoal('team', 'owner', input), receipt, 'Replay must return the original creation receipt after later edits');
		await assert.rejects(goals.createGoal('team', 'owner', { ...input, title: 'Different request' }), { code: 'idempotency_conflict' });
		await assert.rejects(goals.createGoal('team', 'subject', input), { code: 'idempotency_conflict' });
		await db.query("INSERT INTO teams(id,name,created_by) VALUES ('other-team','Other team','owner'); INSERT INTO team_memberships(team_id,user_id,role) VALUES ('other-team','owner','owner')");
		await assert.rejects(goals.createGoal('other-team', 'owner', input), { code: 'idempotency_conflict' });
		for (const requestKey of ['', null, 12, 'short', 'a'.repeat(101)]) await assert.rejects(goals.createGoal('team', 'owner', { ...input, requestKey }), { code: 'idempotency_key_invalid' });
		await db.query("UPDATE team_memberships SET revoked_at=now() WHERE team_id='team' AND user_id='subject'");
		assert.deepEqual(await goals.createGoal('team', 'owner', input), receipt, 'A subject leaving cannot make an already committed request create a duplicate');
		await assert.rejects(goals.createGoal('team', 'subject', input), { code: 'team_not_found' });
		await db.query("UPDATE team_memberships SET revoked_at=NULL WHERE team_id='team' AND user_id='subject'");
		const accepted = await race(['owner', 'subject'].map(actor => () => goals.transitionGoal(goal.id, actor, { action: 'accept', version: 1, expectedRevision: 1 })));
		assert.equal((await goals.getGoal(goal.id, 'subject')).goal.lifecycle, 'proposed');
		await goals.transitionGoal(goal.id, accepted === 0 ? 'subject' : 'owner', { action: 'accept', version: 1, expectedRevision: 2 });
		assert.equal((await goals.getGoal(goal.id, 'subject')).goal.lifecycle, 'active');
		await race([12, 15].map(value => () => goals.transitionGoal(goal.id, 'subject', { action: 'evidence', version: 1, expectedRevision: 3, value, note: 'One concurrent report' })));
		assert.equal((await goals.getGoal(goal.id, 'subject')).updates.length, 1);
		await goals.transitionGoal(goal.id, 'subject', { action: 'submit', version: 1, expectedRevision: 4, selfReview: 'Delivered' });
		await race(['met', 'exceeded'].map(outcome => () => goals.transitionGoal(goal.id, 'owner', { action: 'review', version: 1, expectedRevision: 5, outcome, explanation: 'Evidence checked', nextStep: 'Next period' })));
		assert.equal((await goals.getGoal(goal.id, 'subject')).goal.revision, 6);
		assert.equal((await db.query('SELECT count(*)::int AS n FROM team_goal_reviews WHERE goal_id=$1', [goal.id])).rows[0].n, 1);
		console.log('Goal concurrency passed: separate live connections, stale acceptance/evidence/review rejected, exactly one write per race');
	} finally {
		if (blocker) await blocker.end();
		if (db) await db.close();
		// Only the exact random database successfully created by this run is removed.
		if (created) await admin.query(`DROP DATABASE "${database}"`);
		await admin.end();
	}
})().catch(error => { console.error(error); process.exitCode = 1; });
