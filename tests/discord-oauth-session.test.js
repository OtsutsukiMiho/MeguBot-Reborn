'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(require.resolve('../backend/web/web.js'), 'utf8');

function fixture(intent = 'login') {
	let exchanges = 0, regenerations = 0, links = 0, accounts = 0;
	let stored, consumed = false;
	const registrations = [];
	const account = { id: 'megu-user', displayName: 'Person' };
	const context = {
		crypto, Date, process: { env: {} }, BotLogs: () => {}, recordDiscordBlock: () => false,
		discordBlock: { blocked: () => false }, sendBlockedPage: () => { throw new Error('Unexpected block'); },
		safeInternalReturn: value => value || '/',
		discordOAuth: {
			authorizeUrl: ({ state }) => `https://discord.test/?state=${state}`,
			exchangeCode: async () => { exchanges++; return { access_token: 'token', refresh_token: 'refresh', expires_in: 100 }; },
			fetchMe: async () => ({ id: '123456789012345678', username: 'Person' }), fetchMyGuilds: async () => [],
			toIdentityProfile: user => ({ provider: 'discord', providerUid: user.id }),
		},
		core: { users: {
			loginWithIdentity: async () => { accounts++; return { user: account }; }, claimParticipants: async () => {},
			linkIdentity: async () => { links++; return { linked: true }; }, getUser: async () => account,
		}, oauthCredentials: { save: async () => ({ stored: true }) } },
		setDiscordSession: (session, user, guilds) => { session.user = user; session.allGuilds = guilds; },
		app: { get: (paths, handler) => { registrations.push({ paths: Array.isArray(paths) ? Array.from(paths) : [paths], handler }); } },
	};
	const beginStart = source.indexOf('function beginDiscordOAuth('), beginEnd = source.indexOf('// ── signing in without OAuth', beginStart);
	const finishStart = source.indexOf('async function finishDiscordOAuth('), finishEnd = source.indexOf("app.get('/api/auth/me'", finishStart);
	const handlers = vm.runInNewContext(`${source.slice(beginStart, beginEnd)}\n${source.slice(finishStart, finishEnd)}; ({ begin: beginDiscordOAuth, finish: finishDiscordOAuth })`, context);
	const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, send(body) { this.body = body; return this; }, redirect(url) { this.redirectTo = url; return this; } };
	const req = { sessionID: 'stored-session', query: { returnTo: '/servers' }, headers: {}, session: { meguUserId: intent === 'link' ? account.id : 'old-account', staleAuthority: true } };
	const store = { consumeOAuthRequest: async (_sid, request) => {
		if (consumed || JSON.stringify(stored.oauth2Request) !== JSON.stringify(request)) return false;
		if (request.intent === 'link' && stored.meguUserId !== request.linkingUserId) return false;
		consumed = true; return true;
	} };
	function attach(target) {
		target.sessionStore = store;
		const save = callback => { stored = JSON.parse(JSON.stringify(target.session)); callback(); };
		target.session.save = save;
		target.session.regenerate = callback => { regenerations++; target.session = { save }; callback(); };
		return target;
	}
	attach(req);
	handlers.begin(intent)(req, res);
	const issued = req.session.oauth2Request;
	req.query = { code: 'code', state: issued.state };
	return { req, res, issued, handlers, registrations, counts: () => ({ exchanges, regenerations, links }), accounts: () => accounts,
		snapshot: () => attach({ sessionID: req.sessionID, query: { ...req.query }, headers: {}, session: JSON.parse(JSON.stringify(stored)) }) };
}

async function main() {
	assert.equal(source.includes("app.get('/api/auth/legacy/discord'"), false, 'Unused legacy initiation retired');
	assert.equal(source.includes("app.get('/api/auth/legacy/discord/callback'"), false, 'Unsolicited legacy callback has no handler');
	assert.equal(source.includes('oauth2State'), false, 'No weaker parallel request state remains');
	for (const scenario of ['absent', 'mismatch', 'expired', 'wrong-provider', 'future', 'invalid-time', 'invalid-intent']) {
		const f = fixture();
		if (scenario === 'absent') delete f.req.session.oauth2Request;
		if (scenario === 'mismatch') f.req.query.state = 'unsolicited';
		if (scenario === 'expired') f.issued.createdAt = Date.now() - 600001;
		if (scenario === 'wrong-provider') f.issued.provider = 'other';
		if (scenario === 'future') f.issued.createdAt = Date.now() + 10000;
		if (scenario === 'invalid-time') f.issued.createdAt = 'not-a-time';
		if (scenario === 'invalid-intent') f.issued.intent = 'other';
		await f.handlers.finish(f.req, f.res);
		assert.equal(f.res.statusCode, 403, scenario); assert.equal(f.counts().exchanges, 0);
	}
	for (const intent of ['login', 'link']) {
		const f = fixture(intent);
		await f.handlers.finish(f.req, f.res);
		assert.deepEqual(f.counts(), { exchanges: 1, regenerations: intent === 'login' ? 1 : 0, links: intent === 'link' ? 1 : 0 });
		assert.equal(f.req.session.meguUserId, 'megu-user'); assert.equal(f.req.session.user.id, '123456789012345678');
		assert.equal(f.req.session.oauth2Request, undefined);
		assert.equal(f.req.session.staleAuthority, intent === 'login' ? undefined : true, 'Login regenerates; linking retains existing session');
		assert.equal(f.res.redirectTo, intent === 'login' ? '/servers' : '/account?link=success&provider=discord');
		await f.handlers.finish(f.req, f.res); assert.equal(f.res.statusCode, 403); assert.equal(f.counts().exchanges, 1, 'Replay cannot exchange again');
		const paths = f.registrations.flatMap(r => r.paths);
		assert.ok(paths.includes('/api/auth/callback') && paths.includes('/api/auth/discord/callback'));
	}
	{
		const f = fixture('link'); f.req.session.meguUserId = 'changed-account';
		await f.handlers.finish(f.req, f.res); assert.equal(f.res.statusCode, 403); assert.equal(f.counts().exchanges, 0);
		assert.equal(f.req.session.oauth2Request, undefined, 'Changed-account request is consumed');
	}
	{
		const f = fixture(); f.req.session.regenerate = callback => callback(new Error('store failed'));
		await f.handlers.finish(f.req, f.res); assert.equal(f.res.statusCode, 500); assert.equal(f.req.session.meguUserId, 'old-account');
	}
	{
		const f = fixture(), competing = f.snapshot();
		competing.query.code = 'another-valid-code';
		const competingRes = { ...f.res };
		await Promise.all([f.handlers.finish(f.req, f.res), f.handlers.finish(competing, competingRes)]);
		assert.equal(f.counts().exchanges, 1, 'Independent session snapshots consume once before exchange');
		assert.equal(f.accounts(), 1, 'Exactly one account is established');
		assert.equal(competingRes.statusCode, 403);
		assert.equal(f.res.statusCode, 200); assert.equal(f.res.redirectTo, '/servers');
	}
	for (const scenario of ['missing-store', 'store-error', 'claim-denied']) {
		const f = fixture();
		if (scenario === 'missing-store') f.req.sessionStore = {};
		if (scenario === 'store-error') f.req.sessionStore.consumeOAuthRequest = async () => { throw new Error('unavailable'); };
		if (scenario === 'claim-denied') f.req.sessionStore.consumeOAuthRequest = async () => false;
		await f.handlers.finish(f.req, f.res);
		assert.equal(f.counts().exchanges, 0, scenario);
		assert.equal(f.res.statusCode, scenario === 'store-error' ? 503 : 403);
	}
	console.log('Discord OAuth session passed: legacy retirement; absent/mismatched/expired/replayed state; current login/linking, session regeneration and account continuity.');
}
module.exports = { fixture };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
