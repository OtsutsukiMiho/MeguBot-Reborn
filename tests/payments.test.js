// Paying, end to end, against a real database.
//
// The QR and the slip both touch money and both touch other people's private
// details, so this suite is as much about who is refused as about what works:
// a phone number that must not reach a stranger holding the link, a bank
// document that must not be readable by the rest of the roster, and a slip
// that must not be spendable twice.

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

function makeApp(sessionFor) {
	const app = express();
	// Mirrors the real host: slips get a larger ceiling than everything else.
	const slipBody = express.json({ limit: '4mb' });
	app.use((req, res, next) => (
		req.method === 'POST' && req.path.endsWith('/slip') ? slipBody(req, res, next) : next()
	));
	app.use(express.json());
	app.use(cookieParser());
	app.use((req, res, next) => {
		req.session = sessionFor(req);
		next();
	});
	app.use('/api/megu', meguApi.router({ botPresence: async () => [] }));
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
		const payload = type.includes('application/json')
			? await res.json().catch(() => null)
			: Buffer.from(await res.arrayBuffer());
		return { status: res.status, type, body: payload };
	};
}

// A one-pixel PNG is a valid image and is all the transport needs to carry.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let server = null;

async function main() {
	await core.initCoreSchema();

	const megu = await core.users.loginWithIdentity({
		provider: 'discord', providerUid: '__pay_megu__', username: 'megu', displayName: 'Megu',
	});
	created.users.push(megu.user.id);

	let whoAmI = 'owner';
	const sessions = {
		owner: { meguUserId: megu.user.id, user: { id: '__pay_megu__' }, allGuilds: [] },
		anon: {},
	};

	const app = makeApp(() => sessions[whoAmI] || {});
	server = app.listen(0);
	await new Promise(r => server.once('listening', r));
	const base = `http://127.0.0.1:${server.address().port}`;

	const owner = client(base);
	const ohm = client(base);
	const stranger = client(base);

	// ── the number itself ──────────────────────────────────────────────────

	let r = await owner('PATCH', '/api/megu/me', { promptpayId: 'nonsense' });
	assert.strictEqual(r.status, 400);
	assert.strictEqual(r.body.code, 'promptpay_unrecognised');
	pass('a number that is not a PromptPay id is refused with a code the browser can translate');

	r = await owner('PATCH', '/api/megu/me', { promptpayId: '081-234-5678', promptpayName: 'Megu S.' });
	assert.strictEqual(r.status, 200);
	assert.strictEqual(r.body.user.promptpayId, '081-234-5678');
	pass('the owner saved a PromptPay number on their account');

	// ── an activity with money on it ───────────────────────────────────────

	r = await owner('POST', '/api/megu/activities', {
		title: 'Badminton',
		participants: [{ displayName: 'โอม' }, { displayName: 'นัท' }],
	});
	assert.strictEqual(r.status, 201);
	const code = r.body.activity.code;
	created.activities.push(code);

	const roster = r.body.activity.participants;
	const meRow = roster.find(p => p.isMe);
	const ohmRow = roster.find(p => p.displayName === 'โอม');

	// Nobody has answered yet, so the split falls back to the whole roster —
	// ฿300 three ways. That fallback is what makes the ฿100 below predictable.
	r = await owner('POST', `/api/megu/a/${code}/expenses`, {
		label: 'Court', amountBaht: 300, paidBy: meRow.id,
	});
	assert.strictEqual(r.status, 200);
	pass('the owner fronted ฿300 for the court');

	// ── who may see the number ─────────────────────────────────────────────

	whoAmI = 'anon';
	r = await ohm('POST', `/api/megu/a/${code}/claim`, { participantId: ohmRow.id });
	assert.strictEqual(r.status, 200);
	pass('โอม claimed their name from a browser with no account');

	r = await ohm('GET', `/api/megu/a/${code}`);
	const asOhm = r.body.activity;
	assert.ok(asOhm.payTo, 'a participant is told where to send money');
	assert.strictEqual(asOhm.payTo.ready, true);
	assert.strictEqual(asOhm.payTo.masked, '081-xxx-5678');
	assert.strictEqual(asOhm.payTo.number, '081-234-5678');
	pass('someone who owes money gets the masked number to read and the full one to copy');

	r = await stranger('GET', `/api/megu/a/${code}`);
	assert.strictEqual(r.body.activity.role, 'none');
	assert.strictEqual(r.body.activity.payTo, null);
	assert.deepStrictEqual(r.body.activity.payments, []);
	pass('a stranger holding the link gets no phone number and no amounts');

	// ── the QR ─────────────────────────────────────────────────────────────

	r = await stranger('GET', `/api/megu/a/${code}/qr`);
	assert.strictEqual(r.status, 403);
	pass('a stranger cannot generate a QR either');

	r = await ohm('GET', `/api/megu/a/${code}/qr`);
	assert.strictEqual(r.status, 200);
	assert.ok(r.type.includes('image/png'));
	// PNG magic number: this is a real image, not an error page with the wrong
	// content type.
	assert.deepStrictEqual([...r.body.subarray(0, 4)], [0x89, 0x50, 0x4E, 0x47]);
	pass('โอม gets an actual PNG back');

	// What the QR says is checked at the payload level, where it can be read.
	const owed = asOhm.participants.find(p => p.id === ohmRow.id).outstanding;
	assert.strictEqual(owed, 10000);
	const payload = core.promptpay.buildPayload('081-234-5678', owed);
	const fields = core.promptpay.parsePayload(payload);
	assert.strictEqual(fields['54'], '100.00');
	assert.strictEqual(core.promptpay.verifyPayload(payload), true);
	pass('the amount encoded is the ฿100 owed, not the ฿300 total');

	// ── claiming ───────────────────────────────────────────────────────────

	r = await ohm('POST', `/api/megu/a/${code}/pay`);
	assert.strictEqual(r.status, 200);
	const paymentId = r.body.paymentId;
	assert.ok(paymentId);

	const claim = r.body.activity.payments.find(p => p.id === paymentId);
	assert.strictEqual(claim.status, 'pending');
	assert.strictEqual(claim.amountSatang, 10000);
	assert.strictEqual(claim.expectedSatang, 10000);
	pass('the claim lands as pending, and records what was asked for');

	// A claim is not a payment: the money axis must still read as open.
	whoAmI = 'owner';
	r = await owner('GET', `/api/megu/a/${code}`);
	assert.strictEqual(r.body.activity.moneyState, 'open');
	pass('pressing "I paid" did not settle anything');

	// ── the slip ───────────────────────────────────────────────────────────

	whoAmI = 'anon';
	r = await ohm('POST', `/api/megu/a/${code}/payments/${paymentId}/slip`, {
		dataUrl: TINY_PNG,
		ref: 'TXN-0001',
	});
	assert.strictEqual(r.status, 200);
	assert.strictEqual(r.body.verdict, 'matched');
	pass('โอม attached a slip with a readable reference');

	r = await ohm('GET', `/api/megu/a/${code}`);
	const withSlip = r.body.activity.payments.find(p => p.id === paymentId);
	assert.strictEqual(withSlip.hasSlip, true);
	assert.strictEqual(withSlip.slipVerdict, 'matched');
	assert.strictEqual(withSlip.slipImage, undefined);
	pass('the activity says a slip exists without carrying the image in it');

	r = await ohm('GET', `/api/megu/a/${code}/payments/${paymentId}/slip`);
	assert.strictEqual(r.status, 200);
	assert.ok(r.type.includes('image/'));
	pass('the person who sent the slip can open it again');

	whoAmI = 'owner';
	r = await owner('GET', `/api/megu/a/${code}/payments/${paymentId}/slip`);
	assert.strictEqual(r.status, 200);
	pass('the person being paid can open it');

	whoAmI = 'anon';
	r = await stranger('GET', `/api/megu/a/${code}/payments/${paymentId}/slip`);
	assert.strictEqual(r.status, 403);
	pass('nobody else can — a bank document is not roster-wide reading');

	// ── the same slip twice ────────────────────────────────────────────────

	whoAmI = 'owner';
	r = await owner('POST', `/api/megu/a/${code}/expenses`, {
		label: 'Shuttlecocks', amountBaht: 90, paidBy: meRow.id,
	});
	assert.strictEqual(r.status, 200);

	whoAmI = 'anon';
	r = await ohm('POST', `/api/megu/a/${code}/pay`);
	const secondClaim = r.body.paymentId;
	assert.ok(secondClaim && secondClaim !== paymentId);

	r = await ohm('POST', `/api/megu/a/${code}/payments/${secondClaim}/slip`, {
		dataUrl: TINY_PNG,
		ref: 'TXN-0001',
	});
	assert.strictEqual(r.status, 409);
	assert.strictEqual(r.body.code, 'slip_duplicate');
	pass('the same transaction reference cannot be spent on a second payment');

	r = await ohm('POST', `/api/megu/a/${code}/payments/${secondClaim}/slip`, {
		dataUrl: TINY_PNG,
		ref: 'TXN-0002',
	});
	assert.strictEqual(r.status, 200);
	pass('a different reference on the same image is fine — people do pay twice');

	// A slip nobody could read is still evidence, and must not be refused.
	whoAmI = 'owner';
	r = await owner('POST', `/api/megu/a/${code}/payments/${paymentId}/slip`, { dataUrl: TINY_PNG });
	assert.strictEqual(r.status, 200);
	assert.strictEqual(r.body.verdict, 'unread');
	pass('a slip with no readable QR is accepted and marked unread');

	r = await owner('POST', `/api/megu/a/${code}/payments/${paymentId}/slip`, { dataUrl: 'not-an-image' });
	assert.strictEqual(r.status, 400);
	assert.strictEqual(r.body.code, 'slip_unreadable');
	pass('something that is not an image at all is refused');

	// ── who collects ───────────────────────────────────────────────────────

	r = await owner('POST', `/api/megu/a/${code}/payee`, { participantId: ohmRow.id });
	assert.strictEqual(r.status, 200);
	assert.strictEqual(r.body.activity.payTo.participantId, ohmRow.id);
	// โอม has no account, so there is no number to pay to — and the page has
	// to say so rather than print a QR that goes nowhere.
	assert.strictEqual(r.body.activity.payTo.ready, false);
	pass('the money can be pointed at whoever fronted it, and says so when they have no number');

	r = await owner('GET', `/api/megu/a/${code}/qr`);
	assert.strictEqual(r.status, 404);
	assert.strictEqual(r.body.code, 'promptpay_missing');
	pass('no number means no QR, with a reason');

	r = await owner('POST', `/api/megu/a/${code}/payee`, { participantId: null });
	assert.strictEqual(r.body.activity.payTo.participantId, meRow.id);
	pass('handing it back returns the money to the owner');

	// ── the month's name is never stored for display ───────────────────────

	r = await owner('POST', '/api/megu/activities', {
		title: 'YouTube Premium', kind: 'recurring', amountBaht: 180, dueDay: 15,
		participants: [{ displayName: 'โอม' }],
	});
	const monthly = r.body.activity;
	created.activities.push(monthly.code);

	assert.ok(monthly.period.key.match(/^\d{4}-\d{2}$/));
	assert.strictEqual(monthly.period.label, undefined);
	assert.ok(monthly.periods.every(p => p.label === undefined));
	pass('periods travel as a key, so a month can be read in either language');

	// ── Megu answers in the language she was asked in ──────────────────────

	r = await owner('GET', `/api/megu/a/${code}?lang=en`);
	const english = r.body.activity.megu;
	r = await owner('GET', `/api/megu/a/${code}?lang=th`);
	const thai = r.body.activity.megu;

	assert.notStrictEqual(english, thai);

	// Her sentence is checked with the names taken out. People are called what
	// they are called: "โอม is ฿130.00 short" is correct English about someone
	// named โอม, and a plain Thai-character test would read it as a translation
	// that leaked.
	const withoutNames = line => roster.reduce((s, p) => s.split(p.displayName).join('~'), line);

	// Thai letters and marks, deliberately skipping U+0E3F — the baht sign sits
	// inside the Thai block, so the obvious `[ก-๙]` matches ฿ and reports every
	// English sentence about money as untranslated.
	const THAI_LETTERS = /[ก-ฺเ-๎]/;

	assert.ok(!THAI_LETTERS.test(withoutNames(english)), `English line still contains Thai: ${english}`);
	assert.ok(THAI_LETTERS.test(withoutNames(thai)), `Thai line lost its Thai: ${thai}`);
	pass('the same activity comes back in English or Thai, names left alone');
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
	const left = await core.db.query('SELECT count(*)::int n FROM payments WHERE slip_image IS NOT NULL');
	console.log(`\ncleanup — slips left in the database: ${left.rows[0].n}`);
}

main()
	.then(cleanup)
	.then(() => core.db.close())
	.then(() => console.log(`\n${ok} payment checks passed\n`))
	.catch(async (err) => {
		console.error('\nFAILED:', err.message, '\n', err.stack);
		await cleanup().catch(() => undefined);
		await core.db.close().catch(() => undefined);
		process.exitCode = 1;
	});
