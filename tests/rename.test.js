// The rename from megu_* to plain names is the one piece of this schema that
// touches a database which already has data in it, so it gets a test that
// actually puts data there first.
//
// It runs before every other suite because it rebuilds the local database into
// its pre-rename shape and then migrates it forward, which is also the state
// the rest of the suite wants to start from.
require('dotenv').config();
const assert = require('node:assert');
const core = require('../core/index.js');

const { db } = core;
let n = 0;
function ok(msg) {
	n++;
	console.log(`  ok  ${msg}`);
}

const NEW_TABLES = [
	'payment_reminders', 'payments', 'shares', 'expenses', 'slot_votes',
	'slots', 'periods', 'participants', 'activities', 'identities', 'users',
];

// Enough of the old shape to carry a row through every kind of rename there
// is: a plain table, one with a foreign key, and the one that had to change
// name rather than just lose a prefix.
const OLD_SHAPE = [
	`CREATE TABLE megu_users (
		id TEXT PRIMARY KEY,
		display_name TEXT NOT NULL,
		avatar_url TEXT,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now()
	);`,
	`CREATE TABLE megu_identities (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES megu_users(id) ON DELETE CASCADE,
		provider TEXT NOT NULL,
		provider_uid TEXT NOT NULL,
		email TEXT, username TEXT, avatar_url TEXT,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		UNIQUE (provider, provider_uid)
	);`,
	'CREATE INDEX megu_identities_user_idx ON megu_identities (user_id);',
	`CREATE TABLE megu_activities (
		id TEXT PRIMARY KEY,
		code TEXT NOT NULL UNIQUE,
		owner_user_id TEXT NOT NULL REFERENCES megu_users(id) ON DELETE RESTRICT,
		title TEXT NOT NULL,
		kind TEXT NOT NULL DEFAULT 'event',
		plan_state TEXT NOT NULL DEFAULT 'open',
		location TEXT, starts_at TIMESTAMPTZ,
		currency TEXT NOT NULL DEFAULT 'THB',
		recurrence TEXT, due_day INTEGER, guild_id TEXT, channel_id TEXT,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		closed_at TIMESTAMPTZ
	);`,
	'CREATE INDEX megu_activities_owner_idx ON megu_activities (owner_user_id);',
];

async function tableExists(name) {
	const r = await db.query('SELECT to_regclass($1) AS t', [`public.${name}`]);
	return r.rows[0].t !== null;
}

async function main() {
	if (!db.isLocal(db.connectionString())) {
		throw new Error('rename.test.js rebuilds the schema and must never run on a remote database');
	}

	// Back to before the rename. CASCADE because the new tables point at each
	// other, and this is a local database whose whole contents are test rows.
	await db.query(`DROP TABLE IF EXISTS ${NEW_TABLES.join(', ')} CASCADE;`);
	await db.query('DROP TABLE IF EXISTS megu_reminders, megu_activities, megu_identities, megu_users CASCADE;');
	for (const statement of OLD_SHAPE) await db.query(statement);

	// The bot's own reminders table, which is the reason core's could not simply
	// drop its prefix. It is created here so the migration has something to
	// collide with if it ever tries.
	await db.query(`CREATE TABLE IF NOT EXISTS reminders (
		id SERIAL PRIMARY KEY, user_id TEXT, guild_id TEXT, channel_id TEXT,
		reminder_time BIGINT, message TEXT, recurring BOOLEAN, triggered BOOLEAN DEFAULT FALSE
	);`);
	await db.query('DELETE FROM reminders WHERE message = $1', ['__rename_probe__']);
	await db.query(
		'INSERT INTO reminders (user_id, message) VALUES ($1, $2)',
		['__rename_probe__', '__rename_probe__'],
	);

	await db.query(
		'INSERT INTO megu_users (id, display_name) VALUES ($1, $2)',
		['usr___rename__', 'ฟิก'],
	);
	await db.query(
		`INSERT INTO megu_activities (id, code, owner_user_id, title)
		 VALUES ($1, $2, $3, $4)`,
		['act___rename__', '__RENAME__', 'usr___rename__', 'ตีแบด'],
	);
	ok('a pre-rename database exists, with rows in it and the bot\'s reminders beside it');

	// Both at once, because that is what production does: index.js forks the bot
	// and the web process and each of them boots the schema. Against a database
	// that still has the old names this is the case that used to break.
	await Promise.all([core.initCoreSchema(), core.initCoreSchema()]);
	ok('two processes booted the migration at the same time and both returned');

	// 1. The data is under the new name — renamed, not recreated empty.
	const user = await db.query('SELECT display_name FROM users WHERE id = $1', ['usr___rename__']);
	assert.strictEqual(user.rows[0]?.display_name, 'ฟิก', 'the user row survived the rename');
	const act = await db.query('SELECT title, owner_user_id FROM activities WHERE id = $1', ['act___rename__']);
	assert.strictEqual(act.rows[0]?.title, 'ตีแบด');
	assert.strictEqual(act.rows[0]?.owner_user_id, 'usr___rename__', 'the foreign key still points at the user');
	ok('rows moved across intact — Postgres renamed the tables rather than rebuilding them');

	// 2. Nothing is left behind under the old name.
	for (const old of ['megu_users', 'megu_identities', 'megu_activities']) {
		assert.strictEqual(await tableExists(old), false, `${old} is gone`);
	}
	const strays = await db.query(
		`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		 WHERE n.nspname = 'public' AND c.relname LIKE 'megu\\_%'`,
	);
	assert.deepStrictEqual(strays.rows, [], `nothing named megu_* remains: ${strays.rows.map(r => r.relname)}`);
	const oldConstraints = await db.query(
		`SELECT conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
		 JOIN pg_namespace n ON n.oid = t.relnamespace
		 WHERE n.nspname = 'public' AND c.conname LIKE 'megu\\_%'`,
	);
	assert.deepStrictEqual(oldConstraints.rows, [], 'no constraint still carries the old name');
	ok('no table, index or constraint is still called megu_ anything');

	// 3. The bot's reminders table is the one that keeps the name, untouched.
	const probe = await db.query('SELECT user_id FROM reminders WHERE message = $1', ['__rename_probe__']);
	assert.strictEqual(probe.rows.length, 1, 'the bot\'s reminders row is still there');
	const cols = await db.query(
		'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
		['reminders'],
	);
	const names = cols.rows.map(r => r.column_name);
	assert.ok(names.includes('channel_id'), 'reminders is still the bot\'s table, not core\'s');
	assert.ok(!names.includes('amount_satang'), 'core did not take the reminders name over');
	assert.strictEqual(await tableExists('payment_reminders'), true, 'core\'s nag log is payment_reminders');
	ok('the bot keeps `reminders`; core\'s nag log lives beside it as `payment_reminders`');

	// 4. Running it again changes nothing — the guards hold.
	await core.initCoreSchema();
	const again = await db.query('SELECT display_name FROM users WHERE id = $1', ['usr___rename__']);
	assert.strictEqual(again.rows[0]?.display_name, 'ฟิก', 'a second boot left the data alone');
	ok('booting twice is a no-op — every migration step is guarded');

	await db.query('DELETE FROM reminders WHERE message = $1', ['__rename_probe__']);
	await db.query('DELETE FROM activities WHERE id = $1', ['act___rename__']);
	await db.query('DELETE FROM users WHERE id = $1', ['usr___rename__']);
}

main()
	.then(async () => {
		console.log(`\n  ${n} checks passed`);
		await db.close();
	})
	.catch(async (error) => {
		console.error(`\n  FAILED  ${error.message}`);
		await db.close();
		process.exitCode = 1;
	});
