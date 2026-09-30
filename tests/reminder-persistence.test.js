'use strict';
// Real PostgreSQL, exclusively the existing validated disposable test target.
// TEMP tables shadow application tables; no production/schema rollout is involved.
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Client } = require('pg');
const { resolveTestDatabaseUrl } = require('./test-database');
const { postgresConnectionOptions } = require('../core/postgres-connection');

async function main() {
	let url;
	try { url = resolveTestDatabaseUrl(); }
	catch { throw new Error('Reminder PostgreSQL checks require an existing, validated local disposable test database.'); }
	const client = new Client({ ...postgresConnectionOptions(url), connectionTimeoutMillis: 2000 });
	try {
		await client.connect();
		await client.query('CREATE TEMP TABLE reminders (id SERIAL PRIMARY KEY, user_id TEXT, guild_id TEXT, channel_id TEXT, reminder_time BIGINT, message TEXT, recurring VARCHAR(50))');
		const source = fs.readFileSync(path.join(__dirname, '../backend/database/database.js'), 'utf8');
		const context = { pool: client, BotLogs() {}, COLOR: { red: '' }, module: { exports: {} } };
		vm.runInNewContext(source.slice(source.indexOf('async function getActiveReminders('), source.indexOf('async function clearAllReminders(')) + '\nmodule.exports={getActiveReminders,deleteReminder,updateReminderTime};', context);
		const db = context.module.exports;
		const row = await client.query("INSERT INTO reminders (reminder_time, recurring) VALUES (1, 'false') RETURNING id");
		const id = row.rows[0].id;
		assert.equal((await db.getActiveReminders({ throwOnError: true }))[0].reminder_time, 1);
		assert.equal(await db.updateReminderTime(id, 2), true);
		assert.equal((await db.getActiveReminders())[0].reminder_time, 2);
		await client.query('ALTER TABLE reminders ADD COLUMN triggered BOOLEAN DEFAULT FALSE');
		assert.equal((await db.getActiveReminders()).length, 1);
		await client.query('UPDATE reminders SET triggered = TRUE');
		assert.equal((await db.getActiveReminders()).length, 0);
		assert.equal(await db.deleteReminder(id), true);
		assert.equal((await client.query('SELECT * FROM reminders')).rows.length, 0);
		await client.query('DROP TABLE pg_temp.reminders');
		// Hide any persistent table when exercising SQL failure behavior.
		await client.query('SET search_path = pg_temp');
		assert.equal(await db.deleteReminder(id), false);
		assert.equal(await db.updateReminderTime(id, 3), false);
		await assert.rejects(db.getActiveReminders({ throwOnError: true }));
		console.log('Reminder PostgreSQL persistence passed: current/legacy table reads, update/delete acknowledgements and failures.');
	}
	finally { await client.end(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
