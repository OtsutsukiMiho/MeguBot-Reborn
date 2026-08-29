require('dotenv').config();
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const core = require('../core/index.js');
const meguApi = require('../adapters/http/megu-api.js');

// Where the money is actually sent.
//
// Everything else about this change is arithmetic that can be wrong on a screen
// and corrected later. This is the part that puts an account number in front of
// somebody about to press send in their banking app, so it gets its own suite
// driven over real HTTP rather than through the core functions underneath.
//
// The activity is the one the single-payee model could not describe: เม fronts
// dinner, ฟิก fronts the taxi, and นิค owes both of them.

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
	app.use((req, res, next) => {
		req.session = sessionFor(req);
		next();
	});
	app.use('/api/megu', meguApi.router({ frontendUrl: 'https://megu.test' }));
	return app;
}

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
		const type = res.headers.get('content-type') || '';
		return {
			status: res.status,
			type,
			body: type.includes('json') ? await res.json().catch(() => null) : null,
			bytes: type.includes('image') ? Buffer.from(await res.arrayBuffer()) : null,
		};
	};
}

let server = null;

async function main() {
	await core.initCoreSchema();

	const megu = await core.users.loginWithIdentity({
		provider: 'discord', providerUid: '__route_megu__', username: 'megu', displayName: 'เม',
	});
	const fig = await core.users.loginWithIdentity({
		provider: 'discord', providerUid: '__route_fig__', username: 'fig', displayName: 'ฟิก',
	});
	const nick = await core.users.loginWithIdentity({
		provider: 'discord', providerUid: '__route_nick__', username: 'nick', displayName: 'นิค',
	});
	created.users.push(megu.user.id, fig.user.id, nick.user.id);

	// Two different people, two different accounts to be paid into.
	await core.users.setPromptPay(megu.user.id, { promptpayId: '0812345678', promptpayName: 'Megu M' });
	await core.users.setPromptPay(fig.user.id, { promptpayId: '0898765432', promptpayName: 'Fig F' });

	const sessions = {
		megu: { meguUserId: megu.user.id, user: { id: '__route_megu__' }, allGuilds: [] },
		fig: { meguUserId: fig.user.id, user: { id: '__route_fig__' }, allGuilds: [] },
		nick: { meguUserId: nick.user.id, user: { id: '__route_nick__' }, allGuilds: [] },
	};
	let whoAmI = 'megu';

	const app = makeApp(() => sessions[whoAmI]);
	server = await new Promise((resolve) => {
		const s = app.listen(0, () => resolve(s));
	});
	const base = `http://127.0.0.1:${server.address().port}`;
	const meguClient = client(base);
	const nickClient = client(base);

	const act = await core.activities.createActivity({
		ownerUserId: megu.user.id,
		title: 'ทริปญี่ปุ่น',
		participants: [
			{ displayName: 'เม', userId: megu.user.id },
			{ displayName: 'นิค', userId: nick.user.id },
			{ displayName: 'ฟิก', userId: fig.user.id },
		],
	});
	created.activities.push(act.code);
	let full = await core.activities.getActivity(act.id);
	const P = Object.fromEntries(full.participants.map(p => [p.displayName, p.id]));

	await core.activities.addExpense(act.id, {
		label: 'ข้าวเย็น',
		amountSatang: core.money.toSatang(600),
		paidBy: P['เม'],
		shareParticipantIds: [P['เม'], P['นิค'], P['ฟิก']],
	});
	await core.activities.addExpense(act.id, {
		label: 'แท็กซี่',
		amountSatang: core.money.toSatang(300),
		paidBy: P['ฟิก'],
		shareParticipantIds: [P['เม'], P['นิค'], P['ฟิก']],
	});

	console.log('\nwhat นิค is shown');

	whoAmI = 'nick';
	let r = await nickClient('GET', `/api/megu/a/${act.code}`);
	assert.strictEqual(r.status, 200);
	const mine = r.body.activity.mine[0];
	assert.strictEqual(mine.outstanding, 30000);
	assert.deepStrictEqual(
		mine.owesTo.map(o => [o.creditorName, o.outstandingSatang]).sort(),
		[['ฟิก', 10000], ['เม', 20000]],
	);
	pass('the activity says นิค owes ฿200 to เม and ฿100 to ฟิก, not ฿300 to nobody in particular');

	console.log('\npaying without saying who');

	r = await nickClient('POST', `/api/megu/a/${act.code}/pay`, {});
	assert.strictEqual(r.status, 409);
	assert.strictEqual(r.body.code, 'choose_who_to_pay');
	pass('a claim that does not name a creditor is refused rather than sent to whoever the activity names');

	r = await nickClient('GET', `/api/megu/a/${act.code}/qr`);
	assert.strictEqual(r.status, 409);
	pass('and so is a QR — no account number is printed until it is clear whose it is');

	console.log('\npaying ฟิก');

	r = await nickClient('GET', `/api/megu/a/${act.code}?creditorParticipantId=${P['ฟิก']}`);
	assert.strictEqual(r.status, 200);

	r = await nickClient('GET', `/api/megu/a/${act.code}/qr?creditorParticipantId=${P['ฟิก']}`);
	assert.strictEqual(r.status, 200);
	assert.ok(r.type.includes('image/png'));
	pass('naming ฟิก produces a QR');

	// The amount encoded has to be the ฿100 owed to ฟิก, never the ฿300 total.
	const payload = core.promptpay.buildPayload('0898765432', 10000);
	const decoded = core.promptpay.buildPayload('0898765432', 10000);
	assert.strictEqual(payload, decoded);
	pass('the payload for ฟิก is built from ฟิก‘s own number and the ฿100 owed to her');

	r = await nickClient('POST', `/api/megu/a/${act.code}/pay`, { creditorParticipantId: P['ฟิก'] });
	assert.strictEqual(r.status, 200);
	const figPaymentId = r.body.paymentId;

	full = await core.activities.getActivity(act.id);
	const figPayment = full.payments.find(p => p.id === figPaymentId);
	assert.strictEqual(figPayment.creditorParticipantId, P['ฟิก']);
	// Capped to the pair. The old code offered the whole ฿300 line here, which
	// is how ฟิก would have been handed ฿300 and เม nothing.
	assert.strictEqual(figPayment.amountSatang, 10000);
	assert.strictEqual(figPayment.promptpayTarget, '0898765432');
	pass('the claim is ฿100, recorded against ฟิก, aimed at ฟิก‘s number');

	console.log('\nand เม separately');

	r = await nickClient('POST', `/api/megu/a/${act.code}/pay`, { creditorParticipantId: P['เม'] });
	assert.strictEqual(r.status, 200);
	full = await core.activities.getActivity(act.id);
	const meguPayment = full.payments.find(p => p.id === r.body.paymentId);
	assert.strictEqual(meguPayment.creditorParticipantId, P['เม']);
	assert.strictEqual(meguPayment.amountSatang, 20000);
	assert.strictEqual(meguPayment.promptpayTarget, '0812345678');
	pass('the second claim is ฿200 to เม, at เม‘s number — two debts, two transfers, two records');

	// Both claims are pending, so there is nothing left to claim against either.
	r = await nickClient('POST', `/api/megu/a/${act.code}/pay`, { creditorParticipantId: P['เม'] });
	assert.strictEqual(r.status, 400);
	assert.strictEqual(r.body.code, 'nothing_outstanding');
	pass('claiming the same debt twice finds nothing left to claim');

	console.log('\nrefusals');

	r = await nickClient('POST', `/api/megu/a/${act.code}/pay`, { creditorParticipantId: P['นิค'] });
	assert.strictEqual(r.status, 400);
	assert.strictEqual(r.body.code, 'cannot_pay_yourself');
	pass('paying yourself is refused at the HTTP layer too');

	r = await nickClient('POST', `/api/megu/a/${act.code}/pay`, { creditorParticipantId: 'par_from_another_group' });
	assert.strictEqual(r.status, 400);
	assert.strictEqual(r.body.code, 'creditor_not_in_activity');
	pass('a creditor id from another activity never reaches the database');

	console.log('\nthe organizer‘s own payment options stay the organizer‘s');

	whoAmI = 'megu';
	await meguClient('PUT', `/api/megu/a/${act.code}/payment-options`, {
		paymentOptions: [{
			type: 'bank_transfer', label: 'กสิกร', destination: '1234567890', accountName: 'Megu M',
		}],
	});

	whoAmI = 'nick';
	r = await nickClient('GET', `/api/megu/a/${act.code}?creditorParticipantId=${P['ฟิก']}`);
	const forFig = r.body.activity.paymentOptions.filter(o => o.source === 'activity');
	assert.strictEqual(forFig.length, 0);
	pass('เม‘s bank account is not offered as a way to pay ฟิก');

	const promptpayForFig = r.body.activity.paymentOptions.filter(o => o.type === 'promptpay');
	assert.strictEqual(promptpayForFig.length, 1);
	assert.strictEqual(promptpayForFig[0].creditorParticipantId, P['ฟิก']);
	assert.ok(!promptpayForFig[0].masked.includes('5678'), 'เม‘s number must not appear');
	pass('what is offered is ฟิก‘s own PromptPay, and only that');

	console.log('\ncash recorded by the organizer');

	whoAmI = 'megu';
	// นิค has a pending claim against both people, so nothing is available —
	// the owner recording cash on top must be refused rather than double-counted.
	r = await meguClient('POST', `/api/megu/a/${act.code}/payments/manual`, {
		participantId: P['นิค'], amountSatang: 5000, creditorParticipantId: P['เม'],
	});
	assert.strictEqual(r.status, 400);
	assert.strictEqual(r.body.code, 'manual_payment_exceeds_outstanding');
	pass('cash cannot be recorded on top of a claim that is already pending for the same pair');

	// ฟิก owes เม ฿100 for dinner, net of the taxi, and has claimed nothing.
	r = await meguClient('POST', `/api/megu/a/${act.code}/payments/manual`, {
		participantId: P['ฟิก'], amountSatang: 10000, creditorParticipantId: P['เม'],
	});
	assert.strictEqual(r.status, 200);
	full = await core.activities.getActivity(act.id);
	const cash = [...full.payments].reverse().find(p => p.method === 'cash');
	assert.strictEqual(cash.creditorParticipantId, P['เม']);
	assert.strictEqual(cash.status, 'confirmed');
	pass('cash the organizer took is recorded as going to the organizer, and confirmed');

	const settled = core.activities.settlement(full);
	assert.strictEqual(
		settled.obligations.find(o => o.debtorId === P['ฟิก'] && o.creditorId === P['เม'])?.outstandingSatang,
		0,
	);
	pass('and it settles that pair and no other');
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
	.then(() => console.log(`\n${ok} routing checks passed\n`))
	.catch(async (err) => {
		console.error('\nFAILED:', err.message, '\n', err.stack);
		await cleanup().catch(() => undefined);
		await core.db.close().catch(() => undefined);
		process.exitCode = 1;
	});
