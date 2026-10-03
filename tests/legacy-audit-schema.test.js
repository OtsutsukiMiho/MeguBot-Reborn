'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Client } = require('pg');
const { resolveTestDatabaseUrl } = require('./test-database.js');
const { postgresConnectionOptions } = require('../core/postgres-connection.js');

async function main() {
	const localFile = path.resolve(__dirname, '../.env.workflow-test.local');
	const env = process.env.MEGU_TEST_DATABASE_URL ? process.env
		: fs.existsSync(localFile) ? require('dotenv').parse(fs.readFileSync(localFile)) : process.env;
	const url = resolveTestDatabaseUrl(env);
	const client = new Client({ ...postgresConnectionOptions(url, {}), connectionTimeoutMillis: 4000 });
	assert.ok(['localhost', '127.0.0.1', '::1'].includes(client.connectionParameters.host), 'effective destination must be loopback');
	assert.ok(client.connectionParameters.database.endsWith('_test'), 'database must be disposable');
	await client.connect();
	// Serialize the pool's fire-and-forget retention queries on this single test client.
	let pending = Promise.resolve();
	const query = (...args) => {
		const next = pending.then(() => client.query(...args));
		pending = next.catch(() => {});
		return next;
	};
	let checks = 0;
	try {
		assert.equal((await query('SELECT current_database() AS name')).rows[0].name, client.connectionParameters.database);
		for (const older of [false, true]) {
			await query('BEGIN');
			try {
				// Transaction-local schema: every real bootstrap query is exercised,
				// while rollback leaves the pilot's existing tables/settings untouched.
				const schema = `audit_schema_test_${process.pid}_${older ? 'old' : 'fresh'}`;
				await query(`CREATE SCHEMA "${schema}"`);
				await query(`SET LOCAL search_path TO "${schema}"`);
				if (older) {
					await query(`CREATE TABLE audit_logs (
						id SERIAL PRIMARY KEY, guild_id VARCHAR(30) NOT NULL, guild_name VARCHAR(100),
						event_type VARCHAR(50) NOT NULL, user_id VARCHAR(30), username VARCHAR(100),
						details TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
						INSERT INTO audit_logs (guild_id, event_type, details) VALUES ('111111111111111111', 'OLD_EVENT', 'retained history');
						CREATE TABLE guild_variables (guild_id VARCHAR(30) PRIMARY KEY, variables JSONB DEFAULT '{}'::jsonb);
						INSERT INTO guild_variables VALUES ('111111111111111111', '{"tts_channel_id":"saved-text","tts_waiting_room_channel_id":"saved-room"}');`);
				}
				const logs = [], file = path.resolve(__dirname, '../backend/database/database.js');
				const nativeRequire = createRequire(file), loaded = { exports: {} };
				// Only connection ownership and logging are substituted. SQL, actual
				// initializer, retention routines and writer execute against PostgreSQL.
				class BoundPool {
					on() {}
					async connect() { return { query: (...args) => query(...args), release() {} }; }
					query(...args) { return query(...args); }
					async end() {}
				}
				vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
					module: loaded, __dirname: path.dirname(file), process: { env: { DATABASE_URL: url } },
					setInterval: () => ({ unref() {} }),
					require: id => id === 'pg' ? { Pool: BoundPool }
						: id.includes('bot_functions') ? { BotLogs: (_category, message) => logs.push(message), COLOR: {} }
							: id === 'fs' ? { ...fs, mkdirSync() { throw new Error('Unexpected JSON fallback'); } } : nativeRequire(id),
				}, { filename: file });
				const db = loaded.exports;
				await db.initDatabase();
				const definition = async () => (await query(`SELECT data_type, character_maximum_length, is_nullable, column_default
					FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'audit_logs' AND column_name = 'action_type'`, [schema])).rows;
				assert.deepEqual(await definition(), [{ data_type: 'character varying', character_maximum_length: 50, is_nullable: 'YES', column_default: null }]);
				const before = (await query(`SELECT 'audit_logs'::regclass::oid AS oid`)).rows[0].oid;
				await db.logAuditEvent('111111111111111111', 'NEW_EVENT', null, 'Test', 'new history');
				await db.initDatabase();
				await db.initDatabase();
				assert.equal((await query(`SELECT 'audit_logs'::regclass::oid AS oid`)).rows[0].oid, before, 'healthy table must not be recreated');
				assert.equal((await definition()).length, 1);
				const rows = (await query('SELECT event_type, action_type, details FROM audit_logs ORDER BY id')).rows;
				assert.deepEqual(rows, older ? [
					{ event_type: 'OLD_EVENT', action_type: null, details: 'retained history' },
					{ event_type: 'NEW_EVENT', action_type: 'NEW_EVENT', details: 'new history' },
				] : [{ event_type: 'NEW_EVENT', action_type: 'NEW_EVENT', details: 'new history' }]);
				if (older) assert.deepEqual((await query('SELECT variables FROM guild_variables')).rows[0].variables,
					{ tts_channel_id: 'saved-text', tts_waiting_room_channel_id: 'saved-room' });
				assert.ok(!logs.some(message => /error|failed|fallback/i.test(message)), 'bootstrap/writer must not swallow a database failure');
				checks++;
				console.log(`PASS: ${older ? 'old schema additive upgrade, retained history/settings' : 'fresh schema'}; real writer and repeated healthy bootstrap`);
			}
			finally { await query('ROLLBACK'); }
		}
		console.log(`${checks} PostgreSQL schema checks passed; pilot tables unchanged`);
	}
	finally { await client.end(); }
}

main().catch(error => {
	console.error(String(error.stack || error).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[redacted database URL]'));
	process.exitCode = 1;
});
