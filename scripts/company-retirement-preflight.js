'use strict';

// No dotenv, core startup, schema installation or application pool: this tool
// must never fall back to the live database or mutate the schema being audited.
const { Client } = require('pg');
const { postgresConnectionOptions } = require('../core/postgres-connection.js');
const { isDisposableTestDatabase } = require('../tests/test-database');

const quote = value => `"${String(value).replace(/"/g, '""')}"`;

async function inventory(client, schema = 'public') {
	if ((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only !== 'on') {
		throw new Error('Company inventory requires a read-only transaction');
	}
	const catalog = (await client.query(`SELECT c.relname AS table_name,a.attname AS column_name
		FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
		JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
		WHERE n.nspname=$1 AND c.relkind IN ('r','p') ORDER BY c.relname,a.attnum`, [schema])).rows;
	const columns = new Map();
	for (const row of catalog) {
		if (!columns.has(row.table_name)) columns.set(row.table_name, new Set());
		columns.get(row.table_name).add(row.column_name);
	}
	const table = name => `${quote(schema)}.${quote(name)}`;
	const legacyTables = [...columns.keys()].filter(name => name === 'companies' || name.startsWith('company_'));
	const counts = {};
	for (const name of legacyTables) counts[name] = (await client.query(`SELECT count(*)::text AS n FROM ${table(name)}`)).rows[0].n;
	const columnReferences = {};
	for (const [name, fields] of columns) {
		if (fields.has('company_id')) columnReferences[name] = (await client.query(`SELECT count(*)::text AS n FROM ${table(name)} WHERE company_id IS NOT NULL`)).rows[0].n;
	}
	const expected = ['companies', 'company_memberships', 'company_events', 'company_migrations',
		'company_join_links', 'company_join_requests', 'company_ownership_transfers'];
	const missing = expected.filter(name => !columns.has(name));
	const skipped = [];
	const impact = {};
	async function metric(name, required, sql) {
		if (Object.entries(required).some(([relation, fields]) => fields.some(field => !columns.get(relation)?.has(field)))) {
			skipped.push(name);
			return;
		}
		impact[name] = (await client.query(sql)).rows[0].n;
	}
	const teams = { teams: ['id', 'company_id', 'discord_guild_id', 'archived_at'] };
	const scope = { ...teams, companies: ['id', 'discord_guild_id', 'lifecycle'] };
	const roster = { ...scope, company_memberships: ['company_id', 'user_id', 'revoked_at'] };
	const linked = `FROM ${table('teams')} t WHERE t.company_id IS NOT NULL`;
	await metric('linkedTeams', teams, `SELECT count(*)::text AS n ${linked}`);
	await metric('missingCompanyTeams', scope, `SELECT count(*)::text AS n FROM ${table('teams')} t
		LEFT JOIN ${table('companies')} c ON c.id=t.company_id WHERE t.company_id IS NOT NULL AND c.id IS NULL`);
	await metric('guildMismatchTeams', scope, `SELECT count(*)::text AS n FROM ${table('teams')} t
		JOIN ${table('companies')} c ON c.id=t.company_id WHERE t.discord_guild_id IS DISTINCT FROM c.discord_guild_id`);
	await metric('activeTeamsUnderArchivedCompany', scope, `SELECT count(*)::text AS n FROM ${table('teams')} t
		JOIN ${table('companies')} c ON c.id=t.company_id WHERE t.archived_at IS NULL AND c.lifecycle='archived'`);
	const eligible = user => `EXISTS (SELECT 1 FROM ${table('company_memberships')} cm
		WHERE cm.company_id=t.company_id AND cm.user_id=${user} AND cm.revoked_at IS NULL)`;
	await metric('activeTeamMembersWithoutCompanyEligibility', { ...roster, team_memberships: ['team_id', 'user_id', 'revoked_at'] },
		`SELECT count(*)::text AS n FROM ${table('team_memberships')} m JOIN ${table('teams')} t ON t.id=m.team_id
		WHERE t.company_id IS NOT NULL AND m.revoked_at IS NULL AND NOT ${eligible('m.user_id')}`);
	await metric('teamOwnersWithoutCompanyEligibility', { ...roster, team_memberships: ['team_id', 'user_id', 'role', 'revoked_at'] },
		`SELECT count(*)::text AS n FROM ${table('team_memberships')} m JOIN ${table('teams')} t ON t.id=m.team_id
		WHERE t.company_id IS NOT NULL AND m.revoked_at IS NULL AND m.role='owner' AND NOT ${eligible('m.user_id')}`);
	const projects = { ...roster, projects: ['id', 'team_id', 'owner_user_id'] };
	const projectScope = `FROM ${table('projects')} p JOIN ${table('teams')} t ON t.id=p.team_id WHERE t.company_id IS NOT NULL`;
	await metric('linkedProjects', projects, `SELECT count(*)::text AS n ${projectScope}`);
	await metric('projectOwnersWithoutCompanyEligibility', projects, `SELECT count(*)::text AS n ${projectScope} AND NOT ${eligible('p.owner_user_id')}`);
	await metric('activeProjectMembersWithoutCompanyEligibility', { ...projects, project_memberships: ['project_id', 'user_id', 'revoked_at'] },
		`SELECT count(*)::text AS n FROM ${table('project_memberships')} m JOIN ${table('projects')} p ON p.id=m.project_id
		JOIN ${table('teams')} t ON t.id=p.team_id WHERE t.company_id IS NOT NULL AND m.revoked_at IS NULL AND NOT ${eligible('m.user_id')}`);
	for (const name of ['team_goals', 'team_membership_sources', 'team_membership_suppressions', 'server_role_mappings']) {
		await metric(`${name}OnLinkedTeams`, { ...teams, [name]: ['team_id'] }, `SELECT count(*)::text AS n
			FROM ${table(name)} r JOIN ${table('teams')} t ON t.id=r.team_id WHERE t.company_id IS NOT NULL`);
	}
	for (const name of ['project_reminder_jobs', 'project_channel_deliveries']) {
		await metric(`${name}OutstandingOnLinkedTeams`, { ...teams, projects: ['id', 'team_id'], [name]: ['project_id', 'status'] },
			`SELECT count(*)::text AS n FROM ${table(name)} r JOIN ${table('projects')} p ON p.id=r.project_id
			JOIN ${table('teams')} t ON t.id=p.team_id WHERE t.company_id IS NOT NULL AND r.status IN ('pending','failed','sending','queued')`);
	}
	// Include embedded historical IDs and retired CTA links, not just FKs.
	const referencePattern = '"company(Id|RequestId|LinkId)"[[:space:]]*:|/companies/';
	const jsonReferences = {};
	for (const name of ['team_events', 'project_events', 'server_role_events', 'team_goal_events', 'notification_events']) {
		if (!columns.get(name)?.has('payload')) { skipped.push(`${name}PayloadReferences`); continue; }
		jsonReferences[name] = (await client.query(`SELECT count(*)::text AS n FROM ${table(name)} WHERE payload::text ~ $1`, [referencePattern])).rows[0].n;
	}
	await metric('outstandingCompanyNotifications', { notification_events: ['id', 'event_type', 'payload'], notification_deliveries: ['event_id', 'status'] },
		`SELECT count(*)::text AS n FROM ${table('notification_deliveries')} d JOIN ${table('notification_events')} e ON e.id=d.event_id
		WHERE d.status IN ('pending','failed','sending') AND (e.event_type LIKE 'company\\_%' ESCAPE '\\' OR e.payload::text ~ '${referencePattern}')`);
	await metric('outstandingNotificationsOnLinkedTeams', { ...teams, projects: ['id', 'team_id'], notification_events: ['id', 'payload'], notification_deliveries: ['event_id', 'status'] },
		`SELECT count(*)::text AS n FROM ${table('notification_deliveries')} d JOIN ${table('notification_events')} e ON e.id=d.event_id
		WHERE d.status IN ('pending','failed','sending') AND EXISTS (SELECT 1 FROM ${table('teams')} t
		WHERE t.company_id IS NOT NULL AND (t.id=e.payload->>'teamId' OR EXISTS
		(SELECT 1 FROM ${table('projects')} p WHERE p.team_id=t.id AND p.id=e.payload->>'projectId')))`);
	const foreignKeys = (await client.query(`SELECT sn.nspname AS source_schema,s.relname AS source_table,
		tn.nspname AS target_schema,t.relname AS target_table,k.conname AS constraint_name,
		ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY v(num,pos)
		JOIN pg_attribute a ON a.attrelid=s.oid AND a.attnum=v.num ORDER BY v.pos) AS source_columns,
		ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY v(num,pos)
		JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=v.num ORDER BY v.pos) AS target_columns
		FROM pg_constraint k JOIN pg_class s ON s.oid=k.conrelid JOIN pg_namespace sn ON sn.oid=s.relnamespace
		JOIN pg_class t ON t.oid=k.confrelid JOIN pg_namespace tn ON tn.oid=t.relnamespace
		WHERE k.contype='f' AND ((sn.nspname=$1 AND s.relname=ANY($2::text[]))
		OR (tn.nspname=$1 AND t.relname=ANY($2::text[]))) ORDER BY sn.nspname,s.relname,k.conname`, [schema, legacyTables])).rows;
	for (const fk of foreignKeys) {
		fk.referencing_rows = (await client.query(`SELECT count(*)::text AS n FROM ${quote(fk.source_schema)}.${quote(fk.source_table)}
			WHERE ${fk.source_columns.map(column => `${quote(column)} IS NOT NULL`).join(' AND ')}`)).rows[0].n;
	}
	return {
		schema, schemaState: missing.length === 0 ? 'present' : legacyTables.length ? 'partial' : 'absent',
		counts, columnReferences, impact, jsonReferences, foreignKeys, missingTables: missing, skippedChecks: skipped,
		// Counts cannot establish whether rows are disposable fixtures or retained
		// application data. Never turn an empty local inventory into drop approval.
		dataClassification: 'unclassified', safeToRetire: false,
	};
}

async function preflight(client, schema = 'public') {
	await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
	try {
		await client.query("SET LOCAL statement_timeout='30s'");
		await client.query("SET LOCAL lock_timeout='5s'");
		await client.query('SET LOCAL row_security=off');
		return await inventory(client, schema);
	} finally {
		await client.query('ROLLBACK');
	}
}

async function main() {
	const retained = process.argv.length===3 && process.argv[2]==='--authorized-retained-inventory';
	if (process.argv.length>2 && !retained) throw new Error('Unknown Company preflight option');
	const url = retained ? process.env.MEGU_COMPANY_INVENTORY_DATABASE_URL : process.env.MEGU_TEST_DATABASE_URL;
	if (retained) {
		if (!url) throw new Error('Explicit MEGU_COMPANY_INVENTORY_DATABASE_URL required for authorized read-only inventory');
	} else if (!isDisposableTestDatabase(url)) throw new Error('Explicit MEGU_TEST_DATABASE_URL for a local *_test database required; no live fallback');
	const client = new Client({ ...postgresConnectionOptions(url), connectionTimeoutMillis: 5000 });
	try {
		await client.connect();
		console.log(JSON.stringify(await preflight(client), null, 2));
	} finally { await client.end(); }
}

if (require.main === module) main().catch(error => {
	// Do not expose a connection string, row values or credentials on failure.
	console.error(`Company preflight failed (${error.code || 'validation'}). ${error.code ? 'No inventory established.' : error.message}`);
	process.exitCode = 1;
});

module.exports = { inventory, preflight };
