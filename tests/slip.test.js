// Reading pictures: the QR on a bank slip, the QR a bank hands its customer,
// and the words OCR gets off a photograph of a bill.
//
// The three are tested very differently on purpose, because they are worth
// very different amounts. A slip's QR and a PromptPay QR are checksummed
// strings with a published grammar — they either parse or they do not, and the
// tests can be exact. OCR text is a reading of a photograph, so what is tested
// there is not "does it get the right answer" but "does it refuse to answer
// confidently when it should not": a table number must never become a price, a
// reference must never become an amount, and the reconciliation check must fail
// when the lines and the printed total disagree.

const assert = require('node:assert');
const pp = require('../core/promptpay.js');
const slip = require('../core/slip.js');
const receipt = require('../core/receipt.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

// TLV, the same grammar all of these share.
function field(id, value) {
	return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

// A slip's payload: everything nested under 00, checksum under 91.
function slipPayload(inner) {
	const body = `${field('00', inner)}9104`;
	return `${body}${pp.crc16(body)}`;
}

function bankSlip(bank, ref) {
	return slipPayload(field('00', '000001') + field('01', bank) + field('02', ref));
}

console.log('\nthe QR on a slip');

const scb = slip.readSlipQr(bankSlip('014', '014123456789012345'));
assert.strictEqual(scb.issuer, 'bank');
assert.strictEqual(scb.transRef, '014123456789012345');
assert.strictEqual(scb.bank.short, 'SCB');
ok('a bank slip yields the sending bank and its transaction reference');

// Two banks are free to issue the same reference number. The unique index that
// refuses a slip sent twice does not know that, so the bank has to be part of
// the key — otherwise the second person in the country to be handed reference
// 000000000000000001 is told their payment is a duplicate of a stranger's.
const same = '000000000000000001';
assert.notStrictEqual(
	slip.readSlipQr(bankSlip('014', same)).ref,
	slip.readSlipQr(bankSlip('004', same)).ref,
);
ok('the same reference from two banks does not collide');

assert.strictEqual(slip.readSlipQr(bankSlip('099', '0991234')).bank.short, '099');
ok('an unrecognised bank is reported as its code, never guessed at');

console.log('\nwhat is not a slip');

// Before this file existed, whatever string happened to be in any QR on the
// picture was stored as the reference — so a receipt photographed with the
// shop's LINE code in frame put a URL into the index, and the second customer
// to do that was told their payment was a duplicate.
assert.strictEqual(slip.readSlipQr('https://line.me/ti/p/~megu'), null);
assert.strictEqual(slip.readSlipQr('WIFI:S:CafeMegu;T:WPA;P:hunter2;;'), null);
assert.strictEqual(slip.readSlipQr(''), null);
assert.strictEqual(slip.readSlipQr(null), null);
ok('a link, a Wi-Fi code and nothing at all are all refused');

assert.strictEqual(slip.readSlipQr(pp.buildPayload('0812345678', 6000)), null);
ok('a PromptPay QR is not mistaken for a slip');

// One character of the reference altered must stop it verifying, or the
// duplicate check can be defeated by editing the string.
const genuine = bankSlip('014', '014123456789012345');
const edited = genuine.replace('014123456789012345', '014123456789012346');
assert.strictEqual(slip.readSlipQr(edited), null);
ok('editing the reference breaks the checksum and the slip is refused');

console.log('\nthe checksum some banks truncate');

// Several banks print the CRC with its leading zeros stripped, so a genuine
// slip arrives as ...9104A3F. Strict comparison rejects it, and the bug looks
// like "the app hates one particular bank".
let short = null;
for (let i = 0; i < 4000 && !short; i++) {
	const payload = bankSlip('004', `004${String(i).padStart(15, '0')}`);
	if (payload.slice(-4).startsWith('0')) short = payload;
}
assert.ok(short, 'no payload with a leading-zero checksum was found to test with');

const truncated = `${short.slice(0, -4)}${short.slice(-4).replace(/^0+/, '')}`;
assert.notStrictEqual(truncated, short);
assert.ok(slip.readSlipQr(truncated), 'a slip with its checksum truncated was refused');
assert.strictEqual(slip.readSlipQr(truncated).ref, slip.readSlipQr(short).ref);
ok('a checksum printed without its leading zeros still reads');

// The repair pads; it does not forgive. A wrong checksum stays wrong.
assert.strictEqual(slip.readSlipQr(`${short.slice(0, -4)}FFFF`), null);
ok('padding the checksum does not make a wrong one acceptable');

console.log('\nthe QR a bank gives its customer');

// The number is already in the picture. Reading it beats asking somebody to
// copy thirteen digits, because a mistyped account does not fail — it succeeds
// at paying a stranger.
const mine = pp.readQr(pp.buildPayload('081-234-5678', 6000));
assert.strictEqual(mine.target, '0812345678');
assert.strictEqual(mine.kind, 'mobile');
ok('a mobile comes back as the ten digits its owner would recognise');

// The QR people have saved is usually the one with a figure in it. Keeping the
// amount would fix every future request at whatever they were once paid.
assert.strictEqual(mine.amountSatang, 6000);
assert.strictEqual(pp.buildPayload(mine.target, 9900).includes('540599.00'), true);
ok('an amount in the imported code is reported, and not carried into the account');

assert.strictEqual(pp.readQr(pp.buildPayload('1234567890123')).kind, 'nationalId');
assert.strictEqual(pp.readQr(pp.buildPayload('123456789012345')).kind, 'eWallet');
ok('national id and e-wallet codes read back as themselves');

// A biller id is fifteen digits and so is an e-wallet id. Only the tag they
// arrive under tells them apart, so a shop's code read by length alone would
// be saved as somebody's personal wallet and look perfectly fine.
const billerBody = [
	field('00', '01'),
	field('01', '11'),
	field('30', field('00', pp.AID_BILL_PAYMENT) + field('01', '123456789012345') + field('02', 'INV001')),
	field('53', '764'),
	field('58', 'TH'),
].join('') + '6304';
assert.throws(() => pp.readQr(`${billerBody}${pp.crc16(billerBody)}`), /qr_bill_payment/);
ok('a shop\'s bill-payment code is refused as one, not read as an e-wallet');

// A bank-account proxy needs the bank as well as the number, which nothing
// here can encode. Better to say so than to save half an address.
const acctBody = [
	field('00', '01'),
	field('01', '11'),
	field('29', field('00', pp.AID_PROMPTPAY) + field('04', '0141234567890')),
	field('53', '764'),
	field('58', 'TH'),
].join('') + '6304';
assert.throws(() => pp.readQr(`${acctBody}${pp.crc16(acctBody)}`), /qr_bank_account/);
ok('a bank-account proxy is refused with its own reason');

assert.throws(() => pp.readQr('https://example.com'), /qr_not_promptpay/);
assert.throws(() => pp.readQr(''), /qr_unreadable/);
assert.throws(() => pp.readQr(bankSlip('014', '014123456789012345')), /qr_not_promptpay/);
ok('a link, nothing, and a slip QR are each refused as not being an account');

// The name a bank prints in field 59 is a sensible default for the account
// name — except when it is a placeholder, which several apps emit.
const namedBody = [
	field('00', '01'),
	field('01', '11'),
	field('29', field('00', pp.AID_PROMPTPAY) + field('01', '0066812345678')),
	field('53', '764'),
	field('58', 'TH'),
	field('59', 'MR. SOMCHAI J'),
].join('') + '6304';
assert.strictEqual(pp.readQr(`${namedBody}${pp.crc16(namedBody)}`).accountName, 'MR. SOMCHAI J');

const naBody = namedBody.replace(field('59', 'MR. SOMCHAI J'), field('59', 'NA')).slice(0, -4) + '6304';
assert.strictEqual(pp.readQr(`${naBody}${pp.crc16(naBody)}`).accountName, null);
ok('the printed account name is taken, and its placeholder is not');

// The number is a real person's. Whatever the screen shows must not be enough
// to be worth harvesting out of a forwarded link.
assert.strictEqual(mine.masked, '081-xxx-5678');
assert.ok(!mine.masked.includes('1234'));
ok('an imported number is handed back already masked for display');

console.log('\nthe words on a bill');

const bill = [
	'ร้านหม่าล่าเจ๊หมวย',
	'ใบเสร็จรับเงิน',
	'เลขที่ 00123  โต๊ะ 5',
	'18/08/2569 20:14',
	'2 x หม่าล่าปิ้งย่าง        700.00',
	'1 x น้ำอัดลม               45.00',
	'ข้าวสวย                    30.00',
	'รวมย่อย                   775.00',
	'ค่าบริการ 10%              77.50',
	'ภาษีมูลค่าเพิ่ม 7%          59.68',
	'รวมทั้งสิ้น               912.18',
	'เงินสด                  1,000.00',
	'เงินทอน                    87.82',
].join('\n');

const read = receipt.readReceiptText(bill);

assert.strictEqual(read.items.length, 3);
assert.deepStrictEqual(read.items.map(i => i.amountSatang), [70000, 4500, 3000]);
ok('three dishes come off the bill with their prices');

assert.strictEqual(read.items[0].label, 'หม่าล่าปิ้งย่าง');
assert.strictEqual(read.items[0].quantity, 2);
ok('the quantity is taken out of the name rather than left in it');

// The table number and the receipt number are on a line with no price, and a
// reader that took the largest or the last number on every line would charge
// somebody ฿5 for sitting down.
assert.ok(!read.items.some(i => i.amountSatang === 500 || i.amountSatang === 12300));
ok('a table number and a receipt number are not read as prices');

// Cash tendered is larger than the bill and change is smaller. Either one read
// as the total is a wrong number that looks entirely plausible.
assert.strictEqual(read.totalSatang, 91218);
ok('the printed total is the total, not the cash handed over');

assert.strictEqual(read.subtotalSatang, 77500);
assert.strictEqual(read.serviceSatang, 7750);
assert.strictEqual(read.taxSatang, 5968);
ok('subtotal, service and tax are told apart from each other and from the total');

// The only evidence on offer: two independent readings of the same paper that
// agree. 775 of food, plus 59.68 of tax, plus 77.50 of service, is 912.18.
assert.strictEqual(read.reconciles, true);
ok('the lines add up to the printed total, and the reading says so');

// And it has to be capable of saying no, or saying yes means nothing.
const misread = receipt.readReceiptText(bill.replace('700.00', '100.00'));
assert.strictEqual(misread.reconciles, false);
ok('a misread line makes the reconciliation fail rather than pass quietly');

console.log('\nthe words on a transfer slip');

// Banking apps put the label on one line and the figure on the next, often in
// a much larger face. Read strictly line by line, the one number the whole
// slip exists to state has no label and goes unread.
const transfer = [
	'K PLUS',
	'โอนเงินสำเร็จ',
	'18 ส.ค. 69 14:32 น.',
	'จาก  นาย สมชาย ใจดี',
	'xxx-x-x1234-x',
	'ไปยัง  น.ส. มานี มีนา',
	'จำนวน:',
	'1,250.00 บาท',
	'ค่าธรรมเนียม: 0.00 บาท',
	'รหัสอ้างอิง: 014123456789012345',
].join('\n');

const sent = receipt.readReceiptText(transfer, { kind: 'slip' });
assert.strictEqual(sent.amountSatang, 125000);
assert.strictEqual(sent.amountSource, 'labelled');
ok('an amount printed under its own label on the next line is still found');

assert.deepStrictEqual(sent.parties, {
	sender: { name: 'นาย สมชาย ใจดี', accountTail: '1234' },
	receiver: { name: 'น.ส. มานี มีนา', accountTail: null },
});
ok('the sender, receiver, and only the visible account tail are separated from a slip');

const stackedParties = receipt.readTransferParties([
	'จาก', 'นาง ก คนจ่าย', 'กรุงไทย', 'XXX-X-XX093-7',
	'ไปยัง', 'นาย ข คนรับ', 'กรุงไทย', 'XXX-X-XX230-4',
	'จำนวนเงิน', '1,000.00 บาท',
].join('\n'));
assert.deepStrictEqual(stackedParties, {
	sender: { name: 'นาง ก คนจ่าย', accountTail: '0937' },
	receiver: { name: 'นาย ข คนรับ', accountTail: '2304' },
});
ok('stacked Krungthai-style party sections read without retaining full account numbers');

const noisyEnglishParties = receipt.readTransferParties([
	'From', 'to.', 'MR THIRD PARTY PAYER', 'XXX-X-XX123-4',
	'To', 'MR B CREDITOR', 'XXX-X-XX230-4',
].join('\n'));
assert.deepStrictEqual(noisyEnglishParties, {
	sender: { name: 'MR THIRD PARTY PAYER', accountTail: '1234' },
	receiver: { name: 'MR B CREDITOR', accountTail: '2304' },
});
ok('OCR noise beginning with to does not move the sender into the receiver field');

const noisyKtb = receipt.readReceiptText([
	'จำนวนเงิน', '1.000.00 บาท',
	'ค่าธรรมเนียม', '0.00 บาท',
	'วันที่ทำรายการ', '18 ส.ค. 2569 - 03:27',
].join('\n'), { kind: 'slip' });
assert.strictEqual(noisyKtb.amountSatang, 100000);
assert.deepStrictEqual(noisyKtb.when, { year: 2026, month: 8, day: 18, hour: 3, minute: 27 });
ok('common Thai OCR punctuation repairs 1.000.00 and picks the transaction clock, not the fee');

const sparseEnglishDate = receipt.readReceiptText([
	'Date', '', '2026-08-18 03:27', '', 'Amount', '', '1,000.00 THB',
].join('\n'), { kind: 'slip' });
assert.deepStrictEqual(sparseEnglishDate.when, { year: 2026, month: 8, day: 18, hour: 3, minute: 27 });
ok('sparse OCR blank rows do not separate a date label from its transaction clock');

// Eighteen digits of transaction reference is by far the largest number on the
// page, and the fallback when nothing is labelled is "take the largest figure".
// The reference has to be refused as money before it ever reaches that.
assert.strictEqual(receipt.moneyOn('รหัสอ้างอิง: 014123456789012345').length, 0);
assert.strictEqual(sent.amountSatang, 125000);
ok('a transaction reference is never mistaken for an amount');

assert.deepStrictEqual(sent.when, { year: 2026, month: 8, day: 18, hour: 14, minute: 32 });
ok('18 ส.ค. 69 is August 2026, not 1969');

// Thai apps shorten both calendars, and "26" and "69" are both this week.
assert.strictEqual(receipt.gregorianYear('2569'), 2026);
assert.strictEqual(receipt.gregorianYear('69'), 2026);
assert.strictEqual(receipt.gregorianYear('26'), 2026);
assert.strictEqual(receipt.gregorianYear('2026'), 2026);
ok('Buddhist and Gregorian years, long and short, all land on the same year');

// "ำ" arrives either as one character or as two that render identically. A
// keyword list matching only one of them fails silently on half the slips.
const decomposed = transfer.replace('จำนวน', 'จํานวน');
assert.notStrictEqual(decomposed, transfer);
assert.strictEqual(receipt.readReceiptText(decomposed, { kind: 'slip' }).amountSatang, 125000);
ok('the two ways of writing ำ are the same word to the keyword list');

console.log('\nmoney is money, and other numbers are not');

// Satang are integers everywhere in core and must not acquire a float here:
// 66.50 * 100 is 6649.999999999999.
assert.strictEqual(receipt.toSatang('66.50'), 6650);
assert.strictEqual(receipt.toSatang('1,234.05'), 123405);
assert.strictEqual(receipt.toSatang('0.01'), 1);
ok('satang survive the trip out of the text');

// OCR reads O for 0 and l for 1 constantly. Repairing is confined to tokens
// that are already numeric — repairing everywhere would rewrite the food.
assert.strictEqual(receipt.repairDigits('1O0.O0'), '100.00');
assert.strictEqual(receipt.repairDigits('ข้าวโพด'), 'ข้าวโพด');
assert.strictEqual(receipt.repairDigits('Som Tam'), 'Som Tam');
ok('digit repair fires on numbers and leaves words alone');

// A run of digits long enough to be a reference, an account or a phone number
// is not a price, whatever else is on the line.
assert.strictEqual(receipt.moneyOn('อ้างอิง 014123456789012345').length, 0);
assert.strictEqual(receipt.moneyOn('โทร 0812345678').length, 0);
ok('long bare digit runs are not offered as money');

assert.strictEqual(receipt.readReceiptText('').amountSatang, null);
assert.strictEqual(receipt.readReceiptText('ไม่มีอะไรเลย').amountSatang, null);
ok('a picture with nothing readable in it produces no amount rather than a zero');

console.log(`\n${n} checks passed\n`);
