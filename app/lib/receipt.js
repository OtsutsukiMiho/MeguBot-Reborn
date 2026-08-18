'use client';

// The OCR side of reading a slip: get words out of a picture, then hand them to
// `core/receipt.js`, which is where all the judgement lives and where it can be
// tested without a browser.
//
// Everything runs on the device. The engine is served from this origin (see
// `scripts/vendor-ocr.js`), the picture never leaves the phone, and the only
// thing that reaches the server is what the person chose to attach.

const { readReceiptText } = require('../../core/receipt.js');

const OCR_BASE = '/ocr';

// Big enough for a phone camera's text to survive, small enough that a mid-range
// Android is not holding a stalled page for a minute. Tesseract wants roughly
// 30px of glyph height; a 2000px-tall receipt photo gets close on the item
// lines and comfortably clears it on the amount, which is the line that matters.
const OCR_EDGE = 2000;

let enginePromise = null;
let available = null;

/**
 * Is the reader installed on this deployment at all?
 *
 * The engine is build output, not source, so a checkout that has never run
 * `npm run ocr:setup` genuinely does not have it. That is a different situation
 * from "reading failed", and the interface says a different thing about it:
 * one is a missing feature, the other is a bad photograph.
 */
async function ocrAvailable() {
	if (available != null) return available;
	try {
		const res = await fetch(`${OCR_BASE}/manifest.json`, { cache: 'force-cache' });
		available = res.ok;
	}
	catch {
		available = false;
	}
	return available;
}

/**
 * One worker, kept alive for the session.
 *
 * Starting it costs several megabytes and a couple of seconds, and somebody
 * attaching a slip will very often attach another one a minute later. Paying
 * that twice would be paying it on the mobile data of the person who is already
 * the one out of pocket.
 */
async function engine(languages) {
	if (enginePromise) return enginePromise;

	enginePromise = (async () => {
		const { createWorker, OEM, PSM } = await import('tesseract.js');
		const worker = await createWorker(languages, OEM.LSTM_ONLY, {
			workerPath: `${OCR_BASE}/worker.min.js`,
			corePath: OCR_BASE,
			langPath: `${OCR_BASE}/lang`,
			gzip: true,
			// The language data is a few megabytes that never changes. Letting
			// the browser keep it means the second slip is instant.
			cacheMethod: 'write',
		});

		// The single most important line in this file, and the least obvious.
		//
		// Tesseract defaults to treating the picture as one uniform block of
		// text, and on a bank slip that quietly deletes the amount: the figure
		// is set two or three times the size of everything around it, and
		// layout analysis discards it as an outlier rather than reading it. The
		// result is text containing the word "Amount:" with nothing after it —
		// no error, no warning, just the one number the slip exists to state,
		// gone. Verified against a rendered slip: SINGLE_BLOCK loses it,
		// SINGLE_COLUMN reads it.
		//
		// A slip and a restaurant bill are both exactly what this mode is for:
		// one column, many sizes.
		await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN });
		return worker;
	})();

	try {
		return await enginePromise;
	}
	catch (error) {
		// A failed start must not poison every later attempt.
		enginePromise = null;
		throw error;
	}
}

/**
 * Flatten the picture to grey before recognising it.
 *
 * Thermal paper photographed indoors comes out warm and unevenly lit, and a
 * colour cast pushes Tesseract's thresholding around — the pale half of a
 * curling receipt goes to white and takes the prices with it. Luminance with
 * the ordinary coefficients, then a gentle contrast stretch about the midpoint,
 * is enough; anything more aggressive starts erasing thin Thai strokes, which
 * costs more than it buys.
 */
function flatten(source) {
	const scale = Math.min(1, OCR_EDGE / Math.max(source.width, source.height));
	const width = Math.max(1, Math.round(source.width * scale));
	const height = Math.max(1, Math.round(source.height * scale));

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	ctx.drawImage(source, 0, 0, width, height);

	const frame = ctx.getImageData(0, 0, width, height);
	const pixels = frame.data;
	for (let i = 0; i < pixels.length; i += 4) {
		const grey = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
		const stretched = Math.max(0, Math.min(255, (grey - 128) * 1.35 + 128));
		pixels[i] = stretched;
		pixels[i + 1] = stretched;
		pixels[i + 2] = stretched;
	}
	ctx.putImageData(frame, 0, 0);

	return canvas;
}

/**
 * Read a picture of a slip or a bill.
 *
 * `kind` picks the languages as well as the parsing. A transfer slip is a bank
 * app's own interface — numbers, and Thai words this file never needs to read
 * correctly, since the amount is what is wanted and the amount is digits. A
 * restaurant bill is the opposite: the dish names are the point, so Thai is
 * loaded, and it is loaded only then, because it is another download on a
 * connection somebody is standing in a carpark with.
 *
 * @param {HTMLCanvasElement|HTMLImageElement} image
 * @param {{kind?: 'slip'|'receipt', onProgress?: (fraction: number) => void}} [options]
 */
async function readReceipt(image, { kind = 'slip', onProgress } = {}) {
	if (!await ocrAvailable()) throw new Error('ocr_unavailable');

	// Transfer slips need Thai too: sender and receiver names are part of the
	// minimum dispute evidence and English-only OCR drops them entirely.
	const languages = 'tha+eng';
	const worker = await engine(languages);

	// A worker started for a slip is holding English only; a bill needs Thai as
	// well. Reloading is cheaper than a second worker, and the language data is
	// already in the browser's cache by the second time.
	if (kind === 'receipt') await worker.reinitialize('tha+eng');

	onProgress?.(0.1);
	const { data } = await worker.recognize(flatten(image));
	onProgress?.(1);

	const reading = readReceiptText(data?.text || '', { kind });

	return {
		...reading,
		text: data?.text || '',
		// Tesseract's own confidence, 0–100. Not a probability the amount is
		// right — a crisp misreading scores well — so it is used to decide
		// whether to show a reading at all, never to endorse one.
		confidence: typeof data?.confidence === 'number' ? data.confidence : null,
	};
}

/**
 * Let the worker go.
 *
 * It holds tens of megabytes of WebAssembly heap, which matters on the phone
 * this is aimed at, so the page drops it when the panel that needed it closes.
 */
async function releaseReceiptReader() {
	if (!enginePromise) return;
	const pending = enginePromise;
	enginePromise = null;
	try {
		(await pending).terminate();
	}
	catch {
		// A worker that never finished starting, or has already gone. Either
		// way there is nothing left to release and nothing to report.
	}
}

/**
 * The clock printed on a slip, as the text it was printed in.
 *
 * No timezone is attached and none is guessed at: a slip says 14:32 in Bangkok
 * and says nothing else. Turning that into an instant would be making up the
 * part nobody wrote down — and this codebase has already lost a month's billing
 * to exactly that mistake once.
 */
function stampWhen(when) {
	if (!when?.year) return null;
	const date = `${when.year}-${String(when.month).padStart(2, '0')}-${String(when.day).padStart(2, '0')}`;
	if (when.hour == null) return date;
	return `${date} ${String(when.hour).padStart(2, '0')}:${String(when.minute ?? 0).padStart(2, '0')}`;
}

module.exports = { readReceipt, releaseReceiptReader, ocrAvailable, stampWhen };
