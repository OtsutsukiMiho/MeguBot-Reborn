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
const { renderEvidenceCard } = require('../adapters/payment-evidence-card.js');

const created = { users: [], activities: [] };
let ok = 0;
function pass(m) {
	ok++;
	console.log(`  ok  ${m}`);
}

function makeApp(sessionFor, deps = {}) {
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
	app.use('/api/megu', meguApi.router({ botPresence: async () => [], ...deps }));
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

function field(id, value) {
	return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

function bankSlip(bank, ref) {
	const inner = field('00', '000001') + field('01', bank) + field('02', ref);
	const body = `${field('00', inner)}9104`;
	return `${body}${core.promptpay.crc16(body)}`;
}

function exactSlipBody(ref, amountSatang, { qr = true } = {}) {
	const fixture = Buffer.from(JSON.stringify({ ref, amountSatang, qr }));
	return {
		dataUrl: `data:image/png;base64,${fixture.toString('base64')}`,
		// Deliberately forged client readings. The HTTP adapter must ignore every
		// one and use only what its server-side pixel reader returns below.
		qrPayload: bankSlip('999', 'CALLER-FORGED'),
		readAmountSatang: 1,
		readWhen: '2099-01-01 00:00',
		sender: { name: 'ผู้ส่งปลอม', accountTail: '9999' },
		receiver: { name: 'ผู้รับปลอม', accountTail: '9999' },
	};
}

async function readTestPaymentSlip(image) {
	let fixture;
	try {
		fixture = JSON.parse(image.toString('utf8'));
	}
	catch {
		const error = new Error('slip_unreadable');
		error.code = 'slip_unreadable';
		throw error;
	}
	const qrPayload = fixture.qr ? bankSlip('006', fixture.ref) : null;
	const slip = qrPayload ? core.slip.readSlipQr(qrPayload) : null;
	const read = {
		amountSatang: fixture.amountSatang,
		when: { year: 2026, month: 8, day: 1, hour: 10, minute: 30 },
		parties: {
			sender: { name: 'บุคคลอื่น โอนแทนโอม', accountTail: '00001234' },
			receiver: { name: 'Megu S.', accountTail: '00005678' },
		},
	};
	return {
		qrPayload,
		slip,
		read,
		evidenceImage: slip ? await renderEvidenceCard(slip, read) : null,
	};
}

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
	const notices = [];

	const app = makeApp(() => sessions[whoAmI] || {}, {
		notifyPayment: async notice => notices.push(notice),
		readPaymentSlip: readTestPaymentSlip,
	});
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

	// The organizer explicitly includes the whole roster — ฿300 three ways.
	// RSVP and the money split are separate decisions.
	r = await owner('POST', `/api/megu/a/${code}/expenses`, {
		label: 'Court', amountBaht: 300, paidBy: meRow.id,
		shareParticipantIds: roster.map(p => p.id),
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
	r = await ohm('POST', `/api/megu/a/${code}/payments/${paymentId}/slip`, exactSlipBody('TXN-0001', 10000));
	assert.strictEqual(r.status, 200);
	assert.strictEqual(r.body.verdict, 'matched');
	assert.strictEqual(r.body.autoConfirmed, true);
	assert.strictEqual(notices.length, 1);
	assert.ok(notices[0].message.includes('ลงยอดให้อัตโนมัติแล้ว'));
	pass('server ignored forged browser fields, re-read the uploaded pixels, and auto-confirmed the real values');

	r = await ohm('GET', `/api/megu/a/${code}`);
	const withSlip = r.body.activity.payments.find(p => p.id === paymentId);
	assert.strictEqual(withSlip.hasSlip, true);
	assert.strictEqual(withSlip.slipVerdict, 'matched');
	assert.strictEqual(withSlip.status, 'confirmed');
	assert.strictEqual(withSlip.verificationLevel, 'slip_matched');
	assert.strictEqual(withSlip.slipAmountSatang, 10000);
	assert.strictEqual(withSlip.slipWhen, '2026-08-01 10:30');
	assert.strictEqual(withSlip.slipReceiverName, 'Megu S.');
	assert.strictEqual(withSlip.slipReceiverAccountTail, '5678');
	assert.strictEqual(withSlip.slipImage, undefined);
	pass('the activity exposes the decision level without carrying either private image in JSON');

	r = await ohm('GET', `/api/megu/a/${code}/payments/${paymentId}/slip`);
	assert.strictEqual(r.status, 200);
	assert.ok(r.type.includes('image/'));
	assert.ok(r.body.length > 1000, 'server-rendered evidence must replace the caller-provided one-pixel image');
	pass('the payer opens a server-rendered evidence card, not a caller-supplied image masquerading as one');

	whoAmI = 'owner';
	r = await owner('GET', `/api/megu/a/${code}/payments/${paymentId}/slip`);
	assert.strictEqual(r.status, 200);
	pass('the person being paid can open the sanitized evidence card');

	whoAmI = 'anon';
	r = await stranger('GET', `/api/megu/a/${code}/payments/${paymentId}/slip`);
	assert.strictEqual(r.status, 403);
	pass('nobody else can — a bank document is not roster-wide reading');

	// ── the same slip twice ────────────────────────────────────────────────

	whoAmI = 'owner';
	r = await owner('POST', `/api/megu/a/${code}/expenses`, {
		label: 'Shuttlecocks', amountBaht: 90, paidBy: meRow.id,
		shareParticipantIds: roster.map(p => p.id),
	});
	assert.strictEqual(r.status, 200);

	whoAmI = 'anon';
	r = await ohm('POST', `/api/megu/a/${code}/pay`);
	const secondClaim = r.body.paymentId;
	assert.ok(secondClaim && secondClaim !== paymentId);

	r = await ohm('POST', `/api/megu/a/${code}/payments/${secondClaim}/slip`, exactSlipBody('TXN-0001', 3000));
	assert.strictEqual(r.status, 409);
	assert.strictEqual(r.body.code, 'slip_duplicate');
	pass('the same transaction reference cannot be spent on a second payment');

	r = await ohm('POST', `/api/megu/a/${code}/payments/${secondClaim}/slip`, exactSlipBody('TXN-0002', 3000));
	assert.strictEqual(r.status, 200);
	pass('a different reference on the same image is fine — people do pay twice');

	// A claim for another expense gives us a pending row on which to test an
	// unread slip. No QR means it cannot auto-confirm, even if the caller sends
	// a made-up `ref` field beside it.
	whoAmI = 'owner';
	r = await owner('POST', `/api/megu/a/${code}/expenses`, {
		label: 'Drinks', amountBaht: 60, paidBy: meRow.id,
		shareParticipantIds: roster.map(p => p.id),
	});
	assert.strictEqual(r.status, 200);
	whoAmI = 'anon';
	r = await ohm('POST', `/api/megu/a/${code}/pay`);
	const unreadClaim = r.body.paymentId;
	r = await ohm('POST', `/api/megu/a/${code}/payments/${unreadClaim}/slip`, {
		...exactSlipBody('INVENTED-BUT-IGNORED', 2000, { qr: false }),
		ref: 'INVENTED-BUT-IGNORED',
	});
	assert.strictEqual(r.status, 200);
	assert.strictEqual(r.body.verdict, 'unread');
	assert.strictEqual(r.body.autoConfirmed, false);
	pass('a slip with no valid QR is accepted for review but a caller-invented reference cannot confirm it');

	r = await ohm('POST', `/api/megu/a/${code}/payments/${unreadClaim}/slip`, { dataUrl: 'not-an-image' });
	assert.strictEqual(r.status, 400);
	assert.strictEqual(r.body.code, 'slip_unreadable');
	pass('something that is not an image at all is refused');

	r = await ohm('POST', `/api/megu/a/${code}/payments/${unreadClaim}/slip`, {
		dataUrl: `data:image/png;base64,${Buffer.from('forged image header').toString('base64')}`,
	});
	assert.strictEqual(r.status, 400);
	assert.strictEqual(r.body.code, 'slip_unreadable');
	pass('an image MIME header cannot smuggle non-image bytes into temporary evidence');

	// Link the participant to Discord before owner decisions. A device-only
	// payer still sees the reason in the web ledger; a linked payer must also
	// receive the private notification promised by the payment flow.
	await core.db.query('UPDATE participants SET discord_uid = $2 WHERE id = $1', [ohmRow.id, '__pay_ohm__']);
	const noticesBeforeDecisions = notices.length;

	whoAmI = 'owner';
	r = await owner('POST', `/api/megu/a/${code}/payments/${paymentId}/undo`);
	assert.strictEqual(r.status, 400);
	assert.strictEqual(r.body.code, 'reversal_reason_required');
	r = await owner('POST', `/api/megu/a/${code}/payments/${paymentId}/undo`, {
		reason: 'ตรวจบัญชีธนาคารแล้วไม่พบยอดเข้า',
	});
	assert.strictEqual(r.status, 200);
	assert.strictEqual(r.body.activity.payments.find(p => p.id === paymentId).status, 'reversed');
	assert.strictEqual(notices.length, noticesBeforeDecisions + 1);
	assert.deepStrictEqual(notices.at(-1).recipients, ['__pay_ohm__']);
	assert.ok(notices.at(-1).message.includes('ตรวจบัญชีธนาคารแล้วไม่พบยอดเข้า'));
	pass('owner can reverse an automatic confirmation only with a reason visible in the ledger');

	r = await owner('POST', `/api/megu/a/${code}/payments/${unreadClaim}/reject`);
	assert.strictEqual(r.status, 400);
	assert.strictEqual(r.body.code, 'rejection_reason_required');
	r = await owner('POST', `/api/megu/a/${code}/payments/${unreadClaim}/reject`, {
		reason: 'ภาพไม่มี QR ธุรกรรมให้อ้างอิง',
	});
	assert.strictEqual(r.status, 200);
	assert.strictEqual(r.body.activity.payments.find(p => p.id === unreadClaim).status, 'rejected');
	assert.deepStrictEqual(notices.at(-1).recipients, ['__pay_ohm__']);
	assert.ok(notices.at(-1).message.includes('ภาพไม่มี QR ธุรกรรมให้อ้างอิง'));
	pass('rejecting a pending claim also requires a reason');

	whoAmI = 'anon';
	r = await ohm('POST', `/api/megu/a/${code}/payments/manual`, {
		participantId: ohmRow.id, amountSatang: 1000,
	});
	assert.strictEqual(r.status, 401);
	whoAmI = 'owner';
	r = await owner('POST', `/api/megu/a/${code}/payments/manual`, {
		participantId: ohmRow.id,
		amountSatang: 1000,
		reason: 'รับเงินสดต่อหน้าแล้ว',
	});
	assert.strictEqual(r.status, 200);
	const cash = r.body.activity.payments.find(p => p.method === 'cash');
	assert.strictEqual(cash.status, 'confirmed');
	assert.strictEqual(cash.confirmationSource, 'owner_cash');
	assert.strictEqual(cash.verificationLevel, 'owner_confirmed');
	assert.strictEqual(cash.hasSlip, false);
	pass('only the owner can record cash; it confirms under the owner without inventing slip evidence');

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
