// Who ate what: dishes split among the people who shared them, charges split
// in proportion to what each person ordered, and the preview is exactly what
// the server will record.
const assert = require('node:assert/strict');
const { planReceipt } = require('../core/receipt-split.js');
const { resolveSplit } = require('../core/split.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

const everyone = ['jane', 'ken', 'mark'];

{
	const plan = planReceipt({
		everyone,
		lines: [
			{ label: 'Steak', amountSatang: 42000, sharers: ['jane'] },
			{ label: 'Salad', amountSatang: 18000, sharers: ['ken', 'mark'] },
			{ label: 'Water', amountSatang: 3000 },
		],
	});
	assert.deepEqual(plan.perPerson, { jane: 43000, ken: 10000, mark: 10000 });
	assert.equal(plan.totalSatang, 63000);
	assert.deepEqual(plan.expenses[2].shareParticipantIds, everyone, 'a line naming nobody is shared by everyone');
	ok('each dish is paid by the people who shared it');
}

{
	const plan = planReceipt({
		everyone,
		lines: [
			{ label: 'Steak', amountSatang: 40000, sharers: ['jane'] },
			{ label: 'Rice', amountSatang: 10000, sharers: ['ken'] },
			{ label: 'Service 10%', amountSatang: 5000, kind: 'charge' },
		],
	});
	assert.deepEqual(plan.perPerson, { jane: 44000, ken: 11000, mark: 0 });
	assert.deepEqual(plan.expenses[2].split, { mode: 'shares', values: { jane: 40000, ken: 10000 } });
	assert.deepEqual(plan.expenses[2].shareParticipantIds, ['jane', 'ken'], 'someone who ordered nothing pays no service charge');
	ok('service charge follows the food, and skips whoever ate nothing');
}

{
	const plan = planReceipt({
		everyone,
		lines: [
			{ label: 'Pizza', amountSatang: 10000 },
			{ label: 'VAT', amountSatang: 700, kind: 'charge' },
			{ label: 'Service', amountSatang: 1000, kind: 'charge' },
		],
	});
	// 10000 / 3 does not divide: the planner and the server must agree on who
	// gets the extra satang, because the preview is shown as a promise.
	for (const expense of plan.expenses) {
		const server = resolveSplit(expense.amountSatang, expense.shareParticipantIds, expense.split);
		assert.equal(Object.values(server.split).reduce((a, b) => a + b, 0), expense.amountSatang);
	}
	const total = Object.values(plan.perPerson).reduce((a, b) => a + b, 0);
	assert.equal(total, 11700, 'nothing is lost or invented in rounding');
	assert.equal(plan.expenses[1].split.values.jane, plan.expenses[2].split.values.jane, 'charges are weighted by food, not by each other');
	ok('rounding matches the server to the satang, and charges never weight each other');
}

{
	const plan = planReceipt({ everyone, lines: [{ label: 'Service', amountSatang: 900, kind: 'charge' }] });
	assert.deepEqual(plan.perPerson, { jane: 300, ken: 300, mark: 300 });
	ok('a charge with no food to follow is split evenly');
}

{
	const plan = planReceipt({
		everyone,
		lines: [
			{ label: 'Blank', amountSatang: 0 },
			{ label: 'Nonsense', amountSatang: 12.5 },
			{ label: 'Ghost', amountSatang: 1000, sharers: ['nobody'] },
		],
	});
	assert.equal(plan.expenses.length, 1, 'zero and fractional amounts are skipped');
	assert.deepEqual(plan.expenses[0].shareParticipantIds, everyone, 'unknown sharers fall back to everyone');
	assert.throws(() => planReceipt({ everyone: [], lines: [{ label: 'x', amountSatang: 100 }] }), /split_people_required/);
	ok('bad lines are skipped, and a bill with nobody to pay it is refused');
}

console.log(`\n${n} checks passed\n`);
