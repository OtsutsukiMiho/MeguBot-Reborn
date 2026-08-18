// Decisions made from a transfer slip, without pretending the picture is a
// bank statement. This module is deliberately pure: the browser extracts a
// reading, the HTTP adapter validates the slip QR, and core decides whether the
// result is strong enough for Megu's optimistic confirmation policy.

const FUTURE_SKEW_MS = 15 * 60 * 1000;

function compactName(value) {
	return String(value == null ? '' : value)
		.normalize('NFKC')
		.toLocaleLowerCase('th-TH')
		.replace(/^(?:นาย|นางสาว|นาง|น\.ส\.|mr\.?|mrs\.?|miss)\s*/iu, '')
		.replace(/[\s.*•·_\-–—()[\]{}'"`]/g, '');
}

/**
 * Thai slips frequently mask one side of a name. A masked reading may match a
 * stored full name, but a one-character fragment is never enough to confirm
 * money automatically.
 */
function namesMatch(expected, read) {
	const left = compactName(expected);
	const right = compactName(read);
	if (!left || !right) return false;
	if (left.length < 3 || right.length < 3) return false;
	return left === right || left.includes(right) || right.includes(left);
}

function parseBangkokWallClock(value) {
	if (!value) return null;
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

	const text = String(value).trim();
	const found = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(text);
	if (!found) return null;
	const [, year, month, day, hour = '00', minute = '00'] = found;
	const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00+07:00`);
	if (Number.isNaN(date.getTime())) return null;
	// Date normalises impossible dates (31 February) instead of rejecting them.
	const bangkok = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
	}).formatToParts(date).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
	if (`${bangkok.year}-${bangkok.month}-${bangkok.day} ${bangkok.hour}:${bangkok.minute}` !== `${year}-${month}-${day} ${hour}:${minute}`) return null;
	return date;
}

/**
 * Whether a slip can optimistically settle a claim.
 *
 * Old transfers are allowed. A five-month-late recurring payment is ordinary;
 * age is surfaced for audit, never used as an automatic rejection. A future
 * transfer, on the other hand, is impossible beyond a small clock/OCR margin.
 */
function assessSlip(input, { now = new Date() } = {}) {
	const reasons = [];
	const flags = [];
	const expected = Number(input.expectedSatang);
	const read = Number(input.amountSatang);

	if (!input.ref) reasons.push('reference_missing');
	if (!Number.isSafeInteger(read) || read <= 0) reasons.push('amount_unreadable');
	else if (!Number.isSafeInteger(expected) || expected <= 0 || read !== expected) reasons.push('amount_mismatch');

	if (!input.expectedReceiverName) reasons.push('receiver_not_configured');
	else if (!input.receiverName) reasons.push('receiver_unreadable');
	else if (!namesMatch(input.expectedReceiverName, input.receiverName)) reasons.push('receiver_mismatch');

	const transferredAt = parseBangkokWallClock(input.transferredAt);
	if (!transferredAt) {
		reasons.push('time_unreadable');
	}
	else {
		if (transferredAt.getTime() > new Date(now).getTime() + FUTURE_SKEW_MS) reasons.push('time_in_future');
		const submittedAt = input.submittedAt ? new Date(input.submittedAt) : new Date(now);
		if (!Number.isNaN(submittedAt.getTime()) && submittedAt.getTime() - transferredAt.getTime() > 30 * 24 * 60 * 60 * 1000) {
			flags.push('uploaded_late');
		}
	}

	return {
		decision: reasons.length === 0 ? 'confirm' : 'review',
		reasons,
		flags,
		transferredAt,
	};
}

function validateAllocations(amountSatang, allocations) {
	if (!Number.isSafeInteger(amountSatang) || amountSatang <= 0) throw new Error('payment_amount_invalid');
	if (!Array.isArray(allocations) || allocations.length === 0) throw new Error('payment_allocations_required');

	const seen = new Set();
	let total = 0;
	for (const allocation of allocations) {
		const key = allocation.periodId || '__event__';
		if (seen.has(key)) throw new Error('payment_allocation_duplicate');
		seen.add(key);
		const value = Number(allocation.amountSatang);
		if (!Number.isSafeInteger(value) || value <= 0) throw new Error('payment_allocation_invalid');
		total += value;
	}
	if (total !== amountSatang) throw new Error('payment_allocations_do_not_sum');
	return allocations.map(item => ({ periodId: item.periodId || null, amountSatang: Number(item.amountSatang) }));
}

/** Allocate a transfer over the oldest outstanding periods first. */
function allocateOldestFirst(amountSatang, periods) {
	let remaining = amountSatang;
	const allocations = [];
	for (const period of [...periods].sort((a, b) => String(a.key).localeCompare(String(b.key)))) {
		if (remaining <= 0) break;
		const outstanding = Math.max(0, Number(period.outstandingSatang) || 0);
		if (outstanding === 0) continue;
		const amount = Math.min(remaining, outstanding);
		allocations.push({ periodId: period.id, amountSatang: amount });
		remaining -= amount;
	}
	return { allocations, unallocatedSatang: remaining };
}

module.exports = {
	FUTURE_SKEW_MS,
	compactName,
	namesMatch,
	parseBangkokWallClock,
	assessSlip,
	validateAllocations,
	allocateOldestFirst,
};
