// The QR is the one thing in this product a user cannot check before trusting.
// Everything else on the page is words they can read; a QR is opaque until
// their banking app either opens with ฿60 in the box or refuses it.
//
// So the payload is tested against the format rather than against itself: the
// checksum against CCITT's published check value, and the fields by parsing
// the finished string back apart and reading what a bank would read.

const assert = require('node:assert');
const pp = require('../core/promptpay.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

console.log('\nchecksum');

// The published check value for CRC-16/CCITT-FALSE: the ASCII digits 1-9
// must come out as 0x29B1. This is the only assertion in the file that does
// not depend on our own code being right.
assert.strictEqual(pp.crc16('123456789'), '29B1');
ok('CRC-16/CCITT-FALSE matches the standard check value');

assert.strictEqual(pp.crc16(''), 'FFFF');
ok('empty input is the init vector');

console.log('\ntargets');

assert.deepStrictEqual(pp.normaliseTarget('0812345678'), {
	tag: '01', value: '0066812345678', kind: 'mobile',
});
ok('a plain Thai mobile becomes 0066 + the number without its zero');

// The same account, written the four ways people actually type it.
const written = ['0812345678', '081-234-5678', '+66 81 234 5678', '66812345678'];
const encoded = new Set(written.map(t => pp.normaliseTarget(t).value));
assert.strictEqual(encoded.size, 1);
assert.strictEqual([...encoded][0], '0066812345678');
ok('dashes, spaces and +66 all reach the same account');

assert.strictEqual(pp.normaliseTarget('0066812345678').value.length, 13);
ok('the mobile sub-field is 13 characters wide');

assert.strictEqual(pp.normaliseTarget('1234567890123').kind, 'nationalId');
assert.strictEqual(pp.normaliseTarget('123456789012345').kind, 'eWallet');
ok('13 digits read as a national id, 15 as an e-wallet');

assert.throws(() => pp.normaliseTarget(''), /promptpay_missing/);
assert.throws(() => pp.normaliseTarget('   '), /promptpay_missing/);
assert.throws(() => pp.normaliseTarget(null), /promptpay_missing/);
assert.throws(() => pp.normaliseTarget('12345'), /promptpay_unrecognised/);

// Typing a word is not the same as typing nothing. Told "no number saved yet",
// someone looking at the word they just typed has nothing to act on.
assert.throws(() => pp.normaliseTarget('nonsense'), /promptpay_unrecognised/);
assert.throws(() => pp.normaliseTarget('my phone'), /promptpay_unrecognised/);
assert.strictEqual(pp.isValidTarget('081-234-5678'), true);
assert.strictEqual(pp.isValidTarget('nonsense'), false);
ok('nonsense is refused rather than encoded into a QR nobody can pay');

console.log('\nmasking');

assert.strictEqual(pp.maskTarget('0812345678'), '081-xxx-5678');
ok('a displayed number keeps its ends and hides its middle');

// A link gets forwarded around a group chat and beyond it. Whatever ends up
// on screen must not be a complete phone number.
assert.ok(!pp.maskTarget('0812345678').includes('2345'.slice(0, 3) + '4'));
assert.strictEqual(pp.maskTarget('0812345678').replace(/\D/g, '').length, 7);
ok('only seven of the ten digits survive display');

console.log('\npayload');

const payload = pp.buildPayload('0812345678', 6000);
const fields = pp.parsePayload(payload);

assert.strictEqual(pp.verifyPayload(payload), true);
ok('a freshly built payload verifies against its own checksum');

assert.strictEqual(fields['00'], '01');
ok('payload format indicator is 01');

assert.strictEqual(fields['01'], '12');
ok('an amount makes it a one-time QR, not a standing one');

assert.strictEqual(fields['53'], '764');
assert.strictEqual(fields['58'], 'TH');
ok('currency is THB and country is TH');

assert.strictEqual(fields['54'], '60.00');
ok('฿60 reaches the bank as 60.00, not 60 or 6000');

const merchant = pp.parsePayload(fields['29']);
assert.strictEqual(merchant['00'], pp.AID_PROMPTPAY);
assert.strictEqual(merchant['01'], '0066812345678');
ok('field 29 carries the PromptPay AID and the account');

console.log('\namounts');

// Money is integer satang everywhere in core and must not acquire a float on
// its way into the QR. 66.50 and 1234.05 are the two shapes that go wrong.
assert.strictEqual(pp.parsePayload(pp.buildPayload('0812345678', 6650))['54'], '66.50');
assert.strictEqual(pp.parsePayload(pp.buildPayload('0812345678', 123405))['54'], '1234.05');
assert.strictEqual(pp.parsePayload(pp.buildPayload('0812345678', 1))['54'], '0.01');
ok('satang survive the trip to two decimal places');

const noAmount = pp.parsePayload(pp.buildPayload('0812345678'));
assert.strictEqual(noAmount['54'], undefined);
assert.strictEqual(noAmount['01'], '11');
ok('no amount means a reusable QR with no amount field at all');

assert.throws(() => pp.buildPayload('0812345678', 0), /positive integer/);
assert.throws(() => pp.buildPayload('0812345678', -100), /positive integer/);
assert.throws(() => pp.buildPayload('0812345678', 60.5), /positive integer/);
ok('zero, negative and fractional satang are refused');

console.log('\ntampering');

// If a single character of the payload changes, the checksum must stop
// matching — that is the only protection a scanned QR has.
const flipped = `${payload.slice(0, 40)}${payload[40] === '0' ? '1' : '0'}${payload.slice(41)}`;
assert.strictEqual(pp.verifyPayload(flipped), false);
ok('one altered character invalidates the payload');

// The amount is the field worth attacking, so check it specifically: a QR for
// ฿60 must not verify after being edited to ฿600.
const six = pp.buildPayload('0812345678', 6000);
const sixHundred = six.replace('540560.00', '5406600.00');
assert.notStrictEqual(six, sixHundred);
assert.strictEqual(pp.verifyPayload(sixHundred), false);
ok('editing the amount breaks the checksum');

console.log('\nround trip');

// The one thing every other check in this file takes on trust: that the image
// a person points their banking app at actually carries the payload we built.
//
// The payload is encoded to QR modules, painted into pixels the way a screen
// would, and read back with the same decoder the slip reader uses. If this
// passes, a scan returns the string — including the amount.
(async () => {
	const QRCode = require('qrcode');
	const jsQR = require('jsqr');

	const source = pp.buildPayload('081-234-5678', 6000);
	const qr = QRCode.create(source, { errorCorrectionLevel: 'M' });
	const { size, data: modules } = qr.modules;

	// Real scanners need quiet space around the code and more than one pixel
	// per module; both are what the rendered PNG gives them, so both are
	// reproduced here rather than assumed away.
	const SCALE = 4;
	const QUIET = 4;
	const side = (size + QUIET * 2) * SCALE;
	const pixels = new Uint8ClampedArray(side * side * 4).fill(255);

	for (let row = 0; row < size; row++) {
		for (let col = 0; col < size; col++) {
			if (!modules[row * size + col]) continue;
			for (let dy = 0; dy < SCALE; dy++) {
				for (let dx = 0; dx < SCALE; dx++) {
					const x = (col + QUIET) * SCALE + dx;
					const y = (row + QUIET) * SCALE + dy;
					const at = (y * side + x) * 4;
					pixels[at] = 0;
					pixels[at + 1] = 0;
					pixels[at + 2] = 0;
				}
			}
		}
	}

	const scanned = jsQR(pixels, side, side);
	assert.ok(scanned, 'the rendered QR could not be scanned at all');
	assert.strictEqual(scanned.data, source);
	ok('a rendered QR scans back to exactly the payload it was built from');

	assert.strictEqual(pp.parsePayload(scanned.data)['54'], '60.00');
	ok('the amount survives the round trip through the image');

	console.log(`\n${n} checks passed\n`);
})().catch((error) => {
	console.error('\nFAILED:', error.message);
	process.exitCode = 1;
});
