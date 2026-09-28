'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../core');
const { ensureTestDatabase, resolveTestDatabaseUrl } = require('./test-database');
const { loadCommand, request } = require('./autorole-command.test');
const source = fs.readFileSync(require.resolve('../backend/database/database'), 'utf8');
const sanitize = source.slice(source.indexOf('function sanitizeDbValue('), source.indexOf('/**', source.indexOf('function sanitizeDbValue(')));
const implementation = source.slice(source.indexOf('async function compareAndSetGuildRoleVars('), source.indexOf('async function setGuildVar('));
const guildId = '100000000000000009', low = '600000000000000000', high = '600000000000000001';
const before = { autorole_id: high, autorole_ids: [low], bot_autorole_ids: [] };
const cleared = { autorole_id: low, autorole_ids: [], bot_autorole_ids: [] };
function boundary(pool, directory) {
	return vm.runInNewContext(`${sanitize}\n${implementation}\ncompareAndSetGuildRoleVars`, {
		pool, fs, path, VARS_DIR: directory, isValidSnowflake: id => /^\d{17,20}$/.test(id), clearGuildVarCache: () => {},
	});
}
async function main() {
	const url = resolveTestDatabaseUrl();
	await ensureTestDatabase(url);
	assert.equal(core.db.connectionString(), url, 'Never run against a retained database');
	await core.db.query('CREATE TABLE IF NOT EXISTS guild_variables (guild_id TEXT PRIMARY KEY, variables JSONB)');
	const save = boundary(core.db.getPool());
	try {
		await core.db.query('INSERT INTO guild_variables (guild_id, variables) VALUES ($1,$2) ON CONFLICT (guild_id) DO UPDATE SET variables=EXCLUDED.variables', [guildId, { ...before, unrelated: 'preserved' }]);
		// The reviewer reproduction: a clearing save and an unchanged stale save
		// must never combine high legacy ID with an empty human list.
		await Promise.all([save(guildId, before, cleared), save(guildId, before, before)]);
		const current = (await core.db.query('SELECT variables FROM guild_variables WHERE guild_id=$1', [guildId])).rows[0].variables;
		assert.equal(current.autorole_id, low); assert.deepEqual(current.autorole_ids, []);
		assert.equal(current.unrelated, 'preserved');
		assert.equal(await save(guildId, before, before), false, 'Stale save cannot reactivate old configuration');
		await core.db.query('UPDATE guild_variables SET variables=$2 WHERE guild_id=$1', [guildId, before]);
		let entered, release;
		const pending = new Promise(resolve => { entered = resolve; });
		const gate = new Promise(resolve => { release = resolve; });
		const commandDb = {
			getAllGuildVars: async () => (await core.db.query('SELECT variables FROM guild_variables WHERE guild_id=$1', [guildId])).rows[0].variables,
			compareAndSetGuildRoleVars: async (...args) => { entered(); await gate; return save(...args); },
		};
		const staleCommand = request('clear', 'human');
		const command = loadCommand(commandDb).execute(staleCommand);
		await pending;
		const webDesired = { ...before, bot_autorole_ids: [low] };
		assert.equal(await save(guildId, before, webDesired), true, 'Web boundary wins while command is pending');
		release(); await command;
		assert.match(staleCommand.replies[0].content, /changed.*try again/);
		assert.deepEqual(await commandDb.getAllGuildVars(), webDesired, 'Stale command cannot overwrite web changes');
		commandDb.compareAndSetGuildRoleVars = save;
		await loadCommand(commandDb).execute(request('clear', 'human'));
		assert.deepEqual(await commandDb.getAllGuildVars(), { autorole_id: null, autorole_ids: [], bot_autorole_ids: [low] });
	}
	finally { await core.db.query('DELETE FROM guild_variables WHERE guild_id=$1', [guildId]); }
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'megu-role-settings-'));
	const file = path.join(directory, `${guildId}.json`), lock = `${file}.roles.lock`;
	try {
		fs.writeFileSync(file, JSON.stringify({ ...before, unrelated: 'preserved' }));
		const localSave = boundary(null, directory);
		assert.equal(await localSave(guildId, before, cleared), true);
		assert.equal(await localSave(guildId, before, before), false);
		assert.equal(JSON.parse(fs.readFileSync(file)).unrelated, 'preserved');
		fs.writeFileSync(lock, '');
		assert.equal(await localSave(guildId, cleared, before), false, 'Contended file lock fails closed');
		fs.unlinkSync(lock);
		assert.equal(await localSave(guildId, cleared, before), true);
		assert.equal(fs.existsSync(lock), false, 'Owned lock is cleaned up');
		const commandDb = { getAllGuildVars: async () => JSON.parse(fs.readFileSync(file)), compareAndSetGuildRoleVars: localSave };
		await loadCommand(commandDb).execute(request('clear', 'human'));
		assert.deepEqual(await commandDb.getAllGuildVars(), { autorole_id: null, autorole_ids: [], bot_autorole_ids: [], unrelated: 'preserved' });
	}
	finally { fs.rmSync(directory, { recursive: true, force: true }); }
	// Exercise actual join selection with stale per-key reads forbidden.
	const bot = fs.readFileSync(require.resolve('../backend/bot/bot'), 'utf8');
	const start = bot.indexOf('let roleIdsToAssign = [];', bot.indexOf('const isBot = member.user.bot;'));
	const selection = bot.slice(start, bot.indexOf('if (roleIdsToAssign.length > 0)', start));
	for (const [vars, isBot, expected] of [[cleared, false, [low]], [before, false, [low]], [{ autorole_id: low }, false, [low]], [{}, false, []], [{ bot_autorole_ids: [low] }, true, [low]]]) {
		const selected = await vm.runInNewContext(`(async()=>{${selection};return roleIdsToAssign;})()`, {
			guildId, isBot, database: { getAllGuildVars: async () => vars, getGuildVar: () => { throw new Error('Mixed cached snapshot'); } },
		});
		assert.deepEqual(Array.from(selected), expected);
	}
	console.log('Console role settings passed: atomic PostgreSQL/file saves, command/web stale-save rejection, command clear, unrelated settings retained, snapshot-consistent join fallback.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => core.db.close());
