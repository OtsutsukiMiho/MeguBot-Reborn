const { Pool } = require('pg');
const { log } = require('./log.js');

let pool = null;

/**
 * Core requires PostgreSQL. The legacy bot data has a JSON fallback, but
 * activities carry money between real people and need transactions and
 * foreign keys, so there is no degraded mode here.
 *
 * MEGU_DATABASE_URL wins when set, which is how development and tests stay on
 * a local container while the live bot keeps using DATABASE_URL. Unset it in
 * production and core falls back to the same database as everything else.
 */
function connectionString() {
	return process.env.MEGU_DATABASE_URL || process.env.DATABASE_URL || '';
}

function isLocal(url) {
	return /@(localhost|127\.0\.0\.1|host\.docker\.internal|megu-db)[:/]/.test(url);
}

function getPool() {
	if (pool) return pool;

	const url = connectionString();
	if (!url) {
		throw new Error('MEGU_DATABASE_URL or DATABASE_URL is required for Megu core (activities, payments).');
	}

	// A local container has no TLS to negotiate; forcing ssl there just fails.
	//
	// The cap matters more than it looks. index.js forks two processes, both of
	// them open this pool and both also open the legacy bot's, so pg's default
	// of 10 per pool is forty connections against one database — and a web
	// process that crash-loops would keep opening more. Five each is generous
	// for a workload of short reads and writes, the idle timeout hands
	// connections back instead of holding them for the process lifetime, and
	// the connect timeout turns an unreachable database into an error rather
	// than a queue of callers waiting forever.
	pool = new Pool({
		connectionString: url,
		ssl: isLocal(url) ? false : { rejectUnauthorized: false },
		max: Number(process.env.PG_POOL_MAX) || 5,
		idleTimeoutMillis: 10_000,
		connectionTimeoutMillis: 8_000,
	});

	pool.on('error', (err) => {
		log('Core', `PostgreSQL pool error: ${err.message}`);
	});

	return pool;
}

function query(text, params) {
	return getPool().query(text, params);
}

/**
 * Run `fn` inside a transaction. Anything touching money uses this so a
 * half-written settlement can never survive a crash.
 */
async function transaction(fn) {
	const client = await getPool().connect();
	try {
		await client.query('BEGIN');
		const result = await fn(client);
		await client.query('COMMIT');
		return result;
	}
	catch (error) {
		await client.query('ROLLBACK').catch(() => undefined);
		throw error;
	}
	finally {
		client.release();
	}
}

async function close() {
	if (pool) {
		await pool.end();
		pool = null;
	}
}

/**
 * Which database core is actually talking to, with the password stripped.
 * Printed at boot so nobody has to guess whether they are on the local
 * container or the live one.
 */
function describe() {
	const url = connectionString();
	if (!url) return 'not configured';
	const safe = url.replace(/\/\/([^:]+):[^@]*@/, '//$1:***@');
	return `${safe}${isLocal(url) ? '  (local)' : '  (remote)'}`;
}

module.exports = { getPool, query, transaction, close, describe, isLocal, connectionString };
