'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { test } = require('node:test');
const settings = require('../core/voice-qol-settings');
const { formatTextTts, formatAnnouncement } = require('../core/voice-announcement-batches');
const dbSource = fs.readFileSync(require.resolve('../backend/database/database'), 'utf8');
const webSource = fs.readFileSync(require.resolve('../backend/web/web'), 'utf8');
const guild = '100000000000000051', other = '100000000000000052';

function fixture(pool = null) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'megu-template-boundary-'));
	const normalizeStart = dbSource.indexOf('function sanitizeDbValue(');
	const normalizers = dbSource.slice(normalizeStart, dbSource.indexOf('/**', normalizeStart));
	const functions = dbSource.slice(dbSource.indexOf('const GUILD_VAR_TTL_MS'), dbSource.indexOf('async function deleteGuildVar('));
	const database = vm.runInNewContext(normalizers + functions + '\n({getGuildVar,getAllGuildVars,setGuildVar,compareAndSetGuildRoleVars,sanitizeDbValue,clearGuildVarCache})', {
		fs, path, pool, VARS_DIR: directory, process: { env: {} }, ...settings,
		isValidSnowflake: id => /^\d{17,20}$/.test(id), BotLogs: () => {}, COLOR: {},
	});
	let handlers, mutations = 0;
	const routeDb = { ...database };
	for (const key of ['setGuildVar', 'compareAndSetGuildRoleVars']) routeDb[key] = async (...args) => { mutations++; return database[key](...args); };
	const start = webSource.indexOf("app.post('/api/guilds/:guildId/config'");
	vm.runInNewContext(webSource.slice(start, webSource.indexOf("app.post('/api/guilds/:guildId/reaction-roles'", start)), {
		app: { post: (_path, ...args) => { handlers = args; } }, ...settings,
		requireAdminGuild: async (req, res, next) => req.authorized ? next() : res.status(403).json({ error: 'Forbidden' }),
		database: { ...routeDb, logAuditEvent: async () => {} }, verifyConsoleRoles: async () => true,
		sendIpcRequest: async () => ({ channels: [{ id: '200000000000000051', type: 2 }] }),
		toBooleanSetting: (value, fallback = true) => value == null ? fallback : Boolean(value), process: {}, BotLogs: () => {},
	});
	return { database, directory, mutations: () => mutations,
		async save(body, guildId = guild, authorized = true) {
			const req = { params: { guildId }, body, authorized, session: { user: { id: 'actor', username: 'Actor' } } };
			const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
			await handlers[0](req, res, () => handlers[1](req, res)); return res;
		}, close() { fs.rmSync(directory, { recursive: true, force: true }); },
	};
}

async function roundTrip(f) {
	const body = { tts_channel_template: '["{displayname} says {message}"]', tts_waiting_room_template: '["{nickname} is waiting"]' };
	assert.equal((await f.save(body)).statusCode, 200);
	for (const [key, value] of Object.entries(body)) {
		assert.equal(typeof (await f.database.getGuildVar(guild, key)), 'string', 'Accepted template remains a string');
		assert.equal((await f.database.getAllGuildVars(guild))[key], value, 'Reload preserves literal content');
	}
	const text = await f.database.getGuildVar(guild, 'tts_channel_template');
	assert.equal(formatTextTts(settings.textTtsTemplate(text), { displayname: '{server}' }, 'Guild', 'hello {nickname}', 200), '["{server} says hello {nickname}"]');
	const waiting = await f.database.getGuildVar(guild, 'tts_waiting_room_template');
	assert.equal(formatAnnouncement(settings.waitingRoomTemplate(waiting, 'en'), [{ names: { nickname: 'Alice' } }, { names: { nickname: 'Bob' } }], 'en', 'Guild'), '["Alice and Bob is waiting"]');
	await f.database.setGuildVar(guild, 'unrelated', 'true');
	assert.equal(await f.database.getGuildVar(guild, 'unrelated'), true, 'Unrelated generic boolean coercion remains');
	const before = await f.database.getAllGuildVars(guild);
	assert.equal(await f.database.compareAndSetGuildRoleVars(guild, before, { autorole_id: null, autorole_ids: [], bot_autorole_ids: [] }), true);
	for (const [key, value] of Object.entries(body)) assert.equal((await f.database.getAllGuildVars(guild))[key], value, 'Copy-forward and role updates preserve templates');
	await f.save({});
	await f.save({ tts_waiting_room_channel_id: null, tts_channel_id: null });
	for (const [key, value] of Object.entries(body)) assert.equal((await f.database.getAllGuildVars(guild))[key], value);
	assert.equal((await f.database.getAllGuildVars(other)).tts_channel_template, undefined);
	await f.save({ tts_channel_template: '"{message}"' });
	assert.equal(await f.database.getGuildVar(guild, 'tts_channel_template'), '"{message}"', 'JSON quotes remain literal');
}

test('actual handler, sanitizer, JSON storage, reload and runtime preserve JSON-looking templates', async () => {
	const f = fixture(); try { await roundTrip(f); } finally { f.close(); }
});
test('actual handler rejects escaped braces before any mutation', async () => {
	const f = fixture(); try {
		for (const [key, value] of [['tts_channel_template', String.raw`\{message}`], ['tts_waiting_room_template', String.raw`\{nickname}`], ['tts_channel_template', String.raw`{message}\}`]]) {
			const before = f.mutations(); assert.equal((await f.save({ [key]: value })).statusCode, 400, `Reject ${value}`); assert.equal(f.mutations(), before);
		}
	} finally { f.close(); }
});
test('unsafe Unicode/JSON escapes and actual controls cannot cross validation or storage', async () => {
	const f = fixture(); try {
		assert.equal(f.database.sanitizeDbValue(String.raw`"{message}\u0000"`), '{message}\u0000', 'The actual generic sanitizer decodes this control-bearing JSON string; templates must bypass it');
		await f.save({ tts_channel_template: '{message}' });
		for (const bad of [String.raw`{message}\u0000`, String.raw`"{message}\u0000"`, String.raw`["{message}\u0000"]`, String.raw`{message}\\u0000`, String.raw`{message}\u0041`, String.raw`{message}\x00`, String.raw`{message}\n`, '{message}\u0000', '{message}\u0085', '{message}}', '{unknown}', '{displayname} says', { message: '{message}' }]) {
			const before = f.mutations(); assert.equal((await f.save({ tts_channel_template: bad, tts_waiting_room_template: '{nickname} updated' })).statusCode, 400);
			assert.equal(f.mutations(), before, 'Invalid update must not partially save valid sibling fields');
			assert.equal(await f.database.getGuildVar(guild, 'tts_channel_template'), '{message}');
		}
		for (const bad of [String.raw`{message}\u0000`, '{message}\u0000', ['{message}']]) {
			await assert.rejects(f.database.setGuildVar(guild, 'tts_channel_template', bad), /Invalid voice template/);
			assert.equal(await f.database.getGuildVar(guild, 'tts_channel_template'), '{message}');
		}
		fs.writeFileSync(path.join(f.directory, guild + '.json'), JSON.stringify({ tts_channel_template: '{message}\u0000', tts_waiting_room_template: ['{nickname}'] }));
		f.database.clearGuildVarCache(guild);
		assert.equal(await f.database.getGuildVar(guild, 'tts_channel_template'), null, 'Corrupt stored values fail closed on read');
		assert.equal((await f.database.getAllGuildVars(guild)).tts_waiting_room_template, null);
	} finally { f.close(); }
});
test('canonical tokens, ordinary literal text, bounds and reset survive the real storage boundary', async () => {
	const f = fixture(); try {
		for (const value of ['{MESSAGE}', '[not JSON] {message}', '  ["{message}"]  ', '{displayname}: {message}', 'literal \\ path {message}', 'x'.repeat(291) + '{message}']) {
			assert.equal((await f.save({ tts_channel_template: value })).statusCode, 200); assert.equal(await f.database.getGuildVar(guild, 'tts_channel_template'), value);
		}
		const before = f.mutations(); assert.equal((await f.save({ tts_channel_template: 'x'.repeat(292) + '{message}' })).statusCode, 400); assert.equal(f.mutations(), before);
		await f.save({ tts_channel_template: '' }); assert.equal(await f.database.getGuildVar(guild, 'tts_channel_template'), null);
		await f.save({ tts_waiting_room_template: null }); assert.equal(await f.database.getGuildVar(guild, 'tts_waiting_room_template'), null);
		assert.equal((await f.save({ tts_channel_template: '{message}' }, guild, false)).statusCode, 403);
		assert.equal(f.database.sanitizeDbValue('["unrelated"]')[0], 'unrelated', 'Generic array decoding remains unchanged');
		fs.writeFileSync(path.join(f.directory, guild + '.json'), JSON.stringify(JSON.stringify({ unrelated: 'true', tts_channel_template: '["{message}"]', tts_waiting_room_template: '{nickname}\u0000' })));
		f.database.clearGuildVarCache(guild);
		const legacy = await f.database.getAllGuildVars(guild);
		assert.equal(legacy.unrelated, 'true', 'Legacy whole-document JSON decoding keeps unrelated semantics');
		assert.equal(legacy.tts_channel_template, '["{message}"]'); assert.equal(legacy.tts_waiting_room_template, null);
	} finally { f.close(); }
});

module.exports = { fixture, roundTrip };

// Opt-in: use the existing approved disposable DB only. No database creation,
// destruction, retained-row replacement, or production fallback is allowed.
if (process.argv.includes('--postgres')) test('real approved PostgreSQL round-trips and role-settings regression preserve existing data/schema', async () => {
	const local = require('dotenv').parse(fs.readFileSync(path.resolve('.env.workflow-test.local')));
	const url = require('./test-database').resolveTestDatabaseUrl(local);
	const options = require('../core/postgres-connection').postgresConnectionOptions(url, {});
	const client = new (require('pg').Client)({ ...options, connectionTimeoutMillis: 3000 });
	const { host, port, database } = client.connectionParameters;
	assert.equal(host, '127.0.0.1'); assert.equal(Number(port), 5432); assert.equal(database, 'megubot_workflow_test');
	console.log(`Disposable identity verified: ${host}:${port}/${database}`);
	await client.connect();
	let f, roleRows, beforeDigest, beforeSchema;
	const roleGuild = '100000000000000009';
	const digest = async () => (await client.query("SELECT md5(COALESCE(string_agg(guild_id || variables::text, '|' ORDER BY guild_id), '')) AS value FROM public.guild_variables")).rows[0].value;
	const schema = async () => JSON.stringify((await client.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows);
	try {
		assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name, database);
		assert.ok((await client.query("SELECT to_regclass('public.guild_variables') AS name")).rows[0].name, 'Existing fixture table must already exist');
		beforeDigest = await digest(); beforeSchema = await schema();
		roleRows = (await client.query('SELECT variables FROM public.guild_variables WHERE guild_id=$1', [roleGuild])).rows;
		await client.query('CREATE TEMP TABLE guild_variables (guild_id TEXT PRIMARY KEY, variables JSONB)');
		const pool = { query: (...args) => client.query(...args), connect: async () => ({ query: (...args) => client.query(...args), release() {} }) };
		f = fixture(pool); await roundTrip(f);
		await f.save({ tts_waiting_room_channel_id: '200000000000000051', tts_channel_id: 'text' });
		assert.equal((await f.database.getAllGuildVars(guild)).tts_channel_template, '"{message}"', 'Re-enable preserves value');
		for (const [key, bad] of [['tts_channel_template', String.raw`{message}\u0000`], ['tts_channel_template', String.raw`\{message}`], ['tts_waiting_room_template', String.raw`\{nickname}`]]) {
			const before = f.mutations(); const saved = JSON.stringify(await f.database.getAllGuildVars(guild));
			assert.equal((await f.save({ [key]: bad })).statusCode, 400); assert.equal(f.mutations(), before);
			assert.equal(JSON.stringify(await f.database.getAllGuildVars(guild)), saved);
		}
		await f.save({ tts_channel_template: '{message}' }, other);
		assert.equal(await f.database.getGuildVar(other, 'tts_channel_template'), '{message}');
		assert.equal(await f.database.getGuildVar(guild, 'tts_channel_template'), '"{message}"');
		await f.save({ tts_channel_template: '', tts_waiting_room_template: null });
		assert.equal(await f.database.getGuildVar(guild, 'tts_channel_template'), null); assert.equal(await f.database.getGuildVar(guild, 'tts_waiting_room_template'), null);
		const result = require('node:child_process').spawnSync(process.execPath, [path.resolve('tests/console-role-settings.test.js')], {
			encoding: 'utf8', windowsHide: true, env: { ...process.env, MEGU_TEST_DATABASE_URL: url, MEGU_DATABASE_URL: url, DATABASE_URL: '' },
		});
		assert.equal(result.status, 0, 'DB-backed console role regression failed (output intentionally omitted to protect credentials)');
		console.log('PASS: real PostgreSQL template checks and DB-backed console-role-settings.test.js');
	} finally {
		try {
			if (roleRows) {
				if (roleRows.length) await client.query('INSERT INTO public.guild_variables(guild_id,variables) VALUES($1,$2::jsonb) ON CONFLICT(guild_id) DO UPDATE SET variables=EXCLUDED.variables', [roleGuild, JSON.stringify(roleRows[0].variables)]);
				else await client.query('DELETE FROM public.guild_variables WHERE guild_id=$1', [roleGuild]);
			}
			if (beforeDigest) assert.equal(await digest(), beforeDigest, 'Existing disposable guild settings must remain unchanged');
			if (beforeSchema) assert.equal(await schema(), beforeSchema, 'No persistent schema change');
		} finally { f?.close(); await client.end(); }
	}
});
