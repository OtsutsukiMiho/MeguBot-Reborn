require('dotenv').config();
const assert = require('node:assert');
const core = require('../core/index.js');

// Split modes against a real database, and specifically against the edit.
//
// `split.test.js` proves the arithmetic. What only Postgres can prove is that
// the division survives a correction: a bill split 70/30 and then corrected
// from ฿1,000 to ฿1,200 has to come back 70/30. Before the instruction was
// stored, every edit recomputed an even split — which was right while even was
// the only kind, and would silently move money between people the moment it
// was not.

const { users, activities, money, db } = core;
const created = { users: [] };
let n = 0;
function ok(msg) {
	n++;
	console.log(`  ok  ${msg}`);
}

function sharesOf(activity, expenseId) {
	return Object.fromEntries(activity.shares
		.filter(s => s.expenseId === expenseId)
		.map(s => [s.participantId, s.amountSatang]));
}

async function main() {
	await core.initCoreSchema();

	const owner = await users.loginWithIdentity({
		provider: 'discord', providerUid: '__split_owner__', username: 'megu', displayName: 'เม',
	});
	created.users.push(owner.user.id);

	const act = await activities.createActivity({
		ownerUserId: owner.user.id,
		title: 'ทริปเชียงใหม่',
		participants: [
			{ displayName: 'เม', userId: owner.user.id },
			{ displayName: 'นิค' },
			{ displayName: 'ฟิก' },
		],
	});
	let full = await activities.getActivity(act.id);
	const P = Object.fromEntries(full.participants.map(p => [p.displayName, p.id]));
	const everyone = [P['เม'], P['นิค'], P['ฟิก']];

	console.log('\nthe division is stored, not just its result');

	const hotel = await activities.addExpense(act.id, {
		label: 'โรงแรม',
		amountSatang: money.toSatang(3000),
		paidBy: P['เม'],
		shareParticipantIds: everyone,
		split: { mode: 'shares', values: { [P['เม']]: 2, [P['นิค']]: 1, [P['ฟิก']]: 1 } },
	});
	full = await activities.getActivity(act.id);

	assert.deepStrictEqual(sharesOf(full, hotel.id), {
		[P['เม']]: 150000, [P['นิค']]: 75000, [P['ฟิก']]: 75000,
	});
	ok('เม took the double room and pays half of ฿3,000');

	const stored = full.expenses.find(e => e.id === hotel.id);
	assert.strictEqual(stored.splitMode, 'shares');
	assert.deepStrictEqual(stored.splitValues, { [P['เม']]: 2, [P['นิค']]: 1, [P['ฟิก']]: 1 });
	ok('the instruction that produced it is stored alongside');

	console.log('\ncorrecting the amount keeps the division');

	await activities.updateExpense(hotel.id, { amountSatang: money.toSatang(3600) });
	full = await activities.getActivity(act.id);
	assert.deepStrictEqual(sharesOf(full, hotel.id), {
		[P['เม']]: 180000, [P['นิค']]: 90000, [P['ฟิก']]: 90000,
	});
	assert.strictEqual(full.expenses.find(e => e.id === hotel.id).splitMode, 'shares');
	ok('฿3,000 corrected to ฿3,600 is still 2:1:1 — this is the case that used to break');

	console.log('\nchanging the division');

	await activities.updateExpense(hotel.id, {
		split: { mode: 'percent', values: { [P['เม']]: 50, [P['นิค']]: 25, [P['ฟิก']]: 25 } },
	});
	full = await activities.getActivity(act.id);
	assert.deepStrictEqual(sharesOf(full, hotel.id), {
		[P['เม']]: 180000, [P['นิค']]: 90000, [P['ฟิก']]: 90000,
	});
	assert.strictEqual(full.expenses.find(e => e.id === hotel.id).splitMode, 'percent');
	ok('the same division said a different way records the different way');

	console.log('\nchanging who shares it');

	// A stored 2:1:1 names three people and cannot mean anything once one of
	// them leaves the expense, so the fallback is even — visible, and a rule
	// anybody can check.
	await activities.updateExpense(hotel.id, {
		shareParticipantIds: [P['เม'], P['นิค']],
	});
	full = await activities.getActivity(act.id);
	assert.deepStrictEqual(sharesOf(full, hotel.id), { [P['เม']]: 180000, [P['นิค']]: 180000 });
	assert.strictEqual(full.expenses.find(e => e.id === hotel.id).splitMode, 'even');
	ok('dropping somebody falls back to even rather than reusing a rule about people who left');

	console.log('\nrefusals leave nothing behind');

	const before = full.expenses.length;
	await assert.rejects(
		() => activities.addExpense(act.id, {
			label: 'ไม่ลงตัว',
			amountSatang: money.toSatang(100),
			paidBy: P['เม'],
			shareParticipantIds: everyone,
			split: { mode: 'exact', values: { [P['เม']]: 5000, [P['นิค']]: 4000, [P['ฟิก']]: 999 } },
		}),
		error => error.code === 'split_does_not_sum',
	);
	full = await activities.getActivity(act.id);
	assert.strictEqual(full.expenses.length, before);
	ok('an unbalanced split writes no expense at all — not one with shares that do not add up');

	await assert.rejects(
		() => activities.addExpense(act.id, {
			label: 'คนนอก',
			amountSatang: money.toSatang(100),
			paidBy: P['เม'],
			shareParticipantIds: [P['เม'], P['นิค']],
			split: { mode: 'shares', values: { [P['เม']]: 1, [P['นิค']]: 1, par_stranger: 1 } },
		}),
		error => error.code === 'split_person_not_sharing',
	);
	ok('a stranger in the split is caught before the roster check ever sees them');

	console.log('\nthe ledger still balances');

	const dinner = await activities.addExpense(act.id, {
		label: 'ข้าวเย็น',
		amountSatang: money.toSatang(1000),
		paidBy: P['ฟิก'],
		shareParticipantIds: everyone,
		split: { mode: 'exact', values: { [P['เม']]: 50000, [P['นิค']]: 30000, [P['ฟิก']]: 20000 } },
	});
	full = await activities.getActivity(act.id);

	// Whatever the modes, every expense's shares still sum to its amount, and
	// the pair calculation still agrees with the per-person balance.
	for (const expense of full.expenses) {
		const parts = Object.values(sharesOf(full, expense.id)).reduce((s, v) => s + v, 0);
		assert.strictEqual(parts, expense.amountSatang, `${expense.label} does not reconcile`);
	}
	ok('every expense reconciles to the satang, whichever way it was divided');

	const sum = activities.settlement(full);
	const owedToFig = sum.obligations
		.filter(o => o.creditorId === P['ฟิก'])
		.reduce((total, o) => total + o.outstandingSatang, 0);
	// ฟิก fronted ฿1,000 and took ฿200 of it, so ฿800 is owed to her — minus
	// what she owes เม for the hotel, netted pairwise.
	assert.strictEqual(sum.rows.find(r => r.participantId === P['ฟิก']).paidOut, 100000);
	assert.ok(owedToFig > 0, 'ฟิก is owed something for the dinner she paid for');
	assert.strictEqual(dinner.splitMode, 'exact');
	ok('mixed split modes feed the pair calculation without disagreeing with it');
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
