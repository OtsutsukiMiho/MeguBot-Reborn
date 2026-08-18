const path = require('node:path');
const QRCode = require('qrcode');
const sharp = require('sharp');
const promptpay = require('../core/promptpay.js');

function field(id, value) {
	return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

function slipPayload(bank, reference) {
	const inner = field('00', '000001') + field('01', bank) + field('02', reference);
	const body = `${field('00', inner)}9104`;
	return `${body}${promptpay.crc16(body)}`;
}

async function main() {
	const output = path.resolve(process.argv[2] || 'megu-payment-slip-fixture.png');
	const payload = slipPayload('006', `MEGU-FIXTURE-${Date.now()}`);
	const qr = await QRCode.toBuffer(payload, { width: 330, margin: 2, errorCorrectionLevel: 'M' });
	const svg = `<svg width="1080" height="1500" xmlns="http://www.w3.org/2000/svg">
		<rect width="1080" height="1500" fill="#ffffff"/>
		<style>text{font-family:Arial,Tahoma,sans-serif;fill:#111827}.small{font-size:30px;fill:#64748b}.label{font-size:34px;fill:#475569}.value{font-size:44px;font-weight:700}.amount{font-size:76px;font-weight:800}</style>
		<text x="70" y="100" font-size="56" font-weight="800">Krungthai test slip</text>
		<text x="70" y="160" font-size="42" fill="#15803d">Transfer successful</text>
		<text x="70" y="250" class="label">Reference</text>
		<text x="70" y="305" class="value">MEGU FIXTURE</text>
		<text x="70" y="430" class="label">From</text>
		<text x="70" y="490" class="value">MR THIRD PARTY PAYER</text>
		<text x="70" y="540" class="small">XXX-X-XX123-4</text>
		<text x="70" y="670" class="label">To</text>
		<text x="70" y="730" class="value">MR B CREDITOR</text>
		<text x="70" y="780" class="small">XXX-X-XX230-4</text>
		<text x="70" y="930" class="label">Amount</text>
		<text x="70" y="1020" class="amount">1,000.00 THB</text>
		<text x="70" y="1140" class="label">Fee</text>
		<text x="70" y="1195" class="value">0.00 THB</text>
		<text x="70" y="1320" class="label">Date</text>
		<text x="70" y="1380" class="value">2026-08-18 03:27</text>
		<text x="70" y="1450" class="small">Generated locally for Megu browser testing</text>
	</svg>`;
	await sharp(Buffer.from(svg)).composite([{ input: qr, left: 680, top: 180 }]).png().toFile(output);
	console.log(output);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
