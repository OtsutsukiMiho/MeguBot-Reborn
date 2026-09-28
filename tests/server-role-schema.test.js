'use strict';
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { isDisposableTestDatabase } = require('./test-database');
const { installServerRoleSchema } = require('../core/server-role-schema');

async function main() {
	const url = process.env.MEGU_TEST_DATABASE_URL || process.env.MEGU_DATABASE_URL;
	assert.ok(isDisposableTestDatabase(url), 'Explicit isolated local *_test database required');
	const client = new Client({ connectionString: url });
	await client.connect();
	try {
		await client.query('BEGIN');
		await client.query('CREATE SCHEMA server_role_schema_test');
		await client.query('SET LOCAL search_path TO server_role_schema_test');
		await client.query(`CREATE TABLE users(id text PRIMARY KEY);
		 CREATE TABLE teams(id text PRIMARY KEY,discord_guild_id text);
		 INSERT INTO users VALUES ('owner'),('admin');
		 INSERT INTO teams VALUES ('team','123456789012345678'),('other','998877665544332211'),('independent',NULL)`);
		await installServerRoleSchema(client);
		await installServerRoleSchema(client);
		const reject = async (sql, code) => {
			await client.query('SAVEPOINT invalid');
			await assert.rejects(client.query(sql), error => error.code === code);
			await client.query('ROLLBACK TO SAVEPOINT invalid');
		};
		await client.query(`INSERT INTO server_role_mappings(id,guild_id,kind,team_id,created_by) VALUES ('mapping','123456789012345678','team','team','admin')`);
		assert.equal((await client.query('SELECT enabled FROM server_role_mappings')).rows[0].enabled, false);
		await reject(`UPDATE server_role_mappings SET enabled=true`, '23514');
		await reject(`UPDATE server_role_mappings SET team_id='other'`, '23503');
		await reject(`UPDATE server_role_mappings SET team_id='independent'`, '23503');
		await reject(`UPDATE server_role_mappings SET owner_consent_by='owner'`, '23514');
		await client.query(`UPDATE server_role_mappings SET owner_consent_by='owner',owner_consent_at=now(),server_consent_by='admin',server_consent_at=now(),enabled=true`);
		await client.query("ALTER TABLE server_role_mappings DROP COLUMN active_team_id; ALTER TABLE server_role_mappings DROP COLUMN retired_at; ALTER TABLE server_role_mappings ADD CONSTRAINT legacy_team_guild_fk FOREIGN KEY(team_id,guild_id) REFERENCES teams(id,discord_guild_id) ON DELETE RESTRICT; CREATE UNIQUE INDEX server_role_mappings_team_key ON server_role_mappings(team_id) WHERE kind='team'");
		await installServerRoleSchema(client);
		assert.equal((await client.query("SELECT enabled,retired_at FROM server_role_mappings WHERE id='mapping'")).rows[0].retired_at, null, 'Populated pre-retirement storage gains nullable history state without discarding rows');
		await reject("UPDATE server_role_mappings SET retired_at=now() WHERE id='mapping'", '23514');
		await reject("INSERT INTO server_role_mappings(id,guild_id,kind,team_id,created_by) VALUES ('second','123456789012345678','team','team','admin')", '23505');
		await client.query("UPDATE server_role_mappings SET enabled=false,retired_at=now() WHERE id='mapping'");
		await client.query("INSERT INTO server_role_mappings(id,guild_id,kind,team_id,created_by) VALUES ('second','123456789012345678','team','team','admin')");
		assert.equal((await client.query("SELECT count(*)::int AS n FROM server_role_mappings WHERE team_id='team'")).rows[0].n, 2, 'Retired history permits exactly one new active mapping');
		await installServerRoleSchema(client);
		await reject(`INSERT INTO server_role_mappings(id,guild_id,kind,title,created_by) VALUES ('bad','123456789012345678','title',NULL,'admin')`, '23514');
		await client.query(`INSERT INTO server_role_mappings(id,guild_id,kind,title,created_by) VALUES ('titles','123456789012345678','title','Discord titles','admin')`);
		await reject(`INSERT INTO server_role_mappings(id,guild_id,kind,title,created_by) VALUES ('duplicate_titles','123456789012345678','title','Other titles','admin')`, '23505');
		await client.query(`INSERT INTO server_role_mapping_roles VALUES ('mapping','123456789012345679','Development')`);
		await reject(`INSERT INTO server_role_mapping_roles VALUES ('mapping','123456789012345679','Duplicate')`, '23505');
		await reject(`DELETE FROM users WHERE id='owner'`, '23001');
		await reject(`UPDATE teams SET discord_guild_id='998877665544332211' WHERE id='team'`, '23503');
		await client.query(`INSERT INTO server_role_suggestion_dismissals(mapping_id,discord_user_id,dismissed_by) VALUES ('mapping','223456789012345678','admin')`);
		await reject(`INSERT INTO server_role_suggestion_dismissals(mapping_id,discord_user_id,dismissed_by) VALUES ('mapping','223456789012345678','owner')`, '23505');
		await reject(`UPDATE server_role_suggestion_dismissals SET discord_user_id='invalid'`, '23514');
		await reject(`UPDATE server_role_suggestion_dismissals SET dismissed_by='missing'`, '23503');
		await client.query("DELETE FROM server_role_mappings WHERE id='mapping'");
		assert.equal((await client.query('SELECT count(*)::int AS n FROM server_role_suggestion_dismissals')).rows[0].n, 0, 'Unlink explicitly clears mapping-scoped dismissals');
		console.log('Server role schema passed: idempotency, guild binding, consent, titles, uniqueness and reference preservation');
	} finally {
		await client.query('ROLLBACK');
		await client.end();
	}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
