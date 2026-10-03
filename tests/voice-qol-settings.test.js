'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { validBatchWindow, resolveBatchWindow, batchWindowFromSeconds } = require('../core/voice-qol-settings');

async function main() {
	for (const [seconds, ms] of [['0.5', 500], ['1.5', 1500], ['3.2', 3200], ['5.0', 5000]]) {
		assert.equal(batchWindowFromSeconds(seconds), ms); assert.equal(resolveBatchWindow(ms) / 1000, Number(seconds));
	}
	for (const bad of [499, 5001, NaN, Infinity, '', '1500', null, true, 1500.5]) {
		assert.equal(validBatchWindow(bad), false); assert.equal(resolveBatchWindow(bad), 1500);
	}
	for (const bad of ['', ' ', 'NaN', 'Infinity', 'hello', '1.2.3']) assert.equal(batchWindowFromSeconds(bad), '');
	assert.equal(resolveBatchWindow(), 1500);

	const source = fs.readFileSync(require.resolve('../backend/web/web'), 'utf8');
	const start = source.indexOf("app.post('/api/guilds/:guildId/config'");
	const end = source.indexOf("app.post('/api/guilds/:guildId/reaction-roles'", start);
	const guild = '100000000000000001', other = '100000000000000002', voice = '200000000000000001', text = '200000000000000002';
	const stored = new Map(), writes = [];
	let handlers;
	vm.runInNewContext(source.slice(start, end), {
		app: { post: (_path, ...args) => { handlers = args; } },
		requireAdminGuild: async (req, res, next) => req.authorized ? next() : res.status(403).json({ error: 'Forbidden' }),
		validBatchWindow, resolveBatchWindow,
		sendIpcRequest: async ({ guildId }) => ({ channels: guildId === guild ? [{ id: voice, type: 2 }, { id: text, type: 0 }] : [] }),
		database: {
			getAllGuildVars: async id => ({ ...(stored.get(id) || {}) }),
			compareAndSetGuildRoleVars: async () => true,
			setGuildVar: async (id, key, value) => { writes.push(key); stored.set(id, { ...(stored.get(id) || {}), [key]: value }); },
			logAuditEvent: async () => {},
		},
		verifyConsoleRoles: async () => true, toBooleanSetting: (value, fallback = true) => value == null ? fallback : Boolean(value),
		process: {}, BotLogs: () => {},
	});
	async function save(body, guildId = guild, authorized = true) {
		const req = { params: { guildId }, body, authorized, session: { user: { id: 'actor', username: 'Actor' } } };
		const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
		await handlers[0](req, res, () => handlers[1](req, res)); return res;
	}
	assert.equal((await save({ tts_vc_batch_window_ms: 3200, tts_waiting_room_channel_id: voice })).statusCode, 200);
	assert.equal(stored.get(guild).tts_vc_batch_window_ms, 3200);
	assert.equal(stored.get(guild).tts_waiting_room_channel_id, voice);
	assert.equal((await save({})).data.config.tts_vc_batch_window_ms, 3200, 'Older clients do not erase settings');
	for (const bad of [499, 5001, NaN, Infinity, '', '1500']) {
		const before = writes.length; assert.equal((await save({ tts_vc_batch_window_ms: bad })).statusCode, 400); assert.equal(writes.length, before);
	}
	for (const bad of [text, '200000000000000099', 'invalid', 123, {}]) {
		const before = writes.length; assert.equal((await save({ tts_waiting_room_channel_id: bad })).statusCode, 400); assert.equal(writes.length, before);
	}
	assert.equal((await save({ tts_waiting_room_channel_id: voice }, other)).statusCode, 400, 'Cross-guild channel fails closed');
	assert.equal((await save({ tts_waiting_room_channel_id: null, tts_vc_batch_window_ms: 5000 })).statusCode, 200);
	assert.equal(stored.get(guild).tts_waiting_room_channel_id, null);
	assert.equal((await save({ tts_vc_batch_window_ms: 500 }, other)).statusCode, 200);
	assert.equal(stored.get(guild).tts_vc_batch_window_ms, 5000); assert.equal(stored.get(other).tts_vc_batch_window_ms, 500);
	const before = writes.length; assert.equal((await save({ tts_vc_batch_window_ms: 500 }, guild, false)).statusCode, 403); assert.equal(writes.length, before);
	// Real JSON persistence uses the existing store, not a parallel settings system.
	const db = fs.readFileSync(require.resolve('../backend/database/database'), 'utf8');
	const startWrite = db.indexOf('async function setGuildVar('), endWrite = db.indexOf('async function deleteGuildVar(', startWrite);
	const tmp = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'megu-voice-qol-'));
	try {
		const write = vm.runInNewContext(db.slice(startWrite, endWrite) + '\nsetGuildVar', {
			fs, path: require('node:path'), pool: null, VARS_DIR: tmp, sanitizeDbValue: value => value,
			clearGuildVarCache: () => {}, isValidSnowflake: () => true,
		});
		await write(guild, 'tts_vc_batch_window_ms', 3200); await write(guild, 'tts_waiting_room_channel_id', voice);
		const read = JSON.parse(fs.readFileSync(require('node:path').join(tmp, guild + '.json')));
		assert.equal(read.tts_vc_batch_window_ms, 3200); assert.equal(read.tts_waiting_room_channel_id, voice);
	} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
	if (process.env.MEGU_TEST_DATABASE_URL) {
		const url = require('./test-database').resolveTestDatabaseUrl({ MEGU_TEST_DATABASE_URL: process.env.MEGU_TEST_DATABASE_URL });
		const client = new (require('pg').Client)(require('../core/postgres-connection').postgresConnectionOptions(url, {}));
		assert.ok(['localhost', '127.0.0.1', '::1'].includes(client.connectionParameters.host));
		assert.ok(client.connectionParameters.database.endsWith('_test'));
		try {
			await client.connect();
			// Shadow the shared table for this connection: never alter existing fixture rows.
			await client.query('CREATE TEMP TABLE guild_variables (guild_id TEXT PRIMARY KEY, variables JSONB)');
			const write = vm.runInNewContext(db.slice(startWrite, endWrite) + '\nsetGuildVar', {
				pool: client, sanitizeDbValue: value => value, clearGuildVarCache: () => {}, BotLogs: () => {}, COLOR: {},
			});
			await write(guild, 'tts_vc_batch_window_ms', 3200); await write(guild, 'tts_waiting_room_channel_id', voice);
			await write(other, 'tts_vc_batch_window_ms', 500);
			const read = await client.query('SELECT guild_id, variables FROM guild_variables');
			const rows = new Map(read.rows.map(row => [row.guild_id, row.variables]));
			assert.equal(rows.get(guild).tts_vc_batch_window_ms, 3200); assert.equal(rows.get(guild).tts_waiting_room_channel_id, voice);
			assert.equal(rows.get(other).tts_vc_batch_window_ms, 500);
			await write(guild, 'tts_waiting_room_channel_id', null);
			assert.equal((await client.query('SELECT variables FROM guild_variables WHERE guild_id=$1', [guild])).rows[0].variables.tts_waiting_room_channel_id, null);
			console.log('PASS: real existing PostgreSQL settings write/update/clear and per-guild isolation in a disposable session-local table');
		} finally { await client.end(); }
	}
	console.log('PASS: batch conversion/default/invalid input, actual settings route validation, authorization, per-guild isolation and JSON persistence');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
