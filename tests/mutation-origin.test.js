'use strict';
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const fs = require('node:fs');
const vm = require('node:vm');
const { createMutationOriginGuard } = require('../adapters/http/mutation-origin');
const trusted = 'https://app.example.test';
const web = fs.readFileSync(require.resolve('../backend/web/web'), 'utf8');

async function main() {
	assert.throws(() => createMutationOriginGuard('not-a-url'));
	assert.throws(() => createMutationOriginGuard('https://user:secret@app.example.test'));
	assert.ok(web.indexOf('app.use(createMutationOriginGuard(FRONTEND_URL))') > web.indexOf('app.use(cookieParser())'));
	assert.ok(web.indexOf('app.use(createMutationOriginGuard(FRONTEND_URL))') > web.indexOf('app.use(session('));
	assert.ok(web.indexOf('app.use(createMutationOriginGuard(FRONTEND_URL))') < web.indexOf("app.use('/api/megu'"));
	assert.ok(web.includes("sameSite: 'lax'"));
	let mutations = 0, activityMutations = 0, callbacks = 0;
	const app = express();
	app.use(express.urlencoded({ extended: true })); app.use(express.json());
	app.use(cookieParser());
	app.use(session({ secret: 'test-only-origin-secret', resave: false, saveUninitialized: false, cookie: { sameSite: 'lax' } }));
	app.get('/fixture-session', (req, res) => {
		req.session.meguUserId = 'account'; req.session.user = { id: '200000000000000000' };
		res.json({ ok: true });
	});
	app.use(createMutationOriginGuard(trusted));
	const guardStart = web.indexOf('function requireConsoleGuild(');
	const roleGuard = vm.runInNewContext(`${web.slice(guardStart, web.indexOf('const requireAdminGuild', guardStart))}; requireConsoleGuild('roles')`, {
		sendIpcRequest: async () => ({ success: false, status: 403, error: 'Manage Roles required.' }),
	});
	app.post('/api/guilds/:guildId/denied', async (req, res, next) => roleGuard(req, res, next), (_req, res) => { mutations++; res.json({ ok: true }); });
	app.all(['/api/guilds/change', '/api/developer/action', '/api/account/merge', '/api/auth/logout', '/api/megu/teams/change'], (req, res) => {
		if (!req.session.meguUserId) return res.status(401).json({ error: 'Sign in required.' });
		mutations++; res.json({ ok: true, body: req.body });
	});
	app.post([
		'/api/megu/a/:code/claim', '/api/megu/a/:code/defer', '/api/megu/a/:code/rsvp',
		'/api/megu/a/:code/pay', '/api/megu/a/:code/payments/:paymentId/slip', '/api/megu/a/:code/slots/vote',
	], (req, res) => {
		if (req.path.endsWith('/claim')) res.cookie('megu_pt', 'device-claim');
		else if (req.cookies.megu_pt !== 'device-claim') return res.status(403).json({ error: 'Participant required.' });
		activityMutations++; res.json({ ok: true, body: req.body });
	});
	app.get('/api/megu/a/:code', (_req, res) => res.json({ public: true }));
	app.get(['/api/auth/login', '/api/auth/callback', '/api/auth/discord/callback'], (_req, res) => { callbacks++; res.json({ oauth: true }); });
	app.post('/api/ping', (_req, res) => res.json({ ok: true }));
	const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
	const base = `http://127.0.0.1:${server.address().port}`;
	try {
		const signedIn = await fetch(`${base}/fixture-session`);
		const cookie = signedIn.headers.get('set-cookie').split(';')[0];
		async function mutate(path = '/api/guilds/change', headers = {}, method = 'POST', body = 'value=ok') {
			return fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', ...headers }, body });
		}
		async function activity(path = '/api/megu/a/code/rsvp', headers = {}, body = 'value=ok') {
			return fetch(`${base}${path}`, { method: 'POST', headers: { cookie: 'megu_pt=device-claim', 'content-type': 'application/x-www-form-urlencoded', ...headers }, body });
		}
		assert.equal((await mutate(undefined, { origin: trusted })).status, 200, 'Same-origin form accepted');
		assert.equal((await mutate(undefined, { origin: trusted, 'content-type': 'application/json' }, 'PATCH', '{"value":"ok"}')).status, 200, 'Same-origin JSON accepted');
		assert.equal((await mutate(undefined, { referer: `${trusted}/servers` })).status, 200, 'Exact-origin Referer fallback');
		const before = mutations;
		for (const headers of [
			{ origin: 'https://attacker.test' }, { origin: 'https://sibling.example.test', 'sec-fetch-site': 'same-site' },
			{ origin: 'null' }, { origin: 'not-a-url' }, { origin: `${trusted}/path` }, { origin: `${trusted}/` },
			{ origin: `${trusted}, https://attacker.test` }, { origin: 'https://app.example.test.attacker.test' },
			{ origin: 'https://user@app.example.test' }, { origin: trusted, referer: 'https://sibling.example.test/page' },
			{ referer: 'https://attacker.test' }, {}, { 'sec-fetch-site': 'same-origin' },
			{ origin: trusted, 'sec-fetch-site': 'cross-site' },
			{ origin: 'https://attacker.test', 'x-forwarded-host': 'app.example.test', 'x-forwarded-proto': 'https' },
			{ authorization: 'Bearer not-a-machine-credential' },
		]) assert.equal((await mutate(undefined, headers)).status, 403, JSON.stringify(headers));
		assert.equal(mutations, before, 'Rejected requests cause no mutation');
		for (const path of ['/api/guilds/change', '/api/developer/action', '/api/account/merge', '/api/auth/logout', '/api/megu/teams/change']) {
			for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
				assert.equal((await mutate(path, { origin: 'https://sibling.example.test' }, method)).status, 403);
				assert.equal((await mutate(path, { origin: trusted }, method)).status, 200);
			}
		}
		assert.equal((await activity(undefined, { origin: trusted })).status, 200, 'Anonymous participant form accepted');
		assert.equal((await activity(undefined, { origin: trusted, 'content-type': 'application/json' }, '{"rsvp":"yes"}')).status, 200, 'Anonymous participant JSON accepted');
		assert.equal((await activity(undefined, { referer: `${trusted}/a/code` })).status, 200, 'Anonymous participant Referer fallback accepted');
		const activityBefore = activityMutations;
		for (const headers of [
			{ origin: 'https://sibling.example.test', 'sec-fetch-site': 'same-site' },
			{ origin: 'https://attacker.test' }, { origin: 'not-a-url' }, { origin: 'null' },
			{ origin: trusted, referer: 'https://sibling.example.test/a/code' }, {},
		]) assert.equal((await activity(undefined, headers)).status, 403, `Anonymous RSVP: ${JSON.stringify(headers)}`);
		assert.equal(activityMutations, activityBefore, 'Rejected anonymous participant requests do not mutate');
		assert.equal((await activity(undefined, { origin: trusted, cookie: '' })).status, 403, 'Origin does not authenticate a participant');
		for (const path of [
			'/api/megu/a/code/claim', '/api/megu/a/code/defer', '/api/megu/a/code/pay',
			'/api/megu/a/code/payments/payment/slip', '/api/megu/a/code/slots/vote',
		]) {
			assert.equal((await activity(path, { origin: 'https://sibling.example.test' })).status, 403, path);
			assert.equal((await activity(path, { origin: trusted })).status, 200, path);
		}
		assert.equal((await activity('/api/megu/a/code/claim', { origin: 'https://sibling.example.test', cookie: '' })).status, 403, 'First cookie-free claim is protected');
		assert.equal((await activity('/api/megu/a/code/claim', { origin: trusted, cookie: '' })).status, 200, 'First same-origin claim still works');
		assert.equal((await mutate('/api/megu/a/code/rsvp', { origin: 'https://sibling.example.test' })).status, 403, 'Signed-in activity mutation remains protected');
		assert.equal((await fetch(`${base}/api/megu/a/code`, { headers: { origin: 'https://sibling.example.test' } })).status, 200, 'Public read-only activity remains accessible');
		assert.equal((await fetch(`${base}/api/guilds/change`, { method: 'POST', headers: { origin: trusted } })).status, 401, 'Origin does not authenticate');
		assert.equal((await mutate('/api/guilds/100000000000000000/denied', { origin: trusted })).status, 403, 'Current role authorization still required');
		assert.equal((await fetch(`${base}/api/guilds/100000000000000000/denied`, { method: 'POST', headers: { origin: trusted } })).status, 401, 'Actual console guard requires authentication');
		for (const path of ['/api/auth/login', '/api/auth/callback', '/api/auth/discord/callback']) {
			assert.equal((await fetch(`${base}${path}`, { headers: { cookie, origin: 'https://discord.test', 'sec-fetch-site': 'cross-site' } })).status, 200);
		}
		assert.equal(callbacks, 3, 'OAuth GET routes unaffected');
		assert.equal((await fetch(`${base}/api/ping`, { method: 'POST' })).status, 200, 'Unsigned non-authenticated ping unaffected');
	}
	finally { await new Promise(resolve => server.close(resolve)); }
	console.log('Mutation origin passed: signed-in and anonymous activity form/JSON, exact origin/Referer, sibling/cross-site/malformed/missing evidence denial, route authorization, public reads/ping and OAuth GET compatibility.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
