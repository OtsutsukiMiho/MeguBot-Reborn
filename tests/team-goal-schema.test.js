'use strict';
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { isDisposableTestDatabase } = require('./test-database');
const { installTeamGoalSchema } = require('../core/team-goal-schema');
(async () => {
	// Exercise the actual startup function without touching a non-test database.
	const source = require('node:fs').readFileSync(require.resolve('../core/schema'), 'utf8');
	for (const legacy of [false,true]) for (const [flag, existing, installed] of [[undefined, false, false], ['0', false, false], ['1', false, true], ['0', true, true]]) {
		const events = [];
		const client = { query: async sql => { events.push(sql); return { rows: [{ table_name: sql.includes("to_regclass('companies')") ? (legacy ? 'companies' : null) : (existing ? 'team_goals' : null) }] }; } };
		const sandbox = { module: { exports: {} }, process: { env: { MEGU_TEAM_GOALS_ENABLED: flag } }, require: name => {
			if (name === './db.js') return { transaction: async fn => { events.push('begin'); await fn(client); events.push('commit'); } };
			if (name === './log.js') return { log() {} };
			if (name === './company-schema.js') return { installCompanySchema: async () => events.push('company-schema') };
			if (name === './server-role-schema.js') return { installServerRoleSchema: async () => events.push('role-schema') };
			if (name === './team-goal-schema.js') return { installTeamGoalSchema: async () => events.push('goal-schema') };
			if (name === './team-membership-sources') return { installTeamMembershipSourceSchema: async () => events.push('source-schema') };
			throw new Error(`Unexpected startup dependency: ${name}`);
		} };
		require('node:vm').runInNewContext(source, sandbox);
		await sandbox.module.exports.initCoreSchema();
		assert.equal(events.includes('goal-schema'), installed);
		assert.equal(events.includes('company-schema'),legacy,'Only existing legacy storage may be maintained');
		assert.equal(events[0], 'begin'); assert.match(events[1], /pg_advisory_xact_lock/);
		assert.equal(events.at(-1), 'commit');
		if (installed) assert.ok(events.indexOf('goal-schema') > events.indexOf('role-schema'));
	}
	const url = process.env.MEGU_TEST_DATABASE_URL || process.env.MEGU_DATABASE_URL;
	assert.ok(isDisposableTestDatabase(url), 'Explicit isolated local test database required');
	const client = new Client({ connectionString: url }); await client.connect();
	try {
		await client.query('BEGIN; CREATE SCHEMA goal_schema_test; SET LOCAL search_path TO goal_schema_test');
		await client.query("CREATE TABLE users(id text PRIMARY KEY); CREATE TABLE teams(id text PRIMARY KEY); INSERT INTO users VALUES ('subject'),('reviewer'); INSERT INTO teams VALUES ('team')");
		await client.query("CREATE TABLE projects(id text PRIMARY KEY); CREATE TABLE project_topics(id text PRIMARY KEY,project_id text REFERENCES projects(id),UNIQUE(project_id,id)); INSERT INTO projects VALUES ('project'),('other-project'); INSERT INTO project_topics VALUES ('topic','project')");
		await installTeamGoalSchema(client); await installTeamGoalSchema(client);
		await client.query("INSERT INTO team_goals(id,team_id,subject_id,created_by) VALUES ('goal','team','subject','subject')");
		await client.query(`INSERT INTO team_goal_versions(goal_id,version,title,success_description,period_start,period_end,timezone,measurement,created_by)
		 VALUES ('goal',1,'Delivery','Customer acceptance','2026-09-01','2026-09-30','Asia/Bangkok','{"kind":"milestone","criteria":"Accepted"}','subject')`);
		const reject = async (sql, code = '23514') => {
			await client.query('SAVEPOINT invalid');
			await assert.rejects(client.query(sql), error => error.code === code);
			await client.query('ROLLBACK TO SAVEPOINT invalid');
		};
		// Simulate additive installation over populated pre-receipt storage.
		await client.query('SET CONSTRAINTS team_goals_current_version_fk IMMEDIATE');
		await client.query('ALTER TABLE team_goals DROP COLUMN creation_request_key, DROP COLUMN creation_request_hash');
		await installTeamGoalSchema(client);
		await client.query('SET CONSTRAINTS team_goals_current_version_fk DEFERRED');
		assert.deepEqual((await client.query("SELECT id,creation_request_key,creation_request_hash FROM team_goals WHERE id='goal'")).rows[0], { id: 'goal', creation_request_key: null, creation_request_hash: null });
		await reject("UPDATE team_goals SET creation_request_key='request_1234567890'");
		await reject("UPDATE team_goals SET creation_request_hash=repeat('a',64)");
		await reject("UPDATE team_goals SET creation_request_key='short',creation_request_hash=repeat('a',64)");
		await reject("UPDATE team_goals SET creation_request_key='request_1234567890',creation_request_hash='invalid'");
		await client.query("UPDATE team_goals SET creation_request_key='request_1234567890',creation_request_hash=repeat('a',64)");
		await reject("INSERT INTO team_goals(id,team_id,subject_id,created_by,creation_request_key,creation_request_hash) VALUES ('duplicate','team','subject','subject','request_1234567890',repeat('a',64))", '23505');
		await reject("UPDATE team_goal_versions SET lifecycle='active'");
		await reject("UPDATE team_goals SET current_version=999; SET CONSTRAINTS team_goals_current_version_fk IMMEDIATE", '23503');
		await client.query('SET CONSTRAINTS team_goals_current_version_fk IMMEDIATE');
		await client.query('SET CONSTRAINTS team_goals_current_version_fk DEFERRED');
		await reject("UPDATE team_goal_versions SET measurement='{}'");
		await reject("UPDATE team_goal_versions SET measurement='{\"kind\":null}'");
		await reject("UPDATE team_goal_versions SET lifecycle='active',subject_accepted_at=now(),reviewer_id='reviewer'");
		await reject("UPDATE team_goal_versions SET period_end='2026-08-01'");
		await reject("UPDATE team_goal_versions SET lifecycle='reviewed',subject_accepted_at=now()");
		await reject("UPDATE team_goal_versions SET prior_version=1,reason='Revision'");
		await reject("INSERT INTO team_goal_updates(id,goal_id,version,author_id,reported_value,note) VALUES ('bad','goal',1,'subject','NaN','Report')");
		await reject("INSERT INTO team_goal_updates(id,goal_id,version,author_id,note) VALUES ('bad','goal',2,'subject','Report')", '23503');
		await client.query("INSERT INTO team_goal_updates(id,goal_id,version,author_id,note) VALUES ('update','goal',1,'subject','Evidence')");
		await reject("INSERT INTO team_goal_updates(id,goal_id,version,author_id,note,topic_id) VALUES ('badref','goal',1,'subject','Evidence','topic')");
		await reject("INSERT INTO team_goal_updates(id,goal_id,version,author_id,note,project_id,topic_id) VALUES ('badref','goal',1,'subject','Evidence','other-project','topic')", '23503');
		await client.query("INSERT INTO team_goal_updates(id,goal_id,version,author_id,note,project_id,topic_id) VALUES ('ref','goal',1,'subject','Linked evidence','project','topic')");
		await reject("UPDATE team_goal_updates SET topic_id=NULL WHERE id='ref'");
		await reject("DELETE FROM project_topics WHERE id='topic'", '23001');
		await reject("DELETE FROM team_goals WHERE id='goal'", '23001');
		await reject("DELETE FROM users WHERE id='subject'", '23001');
		console.log('Goal schema passed: idempotency, version links, acceptance constraints, finite values and retained references');
	} finally { await client.query('ROLLBACK'); await client.end(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
