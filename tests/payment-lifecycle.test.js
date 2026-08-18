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
	ok('/จ่าย finds only the linked debtor’s outstanding periods');

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
		evidenceImage: Buffer.from('sanitized evidence card'),
		evidenceMime: 'image/png',
		evidenceHash: 'test-evidence-hash',
		ref: `LIFECYCLE-${Date.now()}`,
		bank: 'KTB',
		amountSatang: 10000,
		when: '2026-03-05 10:30',
		senderName: 'บุคคลที่สาม ผู้โอนแทน',
		receiverName: 'บี เจ้าหนี้',
		senderAccountTail: '1234567890',
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
	assert.ok(privateRow.rows[0].evidence_image);
	assert.strictEqual(privateRow.rows[0].slip_sender_account_tail, '7890');
	assert.strictEqual(privateRow.rows[0].slip_receiver_account_tail, '2304');
	assert.strictEqual(privateRow.rows[0].confirmation_source, 'system_slip_match');
	assert.strictEqual(privateRow.rows[0].verification_level, 'slip_matched');
	ok('the raw slip is destroyed after matching; only the evidence card and last four digits remain');

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
	ok('owner reversal requires a reason and reopens every allocated month');

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
		evidenceImage: Buffer.from('old sanitized evidence card'),
		evidenceMime: 'image/png',
		evidenceHash: 'old-test-evidence-hash',
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
	assert.ok(retainedEvidence.rows[0].evidence_image);
	ok('retention removes an old pending original while preserving sanitized evidence');
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
