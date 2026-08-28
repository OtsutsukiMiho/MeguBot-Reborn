// Who owes whom — the arithmetic only, against literals.
//
// No database on purpose. `settlement()` and everything under it are pure
// functions over an activity shape, and the cases worth being sure about are
// cases about money rather than about storage: two people fronting cash, a
// late joiner, a payment sent to the wrong person. Each of those is three
// lines of literal here and a fixture with a schema behind it anywhere else.

const assert = require('node:assert');
const activities = require('../core/activities.js');
const { pairwiseObligations, rawObligations } = require('../core/obligations.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

const MEGU = 'par_megu';
const NICK = 'par_nick';
const FIG = 'par_fig';

const PEOPLE = [
	{ id: MEGU, displayName: 'เม' },
	{ id: NICK, displayName: 'นิค' },
	{ id: FIG, displayName: 'ฟิก' },
];

/**
 * An expense plus its even split, in the shape `loadActivity` produces.
 *
 * `periodId` defaults to null so a one-off activity reads the way the database
 * writes it, and the recurring cases below pass one explicitly.
 */
function expense(id, amountSatang, paidBy, sharers, periodId = null) {
	const each = amountSatang / sharers.length;
	assert.ok(Number.isInteger(each), `${id}: split this test's amounts evenly`);
	return {
		expense: { id, periodId, label: id, amountSatang, paidBy },
		shares: sharers.map(participantId => ({
			id: `shr_${id}_${participantId}`,
			expenseId: id,
			periodId,
			participantId,
			amountSatang: each,
		})),
	};
}

function activityOf(entries, payments = [], participants = PEOPLE) {
	return {
		participants,
		expenses: entries.map(e => e.expense),
		shares: entries.flatMap(e => e.shares),
		payments,
	};
}

function pay(participantId, amountSatang, creditorParticipantId, extra = {}) {
	return {
		id: `pay_${participantId}_${amountSatang}_${creditorParticipantId || 'legacy'}`,
		participantId,
		creditorParticipantId: creditorParticipantId || null,
		amountSatang,
		status: 'confirmed',
		periodId: null,
		allocations: [],
		...extra,
	};
}

function pairOf(obligations, debtorId, creditorId) {
	return obligations.find(o => o.debtorId === debtorId && o.creditorId === creditorId) || null;
}

/**
 * The identity that has to hold whatever else changes.
 *
 * For every person: what they owe across all their pairs, minus what those
 * pairs owe them, equals the single net figure `settlement()` has always
 * reported, adjusted for money that moved in each direction. If these two ever
 * disagree the roster line and the payment screen are telling one person two
 * different things about the same debt, which is the entire failure this work
 * exists to prevent.
 */
function assertConsistent(activity, periodId = null) {
	const sum = activities.settlement(activity, periodId);
	const inScope = payment => (periodId === null
		? payment.amountSatang
		: (payment.allocations || []).filter(a => a.periodId === periodId).reduce((s, a) => s + a.amountSatang, 0)
			|| (payment.periodId === periodId ? payment.amountSatang : 0));

	for (const row of sum.rows) {
		const signed = sum.obligations.reduce((total, o) => {
			const balance = o.outstandingSatang - o.overpaidSatang;
			if (o.debtorId === row.participantId) return total + balance;
			if (o.creditorId === row.participantId) return total - balance;
			return total;
		}, 0);

		const paidOut = (activity.payments || [])
			.filter(p => p.status === 'confirmed' && p.participantId === row.participantId)
			.reduce((s, p) => s + inScope(p), 0);
		const received = (activity.payments || [])
			.filter(p => p.status === 'confirmed' && p.creditorParticipantId === row.participantId)
			.reduce((s, p) => s + inScope(p), 0);

		assert.strictEqual(
			signed,
			row.net - paidOut + received,
			`${row.displayName}: pairs say ${signed}, net says ${row.net - paidOut + received}`,
		);
	}
	return sum;
}

console.log('\none person fronting the money — nothing may change');

{
	const dinner = expense('exp_dinner', 60000, MEGU, [MEGU, NICK, FIG]);
	const activity = activityOf([dinner]);
	const sum = assertConsistent(activity);

	const by = Object.fromEntries(sum.rows.map(r => [r.participantId, r]));
	assert.strictEqual(by[NICK].outstanding, 20000);
	assert.strictEqual(by[FIG].outstanding, 20000);
	assert.strictEqual(by[MEGU].net, -40000);
	ok('the old net figures are untouched');

	assert.strictEqual(sum.obligations.length, 2);
	assert.strictEqual(pairOf(sum.obligations, NICK, MEGU).outstandingSatang, 20000);
	assert.strictEqual(pairOf(sum.obligations, FIG, MEGU).outstandingSatang, 20000);
	assert.strictEqual(pairOf(sum.obligations, MEGU, NICK), null);
	ok('two debts, both pointing at เม, and none pointing back');

	assert.strictEqual(by[MEGU].owedTotal, 40000);
	assert.strictEqual(by[NICK].owesTotal, 20000);
	ok('เม is owed ฿400 in total, นิค owes ฿200 of it');
}

console.log('\ntwo people fronting the money');

{
	// เม pays for dinner, ฟิก pays for the taxi. นิค owes both of them, and the
	// single-payee model could not say that: it reported ฿300 against whoever
	// the activity happened to name as payee.
	const dinner = expense('exp_dinner', 60000, MEGU, [MEGU, NICK, FIG]);
	const taxi = expense('exp_taxi', 30000, FIG, [MEGU, NICK, FIG]);
	const activity = activityOf([dinner, taxi]);
	const sum = assertConsistent(activity);

	assert.strictEqual(pairOf(sum.obligations, NICK, MEGU).outstandingSatang, 20000);
	assert.strictEqual(pairOf(sum.obligations, NICK, FIG).outstandingSatang, 10000);
	ok('นิค owes ฿200 to เม and ฿100 to ฟิก — two transfers, not one');

	// เม owes ฟิก ฿100 for the taxi and ฟิก owes เม ฿200 for dinner. One line
	// survives, not two people sending each other money on the same screen.
	assert.strictEqual(pairOf(sum.obligations, FIG, MEGU).outstandingSatang, 10000);
	assert.strictEqual(pairOf(sum.obligations, MEGU, FIG), null);
	ok('เม and ฟิก net against each other into one ฿100 line');

	const by = Object.fromEntries(sum.rows.map(r => [r.participantId, r]));
	assert.strictEqual(by[NICK].outstanding, 30000);
	assert.strictEqual(by[NICK].owesTotal, 30000);
	ok('the pairs still add up to the ฿300 the roster line shows');
}

console.log('\npaying the right person, and the wrong one');

{
	const dinner = expense('exp_dinner', 60000, MEGU, [MEGU, NICK, FIG]);
	const taxi = expense('exp_taxi', 30000, FIG, [MEGU, NICK, FIG]);

	const partial = assertConsistent(activityOf([dinner, taxi], [pay(NICK, 10000, MEGU)]));
	assert.strictEqual(pairOf(partial.obligations, NICK, MEGU).outstandingSatang, 10000);
	assert.strictEqual(pairOf(partial.obligations, NICK, MEGU).settledSatang, 10000);
	assert.strictEqual(pairOf(partial.obligations, NICK, FIG).outstandingSatang, 10000);
	ok('฿100 to เม pays down เม only — the debt to ฟิก does not move');

	// The case the old model got wrong. นิค sends เม the whole ฿300 because the
	// screen showed one QR. เม is ฿100 up, ฟิก is still ฿100 short, and both
	// facts have to survive.
	const misdirected = assertConsistent(activityOf([dinner, taxi], [pay(NICK, 30000, MEGU)]));
	assert.strictEqual(pairOf(misdirected.obligations, NICK, MEGU).outstandingSatang, 0);
	assert.strictEqual(pairOf(misdirected.obligations, NICK, MEGU).overpaidSatang, 10000);
	assert.strictEqual(pairOf(misdirected.obligations, NICK, FIG).outstandingSatang, 10000);
	ok('paying one person for both debts leaves ฟิก unpaid and เม ฿100 over');

	const by = Object.fromEntries(misdirected.rows.map(r => [r.participantId, r]));
	assert.strictEqual(by[NICK].overpaid, 10000);
	assert.strictEqual(by[NICK].outstanding, 0);
	ok('the roster line reports zero outstanding, and the ฿100 excess is no longer invisible');
}

console.log('\nrefunds, overpayment and partial payment');

{
	const dinner = expense('exp_dinner', 60000, MEGU, [MEGU, NICK, FIG]);

	const over = assertConsistent(activityOf([dinner], [pay(NICK, 25000, MEGU)]));
	assert.strictEqual(pairOf(over.obligations, NICK, MEGU).overpaidSatang, 5000);
	assert.strictEqual(pairOf(over.obligations, NICK, MEGU).outstandingSatang, 0);
	ok('฿250 against a ฿200 share records the real ฿250 and shows ฿50 over');

	const refunded = assertConsistent(activityOf([dinner], [
		pay(NICK, 25000, MEGU),
		pay(MEGU, 5000, NICK),
	]));
	assert.strictEqual(pairOf(refunded.obligations, NICK, MEGU).overpaidSatang, 0);
	assert.strictEqual(pairOf(refunded.obligations, NICK, MEGU).outstandingSatang, 0);
	ok('เม sending the ฿50 back closes the pair without a special case');

	const instalments = assertConsistent(activityOf([dinner], [
		pay(NICK, 5000, MEGU, { id: 'pay_a' }),
		pay(NICK, 10000, MEGU, { id: 'pay_b' }),
		pay(NICK, 5000, MEGU, { id: 'pay_c' }),
	]));
	assert.strictEqual(pairOf(instalments.obligations, NICK, MEGU).settledSatang, 20000);
	assert.strictEqual(pairOf(instalments.obligations, NICK, MEGU).outstandingSatang, 0);
	ok('three transfers settle the pair exactly, and all three still exist');
}

console.log('\na pending claim is not money');

{
	const dinner = expense('exp_dinner', 60000, MEGU, [MEGU, NICK, FIG]);
	const sum = assertConsistent(activityOf([dinner], [
		pay(NICK, 20000, MEGU, { status: 'pending' }),
	]));

	const pair = pairOf(sum.obligations, NICK, MEGU);
	assert.strictEqual(pair.outstandingSatang, 20000);
	assert.strictEqual(pair.pendingSatang, 20000);
	assert.strictEqual(pair.settledSatang, 0);
	ok('a claim waiting for review is reported, and does not pay anything down');

	for (const status of ['rejected', 'reversed', 'voided']) {
		const ignored = activities.settlement(activityOf([dinner], [pay(NICK, 20000, MEGU, { status })]));
		assert.strictEqual(pairOf(ignored.obligations, NICK, MEGU).outstandingSatang, 20000);
		assert.strictEqual(pairOf(ignored.obligations, NICK, MEGU).settledSatang, 0);
	}
	ok('rejected, reversed and voided payments count for nothing');
}

console.log('\nsomebody joins after the money moved');

{
	// เม and นิค split ฿600. นิค pays his ฿300. Then ฟิก joins and the expense
	// is reallocated three ways — which is an edit to the shares, never to the
	// payment. นิค is now ฿100 up rather than ฿300 down.
	const before = activityOf(
		[expense('exp_dinner', 60000, MEGU, [MEGU, NICK])],
		[pay(NICK, 30000, MEGU)],
		PEOPLE.filter(p => p.id !== FIG),
	);
	const settledBefore = assertConsistent(before);
	assert.strictEqual(pairOf(settledBefore.obligations, NICK, MEGU).outstandingSatang, 0);
	ok('before ฟิก arrives, นิค is square with เม');

	const after = activityOf([expense('exp_dinner', 60000, MEGU, [MEGU, NICK, FIG])], [pay(NICK, 30000, MEGU)]);
	const settledAfter = assertConsistent(after);

	assert.strictEqual(after.payments[0].amountSatang, 30000);
	ok('the ฿300 นิค already sent is still recorded at ฿300');

	assert.strictEqual(pairOf(settledAfter.obligations, NICK, MEGU).overpaidSatang, 10000);
	assert.strictEqual(pairOf(settledAfter.obligations, FIG, MEGU).outstandingSatang, 20000);
	ok('นิค is owed ฿100 back and ฟิก now owes ฿200 — no history was rewritten');
}

console.log('\nmonths stay separate');

{
	const august = expense('exp_aug', 24000, MEGU, [MEGU, NICK, FIG], 'per_aug');
	const september = expense('exp_sep', 24000, MEGU, [MEGU, NICK, FIG], 'per_sep');
	const activity = activityOf([august, september], [{
		id: 'pay_aug',
		participantId: NICK,
		creditorParticipantId: MEGU,
		amountSatang: 8000,
		status: 'confirmed',
		periodId: 'per_aug',
		allocations: [{ id: 'pal_1', periodId: 'per_aug', amountSatang: 8000 }],
	}]);

	const aug = assertConsistent(activity, 'per_aug');
	const sep = assertConsistent(activity, 'per_sep');
	assert.strictEqual(pairOf(aug.obligations, NICK, MEGU).outstandingSatang, 0);
	assert.strictEqual(pairOf(sep.obligations, NICK, MEGU).outstandingSatang, 8000);
	ok('paying August does not settle September');

	const whole = assertConsistent(activity);
	assert.strictEqual(pairOf(whole.obligations, NICK, MEGU).outstandingSatang, 8000);
	ok('across the whole agreement นิค owes one month');
}

console.log('\npayments written before the creditor column existed');

{
	const dinner = expense('exp_dinner', 60000, MEGU, [MEGU, NICK, FIG]);
	const taxi = expense('exp_taxi', 30000, FIG, [MEGU, NICK, FIG]);
	const legacy = activityOf([dinner, taxi], [pay(NICK, 20000, null)]);
	const sum = activities.settlement(legacy);

	assert.strictEqual(sum.hasLegacyPayments, true);
	ok('a confirmed payment with no creditor is reported as a reconstruction');

	// Largest debt first: the ฿200 owed to เม, not the ฿100 owed to ฟิก.
	assert.strictEqual(pairOf(sum.obligations, NICK, MEGU).outstandingSatang, 0);
	assert.strictEqual(pairOf(sum.obligations, NICK, MEGU).estimated, true);
	assert.strictEqual(pairOf(sum.obligations, NICK, FIG).outstandingSatang, 10000);
	assert.strictEqual(pairOf(sum.obligations, NICK, FIG).estimated, false);
	ok('it is spent against the largest debt first, and only that pair is marked estimated');

	const by = Object.fromEntries(sum.rows.map(r => [r.participantId, r]));
	assert.strictEqual(by[NICK].outstanding, 10000);
	ok('the roster line is exactly what it was before this change — ฿100 left');

	// Order of the payment rows must not change the answer.
	const shuffled = activityOf([taxi, dinner], [pay(NICK, 20000, null)]);
	assert.deepStrictEqual(
		activities.settlement(shuffled).obligations,
		sum.obligations,
	);
	ok('the reconstruction is deterministic, not dependent on row order');

	assert.strictEqual(activities.settlement(activityOf([dinner, taxi])).hasLegacyPayments, false);
	ok('an activity with no legacy payment says so');
}

console.log('\nedges');

{
	const empty = activities.settlement(activityOf([]));
	assert.deepStrictEqual(empty.obligations, []);
	assert.strictEqual(empty.state, 'none');
	ok('an activity with no expenses has no obligations');

	// An expense paid by somebody who is also sharing it must not owe itself.
	const solo = activityOf([expense('exp_solo', 10000, MEGU, [MEGU])]);
	assert.deepStrictEqual(activities.settlement(solo).obligations, []);
	ok('paying for yourself creates no debt');

	// Shares belonging to a participant who is no longer on the roster are
	// dropped rather than producing a pair with a missing name at one end.
	const orphan = {
		participants: [{ id: MEGU, displayName: 'เม' }],
		expenses: [{ id: 'exp_x', periodId: null, label: 'x', amountSatang: 20000, paidBy: MEGU }],
		shares: [
			{ id: 's1', expenseId: 'exp_x', periodId: null, participantId: MEGU, amountSatang: 10000 },
			{ id: 's2', expenseId: 'exp_x', periodId: null, participantId: 'par_gone', amountSatang: 10000 },
		],
		payments: [],
	};
	assert.deepStrictEqual(activities.settlement(orphan).obligations, []);
	ok('a share held by nobody on the roster does not become an obligation');

	// `rawObligations` is the unnetted view, and has to stay that way — the
	// netting above is a presentation decision and must not reach back into it.
	const both = activityOf([
		expense('exp_a', 60000, MEGU, [MEGU, NICK]),
		expense('exp_b', 20000, NICK, [MEGU, NICK]),
	]);
	const raw = rawObligations(both);
	assert.strictEqual(raw.get(`${NICK} ${MEGU}`), 30000);
	assert.strictEqual(raw.get(`${MEGU} ${NICK}`), 10000);
	ok('the raw view keeps both directions; only the netted view collapses them');

	// Called directly rather than through `settlement()`, because the module is
	// meant to stand on its own — the reminder sender will read it without an
	// activity summary in hand.
	const netted = pairwiseObligations(both);
	assert.strictEqual(netted.length, 1);
	assert.strictEqual(pairOf(netted, NICK, MEGU).outstandingSatang, 20000);
	assert.deepStrictEqual(netted, activities.settlement(both).obligations);
	ok('and the netted view is one line of ฿200, the same either way in');
}

console.log(`\n${n} checks passed\n`);
