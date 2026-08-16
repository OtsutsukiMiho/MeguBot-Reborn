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
	pool = new Pool({
		connectionString: url,
		ssl: isLocal(url) ? false : { rejectUnauthorized: false },
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
