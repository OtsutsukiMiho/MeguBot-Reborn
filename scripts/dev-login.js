#!/usr/bin/env node
//
// Sign in without OAuth, for a workspace that has no OAuth credentials.
//
// The owner half of this product — /manage, confirming payments, editing the
// roster, setting a payment deadline — is reachable only to a signed-in
// account, and signing in normally means a round trip to Discord or Google with
// real client secrets. On a scratch environment that is a lot of credential to
// carry for the sake of looking at a page.
//
// This writes a session row into `web_sessions` and prints a link that adopts
// it. Handing the cookie over directly does not work: a browser refuses to let
// script overwrite an existing httpOnly `connect.sid`, so once the site has been
// opened even once, pasting one into the console silently does nothing — which
// is exactly how the first version of this script failed. Going through the app
// instead lets express-session mint and sign the cookie itself, so nothing here
// touches crypto or has to match the server's secret.
//
//   MEGU_DEV_LOGIN=1 npm run dev            # the route only exists with this
//   node scripts/dev-login.js               # the seeded demo owner
//   node scripts/dev-login.js <userId>      # a specific account
//
// Two guards, because a script that mints sessions is exactly the thing that
// must never run anywhere real: it refuses a non-local database, and it refuses
// NODE_ENV=production. Both are checked before anything is written.

require('dotenv').config();
const crypto = require('node:crypto');
const core = require('../core/index.js');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', 'host.docker.internal', 'megu-db']);
const TTL_MS = 12 * 60 * 60 * 1000;

function assertSafe() {
	if (process.env.NODE_ENV === 'production') {
		throw new Error('Refusing to mint a session with NODE_ENV=production.');
	}
	const url = process.env.MEGU_DATABASE_URL || process.env.DATABASE_URL;
	if (!url) throw new Error('MEGU_DATABASE_URL is not set.');
	const host = new URL(url).hostname;
	if (!LOCAL_HOSTS.has(host)) {
		throw new Error(`Refusing to mint a session against ${host}, which is not a local database.`);
	}
}

/** The account to sign in as: the one asked for, or the seeded demo owner. */
async function resolveUser(explicitId) {
	if (explicitId) {
		const user = await core.users.getUser(explicitId);
		if (!user) throw new Error(`No user with id ${explicitId}.`);
		return user;
	}

	const owned = await core.db.query(
		`SELECT u.id, u.display_name, count(a.id)::int AS activities
		 FROM users u
		 LEFT JOIN activities a ON a.owner_user_id = u.id
		 GROUP BY u.id
		 ORDER BY activities DESC, u.created_at
		 LIMIT 1`,
	);
	if (owned.rows.length === 0) {
		throw new Error('No accounts exist yet. Run `npm run db:seed` first.');
	}
	return owned.rows[0];
}

async function main() {
	assertSafe();
	await core.initCoreSchema();
	// The session table belongs to the web process's store rather than to core's
	// schema, so it may not exist yet on a workspace that has never served a
	// request. Creating it here is the same statement the store itself runs.
	await core.db.query(`
		CREATE TABLE IF NOT EXISTS web_sessions (
			sid        TEXT PRIMARY KEY,
			data       JSONB NOT NULL,
			expires_at TIMESTAMPTZ NOT NULL
		)`);

	const user = await resolveUser(process.argv[2]);
	const sid = crypto.randomBytes(18).toString('hex');
	const now = Date.now();
	const expires = new Date(now + TTL_MS);

	await core.db.query(
		'INSERT INTO web_sessions (sid, data, expires_at) VALUES ($1, $2, $3)',
		[sid, {
			cookie: { originalMaxAge: TTL_MS, expires, httpOnly: true, path: '/', sameSite: 'lax' },
			meguUserId: user.id,
			// The web process times a session out after 30 minutes idle and 24
			// hours absolute, and checks a User-Agent fingerprint only when one
			// was recorded. Leaving it unset means any browser may present this.
			lastActivity: now,
			loginTimestamp: now,
		}, expires],
	);

	const base = process.env.FRONTEND_URL || 'http://localhost:3100';

	console.log([
		'',
		`Signed in as ${user.display_name || user.id}  (${user.id})`,
		'',
		'Open this once. It is consumed on use and expires in 12 hours:',
		'',
		`  ${base}/api/auth/dev-login?sid=${sid}`,
		'',
		'The web process must be running with MEGU_DEV_LOGIN=1, or the route is',
		'not mounted at all.',
		'',
	].join('\n'));
}

main()
	.then(() => core.db.close())
	.catch(async (error) => {
		console.error(error.message);
		await core.db.close().catch(() => undefined);
		process.exitCode = 1;
	});
