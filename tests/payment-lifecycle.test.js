require('dotenv').config();
const assert = require('node:assert');
const core = require('../core/index.js');

const created = { users: [], activities: [] };
let checks = 0;
function ok(message) {
	checks++;
	console.log(`  ok  ${message}`);
}

async function main() {
	await core.initCoreSchema();
	const ownerLogin = await core.users.loginWithIdentity({
		provider: 'discord',
		providerUid: '__payment_lifecycle_owner__',
		username: 'ledger-owner',
		displayName: 'นาย บี เจ้าหนี้',
	});
	created.users.push(ownerLogin.user.id);
	await core.users.setPromptPay(ownerLogin.user.id, {
		promptpayId: '081-234-5678',
		promptpayName: 'นาย บี เจ้าหนี้',
	});

	const activity = await core.activities.createActivity({
		ownerUserId: ownerLogin.user.id,
		title: 'ค่าสมาชิกรายเดือน',
		kind: 'recurring',
		recurrence: 'monthly',
		dueDay: 5,
		participants: [
			{ displayName: 'บี', userId: ownerLogin.user.id },
			{ displayName: 'เอ', discordUid: '__payment_lifecycle_debtor__' },
		],
	});
	created.activities.push(activity.id);

	let full = await core.activities.getActivity(activity.id);
	const owner = full.participants.find(participant => participant.userId === ownerLogin.user.id);
	const debtor = full.participants.find(participant => participant.id !== owner.id);
	const periodDates = ['2026-03-05', '2026-04-05', '2026-05-05', '2026-06-05', '2026-07-05'];
	const periods = [];
	for (const date of periodDates) {
		const ensured = await core.activities.ensurePeriod(activity.id, new Date(`${date}T00:00:00+07:00`));
		periods.push(ensured.period);
		await core.activities.addExpense(activity.id, {
			label: 'ค่าสมาชิกรายเดือน',
			amountSatang: 4000,
			paidBy: owner.id,
			periodId: ensured.period.id,
		});
	}
	const discordCandidates = await core.activities.listPaymentCandidatesForDiscord(
		'__payment_lifecycle_debtor__',
		'discord-guild-for-test',
	);
	assert.strictEqual(discordCandidates.length, 1);
	assert.strictEqual(discordCandidates[0].outstandingSatang, 10000);
	assert.deepStrictEqual(discordCandidates[0].periods.map(period => period.key).sort(), [
		'2026-03', '2026-04', '2026-05', '2026-06', '2026-07',
	]);
	ok('/pay finds only the linked debtor’s outstanding periods');

	const allocations = periods.map(period => ({ periodId: period.id, amountSatang: 2000 }));
	const transfer = await core.activities.recordPayment(activity.id, debtor.id, {
		amountSatang: 10000,
		method: 'bank_transfer',
		expectedSatang: 10000,
		promptpayTarget: '081-234-5678',
		allocations,
	});
	assert.deepStrictEqual(transfer.allocations, allocations);
	ok('one transfer is allocated across five monthly periods');

	full = await core.activities.getActivity(activity.id);
	for (const period of periods) {
		const row = core.activities.settlement(full, period.id).rows.find(item => item.participantId === debtor.id);
		assert.strictEqual(row.outstanding, 2000);
		assert.strictEqual(row.pending, 2000);
	}
	ok('pending allocations appear in every affected month without settling them');

	const attached = await core.activities.attachSlip(transfer.id, {
		image: Buffer.from('temporary original'),
		mime: 'image/jpeg',
		ref: `LIFECYCLE-${Date.now()}`,
		bank: 'KTB',
		amountSatang: 10000,
		when: '2026-03-05 10:30',
		receiverName: 'บี เจ้าหนี้',
		receiverAccountTail: '00002304',
		expectedReceiverName: 'นาย บี เจ้าหนี้',
	});
	assert.strictEqual(attached.autoConfirmed, true);
	assert.ok(attached.flags.includes('uploaded_late'));
	ok('a five-month-old exact slip auto-confirms and is only flagged as late');

	const privateRow = await core.db.query(
		`SELECT slip_image, evidence_image, slip_sender_account_tail, slip_receiver_account_tail,
		        confirmation_source, verification_level
		 FROM payments WHERE id = $1`,
		[transfer.id],
	);
	assert.strictEqual(privateRow.rows[0].slip_image, null);
	assert.strictEqual(privateRow.rows[0].evidence_image, null, 'no card is stored; it is drawn when asked for');
	assert.strictEqual(privateRow.rows[0].slip_sender_account_tail, null, 'the sender account digits are not kept');
	assert.strictEqual(privateRow.rows[0].slip_receiver_account_tail, '2304');
	assert.strictEqual(privateRow.rows[0].confirmation_source, 'system_slip_match');
	assert.strictEqual(privateRow.rows[0].verification_level, 'slip_matched');
	const virtual = await core.activities.getSlip(transfer.id);
	assert.strictEqual(virtual.image, undefined);
	assert.deepStrictEqual(
		{ payer: virtual.evidence.payerName, amount: virtual.evidence.amountSatang, to: virtual.evidence.receiverName, when: virtual.evidence.when },
		{ payer: 'เอ', amount: 10000, to: 'บี เจ้าหนี้', when: '2026-03-05 10:30' },
	);
	ok('the raw slip is destroyed after matching; a confirmed payment has the fields of its virtual slip');

	full = await core.activities.getActivity(activity.id);
	for (const period of periods) {
		const row = core.activities.settlement(full, period.id).rows.find(item => item.participantId === debtor.id);
		assert.strictEqual(row.outstanding, 0);
	}
	ok('auto-confirmation settles all five allocations atomically');

	await assert.rejects(
		core.activities.reversePayment(transfer.id, ownerLogin.user.id, ''),
		error => error.code === 'reversal_reason_required',
	);
	await core.activities.reversePayment(transfer.id, ownerLogin.user.id, 'ไม่พบเงินเข้าบัญชีธนาคาร');
	full = await core.activities.getActivity(activity.id);
	assert.strictEqual(full.payments.find(payment => payment.id === transfer.id).status, 'reversed');
	for (const period of periods) {
		const row = core.activities.settlement(full, period.id).rows.find(item => item.participantId === debtor.id);
		assert.strictEqual(row.outstanding, 2000);
	}
	assert.strictEqual(await core.activities.getSlip(transfer.id), null, 'a reversed payment has no virtual slip');
	ok('owner reversal requires a reason, reopens every allocated month, and leaves no virtual slip');

	const marchCash = await core.activities.recordPayment(activity.id, debtor.id, {
		amountSatang: 2000,
		method: 'cash',
		periodId: periods[0].id,
		confirmation: {
			actorUserId: ownerLogin.user.id,
			source: 'owner_cash',
			verificationLevel: 'owner_confirmed',
			reason: 'รับเงินสดแล้ว',
		},
	});
	full = await core.activities.getActivity(activity.id);
	assert.strictEqual(
		core.activities.settlement(full, periods[0].id).rows.find(item => item.participantId === debtor.id).outstanding,
		0,
	);
	assert.strictEqual(full.payments.find(payment => payment.id === marchCash.id).hasSlip, false);
	ok('cash can settle without a slip only after the owner confirms it');

	const eventTypes = full.payments.find(payment => payment.id === transfer.id).events.map(event => event.type);
	assert.deepStrictEqual(eventTypes, ['created', 'slip_attached', 'auto_confirmed', 'reversed']);
	ok('creation, evidence, automatic decision and reversal remain in the audit trail');

	const staleReview = await core.activities.recordPayment(activity.id, debtor.id, {
		amountSatang: 500,
		method: 'bank_transfer',
		periodId: periods[1].id,
		expectedSatang: 500,
		promptpayTarget: '081-234-5678',
	});
	const staleAttached = await core.activities.attachSlip(staleReview.id, {
		image: Buffer.from('old temporary original'),
		mime: 'image/jpeg',
		ref: `STALE-${Date.now()}`,
		bank: 'KTB',
		amountSatang: 400,
		when: '2026-03-05 10:30',
		receiverName: 'บี เจ้าหนี้',
		receiverAccountTail: '2304',
		expectedReceiverName: 'นาย บี เจ้าหนี้',
	});
	assert.strictEqual(staleAttached.autoConfirmed, false);
	await core.db.query(
		'UPDATE payments SET slip_uploaded_at = NOW() - INTERVAL \'8 days\' WHERE id = $1',
		[staleReview.id],
	);
	await core.activities.forgetOldSlips(7);
	const retainedEvidence = await core.db.query(
		'SELECT slip_image, evidence_image FROM payments WHERE id = $1',
		[staleReview.id],
	);
	assert.strictEqual(retainedEvidence.rows[0].slip_image, null);
	assert.strictEqual(await core.activities.getSlip(staleReview.id), null, 'nothing to show until somebody confirms it');
	ok('retention removes an old pending original, and an unconfirmed payment has no virtual slip');

	// A one-off bill whose receiver has no PromptPay: the first slip waits,
	// the receiver confirms it, and the name on it is learned for the next.
	const dinner = await core.activities.createActivity({
		ownerUserId: ownerLogin.user.id,
		title: 'ข้าวเย็น',
		participants: [
			{ displayName: 'บี', userId: ownerLogin.user.id },
			{ displayName: 'เอ', discordUid: '__payment_lifecycle_debtor__' },
			{ displayName: 'ซี', discordUid: '__payment_lifecycle_third__' },
		],
	});
	created.activities.push(dinner.id);
	const dinnerFull = await core.activities.getActivity(dinner.id);
	const [, eater, third] = dinnerFull.participants;
	const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
	const slipFor = async (participant, ref, when, expectedReceiverName = null) => {
		const claim = await core.activities.recordPayment(dinner.id, participant.id, { amountSatang: 30000, method: 'bank_transfer', expectedSatang: 30000 });
		const result = await core.activities.attachSlip(claim.id, {
			image: Buffer.from('original'), mime: 'image/jpeg', ref, bank: 'KTB', amountSatang: 30000, when,
			receiverName: 'MR. BEE CREDITOR', expectedReceiverName,
		});
		return { claim, result };
	};

	const early = await slipFor(eater, `EARLY-${Date.now()}`, '2020-01-01 09:00', 'MR. BEE CREDITOR');
	assert.strictEqual(early.result.autoConfirmed, false);
	assert.ok(early.result.reasons.includes('transferred_before_bill'));
	ok('a slip dated before the bill could exist waits for the receiver, even when everything else matches');
	await core.activities.removePayment(early.claim.id);

	const first = await slipFor(eater, `FIRST-${Date.now()}`, `${today} 09:00`);
	assert.deepStrictEqual(first.result.reasons, ['receiver_not_configured']);
	await core.activities.confirmPayment(first.claim.id, ownerLogin.user.id, { source: 'owner_review' });
	const learned = await core.db.query('SELECT learned_receiver_name FROM activities WHERE id = $1', [dinner.id]);
	assert.strictEqual(learned.rows[0].learned_receiver_name, 'MR. BEE CREDITOR');
	const next = await slipFor(third, `NEXT-${Date.now()}`, `${today} 09:30`);
	assert.strictEqual(next.result.autoConfirmed, true, 'the learned name lets the next slip confirm itself');
	ok('with no PromptPay, the first confirmed slip teaches the receiver name and the next one confirms itself');

	const day = earliest => earliest.toISOString();
	assert.strictEqual(day(core.activities.earliestTransferFor({ firstPeriodKey: '2026-10' })), '2026-09-29T17:00:00.000Z', 'from the day before the month opens');
	assert.strictEqual(day(core.activities.earliestTransferFor({ createdAt: '2026-10-27T15:00:00Z' })), '2026-10-25T17:00:00.000Z', 'from the day before the bill was made, in Bangkok');
	assert.strictEqual(day(core.activities.earliestTransferFor({ createdAt: '2026-10-27T15:00:00Z', startsAt: '2026-10-20T12:00:00Z' })), '2026-10-18T17:00:00.000Z', 'or before the day it happened');
	ok('the earliest transfer date allows a day of slack before the bill or its month');
}

async function cleanup() {
	for (const activityId of created.activities) {
		await core.db.query('DELETE FROM activities WHERE id = $1', [activityId]).catch(() => undefined);
	}
	for (const userId of created.users) {
		await core.db.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => undefined);
	}
}

main()
	.then(cleanup)
	.then(() => core.db.close())
	.then(() => console.log(`\n${checks} payment lifecycle checks passed\n`))
	.catch(async (error) => {
		console.error('\nFAILED:', error.message, '\n', error.stack);
		await cleanup().catch(() => undefined);
		await core.db.close().catch(() => undefined);
		process.exitCode = 1;
	});
