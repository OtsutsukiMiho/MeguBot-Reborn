// Who owes whom, derived from the expenses themselves.
//
// `settlement()` in activities.js answers "how much is this person up or down
// overall", which is the right number for a roster line and the wrong one the
// moment two people front money. Three friends, dinner paid by Megu and a taxi
// paid by Fig, and Nick's honest position is not "฿300 owed" — it is ฿200 to
// Megu and ฿100 to Fig, two transfers to two banks. A single net figure cannot
// say that, and the payment screen was quietly assuming there was only ever one
// person collecting.
//
// Nothing here is stored. A pair is recomputed from `expenses` and `shares`
// every time, for the same reason the money state is: a stored obligation is a
// second copy of the truth that starts drifting the moment an expense is
// corrected or somebody joins late. Late joins are the case that settles the
// argument — reallocating an expense changes what Nick owes without touching
// the ฿300 he already sent, and that only works if the debt is derived and the
// payment is recorded.
//
// Deliberately free of the database and of React, like money.js and format.js,
// so the arithmetic can be tested against literals.

// ── scope ────────────────────────────────────────────────────────────────────

/**
 * The expenses this scope covers, keyed by id.
 *
 * Shares are matched by expense rather than by their own `periodId`, which is a
 * denormalised copy carried along by the join in `loadActivity`. Both agree in
 * the database; only one of them is the fact, and a test literal built by hand
 * will have the expense and not the copy.
 */
function expensesInScope(activity, periodId) {
	const map = new Map();
	for (const expense of activity.expenses || []) {
		if (periodId !== null && expense.periodId !== periodId) continue;
		map.set(expense.id, expense);
	}
	return map;
}

/**
 * How much of one payment belongs to this scope.
 *
 * Mirrors `settlement()` exactly, including its fallback: rows written before
 * `payment_allocations` existed carry a bare `periodId` and no allocation, and
 * they must keep counting.
 */
function paymentAmountInScope(payment, periodId) {
	if (periodId === null) return payment.amountSatang;
	if (Array.isArray(payment.allocations) && payment.allocations.length > 0) {
		return payment.allocations
			.filter(allocation => allocation.periodId === periodId)
			.reduce((sum, allocation) => sum + allocation.amountSatang, 0);
	}
	return payment.periodId === periodId ? payment.amountSatang : 0;
}

// ── raw debt ─────────────────────────────────────────────────────────────────

const pairKey = (debtorId, creditorId) => `${debtorId} ${creditorId}`;

/**
 * Every debt exactly as the expenses state it, before any netting.
 *
 * One rule: a share belongs to whoever paid the expense it sits on, except the
 * payer's own share, which is money they already handed over to themselves.
 *
 * Returns a Map keyed `debtor creditor` → satang. Kept separate from the
 * netting below so that the raw history has one home and the decision to net
 * has another — a debt simplification that collapses chains of people would go
 * next to `pairwiseObligations`, and must never reach back into here.
 */
function rawObligations(activity, periodId = null) {
	const expenses = expensesInScope(activity, periodId);
	const raw = new Map();

	for (const share of activity.shares || []) {
		const expense = expenses.get(share.expenseId);
		if (!expense) continue;
		if (share.participantId === expense.paidBy) continue;
		if (share.amountSatang <= 0) continue;

		const key = pairKey(share.participantId, expense.paidBy);
		raw.set(key, (raw.get(key) || 0) + share.amountSatang);
	}
	return raw;
}

// ── payments, attributed ─────────────────────────────────────────────────────

/**
 * Confirmed and pending money, per ordered pair.
 *
 * Money moving from B to A counts against A's debt to B, which reads backwards
 * until you try it on a refund: Nick overpays Megu by ฿50, the pair sits at
 * −฿50, Megu sends ฿50 back, the pair lands on zero. One rule covers both
 * directions and neither needs a special case.
 *
 * Payments with no creditor are the ones written before that column existed.
 * They are returned separately rather than guessed at here.
 */
function attributePayments(activity, periodId, counted) {
	const settled = new Map();
	const pending = new Map();
	const legacy = new Map();

	for (const payment of activity.payments || []) {
		if (payment.status !== 'confirmed' && payment.status !== 'pending') continue;
		const amount = paymentAmountInScope(payment, periodId);
		if (amount <= 0) continue;
		if (!counted.has(payment.participantId)) continue;

		const creditorId = payment.creditorParticipantId || null;
		if (!creditorId) {
			// A pending claim with no creditor cannot be placed against anyone,
			// and guessing at one would show somebody a debt as half-paid on the
			// strength of a claim nobody has checked.
			if (payment.status !== 'confirmed') continue;
			legacy.set(payment.participantId, (legacy.get(payment.participantId) || 0) + amount);
			continue;
		}
		if (!counted.has(creditorId)) continue;

		const target = payment.status === 'confirmed' ? settled : pending;
		const key = pairKey(payment.participantId, creditorId);
		target.set(key, (target.get(key) || 0) + amount);
	}
	return { settled, pending, legacy };
}

/**
 * Spend one payer's unattributed money across the debts they actually hold.
 *
 * Largest debt first, ties broken by creditor id, so the same ledger always
 * produces the same answer rather than drifting with row order. Anything left
 * over after every debt is covered lands on the largest, where it shows up as
 * an overpayment instead of disappearing.
 *
 * This is a guess and is labelled as one: every pair it touches comes back
 * `estimated`, and the caller reports `hasLegacyPayments` so a screen can say
 * the figure is a reconstruction. The backfill exists to make this path empty.
 */
function spendLegacy(pairs, payerId, amountSatang) {
	const mine = pairs
		.filter(pair => pair.debtorId === payerId)
		.sort((a, b) => (b.grossSatang - a.grossSatang) || a.creditorId.localeCompare(b.creditorId));
	if (mine.length === 0) return;

	let left = amountSatang;
	for (const pair of mine) {
		if (left <= 0) break;
		const due = pair.grossSatang - pair.settledSatang;
		if (due <= 0) continue;
		const take = Math.min(due, left);
		pair.settledSatang += take;
		pair.estimated = true;
		left -= take;
	}
	if (left > 0) {
		mine[0].settledSatang += left;
		mine[0].estimated = true;
	}
}

// ── the answer ───────────────────────────────────────────────────────────────

/**
 * Every live obligation between two people, netted two ways and reduced by
 * whatever has already been paid between exactly those two.
 *
 * Netting is strictly pairwise. If Nick owes Megu ฿300 and Megu owes Nick ฿100,
 * one line survives — Nick owes Megu ฿200 — because telling two people to send
 * each other money on the same screen is not a settlement, it is a chore.
 *
 * It stops there on purpose. Collapsing Nick → Megu → Fig into Nick → Fig is a
 * different feature with a different risk: it changes who you are about to
 * transfer money to, and the payment rows in this system freeze the destination
 * they were shown. That belongs behind its own switch, not in the function
 * everything else reads.
 */
function pairwiseObligations(activity, periodId = null) {
	const counted = new Set((activity.participants || []).map(p => p.id));
	const names = new Map((activity.participants || []).map(p => [p.id, p.displayName]));
	const raw = rawObligations(activity, periodId);
	const { settled, pending, legacy } = attributePayments(activity, periodId, counted);

	// Every pair named by a debt or by a payment. A pair that owes nothing but
	// has money against it is exactly the overpayment worth showing.
	const seen = new Set();
	const pairs = [];
	for (const key of [...raw.keys(), ...settled.keys(), ...pending.keys()]) {
		const [debtorId, creditorId] = key.split(' ');
		if (!counted.has(debtorId) || !counted.has(creditorId)) continue;

		const [a, b] = debtorId < creditorId ? [debtorId, creditorId] : [creditorId, debtorId];
		const canonical = pairKey(a, b);
		if (seen.has(canonical)) continue;
		seen.add(canonical);

		const gross = (raw.get(pairKey(a, b)) || 0) - (raw.get(pairKey(b, a)) || 0);
		const paid = (settled.get(pairKey(a, b)) || 0) - (settled.get(pairKey(b, a)) || 0);
		const claimed = (pending.get(pairKey(a, b)) || 0) - (pending.get(pairKey(b, a)) || 0);

		// Orient the row so the debtor is the one actually down on the deal.
		// With no debt either way the direction is decided by the money that
		// moved, so a stray payment still reads as "B owes A a refund".
		// `0 - x` rather than `-x`: negating a zero produces -0, which survives
		// JSON, reaches a strict comparison in a test or a client, and is not
		// equal to the 0 anybody wrote there.
		const forward = gross !== 0 ? gross > 0 : paid <= 0;
		pairs.push(forward
			? { debtorId: a, creditorId: b, grossSatang: gross, settledSatang: paid, pendingSatang: claimed, estimated: false }
			: { debtorId: b, creditorId: a, grossSatang: 0 - gross, settledSatang: 0 - paid, pendingSatang: 0 - claimed, estimated: false });
	}

	for (const [payerId, amount] of legacy) {
		spendLegacy(pairs, payerId, amount);
	}

	return pairs
		.map((pair) => {
			const balance = pair.grossSatang - pair.settledSatang;
			return {
				debtorId: pair.debtorId,
				debtorName: names.get(pair.debtorId) || null,
				creditorId: pair.creditorId,
				creditorName: names.get(pair.creditorId) || null,
				grossSatang: pair.grossSatang,
				settledSatang: pair.settledSatang,
				pendingSatang: pair.pendingSatang,
				outstandingSatang: Math.max(0, balance),
				overpaidSatang: Math.max(0, -balance),
				estimated: pair.estimated,
			};
		})
		.filter(pair => pair.grossSatang !== 0 || pair.settledSatang !== 0 || pair.pendingSatang !== 0)
		.sort((a, b) => (b.outstandingSatang - a.outstandingSatang)
			|| a.debtorId.localeCompare(b.debtorId)
			|| a.creditorId.localeCompare(b.creditorId));
}

/**
 * One person's side of the ledger, ready for a screen to read.
 *
 * `overpaidSatang` is the number the old model had nowhere to put: paying ฿350
 * against a ฿300 share sank into a negative `outstanding` that the interface
 * rendered as zero, and the ฿50 stopped existing.
 */
function obligationsFor(obligations, participantId) {
	const owesTo = obligations.filter(o => o.debtorId === participantId && o.outstandingSatang > 0);
	const owedBy = obligations.filter(o => o.creditorId === participantId && o.outstandingSatang > 0);
	return {
		owesTo,
		owedBy,
		owesTotalSatang: owesTo.reduce((sum, o) => sum + o.outstandingSatang, 0),
		owedTotalSatang: owedBy.reduce((sum, o) => sum + o.outstandingSatang, 0),
		overpaidSatang: obligations
			.filter(o => o.debtorId === participantId)
			.reduce((sum, o) => sum + o.overpaidSatang, 0),
	};
}

module.exports = { rawObligations, pairwiseObligations, obligationsFor, paymentAmountInScope };
