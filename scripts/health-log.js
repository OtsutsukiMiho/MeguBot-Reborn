// What happened to the processes, as opposed to what happened in Discord.
//
// `bot:instances` reads `audit_logs`, which only ever contains Discord feature
// events — so it can see a bot that started and then did something, and is
// blind to one that started and died. That blindness is the whole reason the
// 1 September gap could not be explained: the block erased its own evidence,
// and all that survived was a hole in the history.
//
// This reads the table that is written for exactly that case. Read-only; the
// session is pinned so it cannot be anything else.
require('dotenv').config();
const { Pool } = require('pg');

const HOURS = Number(process.argv[2]) || 168;

/** Long enough that a restart loop is obvious, short enough to still be one boot. */
const BURST_WINDOW_MS = 10 * 60 * 1000;

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

	const exists = await client.query(`
		SELECT to_regclass('public.bot_health_events') AS t
	`);
	if (!exists.rows[0].t) {
		console.log('\nbot_health_events does not exist yet.');
		console.log('It is created the first time index.js starts with this change deployed.\n');
		client.release();
		await pool.end();
		return;
	}

	const res = await client.query(
		`SELECT kind, instance, service, detail, created_at
		   FROM bot_health_events
		  WHERE created_at > now() - ($1 || ' hours')::interval
		  ORDER BY created_at`,
		[String(HOURS)],
	);

	console.log(`\nhealth events in the last ${HOURS}h: ${res.rows.length}`);

	if (!res.rows.length) {
		console.log('\nNothing recorded. Either the service has not restarted in this window,');
		console.log('or it is running a build from before this table existed.\n');
		client.release();
		await pool.end();
		return;
	}

	const counts = new Map();
	for (const row of res.rows) counts.set(row.kind, (counts.get(row.kind) || 0) + 1);
	console.log('\nby kind:');
	for (const [kind, n] of [...counts].sort((a, b) => b[1] - a[1])) {
		console.log(`  ${kind.padEnd(18)} ${n}`);
	}

	console.log('\ntimeline (times are UTC):');
	let previous = null;
	for (const row of res.rows) {
		const at = new Date(row.created_at);
		const gapMin = previous ? (at - previous) / 60000 : null;
		const gap = gapMin !== null && gapMin >= 5 ? `  (+${gapMin.toFixed(0)}m)` : '';
		const mark = row.kind === 'block' || row.kind === 'block_hold' ? ' <<<' : '';
		console.log(`  ${at.toISOString()}  ${row.kind.padEnd(17)} ${String(row.service || '').padEnd(14)} ${String(row.detail || '').slice(0, 80)}${gap}${mark}`);
		previous = at;
	}

	// A service that sleeps wakes as a brand new supervisor, and each wake is a
	// full round of boot-time Discord work. Counting them is the first step to
	// reducing them, and the number is not visible anywhere else.
	const supervisorBoots = res.rows.filter(r => r.kind === 'boot' && r.service === 'supervisor');
	const botBoots = res.rows.filter(r => r.kind === 'boot' && r.service === 'Discord Bot');
	const days = HOURS / 24;
	console.log('\nstarts:');
	console.log(`  supervisor      ${supervisorBoots.length}   (${(supervisorBoots.length / days).toFixed(1)}/day — deploys, crashes, or waking from sleep)`);
	console.log(`  Discord Bot     ${botBoots.length}   (${(botBoots.length / days).toFixed(1)}/day — each one a fresh gateway IDENTIFY)`);

	// Several bot starts inside one short window is a restart loop, which is the
	// shape that turns a five minute block into an afternoon.
	let burst = 0;
	for (let i = 1; i < botBoots.length; i++) {
		if (new Date(botBoots[i].created_at) - new Date(botBoots[i - 1].created_at) < BURST_WINDOW_MS) burst++;
	}
	if (burst) {
		console.log(`\n  ${burst} bot start(s) came within 10 minutes of the previous one.`);
		console.log('  That is the restart-loop shape DISCORD-RATE-LIMITS.md rule 2 exists to stop.');
	}

	const blocks = res.rows.filter(r => r.kind === 'block' || r.kind === 'block_hold');
	if (blocks.length) {
		console.log(`\n  ${blocks.length} block event(s) in this window — see the <<< lines above.`);
	}
	console.log('');

	client.release();
	await pool.end();
}

main().catch(error => {
	console.error(error.message);
	process.exit(1);
});
