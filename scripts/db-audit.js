require('dotenv').config();
const core = require('../core/index.js');

// Core's tables no longer announce themselves with a prefix, so which ones it
// owns is stated here instead of inferred from a name. That is the point: the
// list below is the product's domain, and the list further down is one adapter's
// private storage.
const CORE_TABLES = [
	'users', 'identities', 'activities', 'periods', 'participants',
	'slots', 'slot_votes', 'expenses', 'shares', 'payments',
	'payment_reminders',
];

const DISCORD_TABLES = ['guild_variables', 'user_nicks', 'reminders', 'audit_logs'];

async function count(table) {
	const r = await core.db.query(`SELECT count(*)::int n FROM ${table}`)
		.catch(() => ({ rows: [{ n: 'n/a' }] }));
	return r.rows[0].n;
}

async function main() {
	console.log('\ncore tables (the product\'s own data):');
	for (const t of CORE_TABLES) {
		console.log(`  ${t.padEnd(20)} ${await count(t)} rows`);
	}

	const ids = await core.db.query(
		'SELECT provider, provider_uid, user_id FROM identities ORDER BY created_at',
	).catch(() => ({ rows: [] }));
	if (ids.rows.length) {
		console.log('\nidentities present:');
		for (const r of ids.rows) console.log(`  ${r.provider}:${r.provider_uid}`);
	}

	const acts = await core.db.query(
		'SELECT code, title, plan_state FROM activities ORDER BY created_at',
	).catch(() => ({ rows: [] }));
	if (acts.rows.length) {
		console.log('\nactivities present:');
		for (const r of acts.rows) console.log(`  /a/${r.code}  ${r.title}  [${r.plan_state}]`);
	}

	console.log('\nDiscord bot tables (untouched by this work):');
	for (const t of DISCORD_TABLES) {
		console.log(`  ${t.padEnd(20)} ${await count(t)} rows`);
	}
}

main().then(() => core.db.close()).catch(async (e) => {
	console.error(e.message);
	await core.db.close();
	process.exitCode = 1;
});
