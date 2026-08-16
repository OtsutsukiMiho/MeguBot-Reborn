require('dotenv').config();
const core = require('../core/index.js');

const TABLES = [
	'megu_users', 'megu_identities', 'megu_activities',
	'megu_participants', 'megu_expenses', 'megu_shares', 'megu_payments',
];

async function main() {
	console.log('\nmegu_* tables (everything core created):');
	for (const t of TABLES) {
		const r = await core.db.query(`SELECT count(*)::int n FROM ${t}`);
		console.log(`  ${t.padEnd(20)} ${r.rows[0].n} rows`);
	}

	const ids = await core.db.query(
		'SELECT provider, provider_uid, user_id FROM megu_identities ORDER BY created_at',
	);
	if (ids.rows.length) {
		console.log('\nidentities present:');
		for (const r of ids.rows) console.log(`  ${r.provider}:${r.provider_uid}`);
	}

	const acts = await core.db.query('SELECT code, title, state FROM megu_activities ORDER BY created_at');
	if (acts.rows.length) {
		console.log('\nactivities present:');
		for (const r of acts.rows) console.log(`  /a/${r.code}  ${r.title}  [${r.state}]`);
	}

	console.log('\nlegacy bot tables (untouched by this work):');
	for (const t of ['guild_variables', 'user_nicks', 'reminders', 'audit_logs']) {
		const r = await core.db.query(`SELECT count(*)::int n FROM ${t}`).catch(() => ({ rows: [{ n: 'n/a' }] }));
		console.log(`  ${t.padEnd(20)} ${r.rows[0].n} rows`);
	}
}

main().then(() => core.db.close()).catch(async (e) => {
	console.error(e.message);
	await core.db.close();
	process.exitCode = 1;
});
