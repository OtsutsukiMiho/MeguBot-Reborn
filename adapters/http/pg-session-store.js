// Sessions on Postgres instead of in this process's memory.
//
// express-session's default MemoryStore was the last thing in
// DISCORD-RATE-LIMITS.md still marked "known remaining risk", and it is a rate
// limit problem rather than a storage one. Every restart — a deploy, a crash, a
// wake from idle — emptied it, which signed out every logged-in user at once.
// Signing back in is an OAuth round trip per person, so a single restart turned
// into a burst of Discord traffic proportional to how many people were using
// the site, and a restart loop multiplied that by the number of restarts. That
// is the shape of traffic Cloudflare bans an IP for.
//
// It also broke sign-ins that were already in flight: beginOAuth() keeps the
// state parameter in the session, so anyone sitting on Discord's authorize page
// during a restart came back to "this sign-in request expired" and started
// again.
//
// No new dependency — core already owns a Postgres pool, and the table is
// created here rather than in core/schema.js so it exists before the first
// request regardless of when schema init happens to finish.

const core = require('../../core/index.js');

const CREATE_TABLE = `
	CREATE TABLE IF NOT EXISTS web_sessions (
		sid        TEXT PRIMARY KEY,
		data       JSONB NOT NULL,
		expires_at TIMESTAMPTZ NOT NULL
	)
`;
const CREATE_INDEX = 'CREATE INDEX IF NOT EXISTS web_sessions_expires_at_idx ON web_sessions (expires_at)';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/** When the cookie says it dies, or a day from now if it never says. */
function expiryOf(sess, ttlMs) {
	const expires = sess && sess.cookie && sess.cookie.expires;
	const stamp = expires ? new Date(expires).getTime() : NaN;
	return new Date(Number.isFinite(stamp) ? stamp : Date.now() + ttlMs);
}

/**
 * @param {import('express-session')} session the express-session module, for its Store base class
 */
function createSessionStore(session, { ttlMs = DEFAULT_TTL_MS, log = () => undefined } = {}) {
	let ready = null;

	// Idempotent and retried: if the database is not up yet the next request
	// tries again rather than the store being permanently broken.
	function ensureTable() {
		if (!ready) {
			ready = (async () => {
				await core.db.query(CREATE_TABLE);
				await core.db.query(CREATE_INDEX);
			})().catch((error) => {
				ready = null;
				throw error;
			});
		}
		return ready;
	}

	class PostgresSessionStore extends session.Store {
		get(sid, callback) {
			ensureTable()
				.then(() => core.db.query('SELECT data FROM web_sessions WHERE sid = $1 AND expires_at > now()', [sid]))
				.then((res) => callback(null, res.rows[0] ? res.rows[0].data : null))
				.catch((error) => {
					// Reporting the error would make express-session fail the
					// request outright. Treating an unreadable session as absent
					// degrades to "please sign in", which is recoverable.
					log(`Session read failed: ${error.message}`);
					callback(null, null);
				});
		}

		set(sid, sess, callback) {
			ensureTable()
				.then(() => core.db.query(
					`INSERT INTO web_sessions (sid, data, expires_at) VALUES ($1, $2, $3)
					 ON CONFLICT (sid) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
					[sid, sess, expiryOf(sess, ttlMs)],
				))
				.then(() => callback(null))
				.catch((error) => {
					log(`Session write failed: ${error.message}`);
					callback(error);
				});
		}

		destroy(sid, callback) {
			ensureTable()
				.then(() => core.db.query('DELETE FROM web_sessions WHERE sid = $1', [sid]))
				.then(() => callback(null))
				.catch((error) => {
					log(`Session delete failed: ${error.message}`);
					callback(null);
				});
		}

		// Called on every request for an unmodified session. Only the deadline
		// moves, so this never rewrites the payload.
		touch(sid, sess, callback) {
			ensureTable()
				.then(() => core.db.query('UPDATE web_sessions SET expires_at = $2 WHERE sid = $1', [sid, expiryOf(sess, ttlMs)]))
				.then(() => callback(null))
				.catch(() => callback(null));
		}
	}

	const store = new PostgresSessionStore();

	// Expired rows are dead weight; nothing reads them because every query
	// filters on expires_at. Hourly, and only ever touching the database.
	const prune = setInterval(() => {
		ensureTable()
			.then(() => core.db.query('DELETE FROM web_sessions WHERE expires_at <= now()'))
			.catch(() => undefined);
	}, PRUNE_INTERVAL_MS);
	prune.unref();

	return store;
}

module.exports = { createSessionStore };
