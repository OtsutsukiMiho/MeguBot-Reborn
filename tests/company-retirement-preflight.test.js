'use strict';

const assert = require('node:assert/strict');
const { Client } = require('pg');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { isDisposableTestDatabase } = require('./test-database');
const { installCompanySchema } = require('../core/company-schema');
const { inventory, preflight } = require('../scripts/company-retirement-preflight');

async function main() {
	const cli = path.join(__dirname, '../scripts/company-retirement-preflight.js');
	for (const url of ['', 'postgresql://localhost/retained', 'postgresql://remote.invalid/example_test']) {
		const result = spawnSync(process.execPath, [cli], {
			env: { ...process.env, MEGU_TEST_DATABASE_URL: url, MEGU_DATABASE_URL: 'postgresql://remote.invalid/never_use' }, encoding: 'utf8',
		});
		assert.equal(result.status, 1);
		assert.match(result.stderr, /no live fallback/);
		assert.doesNotMatch(result.stderr, /remote\.invalid/);
	}
	const missingRetained = spawnSync(process.execPath, [cli, '--authorized-retained-inventory'], {
		env: { ...process.env, MEGU_COMPANY_INVENTORY_DATABASE_URL:'', MEGU_DATABASE_URL:'postgresql://remote.invalid/never_use' }, encoding:'utf8',
	});
	assert.equal(missingRetained.status,1); assert.match(missingRetained.stderr,/Explicit MEGU_COMPANY_INVENTORY_DATABASE_URL required/);
	const url = process.env.MEGU_TEST_DATABASE_URL;
	assert.ok(isDisposableTestDatabase(url), 'Explicit isolated local *_test database required');
	process.env.MEGU_DATABASE_URL = url;
	assert.equal(Object.hasOwn(require('../core'), 'companies'), false, 'Retired Company management must not be exposed by the shared core');
	const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
	const schema = `company"preflight_${process.pid}`;
	const quoted = `"${schema.replace(/"/g, '""')}"`;
	await client.connect();
	let created = false;
	try {
		await assert.rejects(inventory(client), /read-only transaction/);
		await client.query(`CREATE SCHEMA ${quoted}`);
		created = true;
		await client.query(`SET search_path TO ${quoted}`);
		const empty = await preflight(client, schema);
		assert.equal(empty.schemaState, 'absent');
		assert.equal(empty.safeToRetire, false);
		assert.equal(empty.dataClassification, 'unclassified');
		assert.equal(empty.missingTables.length, 7);
		assert.ok(empty.skippedChecks.includes('linkedTeams'));
		await client.query(`CREATE TABLE users(id text PRIMARY KEY);
		 CREATE TABLE teams(id text PRIMARY KEY,discord_guild_id text,archived_at timestamptz,name text DEFAULT 'Team');
		 CREATE TABLE team_join_links(id text PRIMARY KEY);
		 CREATE TABLE team_memberships(team_id text REFERENCES teams(id),user_id text REFERENCES users(id),role text,revoked_at timestamptz);
		 CREATE TABLE projects(id text PRIMARY KEY,team_id text REFERENCES teams(id),owner_user_id text REFERENCES users(id));
		 CREATE TABLE project_memberships(project_id text REFERENCES projects(id),user_id text REFERENCES users(id),revoked_at timestamptz);
		 CREATE TABLE team_events(id text PRIMARY KEY,payload jsonb);
		 CREATE TABLE notification_events(id text PRIMARY KEY,event_type text,payload jsonb);
		 CREATE TABLE notification_deliveries(event_id text REFERENCES notification_events(id),status text);
		 CREATE TABLE project_reminder_jobs(project_id text REFERENCES projects(id),status text);
		 CREATE TABLE project_channel_deliveries(project_id text REFERENCES projects(id),status text);
		 CREATE TABLE team_goals(team_id text REFERENCES teams(id));
		 CREATE TABLE team_membership_sources(team_id text REFERENCES teams(id));
		 CREATE TABLE team_membership_suppressions(team_id text REFERENCES teams(id));
		 CREATE TABLE server_role_mappings(team_id text REFERENCES teams(id));`);
		await installCompanySchema(client);
		const installed = await preflight(client, schema);
		assert.equal(installed.schemaState, 'present');
		assert.equal(installed.counts.companies, '0');
		assert.equal(installed.impact.linkedTeams, '0');
		assert.ok(installed.foreignKeys.some(fk => fk.source_table === 'teams' && fk.target_table === 'companies'));
		await client.query(`INSERT INTO users VALUES ('owner'),('revoked'),('missing');
		 INSERT INTO companies(id,discord_guild_id,name,lifecycle,archived_at) VALUES
		 ('active','guild-a','Private retained name','active',NULL),('archived','guild-b','Archived','archived',now());
		 INSERT INTO teams(id,discord_guild_id,archived_at,company_id) VALUES ('a','guild-a',NULL,'active'),('b','wrong-guild',NULL,'archived'),('independent',NULL,NULL,NULL);
		 INSERT INTO company_memberships(company_id,user_id,role,revoked_at) VALUES
		 ('active','owner','owner',NULL),('active','revoked','member',now());
		 INSERT INTO team_memberships VALUES ('a','owner','owner',NULL),('a','revoked','member',NULL),
		 ('b','missing','owner',NULL),('a','missing','member',now()),('independent','missing','owner',NULL);
		 INSERT INTO projects VALUES ('p','a','revoked'),('standalone',NULL,'missing');
		 INSERT INTO project_memberships VALUES ('p','revoked',NULL),('p','owner',NULL),('p','missing',now()),('standalone','missing',NULL);
		 INSERT INTO team_events VALUES ('history','{"nested":{"companyId":"active"}}');
		 INSERT INTO notification_events VALUES ('direct','company_join_requested','{"companyRequestId":"request","ctaUrl":"/companies/active/requests"}'),
		 ('team','team_join_requested','{"teamId":"a"}'),('project','project_topic_due','{"projectId":"p"}'),
		 ('url','other','{"ctaUrl":"https://example.invalid/companies/active"}'),('sent','company_join_requested','{}');
		 INSERT INTO notification_deliveries VALUES ('direct','pending'),('team','sending'),('project','failed'),('url','pending'),('sent','sent');
		 INSERT INTO project_reminder_jobs VALUES ('p','pending'),('p','skipped');
		 INSERT INTO project_channel_deliveries VALUES ('p','sending'),('p','sent');
		 INSERT INTO team_goals VALUES ('a'); INSERT INTO team_membership_sources VALUES ('a');
		 INSERT INTO team_membership_suppressions VALUES ('a'); INSERT INTO server_role_mappings VALUES ('a');
		 CREATE TABLE retained_reference(company_id text REFERENCES companies(id));
		 INSERT INTO retained_reference VALUES ('active');
		 CREATE TABLE company_extension(company_id text REFERENCES companies(id));
		 INSERT INTO company_extension VALUES ('active');
		 CREATE TABLE loose_reference(company_id text);
		 INSERT INTO loose_reference VALUES ('active'),(NULL);`);
		const before = (await client.query('SELECT jsonb_agg(to_jsonb(t) ORDER BY id) AS snapshot FROM teams t')).rows[0].snapshot;
		const report = await preflight(client, schema);
		assert.equal(report.counts.companies, '2');
		assert.equal(report.counts.company_extension, '1', 'Unknown legacy tables must be inventoried');
		assert.equal(report.impact.linkedTeams, '2');
		assert.equal(report.impact.guildMismatchTeams, '1');
		assert.equal(report.impact.activeTeamsUnderArchivedCompany, '1');
		assert.equal(report.impact.activeTeamMembersWithoutCompanyEligibility, '2');
		assert.equal(report.impact.teamOwnersWithoutCompanyEligibility, '1');
		assert.equal(report.impact.linkedProjects, '1');
		assert.equal(report.impact.projectOwnersWithoutCompanyEligibility, '1');
		assert.equal(report.impact.activeProjectMembersWithoutCompanyEligibility, '1');
		assert.equal(report.impact.outstandingCompanyNotifications, '2');
		assert.equal(report.impact.outstandingNotificationsOnLinkedTeams, '2');
		assert.equal(report.impact.project_reminder_jobsOutstandingOnLinkedTeams, '1');
		assert.equal(report.impact.project_channel_deliveriesOutstandingOnLinkedTeams, '1');
		for (const name of ['team_goals', 'team_membership_sources', 'team_membership_suppressions', 'server_role_mappings']) {
			assert.equal(report.impact[`${name}OnLinkedTeams`], '1');
		}
		assert.equal(report.jsonReferences.team_events, '1');
		assert.equal(report.jsonReferences.notification_events, '2');
		assert.equal(report.foreignKeys.find(fk => fk.source_table === 'retained_reference').referencing_rows, '1');
		assert.equal(report.columnReferences.retained_reference, '1');
		assert.equal(report.columnReferences.loose_reference, '1', 'Unconstrained Company columns are retained references too');
		assert.equal(report.safeToRetire, false);
		assert.doesNotMatch(JSON.stringify(report), /Private retained name|guild-a|wrong-guild|https:\/\//);
		assert.deepEqual((await client.query('SELECT jsonb_agg(to_jsonb(t) ORDER BY id) AS snapshot FROM teams t')).rows[0].snapshot, before);
		assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'off', 'Preflight ends its snapshot');
		await client.query('BEGIN READ ONLY');
		await client.query('SAVEPOINT cannot_write');
		await assert.rejects(client.query("UPDATE company_memberships SET revoked_at=NULL WHERE user_id='revoked'"), { code: '25006' });
		await client.query('ROLLBACK TO SAVEPOINT cannot_write');
		assert.equal((await inventory(client, schema)).impact.activeTeamMembersWithoutCompanyEligibility, '2');
		await client.query('ROLLBACK');
		// Fail closed when an incoming FK crosses the audited schema boundary.
		const external = `${quoted.slice(0, -1)}_external"`;
		await client.query(`CREATE SCHEMA ${external}`);
		try {
			await client.query(`CREATE TABLE ${external}.references_company(company_id text REFERENCES companies(id));
			 INSERT INTO ${external}.references_company VALUES ('active')`);
			const crossSchema = (await preflight(client, schema)).foreignKeys.find(fk => fk.source_table === 'references_company');
			assert.equal(crossSchema.source_schema, `${schema}_external`);
			assert.equal(crossSchema.referencing_rows, '1');
		} finally { await client.query(`DROP SCHEMA ${external} CASCADE`); }
		await client.query('DROP TABLE company_migrations');
		assert.equal((await preflight(client, schema)).schemaState, 'partial');
		console.log('Company retirement preflight passed: read-only census, missing/partial schemas, FK/history/outbox references, access-risk counts, privacy and live-fallback rejection.');
	} finally {
		await client.query('ROLLBACK');
		if (created) await client.query(`DROP SCHEMA ${quoted} CASCADE`);
		await client.end();
	}
}

main().catch(error => { console.error(error); process.exitCode = 1; });
