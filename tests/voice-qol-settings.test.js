'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { validBatchWindow, resolveBatchWindow, batchWindowFromSeconds } = require('../core/voice-qol-settings');
const { validVoiceTemplate, waitingRoomTemplate, textTtsTemplate } = require('../core/voice-qol-settings');

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
		validBatchWindow, resolveBatchWindow, validVoiceTemplate, ...require('../core/server-lang.js'),
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
	let readSettings;
	const readStart = source.indexOf("app.get('/api/guilds/:guildId',"), readEnd = source.indexOf('function parseReminderTimeInput', readStart);
	vm.runInNewContext(source.slice(readStart, readEnd), {
		app: { get: (_path, _guard, handler) => { readSettings = handler; } }, requireGuildAccess: () => {},
		sendIpcRequest: async () => ({ exists: true, channels: [] }),
		database: { getAllGuildVars: async id => ({ ...(stored.get(id) || {}) }) },
		resolveBatchWindow, ...require('../core/server-lang.js'), toBooleanSetting: (value, fallback = true) => value == null ? fallback : Boolean(value),
		parseReactionRolesMap: () => ({}), parseAutomodConfig: () => ({}),
	});
	async function reloadSettings(guildId = guild, isAdmin = true) {
		let data; await readSettings({ params: { guildId }, session: {}, guildAccess: { isAdmin } }, { json: value => { data = value; } }); return data;
	}
	assert.equal((await reloadSettings()).config.tts_waiting_room_template, null);
	assert.equal((await reloadSettings()).config.tts_channel_template, null);
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
	assert.equal(waitingRoomTemplate(undefined, 'en'), '{nickname} joined the waiting room');
	assert.equal(waitingRoomTemplate(undefined, 'th'), '{nickname} เข้าห้องรอแล้ว');
	assert.equal(textTtsTemplate(undefined), '{message}');
	const custom = { tts_waiting_room_template: '{nickname} is waiting in {server}', tts_channel_template: '{displayname} says {message}' };
	assert.equal((await save(custom)).statusCode, 200);
	for (const [key, value] of Object.entries(custom)) assert.equal((await reloadSettings()).config[key], value, 'Actual GET route reloads template fields');
	assert.equal((await reloadSettings(other)).config.tts_channel_template, null);
	assert.equal((await reloadSettings(guild, false)).config, undefined, 'Ordinary members cannot read admin template settings');
	assert.equal((await save({})).data.config.tts_channel_template, custom.tts_channel_template, 'Older clients preserve templates');
	for (const [key, kind] of [['tts_waiting_room_template', 'waiting'], ['tts_channel_template', 'text']]) {
		assert.equal(stored.get(guild)[key], custom[key]);
		assert.equal(stored.get(other)[key], undefined, 'Per-guild isolation');
		for (const bad of ['{unknown}', '{nickname', '{message}}', '{{message}}', '{server}', 'hello', '<speak>{nickname}{message}</speak>', '{nickname}{message}\u0000', 42, {}, 'x'.repeat(301), ...(kind === 'text' ? ['{displayname} says'] : ['{message}'])]) {
			const before = writes.length;
			assert.equal((await save({ [key]: bad })).statusCode, 400, `${key} rejects ${JSON.stringify(bad)}`);
			assert.equal(writes.length, before, 'Validation precedes every write');
		}
		const token = kind === 'text' ? '{message}' : '{nickname}';
		assert.equal(validVoiceTemplate(token + 'x'.repeat(300 - token.length), kind), true);
		assert.equal(validVoiceTemplate(token + 'x'.repeat(301 - token.length), kind), false);
		assert.equal(validVoiceTemplate(token.toUpperCase(), kind), true);
		assert.equal(validVoiceTemplate(null, kind), true);
	}
	await save({ tts_waiting_room_channel_id: null, tts_channel_id: null });
	assert.equal(stored.get(guild).tts_waiting_room_template, custom.tts_waiting_room_template);
	assert.equal(stored.get(guild).tts_channel_template, custom.tts_channel_template);
	await save({ tts_waiting_room_channel_id: voice, tts_channel_id: text });
	assert.equal(stored.get(guild).tts_waiting_room_template, custom.tts_waiting_room_template);
	assert.equal(stored.get(guild).tts_channel_template, custom.tts_channel_template);
	const denied = writes.length; assert.equal((await save(custom, guild, false)).statusCode, 403); assert.equal(writes.length, denied);
	await save({ tts_waiting_room_template: '', tts_channel_template: null });
	assert.equal(stored.get(guild).tts_waiting_room_template, null);
	assert.equal(stored.get(guild).tts_channel_template, null);
	// Real JSON persistence uses the existing store, not a parallel settings system.
	const db = fs.readFileSync(require.resolve('../backend/database/database'), 'utf8');
	const sanitizeStart = db.indexOf('function sanitizeDbValue(');
	const sanitizers = vm.runInNewContext(db.slice(sanitizeStart, db.indexOf('/**', sanitizeStart)) + '\n({sanitizeDbValue,sanitizeGuildVar,sanitizeGuildVars})', { validVoiceTemplate });
	const startWrite = db.indexOf('async function setGuildVar('), endWrite = db.indexOf('async function deleteGuildVar(', startWrite);
	const startRead = db.indexOf('async function getAllGuildVars('), endRead = db.indexOf('async function compareAndSetGuildRoleVars(', startRead);
	const tmp = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'megu-voice-qol-'));
	try {
		const write = vm.runInNewContext(db.slice(startWrite, endWrite) + '\nsetGuildVar', {
			fs, path: require('node:path'), pool: null, VARS_DIR: tmp, ...sanitizers,
			clearGuildVarCache: () => {}, isValidSnowflake: () => true,
		});
		await write(guild, 'tts_vc_batch_window_ms', 3200); await write(guild, 'tts_waiting_room_channel_id', voice);
		for (const [key, value] of Object.entries(custom)) await write(guild, key, value);
		await write(other, 'tts_channel_template', '{message} from {tag}');
		const read = JSON.parse(fs.readFileSync(require('node:path').join(tmp, guild + '.json')));
		assert.equal(read.tts_vc_batch_window_ms, 3200); assert.equal(read.tts_waiting_room_channel_id, voice);
		for (const [key, value] of Object.entries(custom)) assert.equal(read[key], value);
		const otherRead = JSON.parse(fs.readFileSync(require('node:path').join(tmp, other + '.json')));
		assert.equal(otherRead.tts_channel_template, '{message} from {tag}');
		const reload = vm.runInNewContext(db.slice(startRead, endRead) + '\ngetAllGuildVars', {
			fs, path: require('node:path'), pool: null, VARS_DIR: tmp, ...sanitizers, isValidSnowflake: () => true,
		});
		for (const [key, value] of Object.entries(custom)) assert.equal((await reload(guild))[key], value, 'Actual JSON reload retains templates');
		await write(guild, 'tts_channel_id', null); await write(guild, 'tts_waiting_room_channel_id', null);
		const disabled = JSON.parse(fs.readFileSync(require('node:path').join(tmp, guild + '.json')));
		for (const [key, value] of Object.entries(custom)) assert.equal(disabled[key], value);
		await write(guild, 'tts_channel_id', text); await write(guild, 'tts_waiting_room_channel_id', voice);
		for (const [key, value] of Object.entries(custom)) assert.equal((await reload(guild))[key], value);
		await write(guild, 'tts_channel_template', null); await write(guild, 'tts_waiting_room_template', null);
		assert.equal((await reload(guild)).tts_channel_template, null); assert.equal((await reload(guild)).tts_waiting_room_template, null);
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
				pool: client, ...sanitizers, clearGuildVarCache: () => {}, BotLogs: () => {}, COLOR: {},
			});
			await write(guild, 'tts_vc_batch_window_ms', 3200); await write(guild, 'tts_waiting_room_channel_id', voice);
			for (const [key, value] of Object.entries(custom)) await write(guild, key, value);
			await write(other, 'tts_channel_template', '{message} from {tag}');
			await write(other, 'tts_vc_batch_window_ms', 500);
			const read = await client.query('SELECT guild_id, variables FROM guild_variables');
			const rows = new Map(read.rows.map(row => [row.guild_id, row.variables]));
			assert.equal(rows.get(guild).tts_vc_batch_window_ms, 3200); assert.equal(rows.get(guild).tts_waiting_room_channel_id, voice);
			assert.equal(rows.get(other).tts_vc_batch_window_ms, 500);
			const reload = vm.runInNewContext(db.slice(startRead, endRead) + '\ngetAllGuildVars', {
				pool: client, ...sanitizers, BotLogs: () => {}, COLOR: {},
			});
			for (const [key, value] of Object.entries(custom)) assert.equal((await reload(guild))[key], value);
			assert.equal((await reload(other)).tts_channel_template, '{message} from {tag}');
			await write(guild, 'tts_waiting_room_channel_id', null);
			await write(guild, 'tts_channel_id', null);
			for (const [key, value] of Object.entries(custom)) assert.equal((await reload(guild))[key], value);
			assert.equal((await client.query('SELECT variables FROM guild_variables WHERE guild_id=$1', [guild])).rows[0].variables.tts_waiting_room_channel_id, null);
			await write(guild, 'tts_waiting_room_channel_id', voice); await write(guild, 'tts_channel_id', text);
			for (const [key, value] of Object.entries(custom)) assert.equal((await reload(guild))[key], value);
			await write(guild, 'tts_waiting_room_template', null); await write(guild, 'tts_channel_template', null);
			assert.equal((await reload(guild)).tts_channel_template, null); assert.equal((await reload(guild)).tts_waiting_room_template, null);
			console.log('PASS: real existing PostgreSQL settings write/update/clear and per-guild isolation in a disposable session-local table');
		} finally { await client.end(); }
	}
	console.log('PASS: batch conversion/default/invalid input, actual settings route validation, authorization, per-guild isolation and JSON persistence');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
