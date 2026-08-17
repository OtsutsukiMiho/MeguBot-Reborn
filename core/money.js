// Every amount in core is an integer number of satang. Floats are never used
// for money: 66.50 is 6650, and 400/3 has to land exactly on 400.00 again.

function toSatang(baht) {
	const n = Number(baht);
	if (!Number.isFinite(n)) throw new TypeError('amount is not a number');
	return Math.round(n * 100);
}

function toBaht(satang) {
	return satang / 100;
}

function formatTHB(satang) {
	const sign = satang < 0 ? '-' : '';
	const abs = Math.abs(satang);
	const baht = Math.floor(abs / 100);
	const rest = String(abs % 100).padStart(2, '0');
	return `${sign}฿${baht.toLocaleString('en-US')}.${rest}`;
}

/**
 * Split a total into `count` shares that always sum back to the total.
 * The remainder satang go to the earliest shares, so the result is stable
 * across recomputation instead of drifting by a satang each time.
 */
function splitEvenly(totalSatang, count) {
	if (!Number.isInteger(totalSatang)) throw new TypeError('totalSatang must be an integer');
	if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be a positive integer');

	const base = Math.floor(totalSatang / count);
	const remainder = totalSatang - (base * count);

	const shares = new Array(count).fill(base);
	for (let i = 0; i < remainder; i++) {
		shares[i] += 1;
	}
	return shares;
}

/**
 * Same split, keyed by participant id so callers do not have to trust
 * array ordering. Ids are sorted first to keep the remainder assignment
 * deterministic no matter what order they arrive in.
 *
 * Duplicates are removed before splitting. Without that, a list containing
 * the same person twice divides by a head count larger than the number of
 * keys the result ends up with, and the shares quietly stop summing to the
 * total — ฿400 across [a,b,c,c] would hand out only ฿300.
 */
function splitEvenlyBy(totalSatang, participantIds) {
	const ids = [...new Set(participantIds)].sort();
	if (ids.length === 0) throw new RangeError('need at least one participant to split between');

	const shares = splitEvenly(totalSatang, ids.length);
	const out = {};
	ids.forEach((id, i) => {
		out[id] = shares[i];
	});
	return out;
}

module.exports = { toSatang, toBaht, formatTHB, splitEvenly, splitEvenlyBy };
