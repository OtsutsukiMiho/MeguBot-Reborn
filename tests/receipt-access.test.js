require('dotenv').config();
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const core = require('../core/index.js');
const meguApi = require('../adapters/http/megu-api.js');

// Who may look at one payment in detail.
//
// Everybody on a roster can see that a payment happened and for how much. The
// evidence behind it is different: a slip carries a bank account name and a
// transaction reference, and it belongs to the two ends of the transfer.
//
// The case this exists for is the one the single-payee model could not express.
// "Whoever was paid" used to mean the activity's payee, which was the same
// thing while one person collected — so a creditor who fronted the taxi could
// be shown a claim against them and then refused the slip proving it.

const created = { users: [], activities: [] };
let ok = 0;
function pass(m) {
	ok++;
	console.log(`  ok  ${m}`);
}

function makeApp(sessionFor) {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use((req, res, next) => { req.session = sessionFor(req); next(); });
	app.use('/api/megu', meguApi.router({ frontendUrl: 'https://megu.test' }));
	return app;
}

function client(base) {
	const jar = new Map();
	return async function call(method, url, body) {
		const headers = { 'Content-Type': 'application/json' };
		if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
		const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
		for (const c of res.headers.getSetCookie?.() || []) {
			const [pair] = c.split(';');
			const i = pair.indexOf('=');
			jar.set(pair.slice(0, i), pair.slice(i + 1));
		}
		const type = res.headers.get('content-type') || '';
		return { status: res.status, body: type.includes('json') ? await res.json().catch(() => null) : null };
	};
}

let server = null;

async function main() {
	await core.initCoreSchema();

	const people = {};
	for (const [key, name] of [['megu', 'เม'], ['nick', 'นิค'], ['fig', 'ฟิก'], ['om', 'โอม']]) {
		const r = await core.users.loginWithIdentity({
			provider: 'discord', providerUid: `__rcpt_${key}__`, username: key, displayName: name,
		});
		people[key] = r.user;
		created.users.push(r.user.id);
	}

	const sessions = Object.fromEntries(Object.entries(people).map(([key, user]) => [
		key, { meguUserId: user.id, user: { id: `__rcpt_${key}__` }, allGuilds: [] },
	]));
	let whoAmI = 'megu';

	server = await new Promise((resolve) => {
		const s = makeApp(() => sessions[whoAmI]).listen(0, () => resolve(s));
	});
	const base = `http://127.0.0.1:${server.address().port}`;

	const act = await core.activities.createActivity({
		ownerUserId: people.megu.id,
		title: 'ทริป',
		participants: [
			{ displayName: 'เม', userId: people.megu.id },
			{ displayName: 'นิค', userId: people.nick.id },
			{ displayName: 'ฟิก', userId: people.fig.id },
			{ displayName: 'โอม', userId: people.om.id },
		],
	});
	created.activities.push(act.code);
	let full = await core.activities.getActivity(act.id);
	const P = Object.fromEntries(full.participants.map(p => [p.displayName, p.id]));

	// ฟิก fronts the taxi, so ฟิก is a creditor and is not the activity's payee.
	await core.activities.addExpense(act.id, {
		label: 'แท็กซี่',
		amountSatang: core.money.toSatang(400),
		paidBy: P['ฟิก'],
		shareParticipantIds: [P['เม'], P['นิค'], P['ฟิก'], P['โอม']],
	});

	const payment = await core.activities.recordPayment(act.id, P['นิค'], {
		amountSatang: core.money.toSatang(100),
		creditorParticipantId: P['ฟิก'],
		method: 'promptpay',
	});

	console.log('\nthe reference on the receipt');

	whoAmI = 'nick';
	const nickClient = client(base);
	let r = await nickClient('GET', `/api/megu/a/${act.code}?lang=en`);
	const serialised = r.body.activity.payments.find(p => p.id === payment.id);
	assert.strictEqual(serialised.reference, core.ids.publicReference(payment.id));
	assert.match(serialised.reference, /^MEGU-PAY-[0-9A-Z]{8}$/);
	pass('the payment carries a reference a person can read down a phone');

	// Derived, so it is the same every time it is asked for and needs no column.
	assert.strictEqual(core.ids.publicReference(payment.id), core.ids.publicReference(payment.id));
	assert.notStrictEqual(core.ids.publicReference(payment.id), core.ids.publicReference(core.ids.newId('pay')));
	pass('it is stable for a payment and different between payments');

	// No confusable characters — this is read aloud and retyped.
	assert.ok(!/[01ILOU]/.test(serialised.reference.replace('MEGU-PAY-', '')),
		`reference should avoid confusable characters: ${serialised.reference}`);
	pass('and it contains nothing that could be misheard as something else');

	console.log('\nwho may open the evidence');

	// No slip is attached, so the honest answer for somebody allowed to look is
	// "there is nothing here" — a different answer from "you may not look".
	for (const [who, expected] of [
		['nick', 404],
		['fig', 404],
		['megu', 404],
		['om', 403],
	]) {
		whoAmI = who;
		const res = await client(base)('GET', `/api/megu/a/${act.code}/payments/${payment.id}/slip`);
		assert.strictEqual(res.status, expected, `${who} expected ${expected}, got ${res.status}`);
	}
	pass('the payer, the creditor and the organizer are let through; another participant is not');

	// The one that used to be wrong: ฟิก is the creditor and not the payee.
	full = await core.activities.getActivity(act.id);
	assert.notStrictEqual(full.payee?.participantId, P['ฟิก'], 'ฟิก must not be the payee for this to prove anything');
	pass('and the creditor above was deliberately not the activity payee');

	console.log('\nrows written before creditors existed');

	const legacyId = core.ids.newId('pay');
	await core.db.query(
		`INSERT INTO payments (id, activity_id, participant_id, amount_satang, method, status)
		 VALUES ($1, $2, $3, $4, 'promptpay', 'pending')`,
		[legacyId, act.id, P['โอม'], 10000],
	);

	for (const [who, expected] of [
		['om', 404],
		['megu', 404],
		['nick', 403],
	]) {
		whoAmI = who;
		const res = await client(base)('GET', `/api/megu/a/${act.code}/payments/${legacyId}/slip`);
		assert.strictEqual(res.status, expected, `${who} expected ${expected}, got ${res.status}`);
	}
	pass('a payment with no creditor still lets its payer and the payee through, and nobody else');

	console.log('\nsomebody who is not on the roster at all');

	whoAmI = 'megu';
	const other = await core.activities.createActivity({
		ownerUserId: people.om.id,
		title: 'อีกทริป',
		participants: [{ displayName: 'โอม', userId: people.om.id }],
	});
	created.activities.push(other.code);

	whoAmI = 'om';
	r = await client(base)('GET', `/api/megu/a/${act.code}/payments/${payment.id}/slip`);
	assert.strictEqual(r.status, 403);
	pass('being an organizer somewhere else grants nothing here');
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
}

main()
	.then(cleanup)
	.then(() => core.db.close())
	.then(() => console.log(`\n${ok} checks passed\n`))
	.catch(async (err) => {
		console.error('\nFAILED:', err.message, '\n', err.stack);
		await cleanup().catch(() => undefined);
		await core.db.close().catch(() => undefined);
		process.exitCode = 1;
	});
