require('dotenv').config();
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const core = require('../core/index.js');
const meguApi = require('../adapters/http/megu-api.js');

const created = { users: [], activities: [] };
let ok = 0;
function pass(m) {
	ok++;
	console.log(`  ok  ${m}`);
}

// Minimal host: a fake session so we can drive the router as different people.
function makeApp(sessionFor) {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use((req, res, next) => {
		req.session = sessionFor(req);
		next();
	});
	app.use('/api/megu', meguApi.router({ botPresence: async () => ['111'] }));
	return app;
}

// A tiny cookie-aware fetch so device tokens behave like a real browser.
function client(base) {
	const jar = new Map();
	return async function call(method, url, body) {
		const headers = { 'Content-Type': 'application/json' };
		if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
		const res = await fetch(base + url, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
		});
		for (const c of res.headers.getSetCookie?.() || []) {
			const [pair] = c.split(';');
			const i = pair.indexOf('=');
			jar.set(pair.slice(0, i), pair.slice(i + 1));
		}
		return { status: res.status, body: await res.json().catch(() => null) };
	};
}

let server = null;

async function main() {
	await core.initCoreSchema();

	const fig = await core.users.loginWithIdentity({
		provider: 'discord', providerUid: '__api_fig__', username: 'fig', displayName: 'ฟิก',
	});
	created.users.push(fig.user.id);

	const sessions = {
		fig: { meguUserId: fig.user.id, user: { id: '__api_fig__' }, allGuilds: [{ id: '111', name: 'Megu HQ', permissions: '8' }] },
		anon: {},
	};
	let whoAmI = 'anon';

	const app = makeApp(() => sessions[whoAmI]);
	server = await new Promise((resolve) => {
		const s = app.listen(0, () => resolve(s));
	});
	const base = `http://127.0.0.1:${server.address().port}`;

	const figClient = client(base);
	const ohmClient = client(base);
	const strangerClient = client(base);

	whoAmI = 'fig';
	let r = await figClient('GET', '/api/megu/me');
	assert.strictEqual(r.body.loggedIn, true);
	assert.strictEqual(r.body.servers.length, 1);
	assert.strictEqual(r.body.servers[0].canManage, true);
	pass('GET /me returns the Megu account and visible servers');

	r = await figClient('POST', '/api/megu/activities', {
		title: 'ตีแบด',
		location: 'คอร์ท 3',
		startsAt: '2026-08-22T17:00:00+07:00',
		guildId: '111',
		participants: [
			{ displayName: 'ฟิก', userId: fig.user.id },
			{ displayName: 'โอม' },
			{ displayName: 'นัท' },
			{ displayName: 'A' },
		],
	});
	assert.strictEqual(r.status, 201);
	const code = r.body.activity.code;
	created.activities.push(code);
	assert.strictEqual(r.body.activity.planState, 'open');
	assert.strictEqual(r.body.activity.role, 'owner');
	assert.strictEqual(r.body.activity.participants.length, 4);
	pass(`POST /activities created /a/${code} with plan open, money none`);

	const ohmId = r.body.activity.participants.find(p => p.displayName === 'โอม').id;
	const nutId = r.body.activity.participants.find(p => p.displayName === 'นัท').id;
	const figId = r.body.activity.participants.find(p => p.displayName === 'ฟิก').id;

	whoAmI = 'anon';
	r = await strangerClient('GET', `/api/megu/a/${code}`);
	assert.strictEqual(r.status, 200);
	assert.strictEqual(r.body.activity.role, 'none');
	assert.strictEqual(r.body.activity.totals, null);
	assert.strictEqual(r.body.activity.moneyState, null);
	assert.strictEqual(r.body.activity.expenses.length, 0);
	pass('a stranger can open the link but sees no amounts');

	const leaked = JSON.stringify(r.body);
	assert.ok(!leaked.includes('deviceToken'), 'device tokens must never reach the client');
	assert.ok(!leaked.includes('discordUid'), 'discord ids must never reach the client');
	pass('public payload leaks no device tokens or Discord ids');

	r = await ohmClient('POST', `/api/megu/a/${code}/claim`, { participantId: ohmId });
	assert.strictEqual(r.status, 200);
	assert.strictEqual(r.body.activity.role, 'participant');
	assert.strictEqual(r.body.activity.me.displayName, 'โอม');
	pass('โอม claimed a slot with no login at all');

	r = await ohmClient('POST', `/api/megu/a/${code}/claim`, { participantId: nutId });
	assert.strictEqual(r.status, 409);
	pass('the same browser cannot also claim to be นัท');

	r = await strangerClient('POST', `/api/megu/a/${code}/claim`, { participantId: ohmId });
	assert.strictEqual(r.status, 409);
	pass('another browser cannot steal a claimed slot');

	r = await ohmClient('POST', `/api/megu/a/${code}/rsvp`, { rsvp: 'yes' });
	assert.strictEqual(r.body.activity.me.rsvp, 'yes');
	pass('โอม answered yes and it stuck to the right row');

	r = await strangerClient('POST', `/api/megu/a/${code}/rsvp`, { rsvp: 'yes' });
	assert.strictEqual(r.status, 403);
	pass('an unclaimed visitor cannot vote');

	whoAmI = 'fig';
	const aId = (await figClient('GET', `/api/megu/a/${code}`)).body.activity.participants
		.find(p => p.displayName === 'A').id;
	for (const id of [figId, nutId]) await core.activities.setRsvp(id, 'yes');

	await figClient('POST', `/api/megu/a/${code}/plan`, { planState: 'confirmed' });
	r = await figClient('POST', `/api/megu/a/${code}/plan`, { planState: 'done' });
	assert.strictEqual(r.body.activity.planState, 'done');
	pass('owner walked the plan to done');

	whoAmI = 'anon';
	r = await ohmClient('POST', `/api/megu/a/${code}/expenses`, { label: 'ค่าคอร์ท', amountBaht: 400, paidBy: figId });
	assert.strictEqual(r.status, 401);
	pass('a participant cannot add an expense');

	// A never answered, so the ฿400 splits three ways, not four.
	whoAmI = 'fig';
	r = await figClient('POST', `/api/megu/a/${code}/expenses`, { label: 'ค่าคอร์ท', amountBaht: 400, paidBy: figId });
	assert.strictEqual(r.status, 200);
	assert.strictEqual(r.body.activity.moneyState, 'open');
	assert.strictEqual(r.body.activity.totals.total, 40000);
	assert.strictEqual(r.body.activity.participants.find(p => p.id === aId).owes, 0);
	const owed = r.body.activity.participants.filter(p => p.owes > 0);
	assert.strictEqual(owed.length, 3);
	assert.strictEqual(owed.reduce((s, p) => s + p.owes, 0), 40000);
	pass('฿400 split only among the three who said yes, summing back to ฿400 exactly');

	await core.activities.setRsvp(aId, 'yes');
	r = await figClient('POST', `/api/megu/a/${code}/expenses`, { label: 'ลูกแบด', amountBaht: 200, paidBy: figId });
	assert.strictEqual(r.body.activity.participants.find(p => p.id === aId).owes, 5000);
	pass('A said yes later → the next expense includes them');

	whoAmI = 'anon';
	r = await ohmClient('GET', `/api/megu/a/${code}`);
	const ohmRow = r.body.activity.participants.find(p => p.id === ohmId);
	// 400/3 cannot divide evenly, so one of the three carries the extra satang.
	// Which one is stable for a given activity but not predictable across runs,
	// so assert the invariant rather than a specific person.
	assert.ok([13333 + 5000, 13334 + 5000].includes(ohmRow.outstanding), `unexpected ${ohmRow.outstanding}`);
	const grandTotal = r.body.activity.participants.reduce((s, p) => s + (p.owes || 0), 0);
	assert.strictEqual(grandTotal, 60000);
	pass(`โอม sees ${core.money.formatTHB(ohmRow.outstanding)}; all shares still sum to ฿600.00`);

	r = await ohmClient('POST', `/api/megu/a/${code}/pay`);
	const payment = r.body.activity.payments.find(p => p.participantId === ohmId);
	assert.strictEqual(payment.status, 'pending');
	assert.ok(r.body.activity.participants.find(p => p.id === ohmId).outstanding > 0);
	pass('โอม pressed paid → recorded as pending, still owing');

	r = await ohmClient('POST', `/api/megu/a/${code}/payments/${payment.id}/confirm`);
	assert.strictEqual(r.status, 401);
	pass('โอม cannot confirm their own payment');

	whoAmI = 'fig';
	r = await figClient('POST', `/api/megu/a/${code}/payments/${payment.id}/confirm`);
	assert.strictEqual(r.status, 200);
	assert.strictEqual(r.body.activity.participants.find(p => p.id === ohmId).outstanding, 0);
	pass('ฟิก confirmed it → โอม is clear');

	const full = await core.activities.getActivityByCode(code);
	for (const row of core.activities.settlement(full).unpaid) {
		const p = await core.activities.recordPayment(full.id, row.participantId, { amountSatang: row.outstanding });
		await core.activities.confirmPayment(p.id, fig.user.id);
	}
	r = await figClient('GET', `/api/megu/a/${code}`);
	assert.strictEqual(r.body.activity.totals.fullySettled, true);
	pass('everyone paid → fullySettled');

	r = await figClient('GET', `/api/megu/a/${code}`);
	assert.strictEqual(r.body.activity.moneyState, 'settled');
	assert.ok(r.body.activity.megu.includes('ตีแบด'));
	pass(`money settled — Megu says "${r.body.activity.megu}"`);

	// ── corrections over HTTP ────────────────────────────────────────────
	whoAmI = 'anon';
	r = await ohmClient('PATCH', `/api/megu/a/${code}`, { title: 'ไม่ควรเปลี่ยนได้' });
	assert.strictEqual(r.status, 401);
	r = await ohmClient('DELETE', `/api/megu/a/${code}/expenses/nope`);
	assert.strictEqual(r.status, 401);
	pass('a participant cannot edit or delete anything');

	whoAmI = 'fig';
	r = await figClient('PATCH', `/api/megu/a/${code}`, { title: 'ตีแบดเย็นวันเสาร์', location: 'คอร์ท 5' });
	assert.strictEqual(r.body.activity.title, 'ตีแบดเย็นวันเสาร์');
	pass('owner renamed the activity');

	r = await figClient('PATCH', `/api/megu/a/${code}/participants/${nutId}`, { displayName: 'นัทตี้' });
	assert.ok(r.body.activity.participants.some(p => p.displayName === 'นัทตี้'));
	pass('owner fixed a misspelt name');

	const badExpense = r.body.activity.expenses[0];
	r = await figClient('PATCH', `/api/megu/a/${code}/expenses/${badExpense.id}`, { amountBaht: 40 });
	const fixed = r.body.activity.expenses.find(e => e.id === badExpense.id);
	assert.strictEqual(fixed.amountSatang, 4000);
	const shareSum = r.body.activity.participants.reduce((s, p) => s + (p.owes || 0), 0);
	assert.strictEqual(shareSum, r.body.activity.totals.total);
	pass('owner corrected a wrong amount and the shares still sum to the new total');

	r = await figClient('DELETE', `/api/megu/a/${code}/expenses/${badExpense.id}`);
	assert.ok(!r.body.activity.expenses.some(e => e.id === badExpense.id));
	pass('owner deleted an expense outright');

	r = await figClient('PATCH', `/api/megu/a/${code}/participants/${ohmId}`, { resetClaim: true });
	assert.strictEqual(r.body.activity.participants.find(p => p.id === ohmId).claimed, false);
	pass('owner handed a claimed name back');

	whoAmI = 'anon';
	r = await ohmClient('GET', `/api/megu/a/${code}`);
	assert.strictEqual(r.body.activity.me, null);
	pass('the browser that had claimed it is no longer that person');

	whoAmI = 'fig';

	r = await figClient('GET', '/api/megu/a/ZZZZZZZ');
	assert.strictEqual(r.status, 404);
	pass('unknown code returns 404, not a crash');

}

async function cleanup() {
	if (server) server.close();
	for (const code of created.activities) {
		const a = await core.activities.getActivityByCode(code).catch(() => null);
		if (a) await core.db.query('DELETE FROM activities WHERE id = $1', [a.id]).catch(() => undefined);
	}
	for (const id of created.users) {
		await core.db.query('DELETE FROM users WHERE id = $1', [id]).catch(() => undefined);
	}
	const left = await core.db.query('SELECT count(*)::int n FROM activities');
	console.log(`\ncleanup — activities: ${left.rows[0].n} rows`);
}

main()
	.then(cleanup)
	.then(() => core.db.close())
	.then(() => console.log(`\n${ok} API checks passed\n`))
	.catch(async (err) => {
		console.error('\nFAILED:', err.message, '\n', err.stack);
		await cleanup().catch(() => undefined);
		await core.db.close().catch(() => undefined);
		process.exitCode = 1;
	});
