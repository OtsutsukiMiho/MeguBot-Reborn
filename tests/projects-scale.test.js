'use strict';

require('dotenv').config();
const assert = require('node:assert/strict');
const core = require('../core/index.js');

const createdUsers = [];
let createdProject = null;

async function timed(label, work) {
	const started = process.hrtime.bigint();
	const value = await work();
	const milliseconds = Number(process.hrtime.bigint() - started) / 1e6;
	return { label, value, milliseconds };
}

async function main() {
	await core.initCoreSchema();
	const run = Date.now();
	const owner = await core.users.loginWithIdentity({
		provider: 'discord', providerUid: `__project_scale_owner_${run}__`, username: 'project-scale-owner', displayName: 'Scale Owner',
	});
	createdUsers.push(owner.user.id);
	createdProject = await core.projects.createProject({ ownerUserId: owner.user.id, title: 'Pilot-size project profile', timezone: 'Asia/Bangkok' });

	const memberRows = [];
	for (let index = 1; index < 50; index++) {
		const userId = core.ids.newId('usr');
		createdUsers.push(userId);
		memberRows.push([userId, `Scale member ${index}`, 'discord', `__project_scale_member_${run}_${index}__`, `scale-${index}`]);
	}

	const userInserts = [];
	const identInserts = [];
	const memberInserts = [];
	for (const [userId, displayName, provider, providerUid, username] of memberRows) {
		userInserts.push(`('${userId}', '${displayName}')`);
		identInserts.push(`('${core.ids.newId('idn')}', '${userId}', '${provider}', '${providerUid}', '${username}')`);
		memberInserts.push(`('${createdProject.id}', '${userId}', 'member')`);
	}
	await core.db.query(`INSERT INTO users (id, display_name) VALUES ${userInserts.join(', ')}`);
	await core.db.query(`INSERT INTO identities (id, user_id, provider, provider_uid, username) VALUES ${identInserts.join(', ')}`);
	await core.db.query(`INSERT INTO project_memberships (project_id, user_id, role) VALUES ${memberInserts.join(', ')}`);

	const topicInserts = [];
	const assigneeInserts = [];
	const eventInserts = [];
	for (let index = 1; index <= 100; index++) {
		const topicId = core.ids.newId('top');
		const assigneeUserId = createdUsers[(index - 1) % createdUsers.length];
		topicInserts.push(`('${topicId}', '${createdProject.id}', ${index}, 'Topic ${String(index).padStart(3, '0')}', 'Representative pilot work item.', ${index - 1})`);
		assigneeInserts.push(`('${createdProject.id}', '${topicId}', '${assigneeUserId}', true)`);
		if (index <= 35) {
			eventInserts.push(`('${core.ids.newId('pev')}', '${createdProject.id}', '${topicId}', '${owner.user.id}', 'topic_created', '{}')`);
		}
	}

	await core.db.query(`INSERT INTO project_topics (id, project_id, topic_no, title, description, position) VALUES ${topicInserts.join(', ')}`);
	await core.db.query(`INSERT INTO project_topic_assignees (project_id, topic_id, user_id, is_primary) VALUES ${assigneeInserts.join(', ')}`);
	await core.db.query(`INSERT INTO project_events (id, project_id, topic_id, actor_user_id, event_type, payload) VALUES ${eventInserts.join(', ')}`);
	await core.db.query('UPDATE projects SET revision = 100 WHERE id = $1', [createdProject.id]);

	const bundle = await timed('100 topics / 50 members workspace', () => core.projects.getProjectByCode(createdProject.code, owner.user.id));
	const history = await timed('30-event history page', () => core.projects.listProjectEvents(createdProject.code, owner.user.id, { limit: 30 }));
	const directory = await timed('directory row', () => core.projects.listProjectDirectory(owner.user.id, { limit: 30 }));
	assert.strictEqual(bundle.value.topics.length, 100);
	assert.strictEqual(bundle.value.members.length, 50);
	assert.strictEqual(bundle.value.events.length, 30, 'the initial workspace bundle remains bounded');
	assert.strictEqual(history.value.events.length, 30);
	assert.ok(history.value.nextCursor, 'large histories expose a cursor instead of downloading every event');
	assert.strictEqual(directory.value.projects[0].topicCount, 100);
	for (const result of [bundle, history, directory]) assert.ok(Number.isFinite(result.milliseconds));

	console.log(`projects scale profile passed — ${bundle.label}: ${bundle.milliseconds.toFixed(1)}ms; ${history.label}: ${history.milliseconds.toFixed(1)}ms; ${directory.label}: ${directory.milliseconds.toFixed(1)}ms`);
}

async function cleanup() {
	if (createdProject) {
		await core.db.query('DELETE FROM project_topic_assignees WHERE project_id=$1', [createdProject.id]).catch(() => undefined);
		await core.db.query('DELETE FROM project_events WHERE project_id=$1', [createdProject.id]).catch(() => undefined);
		await core.db.query('DELETE FROM project_topics WHERE project_id=$1', [createdProject.id]).catch(() => undefined);
		await core.db.query('DELETE FROM project_memberships WHERE project_id=$1', [createdProject.id]).catch(() => undefined);
		await core.db.query('DELETE FROM projects WHERE id=$1', [createdProject.id]).catch(() => undefined);
	}
	if (createdUsers.length) {
		await core.db.query('DELETE FROM identities WHERE user_id = ANY($1::text[])', [createdUsers]).catch(() => undefined);
		await core.db.query('DELETE FROM users WHERE id = ANY($1::text[])', [createdUsers]).catch(() => undefined);
	}
}

main().then(cleanup).then(() => core.db.close()).catch(async error => {
	console.error(error);
	await cleanup().catch(() => undefined);
	await core.db.close().catch(() => undefined);
	process.exitCode = 1;
});
