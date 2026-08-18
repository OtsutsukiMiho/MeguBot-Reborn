const path = require('node:path');
const sharp = require('sharp');
const jsQR = require('jsqr');
const { createWorker, OEM, PSM } = require('tesseract.js');
const { readSlipQr } = require('../../core/slip.js');
const { readReceiptText } = require('../../core/receipt.js');
const { renderEvidenceCard, stampWhen } = require('../payment-evidence-card.js');

const MAX_EDGE = 2000;
const MAX_INPUT_PIXELS = 40_000_000;

/** Decode once at a bounded size and re-encode without source metadata. The
 * normalized image is the only temporary original we retain, so EXIF/GPS and
 * parser-specific payloads never enter the payment ledger. */
async function normalizeSlipImage(image) {
	try {
		return await sharp(image, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
			.rotate()
			.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
			.flatten({ background: '#ffffff' })
			.jpeg({ quality: 90, mozjpeg: true })
			.toBuffer();
	}
	catch {
		const error = new Error('slip_unreadable');
		error.code = 'slip_unreadable';
		throw error;
	}
}

async function decodeSlipQr(image) {
	const { data, info } = await sharp(image)
		.rotate()
		.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height, {
		inversionAttempts: 'attemptBoth',
	});
	return decoded?.data || null;
}

async function ocrSlip(image) {
	const worker = await createWorker('tha+eng', OEM.LSTM_ONLY, {
		langPath: path.join(__dirname, '..', '..', 'public', 'ocr', 'lang'),
		gzip: true,
		logger: () => undefined,
	});
	try {
		await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
		const result = await worker.recognize(image);
		return result?.data?.text || '';
	}
	finally {
		await worker.terminate().catch(() => undefined);
	}
}

/** Read in memory and return only structured fields plus a newly-rendered
 * evidence card. The OCR transcript is deliberately dropped here. */
async function readPaymentSlip(image, { recognizeText = ocrSlip } = {}) {
	const normalizedImage = await normalizeSlipImage(image);
	const [qrPayload, text] = await Promise.all([
		decodeSlipQr(normalizedImage).catch(() => null),
		recognizeText(normalizedImage).catch(() => ''),
	]);
	const slip = qrPayload ? readSlipQr(qrPayload) : null;
	const parsed = readReceiptText(text, { kind: 'slip' });
	const read = {
		amountSatang: parsed.amountSatang || null,
		when: parsed.when || null,
		parties: parsed.parties || null,
	};
	const evidenceImage = slip ? await renderEvidenceCard(slip, read) : null;
	return { qrPayload, slip, read, evidenceImage, normalizedImage, normalizedMime: 'image/jpeg' };
}

// Kept as an alias for the command adapter; web and Discord must pass through
// the same server-side reader so neither transport can invent OCR fields.
const readDiscordSlip = readPaymentSlip;

module.exports = {
	decodeSlipQr,
	normalizeSlipImage,
	ocrSlip,
	readPaymentSlip,
	renderEvidenceCard,
	readDiscordSlip,
	stampWhen,
};
