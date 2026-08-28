// How one expense is divided, beyond "everybody the same".
//
// Splitting evenly covers most of a dinner and none of a trip. One person had
// the room to themselves, two shared the taxi, somebody does not drink — and
// until now the only way to say any of that was to invent extra expenses until
// the even split happened to come out right, which loses what actually
// happened and cannot be corrected afterwards.
//
// Four modes, one rule: whatever is asked for, the parts sum to the total
// exactly. Nothing here rounds a total into existence or lets a satang fall on
// the floor — `allocateByWeight` does the arithmetic and this file does the
// validating, because a split that does not reconcile is a bug the ledger
// cannot recover from later.
//
//   even     the shares are equal (what every existing expense is)
//   exact    each person's satang, given directly
//   percent  each person's share of 100%
//   shares   relative weights — 2 shares to 1, three ways of two rooms
//
// Free of the database, so the rules can be tested against literals.

const { allocateByWeight } = require('./money.js');

const MODES = ['even', 'exact', 'percent', 'shares'];

// A percentage is written the way people write one — 33.33, not 3333 — but it
// is held as an integer number of hundredths of a percent so that summing
// three of them cannot land on 99.99999999999999. Two decimal places is the
// limit, and a third is refused rather than silently rounded: somebody who
// typed 33.333 meant something, and quietly making it 33.33 changes the money.
const PERCENT_SCALE = 100;
const PERCENT_TOTAL = 100 * PERCENT_SCALE;

function codedError(code, message = code) {
	const error = new Error(message);
	error.code = code;
	return error;
}

function toScaledPercent(value, id) {
	const text = String(value).trim();
	if (!/^\d+(\.\d{1,2})?$/.test(text)) throw codedError('split_percent_invalid', `${id}: percentages take up to two decimal places`);
	const [whole, fraction = ''] = text.split('.');
	return (Number(whole) * PERCENT_SCALE) + Number(fraction.padEnd(2, '0'));
}

/**
 * Turn a split specification into the satang each participant owes.
 *
 * `participantIds` is who the expense is shared between; `spec.values` says how
 * much each of them takes. Anyone in `values` who is not in `participantIds` is
 * an error rather than a silent omission — it is nearly always a stale id from
 * a roster that has changed underneath the screen, and dropping it quietly
 * would hand their share to everybody else without saying so.
 *
 * Returns `{ mode, values, split }` where `split` is the satang per person and
 * `values` is the normalised specification worth storing, so that correcting
 * the amount later re-divides it the same way instead of falling back to even.
 */
function resolveSplit(totalSatang, participantIds, spec = null) {
	if (!Number.isInteger(totalSatang) || totalSatang <= 0) throw codedError('amount_invalid');

	const ids = [...new Set(participantIds)];
	if (ids.length === 0) throw codedError('split_people_required');

	const mode = spec?.mode || 'even';
	if (!MODES.includes(mode)) throw codedError('split_mode_invalid');

	if (mode === 'even') {
		return {
			mode: 'even',
			values: null,
			split: allocateByWeight(totalSatang, Object.fromEntries(ids.map(id => [id, 1]))),
		};
	}

	const values = spec?.values;
	if (!values || typeof values !== 'object') throw codedError('split_values_required');

	const given = Object.keys(values);
	for (const id of given) {
		if (!ids.includes(id)) throw codedError('split_person_not_sharing');
	}
	// Every sharer must be named. A missing one is ambiguous — zero, or an
	// oversight — and the two are far apart when it is somebody's money.
	for (const id of ids) {
		if (!given.includes(id)) throw codedError('split_person_missing');
	}

	if (mode === 'exact') {
		const split = {};
		let sum = 0;
		for (const id of ids) {
			const amount = Number(values[id]);
			if (!Number.isInteger(amount) || amount < 0) throw codedError('split_amount_invalid');
			split[id] = amount;
			sum += amount;
		}
		// The whole point of exact mode is that the person typing knows the
		// numbers. If they do not add up, saying so beats adjusting one of them.
		if (sum !== totalSatang) throw codedError('split_does_not_sum');
		return { mode, values: split, split };
	}

	if (mode === 'percent') {
		const scaled = {};
		let sum = 0;
		for (const id of ids) {
			const percent = toScaledPercent(values[id], id);
			scaled[id] = percent;
			sum += percent;
		}
		if (sum !== PERCENT_TOTAL) throw codedError('split_percent_does_not_total');
		return {
			mode,
			// Stored as written, so an edit screen shows 33.33 rather than 3333.
			values: Object.fromEntries(ids.map(id => [id, scaled[id] / PERCENT_SCALE])),
			split: allocateByWeight(totalSatang, scaled),
		};
	}

	// shares
	const weights = {};
	let total = 0;
	for (const id of ids) {
		const weight = Number(values[id]);
		if (!Number.isInteger(weight) || weight < 0) throw codedError('split_weight_invalid');
		weights[id] = weight;
		total += weight;
	}
	if (total <= 0) throw codedError('split_weight_invalid');
	return { mode, values: weights, split: allocateByWeight(totalSatang, weights) };
}

module.exports = { resolveSplit, MODES };
