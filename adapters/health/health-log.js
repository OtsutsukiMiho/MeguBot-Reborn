// A durable record of what happened to the processes themselves.
//
// The Cloudflare block was invisible after the fact, and the reason is worth
// stating plainly: `discordBlock.record()` logged it through `BotLogs()`, which
// appends to a 500-entry array in memory — and the block's own response is to
// exit the process. The event erased its own evidence at the moment it fired.
// Nothing in `audit_logs` covers it either: all eleven event types there are
// Discord *features* (VOICE_TTS, ROLE_ASSIGN, AUTOMOD …), none is the health of
// the bot, and its `guild_id NOT NULL` has no answer for a process-wide event.
//
// So a gap of exactly BLOCK_COOLDOWN_MS in the audit history is the only trace a
// block leaves, and a gap is not evidence — it is the absence of it.
//
// Writing here is safe while Discord is refusing us: Postgres is not Discord and
// none of this counts toward any rate limit. There was never a reason not to
// keep it.
//
// Two rules shape this file:
//
//   1. The recorder must outlive the thing it records. `index.js` sees the exit
//      code of a child that could not write its own obituary, so the supervisor
//      is the primary caller. A child that *can* write adds detail the
//      supervisor does not have — the error body — and both are kept.
//   2. Failing to log must never be worse than the thing being logged. Every
//      call swallows its own errors and gives up quickly; a database that is
//      down must not take the supervisor with it.

const { Pool } = require('pg');

/** Long enough for a healthy write, short enough not to hold up an exit path. */
const WRITE_TIMEOUT_MS = 2000;

/**
 * The kinds worth keeping. A closed set, because free text becomes unqueryable
 * within a month and the point of this table is that it can be asked questions.
 *
 *   boot              a process started — counts the restarts audit_logs cannot
 *                     see, because a bot that dies during boot writes no events
 *   exit              a process ended, with its code and how long it had been up
 *   block             the Cloudflare block guard recognised a block
 *   block_hold        the supervisor held a child down rather than restarting it
 *   invalid_requests  the local invalid-request circuit opened
 */
const KINDS = [
	'boot',
	'exit',
	'block',
	'block_hold',
	'invalid_requests',
];

let pool = null;
let ready = null;

function poolFor(url) {
	if (pool) return pool;
	pool = new Pool({
		connectionString: url,
		ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : { rejectUnauthorized: false },
		max: 1,
		connectionTimeoutMillis: WRITE_TIMEOUT_MS,
	});
	// A pool error with no listener is an uncaught exception, which would make
	// this module the thing that kills the supervisor.
	pool.on('error', () => undefined);
	return pool;
}

/**
 * `created_at` is `timestamptz`, unlike `audit_logs.created_at`, which is a bare
 * `TIMESTAMP`. That difference is not cosmetic: reading the audit table from a
 * machine in UTC+7 shifts every row seven hours, which is exactly how long it
 * took to notice while trying to line these events up against an incident.
 */
async function ensureTable(url) {
	if (ready) return ready;
	ready = poolFor(url).query(`
		CREATE TABLE IF NOT EXISTS bot_health_events (
			id         SERIAL PRIMARY KEY,
			kind       VARCHAR(40) NOT NULL,
			instance   VARCHAR(160),
			service    VARCHAR(60),
			detail     TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`).then(() => poolFor(url).query(
		'CREATE INDEX IF NOT EXISTS bot_health_events_created_at_idx ON bot_health_events (created_at DESC)',
	)).catch(error => {
		// Let the next call try again rather than caching the failure forever.
		ready = null;
		throw error;
	});
	return ready;
}

/**
 * Record one health event. Never throws and never waits long — a caller on an
 * exit path can `await` this without risking the exit.
 *
 * Returns true when the row was written, so a caller can say so in its log.
 */
async function record({ kind, instance = null, service = null, detail = null } = {}) {
	if (!KINDS.includes(kind)) return false;

	const url = process.env.DATABASE_URL;
	if (!url) return false;

	const timeout = new Promise(resolve => {
		const timer = setTimeout(() => resolve('timeout'), WRITE_TIMEOUT_MS);
		if (typeof timer.unref === 'function') timer.unref();
	});

	try {
		const write = ensureTable(url).then(() => poolFor(url).query(
			'INSERT INTO bot_health_events (kind, instance, service, detail) VALUES ($1, $2, $3, $4)',
			[kind, instance, service, detail === null ? null : String(detail).slice(0, 4000)],
		));
		const outcome = await Promise.race([write, timeout]);
		return outcome !== 'timeout';
	}
	catch {
		// Deliberately silent. Anything louder competes for attention with the
		// incident this is trying to describe, and the console line the caller
		// already wrote is not going anywhere.
		return false;
	}
}

/** Let a short-lived process (a script, a dying child) release the connection. */
async function close() {
	if (!pool) return;
	const closing = pool;
	pool = null;
	ready = null;
	await closing.end().catch(() => undefined);
}

module.exports = { record, close, KINDS, WRITE_TIMEOUT_MS };
