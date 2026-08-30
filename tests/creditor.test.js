require('dotenv').config();
const assert = require('node:assert');
const core = require('../core/index.js');
const { inferCreditor, main: backfill } = require('../scripts/backfill-payment-creditor.js');

// The creditor column, against a real database.
//
// `obligations.test.js` proves the arithmetic; this proves the parts of it that
// only a database can be wrong about — that the column round-trips, that a
// creditor from another activity is refused rather than written, that removing
// somebody who has been paid is refused rather than silently repointing money,
// and that a payment written before the column existed still reads correctly.

const { users, activities, money, db } = core;
const created = { users: [] };
let n = 0;
function ok(msg) {
	n++;
	console.log(`  ok  ${msg}`);
}

function pairOf(sum, debtorId, creditorId) {
	return sum.obligations.find(o => o.debtorId === debtorId && o.creditorId === creditorId) || null;
}

async function main() {
	await core.initCoreSchema();

	const megu = await users.loginWithIdentity({
		provider: 'discord', providerUid: '__cred_megu__', username: 'megu', displayName: 'เม',
	});
	created.users.push(megu.user.id);

	const act = await activities.createActivity({
		ownerUserId: megu.user.id,
		title: 'ทริปญี่ปุ่น',
		participants: [
			{ displayName: 'เม', userId: megu.user.id },
			{ displayName: 'นิค' },
			{ displayName: 'ฟิก' },
		],
	});
	let full = await activities.getActivity(act.id);
	const P = Object.fromEntries(full.participants.map(p => [p.displayName, p.id]));

	// เม fronts dinner, ฟิก fronts the taxi. This is the shape the single-payee
	// model could not describe, and every assertion below depends on it.
	await activities.addExpense(act.id, {
		label: 'ข้าวเย็น',
		amountSatang: money.toSatang(600),
		paidBy: P['เม'],
		shareParticipantIds: [P['เม'], P['นิค'], P['ฟิก']],
	});
	await activities.addExpense(act.id, {
		label: 'แท็กซี่',
		amountSatang: money.toSatang(300),
		paidBy: P['ฟิก'],
		shareParticipantIds: [P['เม'], P['นิค'], P['ฟิก']],
	});
	full = await activities.getActivity(act.id);

	console.log('\ntwo people fronted money');

	let sum = activities.settlement(full);
	assert.strictEqual(pairOf(sum, P['นิค'], P['เม']).outstandingSatang, 20000);
	assert.strictEqual(pairOf(sum, P['นิค'], P['ฟิก']).outstandingSatang, 10000);
	assert.strictEqual(pairOf(sum, P['ฟิก'], P['เม']).outstandingSatang, 10000);
	ok('นิค owes two people, and เม owes ฟิก for the taxi');

	assert.strictEqual(sum.hasLegacyPayments, false);
	ok('a fresh activity has nothing to reconstruct');

	console.log('\nrecording who the money went to');

	const paid = await activities.recordPayment(act.id, P['นิค'], {
		amountSatang: 20000,
		creditorParticipantId: P['เม'],
		method: 'promptpay',
	});
	assert.strictEqual(paid.creditorParticipantId, P['เม']);

	full = await activities.getActivity(act.id);
	const stored = full.payments.find(p => p.id === paid.id);
	assert.strictEqual(stored.creditorParticipantId, P['เม']);
	ok('the creditor is written and read back');

	const createdEvent = stored.events.find(e => e.type === 'created');
	assert.strictEqual(createdEvent.metadata.creditorParticipantId, P['เม']);
	ok('the created event records it too, so history explains itself');

	sum = activities.settlement(full);
	assert.strictEqual(pairOf(sum, P['นิค'], P['เม']).pendingSatang, 20000);
	assert.strictEqual(pairOf(sum, P['นิค'], P['เม']).outstandingSatang, 20000);
	assert.strictEqual(pairOf(sum, P['นิค'], P['ฟิก']).outstandingSatang, 10000);
	ok('a claim awaiting review is shown against the right pair and pays nothing down');

	await activities.confirmPayment(paid.id, megu.user.id);
	full = await activities.getActivity(act.id);
	sum = activities.settlement(full);
	assert.strictEqual(pairOf(sum, P['นิค'], P['เม']).outstandingSatang, 0);
	assert.strictEqual(pairOf(sum, P['นิค'], P['ฟิก']).outstandingSatang, 10000);
	ok('confirming it settles เม only — ฟิก is still owed ฿100');

	// The figure every existing screen reads must move exactly as it always did.
	const nick = sum.rows.find(r => r.participantId === P['นิค']);
	assert.strictEqual(nick.outstanding, 10000);
	assert.strictEqual(nick.owesTotal, 10000);
	ok('the roster line and the pairs agree');

	console.log('\nrefusals');

	await assert.rejects(
		() => activities.recordPayment(act.id, P['นิค'], { amountSatang: 100, creditorParticipantId: P['นิค'] }),
		error => error.code === 'cannot_pay_yourself',
	);
	ok('paying yourself is refused');

	await assert.rejects(
		() => activities.recordPayment(act.id, P['นิค'], { amountSatang: 100, creditorParticipantId: 'par_from_elsewhere' }),
		error => error.code === 'creditor_not_in_activity',
	);
	ok('a creditor from another activity is refused, with a code rather than a foreign key error');

	// Somebody added after the expenses were split, so they hold no shares and
	// fronted nothing. Without that, `เม` would trip the older `paid_out` guard
	// first and this would pass without ever reaching the new one.
	const late = await activities.addParticipant(act.id, { displayName: 'ต้น' });
	assert.strictEqual(await activities.removeParticipant(late.id), true);
	ok('the guard only catches people with money attached — a clean row still comes off');

	const paidByMistake = await activities.addParticipant(act.id, { displayName: 'ต้น' });
	await activities.recordPayment(act.id, P['นิค'], {
		amountSatang: 5000,
		creditorParticipantId: paidByMistake.id,
	});
	await assert.rejects(
		() => activities.removeParticipant(paidByMistake.id),
		error => error.code === 'participant_is_creditor',
	);
	ok('somebody money was sent to cannot be removed, even with no expenses of their own');

	console.log('\npayments written before the column existed');

	// Written straight to SQL because `recordPayment` can no longer produce one:
	// this is what the table looked like yesterday, and it has to keep reading
	// correctly today.
	const legacyId = core.ids.newId('pay');
	await db.query(
		`INSERT INTO payments (id, activity_id, participant_id, amount_satang, method, status, confirmed_at, confirmed_by)
		 VALUES ($1, $2, $3, $4, 'promptpay', 'confirmed', now(), $5)`,
		[legacyId, act.id, P['ฟิก'], 10000, megu.user.id],
	);
	full = await activities.getActivity(act.id);
	assert.strictEqual(full.payments.find(p => p.id === legacyId).creditorParticipantId, null);

	sum = activities.settlement(full);
	assert.strictEqual(sum.hasLegacyPayments, true);
	assert.strictEqual(pairOf(sum, P['ฟิก'], P['เม']).outstandingSatang, 0);
	assert.strictEqual(pairOf(sum, P['ฟิก'], P['เม']).estimated, true);
	ok('a creditor-less payment is placed on the debt it must have been for, and flagged as a reconstruction');

	// And here is the whole argument for the column, in one roster line.
	//
	// ฟิก is square on `net`: ฿300 of shares against ฿300 of taxi fronted. But
	// square overall is not the same as owing nobody — ฟิก owes เม ฿100 for
	// dinner and นิค owes ฟิก ฿100 for the taxi, and paying that ฿100 to เม is
	// the correct thing to have done. The single balance cannot tell those two
	// situations apart, so it now reads ฿100 overpaid; the pairs say exactly
	// what happened and what is still outstanding.
	const fig = sum.rows.find(r => r.participantId === P['ฟิก']);
	assert.strictEqual(fig.net, 0);
	assert.strictEqual(fig.outstanding, -10000);
	assert.strictEqual(fig.owesTotal, 0);
	assert.strictEqual(fig.owedTotal, 10000);
	assert.strictEqual(pairOf(sum, P['นิค'], P['ฟิก']).outstandingSatang, 10000);
	ok('a net of zero hid a real ฿100 each way — the pairs separate them, the balance never could');

	console.log('\nthe backfill decides on evidence, then on assumption');

	const roster = [
		{ id: P['เม'], display_name: 'เม', user_id: megu.user.id, promptpay_id: '0812345678', promptpay_name: 'Teerapab B' },
		{ id: P['ฟิก'], display_name: 'ฟิก', user_id: null, promptpay_id: null, promptpay_name: null },
		{ id: P['นิค'], display_name: 'นิค', user_id: null, promptpay_id: null, promptpay_name: null },
	];
	const context = { roster, payeeParticipantId: P['ฟิก'], ownerUserId: megu.user.id };

	const byTarget = inferCreditor(
		{ participant_id: P['นิค'], promptpay_target: '081-234-5678', payment_destination: null },
		context,
	);
	assert.strictEqual(byTarget.participantId, P['เม']);
	assert.strictEqual(byTarget.basis, 'promptpay_target');
	ok('the number the payer was actually shown wins over the activity payee');

	const byName = inferCreditor(
		{ participant_id: P['นิค'], promptpay_target: null, payment_destination: { accountName: 'teerapab b' } },
		context,
	);
	assert.strictEqual(byName.participantId, P['เม']);
	assert.strictEqual(byName.basis, 'account_name');
	ok('a frozen account name matches its owner regardless of case');

	const byPayee = inferCreditor(
		{ participant_id: P['นิค'], promptpay_target: null, payment_destination: null },
		context,
	);
	assert.strictEqual(byPayee.participantId, P['ฟิก']);
	assert.strictEqual(byPayee.basis, 'activity_payee');
	ok('with no evidence on the row it falls back to who the activity named');

	const selfPay = inferCreditor(
		{ participant_id: P['ฟิก'], promptpay_target: null, payment_destination: null },
		context,
	);
	assert.strictEqual(selfPay.participantId, P['เม']);
	assert.strictEqual(selfPay.basis, 'owner_row');
	ok('it never names the payer as their own creditor — it moves down the list instead');

	const ambiguous = inferCreditor(
		{ participant_id: P['นิค'], promptpay_target: null, payment_destination: { accountName: 'ฟิก' } },
		{ ...context, roster: [...roster, { id: 'par_other_fig', display_name: 'ฟิก', user_id: null }] },
	);
	assert.strictEqual(ambiguous.basis, 'activity_payee');
	ok('a name matching two people is not a match — it falls through rather than guessing');

	const nothing = inferCreditor(
		{ participant_id: P['นิค'], promptpay_target: null, payment_destination: null },
		{ roster, payeeParticipantId: null, ownerUserId: 'usr_nobody_here' },
	);
	assert.strictEqual(nothing, null);
	ok('with nothing to go on it returns nothing, and the row keeps its NULL');

	console.log('\nthe backfill, actually writing');

	// The legacy row inserted above is still sitting there with a NULL creditor,
	// and the activity names เม as owner with no explicit payee — so `owner_row`
	// is the basis this one should land on.
	const dry = await backfill({ quiet: true });
	assert.ok(dry.pending >= 1, 'the legacy payment is picked up');
	assert.strictEqual(dry.written, false);

	const stillNull = await db.query('SELECT creditor_participant_id FROM payments WHERE id = $1', [legacyId]);
	assert.strictEqual(stillNull.rows[0].creditor_participant_id, null);
	ok('a dry run reports what it would do and writes nothing');

	const applied = await backfill({ commit: true, quiet: true });
	assert.strictEqual(applied.written, true);

	const placed = await db.query('SELECT creditor_participant_id FROM payments WHERE id = $1', [legacyId]);
	assert.strictEqual(placed.rows[0].creditor_participant_id, P['เม']);
	ok('committing places the payment on the creditor it inferred');

	const trail = await db.query(
		"SELECT reason, metadata FROM payment_events WHERE payment_id = $1 AND event_type = 'creditor_backfilled'",
		[legacyId],
	);
	assert.strictEqual(trail.rows.length, 1);
	assert.strictEqual(trail.rows[0].metadata.basis, 'owner_row');
	assert.strictEqual(trail.rows[0].metadata.confidence, 'low');
	assert.strictEqual(trail.rows[0].metadata.creditorParticipantId, P['เม']);
	ok('and leaves an event saying which basis it used and how much to trust it');

	full = await activities.getActivity(act.id);
	sum = activities.settlement(full);
	assert.strictEqual(sum.hasLegacyPayments, false);
	assert.strictEqual(pairOf(sum, P['ฟิก'], P['เม']).estimated, false);
	assert.strictEqual(pairOf(sum, P['ฟิก'], P['เม']).outstandingSatang, 0);
	ok('afterwards nothing is a reconstruction any more, and the figure is unchanged');

	const again = await backfill({ commit: true, quiet: true });
	assert.strictEqual(again.pending, 0);
	ok('running it twice is a no-op — there is nothing left with a NULL creditor');
}

async function cleanup() {
	await db.query('DELETE FROM activities WHERE owner_user_id = ANY($1::text[])', [created.users]).catch(() => undefined);
	for (const id of created.users) {
		await db.query('DELETE FROM users WHERE id = $1', [id]).catch(() => undefined);
	}
}

main()
	.then(cleanup)
	.then(() => db.close())
	.then(() => console.log(`\n${n} checks passed\n`))
	.catch(async (err) => {
		console.error('\nFAILED:', err.message, '\n', err.stack);
		await cleanup().catch(() => undefined);
		await db.close().catch(() => undefined);
		process.exitCode = 1;
	});
