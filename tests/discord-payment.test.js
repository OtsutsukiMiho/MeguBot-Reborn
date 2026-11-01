const assert = require('node:assert');
const QRCode = require('qrcode');
const promptpay = require('../core/promptpay.js');
const { readDiscordSlip } = require('../adapters/discord/payment-evidence.js');
const paymentCommand = require('../commands/utility/pay.js');
const { evidenceRows, renderEvidenceCard } = require('../adapters/payment-evidence-card.js');

function field(id, value) {
	return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

function bankSlip(bank, ref) {
	const inner = field('00', '000001') + field('01', bank) + field('02', ref);
	const body = `${field('00', inner)}9104`;
	return `${body}${promptpay.crc16(body)}`;
}

async function main() {
	const commandOptions = paymentCommand.data.toJSON().options;
	let optionalSeen = false;
	for (const option of commandOptions) {
		if (!option.required) optionalSeen = true;
		assert.ok(!(optionalSeen && option.required), 'Discord requires every required option before optional options');
	}
	assert.deepStrictEqual(commandOptions.map(option => option.name), ['amount', 'slip', 'bill']);
	console.log('\n  ok  /pay serializes required options before the optional autocomplete field');

	const payload = bankSlip('006', 'DISCORD-TRANSFER-001');
	const image = await QRCode.toBuffer(payload, { width: 900, margin: 3 });
	const read = await readDiscordSlip(image, {
		recognizeText: async () => [
			'จาก', 'นาย คนอื่น โอนแทน', 'XXX-X-XX123-4',
			'ไปยัง', 'นาย บี เจ้าหนี้', 'XXX-X-XX230-4',
			'จำนวนเงิน', '100.00 บาท',
			'วันที่ทำรายการ', '18 ส.ค. 2569 - 03:27',
		].join('\n'),
	});

	assert.strictEqual(read.slip.bank.short, 'KTB');
	assert.strictEqual(read.slip.transRef, 'DISCORD-TRANSFER-001');
	assert.strictEqual(read.read.amountSatang, 10000);
	assert.strictEqual(read.read.parties.sender.accountTail, '1234');
	assert.strictEqual(read.read.parties.receiver.accountTail, '2304');
	assert.deepStrictEqual(read.read.when, { year: 2026, month: 8, day: 18, hour: 3, minute: 27 });
	assert.strictEqual(read.text, undefined, 'raw OCR must not escape the intake boundary');
	assert.strictEqual(read.evidenceImage, undefined, 'no card is drawn until the payment is confirmed');
	assert.deepStrictEqual([...read.normalizedImage.subarray(0, 3)], [255, 216, 255]);
	assert.strictEqual(read.normalizedMime, 'image/jpeg');
	await assert.rejects(readDiscordSlip(Buffer.from('not really an image')), /slip_unreadable/);
	console.log('\n  ok  /pay decodes the bank QR, keeps only account tails, drops raw OCR, and draws no card yet');

	// The evidence card names the payer as the bill does. The name and digits
	// of the sender's bank account are not drawn, and the reference is cut.
	const rows = Object.fromEntries(evidenceRows(read.slip, read.read, { payerName: 'Mina' }));
	assert.strictEqual(rows['ผู้จ่าย'], 'Mina');
	assert.strictEqual(rows['ไปยัง'], 'นาย บี เจ้าหนี้');
	assert.strictEqual(rows['จำนวนเงิน'], '100.00 บาท');
	assert.strictEqual(rows['เลขอ้างอิง'], '•••• -001');
	const drawn = JSON.stringify(rows);
	assert.doesNotMatch(drawn, /คนอื่น|1234|2304|DISCORD-TRANSFER/);
	const png = await renderEvidenceCard(read.slip, read.read, new Date(), { payerName: 'Mina' });
	assert.deepStrictEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
	console.log('\n  ok  the evidence card shows the payer from the bill, no sender account, and only the end of the reference');
}

main().catch((error) => {
	console.error('\nFAILED:', error.message, '\n', error.stack);
	process.exitCode = 1;
});
