// Answers one question: is more than one copy of the bot running on this token?
//
// Every slash command writes a row to audit_logs stamped with the instance that
// handled it (see INSTANCE in backend/bot/bot.js). That table lives in the
// shared database, which is what makes this work — two instances deployed in
// different places have console logs nobody can read side by side, but they
// both write here.
//
// Read-only. The session is pinned so it cannot be anything else.
require('dotenv').config();
const { Pool } = require('pg');

const HOURS = Number(process.argv[2]) || 24;
const STAMP = /\s\[([^\]]+)\]$/;

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set.');

	const pool = new Pool({
		connectionString: url,
		ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : { rejectUnauthorized: false },
		max: 1,
		connectionTimeoutMillis: 15000,
	});
	const client = await pool.connect();
	await client.query('SET default_transaction_read_only = on');

	const res = await client.query(
		`SELECT user_id, username, details, created_at
		 FROM audit_logs
		 WHERE action_type = 'COMMAND_EXEC' AND created_at > now() - ($1 || ' hours')::interval
		 ORDER BY created_at`,
		[String(HOURS)],
	);

	const stamped = [];
	const instances = new Map();
	for (const row of res.rows) {
		const match = STAMP.exec(row.details || '');
		if (!match) continue;
		const instance = match[1];
		stamped.push({ ...row, instance, command: row.details.replace(STAMP, '') });
		instances.set(instance, (instances.get(instance) || 0) + 1);
	}

	console.log(`\ncommands in the last ${HOURS}h: ${res.rows.length} (${stamped.length} carry an instance stamp)`);

	if (!stamped.length) {
		console.log('\nNo stamped rows yet. The stamp ships with the instance-logging change, so');
		console.log('this stays empty until every running copy has been redeployed past it.');
	}
	else {
		console.log(`\ninstances seen: ${instances.size}`);
		for (const [instance, n] of [...instances].sort((a, b) => b[1] - a[1])) {
			console.log(`  ${instance.padEnd(34)} ${n} commands`);
		}
		console.log(instances.size > 1
			? '\n  ^ more than one. That is the duplicate-reply cause: one token, several gateways.'
			: '\n  ^ one instance. Duplicate replies are not coming from a second copy of this build.');

		// The same person running the same command inside a few seconds, handled
		// by two different instances, is a duplicate caught in the act.
		const byKey = new Map();
		for (const row of stamped) {
			const bucket = Math.floor(new Date(row.created_at).getTime() / 5000);
			const key = `${row.user_id}|${row.command}|${bucket}`;
			if (!byKey.has(key)) byKey.set(key, []);
			byKey.get(key).push(row);
		}
		const dupes = [...byKey.values()].filter(
			rows => new Set(rows.map(r => r.instance)).size > 1,
		);

		if (dupes.length) {
			console.log(`\ncommands handled by more than one instance at once: ${dupes.length}`);
			for (const rows of dupes.slice(0, 10)) {
				console.log(`  ${rows[0].username} — ${rows[0].command}`);
				for (const r of rows) console.log(`      ${r.instance}  ${new Date(r.created_at).toISOString()}`);
			}
		}
		else {
			console.log('\nNo single command was handled by two instances.');
		}
	}

	client.release();
	await pool.end();
}

main().catch((error) => {
	console.error(`\nFAILED: ${error.message || error.name}`);
	process.exitCode = 1;
});
