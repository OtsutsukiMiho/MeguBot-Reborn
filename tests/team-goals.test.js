'use strict';
const assert = require('node:assert/strict');
const db = require('../core/db');
const { initCoreSchema } = require('../core/schema');
const { installTeamGoalSchema } = require('../core/team-goal-schema');
const { isDisposableTestDatabase } = require('./test-database');
(async () => {
	assert.ok(isDisposableTestDatabase(process.env.MEGU_DATABASE_URL), 'Explicit local test database required');
	await initCoreSchema();
	const client = await db.getPool().connect();
	const originalTransaction = db.transaction;
	try {
		await client.query('BEGIN');
		await installTeamGoalSchema(client);
		db.transaction = async fn => {
			await client.query('SAVEPOINT goal_operation');
			try { const value = await fn(client); await client.query('RELEASE SAVEPOINT goal_operation'); return value; }
			catch (error) { await client.query('ROLLBACK TO SAVEPOINT goal_operation'); throw error; }
		};
		const { createGoal, getGoal, transitionGoal, reassignReviewer, listGoals } = require('../core/team-goals');
		const accountMerge = require('../core/account-merge');
		process.env.MEGU_TEAM_GOALS_ENABLED = '1';
		const prefix = `goal_test_${Date.now()}`;
		const [owner, member, other, outsider] = ['owner', 'member', 'other', 'outsider'].map(id => `${prefix}_${id}`);
		for (const id of [owner, member, other, outsider]) await client.query('INSERT INTO users(id,display_name) VALUES ($1,$1)', [id]);
		await client.query('INSERT INTO teams(id,name,created_by) VALUES ($1,$1,$2)', [prefix, owner]);
		for (const [id, role] of [[owner, 'owner'], [member, 'member'], [other, 'admin']]) await client.query('INSERT INTO team_memberships(team_id,user_id,role) VALUES ($1,$2,$3)', [prefix, id, role]);
		const input = { subjectId: member, reviewerId: owner, title: 'Private delivery goal', successDescription: 'Deliver accepted work', periodStart: '2026-09-01', periodEnd: '2026-09-30', timezone: 'Asia/Bangkok', measurement: { kind: 'numeric', direction: 'increase', unit: 'deliverables', baseline: 0, target: 10 } };
		const goal = await createGoal(prefix, owner, { ...input, requestKey: prefix });
		assert.deepEqual(await createGoal(prefix, owner, { ...input, requestKey: prefix }), goal);
		assert.equal((await accountMerge.planMerge(member, owner)).blockedBy.reason, 'goal-participant-conflict', 'Merge planning must not collapse reviewer and subject');
		await assert.rejects(accountMerge.mergeAccounts({ userIdA: member, userIdB: owner }), /merge_goal_participant_conflict/);
		assert.equal(goal.lifecycle, 'draft');
		const subject = await getGoal(goal.id, member);
		assert.equal(subject.access, 'private'); assert.equal(subject.goal.achievement, null);
		assert.equal(subject.capabilities.canPropose, true); assert.equal(subject.capabilities.canAccept, false);
		assert.equal(subject.capabilities.canReassignReviewer, false);
		assert.equal(subject.capabilities.canCancel, true);
		assert.equal(subject.capabilities.canEdit, true); assert.equal(subject.capabilities.canRevise, false);
		assert.equal(subject.goal.subjectAcceptedAt, null); assert.equal(subject.goal.reviewerAcceptedAt, null);
		assert.equal((await getGoal(goal.id, owner)).goal.title, input.title);
		const metadata = await getGoal(goal.id, other);
		assert.equal(metadata.access, 'administration'); assert.equal(metadata.goal.title, undefined);
		assert.equal(metadata.capabilities.canReassignReviewer, true);
		assert.ok(Object.entries(metadata.capabilities).filter(([key]) => key !== 'canReassignReviewer').every(([, value]) => value === false));
		const app = require('express')();
		app.use(require('express').json());
		require('../adapters/http/team-goals-api').registerTeamGoalRoutes(app, (req, res, next) => {
			if (!req.headers['x-test-user']) return res.status(401).json({ code: 'session_expired' });
			req.actor = { userId: req.headers['x-test-user'] }; next();
		});
		const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
		try {
			const base = `http://127.0.0.1:${server.address().port}`;
			const url = `${base}/team-goals/${goal.id}`;
			assert.equal((await fetch(url)).status, 401);
			assert.equal((await fetch(`${base}/teams/${prefix}/goals/${goal.id}`, { headers: { 'x-test-user': member } })).status, 200);
			assert.equal((await fetch(`${base}/teams/wrong-team/goals/${goal.id}`, { headers: { 'x-test-user': member } })).status, 404, 'Nested route must enforce its parent even for an authorized goal participant');
			const privateResponse = await fetch(url, { headers: { 'x-test-user': member } });
			assert.equal(privateResponse.status, 200); assert.equal(privateResponse.headers.get('cache-control'), 'private, no-store');
			assert.equal((await privateResponse.json()).goal.title, input.title);
			const adminResponse = await fetch(url, { headers: { 'x-test-user': other } });
			assert.equal((await adminResponse.json()).goal.title, undefined);
			assert.equal((await fetch(`${url}?version=invalid`, { headers: { 'x-test-user': member } })).status, 422);
			assert.equal((await fetch(url, { headers: { 'x-test-user': outsider } })).status, 404);
			const invalidCreate = await fetch(`${base}/teams/${prefix}/goals`, { method: 'POST', headers: { 'x-test-user': member, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, unexpected: true }) });
			assert.equal(invalidCreate.status, 422);
			const createRequest = (payload, actor = owner) => fetch(`${base}/teams/${prefix}/goals`, { method: 'POST', headers: { 'x-test-user': actor, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
			const replay = await createRequest({ ...input, requestKey: prefix });
			assert.equal(replay.status, 201); assert.deepEqual(await replay.json(), goal);
			assert.equal(replay.headers.get('cache-control'), 'private, no-store');
			assert.equal((await createRequest({ ...input, title: 'Changed', requestKey: prefix })).status, 409);
			assert.equal((await createRequest({ ...input, requestKey: 'short' })).status, 422);
			assert.equal((await createRequest({ ...input, requestKey: prefix }, outsider)).status, 404);
			const writes = [
				[`${base}/teams/${prefix}/goals`, input],
				[`${url}/transitions`, { action: 'propose', version: 1, expectedRevision: 0 }],
				[`${url}/reviewer`, { reviewerId: other, reason: 'Forged reassignment', expectedRevision: 0 }],
			];
			for (const [endpoint, payload] of writes) {
				for (const contentType of ['application/x-www-form-urlencoded', 'text/plain', 'multipart/form-data; boundary=test']) {
					const response = await fetch(endpoint, { method: 'POST', headers: { 'x-test-user': owner, 'Content-Type': contentType, Origin: 'https://untrusted.example' }, body: 'action=propose' });
					assert.equal(response.status, 415);
				}
				const crossSite = await fetch(endpoint, { method: 'POST', headers: { 'x-test-user': owner, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }, body: JSON.stringify(payload) });
				assert.equal(crossSite.status, 403);
				const preflight = await fetch(endpoint, { method: 'OPTIONS', headers: { Origin: 'https://untrusted.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
				assert.equal(preflight.headers.get('access-control-allow-origin'), null);
			}
			assert.equal((await getGoal(goal.id, member)).goal.revision, 0, 'Rejected browser requests cannot mutate goals');
			assert.equal((await listGoals(prefix, owner)).goals.length, 1, 'Rejected browser requests cannot create goals');
			process.env.MEGU_TEAM_GOALS_ENABLED = '0';
			assert.equal((await fetch(url, { headers: { 'x-test-user': member } })).status, 404);
		} finally { process.env.MEGU_TEAM_GOALS_ENABLED = '1'; await new Promise(resolve => server.close(resolve)); }
		const managerDirectory = await listGoals(prefix, other);
		assert.equal(managerDirectory.goals.length, 1); assert.equal(managerDirectory.goals[0].title, undefined);
		assert.equal(managerDirectory.team.id, prefix);
		assert.equal(managerDirectory.goals[0].subjectName, member);
		assert.equal(managerDirectory.goals[0].periodStart, '2026-09-01', 'Directory dates remain date-only, without timezone drift');
		assert.equal(managerDirectory.goals[0].measurement, undefined);
		assert.equal((await listGoals(prefix, member)).goals[0].title, input.title);
		await assert.rejects(listGoals(prefix, outsider), { code: 'team_not_found' });
		await assert.rejects(listGoals(prefix, owner, { limit: 101 }), { code: 'goal_page_invalid' });
		await assert.rejects(getGoal(goal.id, outsider), { code: 'goal_not_found' });
		await assert.rejects(createGoal(prefix, member, { ...input, subjectId: other }), { code: 'goal_forbidden' });
		await assert.rejects(createGoal(prefix, owner, { ...input, reviewerId: member }), { code: 'goal_reviewer_invalid' });
		await assert.rejects(createGoal(prefix, owner, { ...input, reviewerId: outsider }), { code: 'team_not_found' });
		await assert.rejects(createGoal(prefix, owner, { ...input, periodStart: '2026-02-30' }), { code: 'goal_period_invalid' });
		await assert.rejects(createGoal(prefix, owner, { ...input, measurement: { ...input.measurement, current: 5 } }), { code: 'goal_value_requires_evidence' });
		const personal = await createGoal(prefix, member, { ...input, reviewerId: null });
		assert.equal((await getGoal(personal.id, member)).goal.reviewerId, null);
		const firstGoalPage = await listGoals(prefix, member, { limit: 1 });
		const secondGoalPage = await listGoals(prefix, member, { limit: 1, offset: firstGoalPage.nextOffset });
		assert.notEqual(firstGoalPage.goals[0].id, secondGoalPage.goals[0].id);
		assert.equal(secondGoalPage.nextOffset, null);
		await assert.rejects(transitionGoal(goal.id, other, { action: 'propose', version: 1, expectedRevision: 0 }), { code: 'goal_forbidden' });
		await transitionGoal(goal.id, owner, { action: 'propose', version: 1, expectedRevision: 0 });
		assert.equal((await getGoal(goal.id, member)).capabilities.canAccept, true);
		assert.equal((await getGoal(goal.id, member)).capabilities.canEdit, false);
		await assert.rejects(transitionGoal(goal.id, member, { action: 'accept', version: 1, expectedRevision: 0 }), { code: 'goal_revision_conflict' });
		const firstAcceptance = await transitionGoal(goal.id, owner, { action: 'accept', version: 1, expectedRevision: 1 });
		assert.equal((await getGoal(goal.id, owner)).capabilities.canAccept, false);
		assert.equal(firstAcceptance.lifecycle, 'proposed', 'Reviewer cannot accept on behalf of subject');
		await assert.rejects(transitionGoal(goal.id, owner, { action: 'accept', version: 1, expectedRevision: 2 }), { code: 'goal_already_accepted' });
		assert.equal((await transitionGoal(goal.id, member, { action: 'accept', version: 1, expectedRevision: 2 })).lifecycle, 'active');
		const activeCapabilities = (await getGoal(goal.id, member)).capabilities;
		assert.equal(activeCapabilities.canAddEvidence, true); assert.equal(activeCapabilities.canSubmit, true); assert.equal(activeCapabilities.canReview, false);
		assert.equal((await getGoal(goal.id, owner)).capabilities.canAddEvidence, false);
		await assert.rejects(transitionGoal(goal.id, member, { action: 'propose', version: 1, expectedRevision: 3 }), { code: 'goal_transition_invalid' });
		await transitionGoal(personal.id, member, { action: 'propose', version: 1, expectedRevision: 0 });
		assert.equal((await transitionGoal(personal.id, member, { action: 'accept', version: 1, expectedRevision: 1 })).lifecycle, 'active', 'No-reviewer personal tracking is allowed');
		await assert.rejects(transitionGoal(personal.id, member, { action: 'submit', version: 1, expectedRevision: 2, selfReview: 'Done' }), { code: 'goal_reviewer_required' });
		await assert.rejects(transitionGoal(personal.id, other, { action: 'cancel', version: 1, expectedRevision: 2, reason: 'Unrelated manager' }), { code: 'goal_forbidden' });
		await transitionGoal(personal.id, member, { action: 'cancel', version: 1, expectedRevision: 2, reason: 'No longer needed' });
		assert.equal((await getGoal(personal.id, member)).goal.lifecycle, 'cancelled');
		assert.equal((await getGoal(personal.id, member)).capabilities.canCancel, false);
		await assert.rejects(transitionGoal(personal.id, member, { action: 'evidence', version: 1, expectedRevision: 3, note: 'Late report', value: 3 }), { code: 'goal_transition_invalid' });
		await assert.rejects(transitionGoal(goal.id, owner, { action: 'evidence', version: 1, expectedRevision: 3, note: 'Claim', value: 10 }), { code: 'goal_forbidden' });
		await transitionGoal(goal.id, member, { action: 'evidence', version: 1, expectedRevision: 3, note: 'Delivered', value: 12, links: ['https://example.com/evidence'] });
		const reported = await getGoal(goal.id, member);
		assert.equal(reported.goal.achievement, 100); assert.equal(reported.goal.measurement.current, 12);
		await transitionGoal(goal.id, member, { action: 'submit', version: 1, expectedRevision: 4, selfReview: 'Initial self-review' });
		const reviewCapabilities = (await getGoal(goal.id, owner)).capabilities;
		assert.equal(reviewCapabilities.canReview, true); assert.equal(reviewCapabilities.canReturn, true);
		assert.equal((await getGoal(goal.id, member)).capabilities.canAddEvidence, false);
		await assert.rejects(transitionGoal(goal.id, member, { action: 'evidence', version: 1, expectedRevision: 5, note: 'Late edit', value: 20 }), { code: 'goal_transition_invalid' });
		await assert.rejects(transitionGoal(goal.id, other, { action: 'return', version: 1, expectedRevision: 5, reason: 'Private meddling' }), { code: 'goal_forbidden' });
		await transitionGoal(goal.id, owner, { action: 'return', version: 1, expectedRevision: 5, reason: 'Clarify evidence' });
		await transitionGoal(goal.id, member, { action: 'submit', version: 1, expectedRevision: 6, selfReview: 'Clarified self-review' });
		await transitionGoal(goal.id, owner, { action: 'review', version: 1, expectedRevision: 7, outcome: 'exceeded', explanation: 'Evidence supports the target', nextStep: 'Agree next period' });
		assert.equal((await getGoal(goal.id, member)).review.outcome, 'exceeded');
		assert.equal((await getGoal(goal.id, member)).capabilities.canCancel, false);
		assert.equal((await getGoal(goal.id, member)).capabilities.canRevise, true);
		assert.equal((await getGoal(goal.id, member)).capabilities.canRespond, true);
		assert.equal((await getGoal(goal.id, owner)).capabilities.canRespond, false);
		assert.equal((await getGoal(goal.id, owner)).capabilities.canReassignReviewer, false, 'Published reviews cannot be reassigned');
		await assert.rejects(transitionGoal(goal.id, member, { action: 'cancel', version: 1, expectedRevision: 8, reason: 'Change published outcome' }), { code: 'goal_transition_invalid' });
		await assert.rejects(transitionGoal(goal.id, owner, { action: 'return', version: 1, expectedRevision: 8, reason: 'Overwrite published review' }), { code: 'goal_transition_invalid' });
		assert.equal((await client.query('SELECT count(*)::int AS n FROM team_goal_updates WHERE goal_id=$1', [goal.id])).rows[0].n, 1);
		await assert.rejects(transitionGoal(goal.id, owner, { action: 'respond', version: 1, expectedRevision: 8, acknowledged: true }), { code: 'goal_forbidden' });
		await transitionGoal(goal.id, member, { action: 'respond', version: 1, expectedRevision: 8, acknowledged: true });
		await transitionGoal(goal.id, member, { action: 'respond', version: 1, expectedRevision: 9, response: 'My response to the published assessment' });
		assert.equal((await client.query('SELECT count(*)::int AS n FROM team_goal_responses WHERE author_id=$1', [member])).rows[0].n, 2);
		assert.equal((await getGoal(goal.id, member)).review.explanation, 'Evidence supports the target', 'Subject responses never overwrite the published assessment');
		const history = await getGoal(goal.id, member);
		assert.equal(history.updates[0].value, 12);
		assert.equal(history.updates[0].note, 'Delivered');
		assert.equal(history.updates[0].authorName, member);
		assert.equal(history.review.authorName, owner);
		assert.equal(history.responses[0].authorName, member);
		assert.equal(history.updates[0].authorAvatarUrl, null);
		await client.query('UPDATE users SET avatar_url=$2 WHERE id=$1', [member, 'https://example.com/fallback.png']);
		assert.equal((await getGoal(goal.id, member)).updates[0].authorAvatarUrl, 'https://example.com/fallback.png');
		await client.query('INSERT INTO identities(id,user_id,provider,provider_uid,avatar_url) VALUES ($1,$2,$3,$2,$4)', [`${prefix}_discord`, member, 'discord', 'https://cdn.discordapp.com/avatars/member/profile.png']);
		const discordHistory = await getGoal(goal.id, member);
		assert.equal(discordHistory.updates[0].authorAvatarUrl, 'https://cdn.discordapp.com/avatars/member/profile.png');
		assert.equal(discordHistory.responses[0].authorAvatarUrl, discordHistory.updates[0].authorAvatarUrl);
		await client.query('UPDATE identities SET avatar_url=$2 WHERE user_id=$1', [member, '']);
		assert.equal((await getGoal(goal.id, member)).updates[0].authorAvatarUrl, 'https://example.com/fallback.png', 'Empty Discord avatar falls back to the account profile');
		assert.equal(history.responses.length, 2);
		assert.ok(history.responses.some(response => response.acknowledged && response.response === null));
		assert.equal((await getGoal(goal.id, other)).updates, undefined, 'Administration never includes private evidence history');
		await assert.rejects(getGoal(goal.id, member, { updatesOffset: -1 }), { code: 'goal_page_invalid' });
		for (let i = 0; i < 50; i++) await client.query('INSERT INTO team_goal_updates(id,goal_id,version,author_id,note) VALUES ($1,$2,1,$3,$4)', [`${prefix}_history_${i}`, goal.id, member, `Historical evidence ${i}`]);
		const pageOne = await getGoal(goal.id, owner);
		const pageTwo = await getGoal(goal.id, owner, { updatesOffset: pageOne.updatesNextOffset });
		assert.equal(pageOne.updates.length, 50); assert.equal(pageTwo.updates.length, 1);
		assert.equal(pageTwo.updatesNextOffset, null);
		assert.equal(new Set([...pageOne.updates, ...pageTwo.updates].map(update => update.id)).size, 51);
		await assert.rejects(transitionGoal(goal.id, other, { action: 'revise', version: 1, expectedRevision: 10, reason: 'Override' }), { code: 'goal_forbidden' });
		await assert.rejects(transitionGoal(goal.id, member, { action: 'revise', version: 1, expectedRevision: 10, reason: 'Invalid period', periodEnd: '2026-08-31' }), { code: 'goal_period_invalid' });
		const revised = await transitionGoal(goal.id, member, { action: 'revise', version: 1, expectedRevision: 10, reason: 'Agree revised target', title: 'Next delivery period', successDescription: 'Deliver next accepted work', periodStart: '2026-10-01', periodEnd: '2026-10-31', timezone: 'UTC', measurement: { ...input.measurement, target: 15 } });
		assert.equal(revised.version, 2); assert.equal(revised.lifecycle, 'draft');
		const revisedRead = await getGoal(goal.id, member);
		assert.equal(revisedRead.goal.measurement.target, 15); assert.equal(revisedRead.goal.measurement.current, null);
		assert.equal(revisedRead.goal.title, 'Next delivery period');
		assert.equal(revisedRead.goal.timezone, 'UTC');
		assert.equal((await client.query('SELECT period_start::text,period_end::text FROM team_goal_versions WHERE goal_id=$1 AND version=2', [goal.id])).rows[0].period_start, '2026-10-01');
		assert.equal(revisedRead.goal.subjectAcceptedAt, null); assert.equal(revisedRead.goal.reviewerAcceptedAt, null);
		assert.equal(revisedRead.review, null); assert.equal(revisedRead.updates.length, 0);
		const historical = await getGoal(goal.id, member, { version: 1 });
		assert.equal(historical.goal.version, 1); assert.equal(historical.goal.currentVersion, 2);
		assert.equal(historical.goal.measurement.target, 10); assert.equal(historical.review.outcome, 'exceeded');
		assert.equal(historical.goal.title, input.title, 'Revised terms never overwrite the published version');
		assert.ok(Object.values(historical.capabilities).every(value => value === false));
		assert.equal(historical.responses.length, 2);
		assert.equal((await getGoal(goal.id, other, { version: 1 })).updates, undefined);
		await assert.rejects(getGoal(goal.id, owner, { version: 999 }), { code: 'goal_not_found' });
		await assert.rejects(getGoal(goal.id, owner, { version: 0 }), { code: 'goal_page_invalid' });
		assert.equal((await client.query('SELECT lifecycle FROM team_goal_versions WHERE goal_id=$1 AND version=1', [goal.id])).rows[0].lifecycle, 'reviewed');
		assert.equal((await client.query('SELECT outcome FROM team_goal_reviews WHERE goal_id=$1 AND version=1', [goal.id])).rows[0].outcome, 'exceeded');
		for (const sql of [
			"UPDATE team_goal_reviews SET explanation='Overwritten' WHERE goal_id=$1",
			"DELETE FROM team_goal_reviews WHERE goal_id=$1",
			"UPDATE team_goal_updates SET note='Overwritten' WHERE goal_id=$1",
			"DELETE FROM team_goal_events WHERE goal_id=$1",
			"UPDATE team_goal_versions SET title='Overwritten' WHERE goal_id=$1 AND version=1",
		]) {
			await client.query('SAVEPOINT immutable_check');
			await assert.rejects(client.query(sql, [goal.id]), error => error.code === '23514');
			await client.query('ROLLBACK TO SAVEPOINT immutable_check');
		}
		await client.query('UPDATE team_goal_reviews SET reviewer_id=$2 WHERE goal_id=$1', [goal.id, other]);
		assert.equal((await client.query('SELECT explanation FROM team_goal_reviews WHERE goal_id=$1', [goal.id])).rows[0].explanation, 'Evidence supports the target', 'Identity-only remap preserves published content');
		await assert.rejects(transitionGoal(goal.id, member, { action: 'accept', version: 1, expectedRevision: 11 }), { code: 'goal_revision_conflict' });
		const reassignment = await createGoal(prefix, member, { ...input, reviewerId: other });
		await require('../core/teams').updateMemberRole(prefix, other, owner, { role: 'member', expectedRevision: 0 });
		assert.equal((await getGoal(reassignment.id, member)).goal.needsReviewer, true);
		await assert.rejects(reassignReviewer(reassignment.id, member, { reviewerId: owner, expectedRevision: 1, reason: 'Choose reviewer' }), { code: 'goal_forbidden' });
		await reassignReviewer(reassignment.id, owner, { reviewerId: owner, expectedRevision: 1, reason: 'Previous reviewer changed role' });
		await assert.rejects(reassignReviewer(reassignment.id, owner, { reviewerId: owner, expectedRevision: 2, reason: 'Duplicate assignment' }), { code: 'goal_reviewer_invalid' });
		assert.equal((await getGoal(reassignment.id, owner)).goal.revision, 2, 'Duplicate assignment cannot reset agreement or add an event');
		const proposedAssignment = await getGoal(reassignment.id, owner);
		assert.equal(proposedAssignment.capabilities.canAccept, true);
		assert.equal(proposedAssignment.access, 'proposal'); assert.equal(proposedAssignment.updates, undefined);
		assert.equal(proposedAssignment.goal.measurement.current, null);
		await transitionGoal(reassignment.id, owner, { action: 'accept', expectedRevision: 2, version: 1 });
		assert.equal((await getGoal(reassignment.id, owner)).access, 'proposal', 'Reviewer cannot unlock history without subject acceptance');
		assert.equal((await getGoal(reassignment.id, owner)).capabilities.canAccept, false);
		await transitionGoal(reassignment.id, member, { action: 'accept', expectedRevision: 3, version: 1 });
		assert.equal((await getGoal(reassignment.id, owner)).access, 'private');
		await require('../core/teams').removeTeamMember(prefix, member, owner, { expectedRevision: 1 });
		assert.equal((await client.query('SELECT lifecycle FROM team_goal_versions WHERE goal_id=$1 AND version=2', [goal.id])).rows[0].lifecycle, 'cancelled');
		assert.equal((await client.query('SELECT lifecycle FROM team_goal_versions WHERE goal_id=$1 AND version=1', [goal.id])).rows[0].lifecycle, 'reviewed');
		await assert.rejects(getGoal(goal.id, member), { code: 'goal_not_found' });
		assert.equal((await client.query('SELECT count(*)::int AS n FROM team_goal_events WHERE goal_id=$1', [goal.id])).rows[0].n, 13);
		await client.query("UPDATE users SET created_at=created_at-interval '1 day' WHERE id=$1", [outsider]);
		await client.query("INSERT INTO team_memberships(team_id,user_id,role) VALUES ($1,$2,'member')", [prefix, outsider]);
		assert.equal((await accountMerge.planMerge(member, outsider)).blockedBy.reason, 'goal-membership-conflict');
		await assert.rejects(accountMerge.mergeAccounts({ userIdA: member, userIdB: outsider }), /merge_goal_membership_conflict/);
		assert.equal((await client.query('SELECT revoked_at FROM team_memberships WHERE team_id=$1 AND user_id=$2', [prefix, member])).rows[0].revoked_at instanceof Date, true);
		await client.query('DELETE FROM team_memberships WHERE team_id=$1 AND user_id=$2', [prefix, outsider]);
		const merged = await accountMerge.mergeAccounts({ userIdA: member, userIdB: outsider });
		assert.equal(merged.survivorId, outsider, 'Exercise real remapping of the subject and authored history');
		assert.equal((await client.query('SELECT subject_id FROM team_goals WHERE id=$1', [goal.id])).rows[0].subject_id, merged.survivorId);
		assert.equal((await client.query('SELECT creation_request_key FROM team_goals WHERE id=$1', [goal.id])).rows[0].creation_request_key, prefix, 'Account merge must preserve the durable creation receipt');
		assert.equal((await client.query('SELECT count(*)::int AS n FROM team_goal_responses WHERE author_id=$1', [merged.survivorId])).rows[0].n, 2);
		assert.equal((await client.query('SELECT explanation FROM team_goal_reviews WHERE goal_id=$1', [goal.id])).rows[0].explanation, 'Evidence supports the target');
		const editable = await createGoal(prefix, owner, { ...input, subjectId: owner, reviewerId: null });
		await assert.rejects(transitionGoal(editable.id, other, { action: 'edit', version: 1, expectedRevision: 0, reason: 'Manager override', title: 'Not permitted' }), { code: 'goal_forbidden' });
		for (const [patch, code] of [
			[{ title: ' ' }, 'goal_input_invalid'], [{ periodEnd: '2026-02-30' }, 'goal_period_invalid'],
			[{ timezone: 'Not/AZone' }, 'timezone_invalid'], [{ measurement: { ...input.measurement, current: 2 } }, 'goal_value_requires_evidence'],
			[{ subjectId: other }, 'unknown_field'], [{}, 'goal_input_invalid'],
		]) await assert.rejects(transitionGoal(editable.id, owner, { action: 'edit', version: 1, expectedRevision: 0, reason: 'Correct draft', ...patch }), { code });
		await transitionGoal(editable.id, owner, { action: 'edit', version: 1, expectedRevision: 0, reason: 'Correct draft', title: ' Corrected title ', measurement: { ...input.measurement, target: 20 } });
		assert.equal((await getGoal(editable.id, owner)).goal.title, 'Corrected title');
		const editAudit = (await client.query("SELECT payload FROM team_goal_events WHERE goal_id=$1 AND event_type='goal_terms_edited'", [editable.id])).rows[0].payload;
		assert.equal(editAudit.terms.before.measurement.target, 10); assert.equal(editAudit.terms.after.measurement.target, 20);
		await assert.rejects(transitionGoal(editable.id, owner, { action: 'edit', version: 1, expectedRevision: 0, reason: 'Stale draft', title: 'Stale' }), { code: 'goal_revision_conflict' });
		await transitionGoal(editable.id, owner, { action: 'propose', version: 1, expectedRevision: 1 });
		await assert.rejects(transitionGoal(editable.id, owner, { action: 'edit', version: 1, expectedRevision: 2, reason: 'Change agreed terms', title: 'Different' }), { code: 'goal_transition_invalid' });
		const archiveGoal = await createGoal(prefix, owner, { ...input, subjectId: owner, reviewerId: null });
		const teamRevision = (await client.query('SELECT revision FROM teams WHERE id=$1', [prefix])).rows[0].revision;
		// Lifecycle cleanup must work even while the Goals UI is disabled.
		process.env.MEGU_TEAM_GOALS_ENABLED = '0';
		await require('../core/teams').archiveTeam(prefix, owner, { expectedRevision: teamRevision });
		process.env.MEGU_TEAM_GOALS_ENABLED = '1';
		await assert.rejects(getGoal(archiveGoal.id, owner), { code: 'goal_not_found' });
		await assert.rejects(createGoal(prefix, owner, { ...input, subjectId: owner, reviewerId: null }), { code: 'team_not_found' });
		const archived = (await client.query('SELECT lifecycle,reason FROM team_goal_versions WHERE goal_id=$1', [archiveGoal.id])).rows[0];
		assert.deepEqual(archived, { lifecycle: 'archived', reason: 'team_archived' });
		assert.equal((await client.query('SELECT lifecycle FROM team_goal_versions WHERE goal_id=$1 AND version=1', [goal.id])).rows[0].lifecycle, 'reviewed');
		await require('../core/teams').archiveTeam(prefix, owner, { expectedRevision: teamRevision + 1 });
		assert.equal((await client.query("SELECT count(*)::int AS n FROM team_goal_events WHERE goal_id=$1 AND event_type='goal_archived'", [archiveGoal.id])).rows[0].n, 1);
		await require('../core/teams').restoreTeam(prefix, owner, { expectedRevision: teamRevision + 1 });
		assert.equal((await getGoal(archiveGoal.id, owner)).goal.lifecycle, 'archived', 'Restoring a team never silently reactivates agreed goals');
		await assert.rejects(transitionGoal(archiveGoal.id, owner, { action: 'propose', version: 1, expectedRevision: 1 }), { code: 'goal_transition_invalid' });
		await client.query('SET CONSTRAINTS ALL IMMEDIATE');
		console.log('Goal integration passed: consent, private access, immutable history, merge, membership and archive lifecycle');
	} finally { db.transaction = originalTransaction; await client.query('ROLLBACK'); client.release(); await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
