// Sessions moved from express-session's MemoryStore to Postgres, and that store
// sits directly on the sign-in path: if it is wrong, nobody can log in at all.
//
// The reason it moved is a rate-limit one. MemoryStore emptied on every restart,
// which signed out every user at once, and every one of them signing back in is
// an OAuth round trip to Discord from an IP that gets banned for exactly that
// kind of burst. So the property that matters most here is the last one: a
// session written by one process is readable by the next, because that is what
// a restart is.
require('dotenv').config();
const assert = require('node:assert');
const session = require('express-session');
const core = require('../core/index.js');
const { createSessionStore } = require('../adapters/http/pg-session-store.js');

let n = 0;
function ok(msg) {
	n++;
	console.log(`  ok  ${msg}`);
}

/** The store speaks callbacks, because that is the interface express-session calls. */
function promisify(store, method, ...args) {
	return new Promise((resolve, reject) => {
		store[method](...args, (error, value) => (error ? reject(error) : resolve(value)));
	});
}

function sessionFixture(expiresAt, extra = {}) {
	return {
		cookie: { originalMaxAge: 86400000, expires: new Date(expiresAt).toISOString(), httpOnly: true, path: '/' },
		...extra,
	};
}

async function main() {
	const store = createSessionStore(session);
	const day = 24 * 60 * 60 * 1000;

	// 1. A session survives being written and read back, with its contents
	//    intact. oauth2Request is the one that matters most: it holds the state
	//    parameter, and losing it mid-sign-in is what produced "this sign-in
	//    request expired" and sent people round the OAuth loop again.
	{
		const sid = `test-sid-${Date.now()}-a`;
		const written = sessionFixture(Date.now() + day, {
			meguUserId: 'usr_test',
			oauth2Request: { provider: 'discord', intent: 'login', state: 'abc123', createdAt: Date.now() },
		});

		await promisify(store, 'set', sid, written);
		const read = await promisify(store, 'get', sid);

		assert.ok(read, 'the session comes back');
		assert.strictEqual(read.meguUserId, 'usr_test', 'the account id survives');
		assert.strictEqual(read.oauth2Request.state, 'abc123', 'and so does the in-flight OAuth state');
		ok('a session survives a write and read — including an in-flight sign-in');

		await promisify(store, 'destroy', sid);
	}

	// 2. Reading a session that was never written is not an error. Callers treat
	//    "no session" as "please sign in", which is recoverable; an error would
	//    fail the request outright.
	{
		const missing = await promisify(store, 'get', 'test-sid-does-not-exist');
		assert.strictEqual(missing, null, 'an unknown sid reads as nothing at all');
		ok('an unknown session reads as absent, not as an error');
	}

	// 3. destroy() is what logout and the hijack/timeout paths call.
	{
		const sid = `test-sid-${Date.now()}-b`;
		await promisify(store, 'set', sid, sessionFixture(Date.now() + day));
		assert.ok(await promisify(store, 'get', sid), 'it is there first');

		await promisify(store, 'destroy', sid);
		assert.strictEqual(await promisify(store, 'get', sid), null, 'and gone afterwards');
		ok('destroy() removes the session, so logout really logs out');
	}

	// 4. An expired row is not served, even though it is still in the table.
	//    Every read filters on the deadline; the hourly prune is housekeeping,
	//    not the thing that enforces expiry.
	{
		const sid = `test-sid-${Date.now()}-c`;
		await promisify(store, 'set', sid, sessionFixture(Date.now() - 1000));

		assert.strictEqual(await promisify(store, 'get', sid), null, 'an expired session is not served');
		const row = await core.db.query('SELECT sid FROM web_sessions WHERE sid = $1', [sid]);
		assert.strictEqual(row.rows.length, 1, 'even though the row is still there');
		ok('expiry is enforced on read, not left to the cleanup timer');

		await promisify(store, 'destroy', sid);
	}

	// 5. touch() moves the deadline without rewriting the payload. It runs on
	//    every request for an unmodified session, so it has to be the cheap one.
	{
		const sid = `test-sid-${Date.now()}-d`;
		await promisify(store, 'set', sid, sessionFixture(Date.now() + 60_000, { meguUserId: 'usr_touch' }));

		const before = await core.db.query('SELECT expires_at FROM web_sessions WHERE sid = $1', [sid]);
		await promisify(store, 'touch', sid, sessionFixture(Date.now() + day));
		const after = await core.db.query('SELECT data, expires_at FROM web_sessions WHERE sid = $1', [sid]);

		assert.ok(new Date(after.rows[0].expires_at) > new Date(before.rows[0].expires_at),
			'the deadline moved forward');
		assert.strictEqual(after.rows[0].data.meguUserId, 'usr_touch', 'and the payload was left alone');
		ok('touch() extends the deadline without rewriting the session');

		await promisify(store, 'destroy', sid);
	}

	// 6. The point of the whole change: a second store — standing in for the
	//    process that comes up after a restart — reads what the first one wrote.
	//    Under MemoryStore this is where everyone got signed out at once.
	{
		const sid = `test-sid-${Date.now()}-e`;
		await promisify(store, 'set', sid, sessionFixture(Date.now() + day, { meguUserId: 'usr_restart' }));

		const afterRestart = createSessionStore(session);
		const read = await promisify(afterRestart, 'get', sid);

		assert.ok(read, 'the session outlived the store that wrote it');
		assert.strictEqual(read.meguUserId, 'usr_restart', 'with the user still signed in');
		ok('a restart no longer signs everyone out — which is what caused the login stampede');

		await promisify(store, 'destroy', sid);
	}

	// 7. The same thing again, but driven by express-session over real HTTP,
	//    which is the only way to catch a wiring mistake — a callback signature
	//    that does not match what the middleware expects fails silently as
	//    "everybody is logged out" rather than as an error.
	await throughExpress();
}

async function throughExpress() {
	const express = require('express');
	const http = require('node:http');

	function serve(sessionStore) {
		const app = express();
		app.use(session({
			store: sessionStore,
			secret: 'test-secret-not-a-real-one',
			resave: false,
			saveUninitialized: false,
			cookie: { httpOnly: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 },
		}));
		app.get('/sign-in', (req, res) => {
			req.session.meguUserId = 'usr_http';
			req.session.oauth2Request = { provider: 'discord', state: 'state-token' };
			req.session.save(() => res.json({ ok: true }));
		});
		app.get('/me', (req, res) => res.json({
			meguUserId: req.session.meguUserId || null,
			state: req.session.oauth2Request ? req.session.oauth2Request.state : null,
		}));
		app.get('/sign-out', (req, res) => req.session.destroy(() => res.json({ ok: true })));

		const server = http.createServer(app);
		return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
	}

	const first = await serve(createSessionStore(session));
	const base = `http://127.0.0.1:${first.address().port}`;

	const signIn = await fetch(`${base}/sign-in`);
	const cookie = (signIn.headers.getSetCookie ? signIn.headers.getSetCookie() : [signIn.headers.get('set-cookie')])
		.filter(Boolean)
		.map(value => value.split(';')[0])
		.join('; ');
	assert.ok(cookie.includes('connect.sid'), 'signing in sets a session cookie');

	const me = await (await fetch(`${base}/me`, { headers: { cookie } })).json();
	assert.strictEqual(me.meguUserId, 'usr_http', 'the session is readable on the next request');
	assert.strictEqual(me.state, 'state-token', 'including the in-flight OAuth state');
	ok('express-session reads and writes through the Postgres store over real HTTP');

	// Stand up a second server on a fresh store and present the same cookie.
	// This is the restart, and under MemoryStore it answered "who are you?".
	await new Promise(resolve => first.close(resolve));
	const second = await serve(createSessionStore(session));
	const afterRestart = await (await fetch(`http://127.0.0.1:${second.address().port}/me`, { headers: { cookie } })).json();
	assert.strictEqual(afterRestart.meguUserId, 'usr_http', 'the cookie still identifies the user after a restart');
	ok('the same cookie still works against a process that has just started');

	const signOut = await fetch(`http://127.0.0.1:${second.address().port}/sign-out`, { headers: { cookie } });
	assert.strictEqual(signOut.status, 200, 'signing out succeeds');
	const gone = await (await fetch(`http://127.0.0.1:${second.address().port}/me`, { headers: { cookie } })).json();
	assert.strictEqual(gone.meguUserId, null, 'and the session really is gone');
	ok('signing out through the middleware clears the stored session');

	await new Promise(resolve => second.close(resolve));
}

main()
	.then(() => console.log(`\n  ${n} checks passed`))
	.catch((error) => {
		console.error(`\n  FAILED  ${error.message}`);
		process.exitCode = 1;
	})
	.finally(() => core.db.close());
