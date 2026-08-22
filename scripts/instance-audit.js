// Answers one question: is more than one copy of the bot running on this token?
//
// The bot stamps the rows it writes to audit_logs with the instance that handled
// them (see `stamp()` in backend/bot/bot.js). That table lives in the shared
// database, which is what makes this work — two instances deployed in different
// places have console logs nobody can read side by side, but they both write
// here.
//
// It used to read slash commands alone, and slash commands are far too rare to
// answer with: thirty days of them came to twenty-one rows, and a whole day
// could pass with none, which reads as "nothing is running" while the bot is up
// and busy. It now reads every stamped row, whatever the event, so an ordinary
// day of TTS is enough of a sample.
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
		`SELECT action_type, user_id, username, details, created_at
		 FROM audit_logs
		 WHERE created_at > now() - ($1 || ' hours')::interval
		 ORDER BY created_at`,
		[String(HOURS)],
	);

	const stamped = [];
	const instances = new Map();
	for (const row of res.rows) {
		const match = STAMP.exec(row.details || '');
		if (!match) continue;
		const instance = match[1];
		stamped.push({ ...row, instance, event: row.details.replace(STAMP, '') });
		const seen = instances.get(instance) || { count: 0, first: row.created_at, last: row.created_at };
		seen.count += 1;
		seen.last = row.created_at;
		instances.set(instance, seen);
	}

	console.log(`\nevents in the last ${HOURS}h: ${res.rows.length} (${stamped.length} carry an instance stamp)`);

	if (!stamped.length) {
		console.log('\nNo stamped rows in this window. Either nothing happened, or every copy');
		console.log('running is older than the change that adds the stamp. Widen the window:');
		console.log('\n    npm run bot:instances -- 336\n');
		console.log('and if that is empty too, redeploy before trusting this answer.');
	}
	else {
		const ordered = [...instances].sort((a, b) => new Date(a[1].first) - new Date(b[1].first));
		const width = Math.max(...ordered.map(([name]) => name.length));

		console.log(`\ninstances seen: ${instances.size}`);
		for (const [instance, seen] of ordered) {
			const window = `${new Date(seen.first).toISOString()} → ${new Date(seen.last).toISOString()}`;
			console.log(`  ${instance.padEnd(width)}  ${String(seen.count).padStart(4)} events   ${window}`);
		}

		// Two instances one after another is the same service being restarted or
		// redeployed — every one of those is a fresh gateway IDENTIFY, which has
		// its own cost (DISCORD-RATE-LIMITS.md), but it is not a duplicate.
		//
		// Two instances whose windows *overlap* is one token on two gateways at
		// once, which is the duplicate-reply cause. Comparing ISO timestamps by
		// eye gets that wrong, so it is worked out here. An instance seen only
		// once has a zero-width window and still counts: a single event landing
		// inside another instance's window is the same finding.
		const overlaps = [];
		for (let i = 0; i < ordered.length; i++) {
			for (let j = i + 1; j < ordered.length; j++) {
				const [aName, a] = ordered[i];
				const [bName, b] = ordered[j];
				if (new Date(a.first) <= new Date(b.last) && new Date(b.first) <= new Date(a.last)) {
					overlaps.push([aName, bName]);
				}
			}
		}

		if (instances.size === 1) {
			console.log('\n  ^ one instance. Duplicate replies are not coming from a second copy of this build.');
		}
		else if (overlaps.length) {
			console.log(`\n  ^ ${overlaps.length} pair(s) of these were alive at the same time:`);
			for (const [a, b] of overlaps) console.log(`      ${a}\n      ${b}\n`);
			console.log('    One token, several gateways. Both receive every event and both answer it.');
			console.log('    Shut one down, or give the other its own Discord application.');
		}
		else {
			console.log('\n  ^ more than one, but none overlapping — this is the same service being');
			console.log('    restarted or redeployed, not two copies running side by side. Every');
			console.log('    restart is still a fresh gateway IDENTIFY; see DISCORD-RATE-LIMITS.md.');
		}

		// The same user, the same event text, inside a few seconds, handled by two
		// different instances: a duplicate caught in the act.
		const byKey = new Map();
		for (const row of stamped) {
			const bucket = Math.floor(new Date(row.created_at).getTime() / 5000);
			const key = `${row.user_id}|${row.event}|${bucket}`;
			if (!byKey.has(key)) byKey.set(key, []);
			byKey.get(key).push(row);
		}
		const dupes = [...byKey.values()].filter(
			rows => new Set(rows.map(r => r.instance)).size > 1,
		);

		if (dupes.length) {
			console.log(`\nevents handled by more than one instance at once: ${dupes.length}`);
			for (const rows of dupes.slice(0, 10)) {
				console.log(`  ${rows[0].username} — ${rows[0].event}`);
				for (const r of rows) console.log(`      ${r.instance}  ${new Date(r.created_at).toISOString()}`);
			}
		}
		else {
			console.log('\nNo single event was handled by two instances.');
		}
	}

	client.release();
	await pool.end();
}

main().catch((error) => {
	console.error(`\nFAILED: ${error.message || error.name}`);
	process.exitCode = 1;
});
