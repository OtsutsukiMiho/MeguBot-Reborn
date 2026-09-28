'use strict';

const assert = require('node:assert/strict');
const { Client } = require('pg');
const { isDisposableTestDatabase } = require('./test-database');
const { installCompanySchema, backfillCompanies } = require('../core/company-schema');

async function main() {
	const url = process.env.MEGU_TEST_DATABASE_URL || process.env.MEGU_DATABASE_URL;
	assert.ok(isDisposableTestDatabase(url), 'Explicit isolated local *_test database required');
	const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
	await client.connect();
	try {
		await client.query('BEGIN');
		// Dedicated temporary schema: every test change is rolled back, including DDL.
		await client.query('CREATE SCHEMA company_migration_test');
		await client.query('SET LOCAL search_path TO company_migration_test');
		await client.query(`CREATE TABLE users(id text PRIMARY KEY);
		 CREATE TABLE teams(id text PRIMARY KEY,created_by text REFERENCES users(id),name text,
		 discord_guild_id text,discord_guild_name text,discord_guild_icon text,
		 updated_at timestamptz DEFAULT now(),archived_at timestamptz);
		 CREATE TABLE team_memberships(team_id text REFERENCES teams(id),user_id text REFERENCES users(id),
		 role text,joined_at timestamptz DEFAULT now(),revoked_at timestamptz,PRIMARY KEY(team_id,user_id));
		 CREATE TABLE team_join_links(id text PRIMARY KEY);
		 INSERT INTO users VALUES ('owner'),('member'),('revoked');
		 INSERT INTO teams(id,name,discord_guild_id,discord_guild_name,updated_at) VALUES
		 ('a','IT','11111111111111111','Old name','2026-01-01'),
		 ('b','Dev','11111111111111111','Current name','2026-02-01'),
		 ('c','Other','22222222222222222','Other company','2026-02-01'),
		 ('d','Independent',NULL,NULL,'2026-02-01');
		 INSERT INTO team_memberships(team_id,user_id,role,revoked_at) VALUES
		 ('a','owner','owner',NULL),('b','owner','owner',NULL),('b','member','member',NULL),
		 ('a','revoked','member',now()),('d','member','owner',NULL)`);
		await installCompanySchema(client);
		await installCompanySchema(client);
		assert.deepEqual(await backfillCompanies(client), { alreadyApplied: false, companies: 2, teams: 3, members: 2 });
		const companies = (await client.query('SELECT * FROM companies ORDER BY discord_guild_id')).rows;
		assert.equal(companies[0].name, 'Current name');
		assert.equal(companies[0].lifecycle, 'unclaimed');
		assert.equal((await client.query("SELECT company_id FROM teams WHERE id='d'")).rows[0].company_id, null);
		assert.equal((await client.query("SELECT count(*)::int AS n FROM company_memberships WHERE role='owner' OR user_id='revoked'")).rows[0].n, 0);
		await client.query("UPDATE company_memberships SET revoked_at=now() WHERE user_id='member'");
		assert.deepEqual(await backfillCompanies(client), { alreadyApplied: true });
		assert.ok((await client.query("SELECT revoked_at FROM company_memberships WHERE user_id='member'")).rows[0].revoked_at);
		await client.query('SAVEPOINT duplicate');
		await assert.rejects(client.query("INSERT INTO companies(id,discord_guild_id,name) VALUES ('duplicate','11111111111111111','Wrong')"), { code: '23505' });
		await client.query('ROLLBACK TO SAVEPOINT duplicate');
		await client.query("UPDATE company_memberships SET role='owner' WHERE user_id='owner'");
		await client.query('SAVEPOINT owners');
		await assert.rejects(client.query("UPDATE company_memberships SET role='owner',revoked_at=NULL WHERE user_id='member'"), { code: '23505' });
		await client.query('ROLLBACK TO SAVEPOINT owners');
		console.log('Company migration: grouping, snapshots, independent teams, no owner inference, no revoked re-admission, rerun and uniqueness passed.');
	}
	finally {
		await client.query('ROLLBACK');
		await client.end();
	}
}

main().catch(error => { console.error(error); process.exitCode = 1; });
