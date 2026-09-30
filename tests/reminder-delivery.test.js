'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createReminderRunner, nextOccurrence, DAY_MS, RETRY_MS } = require('../adapters/discord/scheduled-reminders');

function fixture(recurring = false) {
	let clock = Date.UTC(2026, 8, 20, 1);
	const rows = [{ id: 1, guild_id: 'guild', channel_id: 'channel', user_id: 'user', message: 'test', reminder_time: clock, recurring }];
	const events = [], errors = [];
	const database = {
		getActiveReminders: async () => rows.map(row => ({ ...row })),
		deleteReminder: async id => { events.push('delete'); rows.splice(rows.findIndex(r => r.id === id), 1); return true; },
		updateReminderTime: async (id, time) => { events.push('advance'); rows.find(r => r.id === id).reminder_time = time; return true; },
	};
	const options = { database, now: () => clock, deliver: async () => { events.push('send'); }, onError: (error, r, stage) => errors.push(stage) };
	return { rows, events, errors, database, options, advance: ms => { clock += ms; }, time: () => clock };
}

test('reference scheduling cases: on time, several missed days, late tick, future slot and invalid clock', () => {
	const eight = Date.UTC(2026, 8, 20, 1);
	assert.equal(nextOccurrence(eight, eight), eight + DAY_MS);
	assert.equal(nextOccurrence(eight, eight + 3 * DAY_MS + 60_000), eight + 4 * DAY_MS);
	assert.equal(nextOccurrence(eight, eight + 5_000), eight + DAY_MS);
	assert.equal(nextOccurrence(eight + DAY_MS, eight), eight + DAY_MS);
	assert.throws(() => nextOccurrence(eight, NaN), /reminder_clock_invalid/);
	assert.throws(() => nextOccurrence(NaN, eight), /reminder_time_invalid/);
});

test('one-shot success is sent before deletion, including PostgreSQL text false', async () => {
	for (const recurring of [false, 'false', null]) {
		const f = fixture(recurring), tick = createReminderRunner(f.options);
		await tick(); await tick();
		assert.deepEqual(f.events, ['send', 'delete']); assert.equal(f.rows.length, 0);
	}
});

test('overdue daily delivery catches up once and advances to the first future anchored occurrence', async () => {
	for (const recurring of [true, 'true']) {
		const f = fixture(recurring), original = f.rows[0].reminder_time;
		f.advance(3 * DAY_MS + 60_000);
		const tick = createReminderRunner(f.options);
		await tick(); f.advance(5_000); await tick();
		assert.deepEqual(f.events, ['send', 'advance']);
		assert.equal(f.rows[0].reminder_time, original + 4 * DAY_MS);
	}
});

test('next daily occurrence uses completion time when sending crosses another scheduled slot', async () => {
	const f = fixture(true), original = f.time();
	f.options.deliver = async () => { f.events.push('send'); f.advance(DAY_MS + 5_000); };
	await createReminderRunner(f.options)();
	assert.equal(f.rows[0].reminder_time, original + 2 * DAY_MS);
});

test('one-shot and recurring transient/rejected sends remain due and retry after cooldown', async () => {
	for (const recurring of [false, true]) {
		for (const code of [undefined, 'ETIMEDOUT', 429]) {
			const f = fixture(recurring), original = f.time(); let failing = true;
			f.options.deliver = async () => { f.events.push('send'); if (failing) throw Object.assign(new Error('send rejected'), { code }); };
			const tick = createReminderRunner(f.options);
			await tick(); f.advance(5_000); await tick();
			assert.equal(f.rows[0].reminder_time, original); assert.deepEqual(f.events, ['send']);
			assert.deepEqual(f.errors, ['retryable']);
			failing = false; f.advance(RETRY_MS); await tick();
			assert.deepEqual(f.events, ['send', 'send', recurring ? 'advance' : 'delete']);
		}
	}
});

test('explicit unknown destination/missing permission retires one-shot and daily schedules', async () => {
	for (const recurring of [false, true]) {
		for (const code of [10003, 10004, 50001, 50013]) {
			const f = fixture(recurring);
			f.options.deliver = async () => { f.events.push('send'); throw Object.assign(new Error('terminal'), { code }); };
			const tick = createReminderRunner(f.options); await tick(); await tick();
			assert.deepEqual(f.events, ['send', 'delete']); assert.deepEqual(f.errors, ['terminal']);
		}
	}
});

test('overlapping ticks during a pending send deliver the occurrence once', async () => {
	const f = fixture(); let release;
	f.options.deliver = () => { f.events.push('send'); return new Promise(resolve => { release = resolve; }); };
	const tick = createReminderRunner(f.options), first = tick();
	await new Promise(resolve => setImmediate(resolve));
	await Promise.all([tick(), tick()]); assert.deepEqual(f.events, ['send']);
	release(); await first; await tick(); assert.deepEqual(f.events, ['send', 'delete']);
});

test('overlapping reads are serialized and the guard releases after a failed read', async () => {
	const f = fixture(); let release, reads = 0;
	f.database.getActiveReminders = () => { reads++; return new Promise((resolve, reject) => { release = () => reject(new Error('read failed')); }); };
	const tick = createReminderRunner(f.options), first = tick(); await tick(); assert.equal(reads, 1);
	release(); await first; f.database.getActiveReminders = async () => f.rows.map(r => ({ ...r }));
	await tick(); assert.deepEqual(f.events, ['send', 'delete']);
});

test('Discord block skips reads/sends and a block tripped during delivery never consumes the occurrence', async () => {
	const f = fixture(); let blocked = true, failing = true;
	f.options.isBlocked = () => blocked;
	f.options.deliver = async () => { f.events.push('send'); if (failing) { blocked = true; throw Object.assign(new Error('blocked'), { code: 50013 }); } };
	const tick = createReminderRunner(f.options); await tick(); assert.deepEqual(f.events, []);
	blocked = false; await tick(); assert.deepEqual(f.events, ['send']); assert.equal(f.rows.length, 1);
	blocked = false; failing = false;
	await tick(); assert.equal(f.rows.length, 0); assert.deepEqual(f.events, ['send', 'send', 'delete']);
});

test('failed persistence and a subsequent failed read do not resend an accepted message', async () => {
	for (const recurring of [false, true]) {
		const f = fixture(recurring), method = recurring ? 'updateReminderTime' : 'deleteReminder', original = f.database[method];
		let writesFail = true, readsFail = false;
		f.database[method] = async (...args) => { if (writesFail) return false; return original(...args); };
		f.database.getActiveReminders = async ({ throwOnError }) => { assert.equal(throwOnError, true); if (readsFail) throw new Error('read failed'); return f.rows.map(r => ({ ...r })); };
		const tick = createReminderRunner(f.options); await tick(); assert.deepEqual(f.events, ['send']);
		readsFail = true; f.advance(RETRY_MS); await tick();
		readsFail = false; writesFail = false; await tick();
		assert.deepEqual(f.events, ['send', recurring ? 'advance' : 'delete']);
		assert.deepEqual(f.errors, ['persistence', 'tick']);
	}
});

test('one failed reminder does not block other due reminders and voice failure does not replay text', async () => {
	const f = fixture(); f.rows.push({ ...f.rows[0], id: 2 });
	f.options.deliver = async r => { f.events.push(`send:${r.id}`); if (r.id === 1) throw new Error('network'); };
	f.options.afterDelivery = async () => { throw new Error('voice failed'); };
	const tick = createReminderRunner(f.options); await tick(); await tick();
	assert.deepEqual(f.events, ['send:1', 'send:2', 'delete']); assert.equal(f.rows[0].id, 1);
	assert.deepEqual(f.errors, ['retryable', 'voice']);
});

test('lost persistence acknowledgement and terminal-retirement write failure do not resend', async () => {
	const f = fixture(), original = f.database.deleteReminder;
	f.database.deleteReminder = async id => { await original(id); return false; };
	const tick = createReminderRunner(f.options); await tick(); f.advance(RETRY_MS); await tick();
	assert.deepEqual(f.events, ['send', 'delete']); assert.equal(f.rows.length, 0);
	const terminal = fixture(); let failing = true;
	terminal.options.deliver = async () => { terminal.events.push('send'); throw Object.assign(new Error('deleted channel'), { code: 10003 }); };
	const remove = terminal.database.deleteReminder;
	terminal.database.deleteReminder = async id => { if (failing) throw new Error('write unavailable'); return remove(id); };
	const terminalTick = createReminderRunner(terminal.options);
	await terminalTick(); failing = false; terminal.advance(RETRY_MS); await terminalTick();
	assert.deepEqual(terminal.events, ['send', 'delete']); assert.deepEqual(terminal.errors, ['terminal', 'persistence']);
});

test('actual bot timer fetches cache-missing destinations and preserves guarded send failure', async () => {
	const source = fs.readFileSync(path.join(__dirname, '../backend/bot/bot.js'), 'utf8').replace(/\r\n/g, '\n');
	const start = source.indexOf('\tconst { createReminderRunner }');
	const end = source.indexOf('\n});\n\nclient.commands', start);
	assert.ok(start >= 0 && end > start);
	for (const failing of [false, true]) {
		const f = fixture(); let tick, fetches = 0, messages = 0, voice = 0;
		const voiceChannel = { id: 'voice' };
		const guild = { id: 'guild', channels: { cache: new Map(), fetch: async () => { fetches++; return { send: async content => { messages++; assert.equal(content, '⏰ <@user>, **Reminder:** test'); if (failing) throw new Error('transient'); } }; } }, members: { fetch: async () => ({ voice: { channel: voiceChannel } }), me: { voice: { channel: voiceChannel } } } };
		f.database.getUserNick = async () => 'nickname';
		vm.runInNewContext(source.slice(start, end), {
			require: name => name === './audio_queue.js'
				? { generateUUID: () => 'uuid', addToQueue: (id, entry) => { voice++; assert.equal(id, 'guild'); assert.equal(entry.name, 'เตือนความจำคุณ nickname test'); } }
				: { createReminderRunner: options => createReminderRunner({ ...options, now: f.time }) },
			database: f.database, client: { guilds: { cache: new Map(), fetch: async () => { fetches++; return guild; } } },
			getOrCreateConnection: () => ({}),
			discordBlock: { blocked: () => false }, BotLogs() {},
			discordCall: async (_label, run, fallback) => { try { return await run(); } catch { return fallback; } },
			setInterval: (fn, ms) => { tick = fn; assert.equal(ms, 5000); },
		});
		await tick(); await tick(); assert.equal(messages, 1); assert.equal(fetches, 2);
		assert.equal(f.rows.length, failing ? 1 : 0);
		assert.equal(voice, failing ? 0 : 1);
	}
});

test('actual JSON persistence reports write failure without losing reminder data', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'megu-reminder-'));
	try {
		const file = path.join(dir, 'reminders.json'); let fail = false;
		const source = fs.readFileSync(path.join(__dirname, '../backend/database/database.js'), 'utf8');
		const context = { pool: null, REMINDERS_FILE: file, fs: { ...fs, writeFileSync: (...args) => { if (fail) throw new Error('disk failure'); return fs.writeFileSync(...args); } }, BotLogs() {}, COLOR: { red: '' }, module: { exports: {} } };
		vm.runInNewContext(source.slice(source.indexOf('async function getActiveReminders('), source.indexOf('async function clearAllReminders(')) + '\nmodule.exports={getActiveReminders,deleteReminder,updateReminderTime};', context);
		const db = context.module.exports;
		fs.writeFileSync(file, JSON.stringify([{ id: 1, reminder_time: 1 }]));
		fail = true; assert.equal(await db.updateReminderTime(1, 2), false); assert.equal(await db.deleteReminder(1), false);
		assert.equal((await db.getActiveReminders())[0].reminder_time, 1);
		fail = false; assert.equal(await db.updateReminderTime(1, 2), true); assert.equal((await db.getActiveReminders())[0].reminder_time, 2);
		assert.equal(await db.deleteReminder(1), true); assert.equal((await db.getActiveReminders()).length, 0);
		fs.writeFileSync(file, '{broken'); await assert.rejects(db.getActiveReminders({ throwOnError: true }));
		assert.equal((await db.getActiveReminders()).length, 0);
	}
	finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('actual PostgreSQL persistence API reports failures and preserves strict scheduler reads', async () => {
	const source = fs.readFileSync(path.join(__dirname, '../backend/database/database.js'), 'utf8');
	const calls = []; let fail = false;
	const context = { pool: { query: async (sql, values) => { if (fail) throw new Error('database unavailable'); calls.push([sql, values]); return { rows: [{ id: 1, reminder_time: '123', recurring: 'false' }] }; } }, BotLogs() {}, COLOR: { red: '' }, module: { exports: {} } };
	vm.runInNewContext(source.slice(source.indexOf('async function getActiveReminders('), source.indexOf('async function clearAllReminders(')) + '\nmodule.exports={getActiveReminders,deleteReminder,updateReminderTime};', context);
	const db = context.module.exports;
	assert.equal((await db.getActiveReminders({ throwOnError: true }))[0].reminder_time, 123);
	assert.equal(await db.updateReminderTime(1, 456), true); assert.equal(await db.deleteReminder(1), true);
	assert.deepEqual(Array.from(calls[1][1]), [1, 456]); assert.deepEqual(Array.from(calls[2][1]), [1]);
	fail = true; assert.equal(await db.updateReminderTime(1, 789), false); assert.equal(await db.deleteReminder(1), false);
	await assert.rejects(db.getActiveReminders({ throwOnError: true }), /database unavailable/);
	assert.equal((await db.getActiveReminders()).length, 0);
});
