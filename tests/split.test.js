// Dividing an expense by something other than "everybody the same".
//
// The rule every case here checks is the same one: whatever was asked for, the
// parts sum back to the total exactly. A split that loses a satang is not a
// rounding detail — it is a ledger that will never balance again, and no screen
// downstream can recover from it.

const assert = require('node:assert');
const money = require('../core/money.js');
const { resolveSplit } = require('../core/split.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

const A = 'par_a';
const B = 'par_b';
const C = 'par_c';
const THREE = [A, B, C];

/** The invariant, asserted on every result in this file. */
function sums(split, total) {
	const got = Object.values(split).reduce((sum, v) => sum + v, 0);
	assert.strictEqual(got, total, `parts sum to ${got}, not ${total}`);
	for (const [id, value] of Object.entries(split)) {
		assert.ok(Number.isInteger(value), `${id} is not an integer number of satang`);
		assert.ok(value >= 0, `${id} is negative`);
	}
	return split;
}

console.log('\nweights');

{
	// ฿100 across 1:1:8 — the ฿0.01 that cannot be divided goes to the largest
	// claim, not to whoever happens to sort first.
	const out = sums(money.allocateByWeight(10000, { [A]: 1, [B]: 1, [C]: 8 }), 10000);
	assert.deepStrictEqual(out, { [A]: 1000, [B]: 1000, [C]: 8000 });
	ok('a clean ratio divides cleanly');

	const awkward = sums(money.allocateByWeight(10000, { [A]: 1, [B]: 1, [C]: 1 }), 10000);
	assert.deepStrictEqual(awkward, { [A]: 3334, [B]: 3333, [C]: 3333 });
	ok('฿100 three ways keeps the spare satang rather than losing it');

	// Every fraction is identical here, so the tie-break decides — and it must
	// match `splitEvenly`, which every expense already written used.
	assert.deepStrictEqual(
		money.allocateByWeight(10000, Object.fromEntries(THREE.map(id => [id, 1]))),
		money.splitEvenlyBy(10000, THREE),
	);
	ok('equal weights agree with the even split, to the satang');

	// The largest discarded fraction wins. ฿1 across 1:2:4 lands on 14.28,
	// 28.57 and 57.14; the spare satang goes to the 0.57, not to the 0.28 that
	// sorts first or the 0.14 that is largest overall.
	const remainders = sums(money.allocateByWeight(100, { [A]: 1, [B]: 2, [C]: 4 }), 100);
	assert.deepStrictEqual(remainders, { [A]: 14, [B]: 29, [C]: 57 });
	ok('the spare satang goes to the biggest discarded fraction');

	// Order in must not change the answer.
	assert.deepStrictEqual(
		money.allocateByWeight(100, { [C]: 4, [A]: 1, [B]: 2 }),
		remainders,
	);
	ok('the result does not depend on the order the weights arrive in');

	assert.throws(() => money.allocateByWeight(100, {}), RangeError);
	assert.throws(() => money.allocateByWeight(100, { [A]: 0, [B]: 0 }), RangeError);
	assert.throws(() => money.allocateByWeight(100, { [A]: 1.5 }), RangeError);
	assert.throws(() => money.allocateByWeight(100, { [A]: -1 }), RangeError);
	ok('no weights, all-zero weights and fractional weights are refused');
}

console.log('\neven');

{
	const { mode, values, split } = resolveSplit(10000, THREE);
	assert.strictEqual(mode, 'even');
	assert.strictEqual(values, null);
	assert.deepStrictEqual(sums(split, 10000), { [A]: 3334, [B]: 3333, [C]: 3333 });
	ok('no specification means what it always meant');

	// Duplicates in the roster list must not divide by a head count larger than
	// the number of people who end up with a share.
	assert.deepStrictEqual(resolveSplit(30000, [A, B, B]).split, { [A]: 15000, [B]: 15000 });
	ok('the same person listed twice is still one share');
}

console.log('\nexact');

{
	const { split } = resolveSplit(120000, THREE, {
		mode: 'exact', values: { [A]: 100000, [B]: 10000, [C]: 10000 },
	});
	assert.deepStrictEqual(sums(split, 120000), { [A]: 100000, [B]: 10000, [C]: 10000 });
	ok('the amounts are taken exactly as given');

	assert.deepStrictEqual(
		resolveSplit(20000, [A, B], { mode: 'exact', values: { [A]: 20000, [B]: 0 } }).split,
		{ [A]: 20000, [B]: 0 },
	);
	ok('somebody can take none of it — a nought is a real answer');

	// Off by one satang. Nudging a figure the person typed would be worse than
	// refusing: they know what the bill said and Megu does not.
	assert.throws(
		() => resolveSplit(120000, THREE, { mode: 'exact', values: { [A]: 100000, [B]: 10000, [C]: 9999 } }),
		error => error.code === 'split_does_not_sum',
	);
	ok('a total that is one satang out is refused, not quietly adjusted');
}

console.log('\npercent');

{
	const { split, values } = resolveSplit(10000, THREE, {
		mode: 'percent', values: { [A]: '33.33', [B]: '33.33', [C]: '33.34' },
	});
	assert.deepStrictEqual(sums(split, 10000), { [A]: 3333, [B]: 3333, [C]: 3334 });
	assert.deepStrictEqual(values, { [A]: 33.33, [B]: 33.33, [C]: 33.34 });
	ok('percentages divide exactly and come back as people wrote them');

	assert.deepStrictEqual(
		sums(resolveSplit(100000, [A, B], { mode: 'percent', values: { [A]: 70, [B]: 30 } }).split, 100000),
		{ [A]: 70000, [B]: 30000 },
	);
	ok('70/30 of ฿1,000 is ฿700 and ฿300');

	assert.throws(
		() => resolveSplit(10000, THREE, { mode: 'percent', values: { [A]: 33, [B]: 33, [C]: 33 } }),
		error => error.code === 'split_percent_does_not_total',
	);
	ok('99% is refused');

	// A third decimal place is a real intention, and rounding it to two changes
	// the money by more than the person who typed it would expect.
	assert.throws(
		() => resolveSplit(10000, THREE, { mode: 'percent', values: { [A]: '33.333', [B]: '33.333', [C]: '33.334' } }),
		error => error.code === 'split_percent_invalid',
	);
	ok('three decimal places is refused rather than rounded');
}

console.log('\nshares');

{
	const { split } = resolveSplit(90000, THREE, { mode: 'shares', values: { [A]: 2, [B]: 1, [C]: 1 } });
	assert.deepStrictEqual(sums(split, 90000), { [A]: 45000, [B]: 22500, [C]: 22500 });
	ok('two shares to one is twice as much');

	// Three people, two rooms, one of them alone: 2:1:1 of an awkward total.
	const awkward = sums(resolveSplit(100, THREE, { mode: 'shares', values: { [A]: 2, [B]: 1, [C]: 1 } }).split, 100);
	assert.deepStrictEqual(awkward, { [A]: 50, [B]: 25, [C]: 25 });
	ok('an awkward total still reconciles');

	assert.throws(
		() => resolveSplit(10000, THREE, { mode: 'shares', values: { [A]: 1, [B]: 1, [C]: 0.5 } }),
		error => error.code === 'split_weight_invalid',
	);
	ok('half a share is refused — that is what percentages are for');
}

console.log('\nwho is named');

{
	assert.throws(
		() => resolveSplit(10000, THREE, { mode: 'shares', values: { [A]: 1, [B]: 1 } }),
		error => error.code === 'split_person_missing',
	);
	ok('leaving somebody out is refused — zero and an oversight are far apart');

	assert.throws(
		() => resolveSplit(10000, [A, B], { mode: 'shares', values: { [A]: 1, [B]: 1, [C]: 1 } }),
		error => error.code === 'split_person_not_sharing',
	);
	ok('naming somebody who is not sharing is refused, not dropped');

	assert.throws(
		() => resolveSplit(10000, THREE, { mode: 'exact' }),
		error => error.code === 'split_values_required',
	);
	assert.throws(
		() => resolveSplit(10000, THREE, { mode: 'sideways', values: {} }),
		error => error.code === 'split_mode_invalid',
	);
	ok('a mode with no numbers, and a mode that does not exist, both fail loudly');
}

console.log('\nlarge and awkward totals still reconcile');

{
	// A brute force over the shape most likely to leave a satang behind.
	for (let total = 1; total <= 400; total++) {
		for (const weights of [{ [A]: 1, [B]: 1, [C]: 1 }, { [A]: 1, [B]: 2, [C]: 4 }, { [A]: 7, [B]: 11, [C]: 13 }]) {
			sums(money.allocateByWeight(total, weights), total);
		}
	}
	sums(money.allocateByWeight(999999999, { [A]: 7, [B]: 11, [C]: 13 }), 999999999);
	ok('1,200 combinations and one ฿10m total all sum back exactly');
}

console.log(`\n${n} checks passed\n`);
