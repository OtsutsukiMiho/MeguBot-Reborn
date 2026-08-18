const assert = require('node:assert');
const evidence = require('../core/payment-evidence.js');

let checks = 0;
function ok(message) {
	checks++;
	console.log(`  ok  ${message}`);
}

const NOW = new Date('2026-08-18T10:00:00+07:00');

let result = evidence.assessSlip({
	ref: 'th-bank:006:ABC123',
	expectedSatang: 2000,
	amountSatang: 2000,
	expectedReceiverName: 'นาย B ตัวอย่าง',
	receiverName: 'B ตัวอย่าง',
	transferredAt: '2026-08-18 09:50',
}, { now: NOW });
assert.strictEqual(result.decision, 'confirm');
ok('a unique exact transfer to the configured receiver confirms optimistically');

result = evidence.assessSlip({
	ref: 'th-bank:006:OLD123', expectedSatang: 50000, amountSatang: 50000,
	expectedReceiverName: 'เจ้าหนี้', receiverName: 'เจ้าหนี้',
	transferredAt: '2026-03-18 09:50', submittedAt: NOW,
}, { now: NOW });
assert.strictEqual(result.decision, 'confirm');
assert.deepStrictEqual(result.flags, ['uploaded_late']);
ok('a five-month-old slip is allowed and merely flagged as uploaded late');

result = evidence.assessSlip({
	ref: 'th-bank:006:FUTURE', expectedSatang: 2000, amountSatang: 2000,
	expectedReceiverName: 'B', receiverName: 'B', transferredAt: '2026-08-18 11:00',
}, { now: NOW });
assert.strictEqual(result.decision, 'review');
assert.ok(result.reasons.includes('time_in_future'));
ok('a transfer implausibly in the future never auto-confirms');

result = evidence.assessSlip({
	ref: 'th-bank:006:WRONG', expectedSatang: 2000, amountSatang: 2100,
	expectedReceiverName: 'นาย B ตัวอย่าง', receiverName: 'นาย C ตัวอย่าง',
	transferredAt: '2026-08-18 09:50',
}, { now: NOW });
assert.deepStrictEqual(new Set(result.reasons), new Set(['amount_mismatch', 'receiver_mismatch']));
ok('a wrong amount or receiver is sent to review rather than settled');

result = evidence.assessSlip({
	ref: 'th-bank:006:THIRD', expectedSatang: 2000, amountSatang: 2000,
	expectedReceiverName: 'นาย B ตัวอย่าง', receiverName: 'นาย B ตัวอย่าง',
	senderName: 'แม่ของ A', transferredAt: '2026-08-18 09:50',
}, { now: NOW });
assert.strictEqual(result.decision, 'confirm');
ok('somebody else may transfer on the debtor’s behalf');

const allocation = evidence.allocateOldestFirst(50000, [
	{ id: 'dec', key: '2026-12', outstandingSatang: 10000 },
	{ id: 'aug', key: '2026-08', outstandingSatang: 10000 },
	{ id: 'sep', key: '2026-09', outstandingSatang: 10000 },
	{ id: 'oct', key: '2026-10', outstandingSatang: 10000 },
	{ id: 'nov', key: '2026-11', outstandingSatang: 10000 },
]);
assert.deepStrictEqual(allocation.allocations.map(row => row.periodId), ['aug', 'sep', 'oct', 'nov', 'dec']);
assert.strictEqual(allocation.unallocatedSatang, 0);
evidence.validateAllocations(50000, allocation.allocations);
ok('one transfer can settle five monthly periods, oldest first');

assert.throws(
	() => evidence.validateAllocations(2000, [{ periodId: 'aug', amountSatang: 1000 }]),
	/payment_allocations_do_not_sum/,
);
ok('allocations must reconcile exactly to the transfer');

console.log(`\n${checks} checks passed`);
