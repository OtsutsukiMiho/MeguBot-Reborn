'use strict';
const assert = require('node:assert/strict');
const db = require('../core/db');
const { isDisposableTestDatabase } = require('./test-database');
(async () => {
	assert.ok(isDisposableTestDatabase(process.env.MEGU_TEST_DATABASE_URL));
	process.env.MEGU_DATABASE_URL = process.env.MEGU_TEST_DATABASE_URL;
	process.env.MEGU_TEAM_GOALS_ENABLED = '1';
	await require('../core/schema').initCoreSchema();
	const client = await db.getPool().connect(), original = db.transaction;
	let server;
	try {
		await client.query('BEGIN');
		db.transaction = async fn => {
			await client.query('SAVEPOINT reference_operation');
			try { const result = await fn(client); await client.query('RELEASE SAVEPOINT reference_operation'); return result; }
			catch (error) { await client.query('ROLLBACK TO SAVEPOINT reference_operation'); throw error; }
		};
		const goals = require('../core/team-goals'), projects = require('../core/projects');
		const id = `reference_${Date.now()}`, owner = `${id}_owner`, subject = `${id}_subject`, admin = `${id}_admin`;
		for (const user of [owner, subject, admin]) await client.query('INSERT INTO users(id,display_name) VALUES ($1,$1)', [user]);
		await client.query('INSERT INTO teams(id,name,created_by) VALUES ($1,$1,$2)', [id, owner]);
		for (const [user, role] of [[owner, 'owner'], [subject, 'member'], [admin, 'admin']]) await client.query('INSERT INTO team_memberships(team_id,user_id,role) VALUES ($1,$2,$3)', [id, user, role]);
		const project = await projects.createProject({ ownerUserId: owner, title: 'Private linked project', timezone: 'UTC' });
		const topic = (await projects.createTopic(project.code, owner, { title: 'Private linked topic', expectedRevision: 0 })).topic;
		const other = await projects.createProject({ ownerUserId: owner, title: 'Other private project', timezone: 'UTC' });
		const wrongTopic = (await projects.createTopic(other.code, owner, { title: 'Wrong project topic', expectedRevision: 0 })).topic;
		const input = { subjectId: subject, reviewerId: owner, title: 'Delivery', successDescription: 'Accepted work', periodStart: '2026-09-01', periodEnd: '2026-09-30', timezone: 'UTC', measurement: { kind: 'milestone', criteria: 'Accepted' } };
		const goal = await goals.createGoal(id, owner, input);
		await goals.transitionGoal(goal.id, owner, { action: 'propose', version: 1, expectedRevision: 0 });
		await goals.transitionGoal(goal.id, subject, { action: 'accept', version: 1, expectedRevision: 1 });
		await goals.transitionGoal(goal.id, owner, { action: 'accept', version: 1, expectedRevision: 2 });
		const evidence = { action: 'evidence', version: 1, expectedRevision: 3, note: 'Accepted delivery', reference: { projectCode: project.code, topicId: topic.id } };
		await assert.rejects(goals.transitionGoal(goal.id, subject, { ...evidence, links: ['http://localhost:3000/teams/test/goals/goal'] }), { code: 'goal_evidence_links_invalid' });
		await assert.rejects(goals.transitionGoal(goal.id, subject, evidence), { code: 'goal_reference_unavailable' });
		assert.equal((await goals.getGoal(goal.id, subject)).goal.revision, 3);
		await client.query("INSERT INTO project_memberships(project_id,user_id,role) VALUES ($1,$2,'viewer')", [project.id, subject]);
		await assert.rejects(goals.transitionGoal(goal.id, subject, { ...evidence, reference: { projectCode: project.code, topicId: wrongTopic.id } }), { code: 'goal_reference_unavailable' });
		for (const reference of [{ projectCode: project.code, extra: true }, { projectCode: '' }, { projectCode: project.code, topicId: '' }, []]) await assert.rejects(goals.transitionGoal(goal.id, subject, { ...evidence, reference }), { code: 'goal_reference_invalid' });
		await goals.transitionGoal(goal.id, subject, evidence);
		for (const user of [owner, subject]) {
			const ref = (await goals.getGoal(goal.id, user)).updates[0].reference;
			assert.equal(ref.access, 'available'); assert.equal(ref.title, project.title); assert.equal(ref.topicTitle, topic.title);
		}
		const metadata = await goals.getGoal(goal.id, admin); assert.equal(metadata.access, 'administration'); assert.equal(metadata.updates, undefined);
		const app = require('express')(); app.use(require('express').json());
		require('../adapters/http/team-goals-api').registerTeamGoalRoutes(app, (req, res, next) => { req.actor = { userId: req.headers['x-test-user'] || admin }; next(); });
		server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
		const url = `http://127.0.0.1:${server.address().port}/team-goals/${goal.id}`;
		const hidden = async user => {
			const response = await fetch(url, { headers: { 'x-test-user': user } }); assert.equal(response.status, 200);
			assert.equal(response.headers.get('cache-control'), 'private, no-store');
			const data = await response.json(); assert.deepEqual(data.updates[0].reference, { access: 'unavailable' });
			for (const secret of [project.title, topic.title, project.id, project.code, topic.id]) assert.ok(!JSON.stringify(data).includes(secret), `Redacted reference cannot contain ${secret}`);
		};
		for (const revoked of [owner, subject]) {
			await client.query('UPDATE project_memberships SET revoked_at=now() WHERE project_id=$1 AND user_id=$2', [project.id, revoked]);
			for (const viewer of [owner, subject]) await hidden(viewer);
			await assert.rejects(goals.transitionGoal(goal.id, subject, { ...evidence, expectedRevision: 4 }), { code: 'goal_reference_unavailable' });
			await client.query('UPDATE project_memberships SET revoked_at=NULL WHERE project_id=$1 AND user_id=$2', [project.id, revoked]);
		}
		assert.equal((await goals.getGoal(goal.id, subject)).updates[0].reference.access, 'available');
		const stored = (await client.query('SELECT project_id,topic_id FROM team_goal_updates WHERE goal_id=$1', [goal.id])).rows[0];
		assert.deepEqual(stored, { project_id: project.id, topic_id: topic.id });
		const personal = await goals.createGoal(id, subject, { ...input, reviewerId: null });
		await goals.transitionGoal(personal.id, subject, { action: 'propose', version: 1, expectedRevision: 0 });
		await goals.transitionGoal(personal.id, subject, { action: 'accept', version: 1, expectedRevision: 1 });
		await goals.transitionGoal(personal.id, subject, { ...evidence, expectedRevision: 2, reference: { projectCode: project.code } });
		assert.equal((await goals.getGoal(personal.id, subject)).updates[0].reference.topicId, null);
		await client.query("UPDATE users SET created_at=created_at-interval '1 day' WHERE id=$1", [admin]);
		const merged = await require('../core/account-merge').mergeAccounts({ userIdA: subject, userIdB: admin });
		assert.equal(merged.survivorId, admin);
		const retained = (await goals.getGoal(goal.id, admin)).updates[0];
		assert.equal(retained.authorId, admin); assert.equal(retained.reference.topicId, topic.id);
		assert.deepEqual((await client.query('SELECT project_id,topic_id FROM team_goal_updates WHERE goal_id=$1', [goal.id])).rows[0], stored, 'Identity merge cannot rewrite linked historical resource IDs');
		console.log('Goal references passed: independent subject/reviewer access, opaque failures, topic scope, current HTTP redaction, retained immutable IDs and personal tracking.');
	} finally { if (server) await new Promise(resolve => server.close(resolve)); db.transaction = original; await client.query('ROLLBACK'); client.release(); await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
