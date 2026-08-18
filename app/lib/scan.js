'use client';

// Pictures are reduced here before upload so a phone sends a few hundred
// kilobytes instead of several megabytes. QR import previews can also be read
// locally. Payment authorization never trusts these client-side readings: the
// backend decodes the uploaded pixels again before it can auto-confirm.

// A slip photographed on a modern phone is three to six megabytes of detail
// nobody needs. An amount, a name and a time all survive a long edge of 1600px
// comfortably, and that is also enough resolution for the small QR printed on
// the slip to still decode.
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

/**
 * Whatever came out of the photo library, drawn onto a canvas at a size worth
 * working with.
 *
 * `maxEdge: 0` means "leave it alone", which is what the second pass of
 * `scanQr` wants when the first pass found nothing.
 */
async function drawToCanvas(file, maxEdge = MAX_EDGE) {
	const dataUrl = await new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = () => reject(new Error('image_unreadable'));
		reader.readAsDataURL(file);
	});

	const image = await new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('image_unreadable'));
		img.src = dataUrl;
	});

	const scale = maxEdge ? Math.min(1, maxEdge / Math.max(image.width, image.height)) : 1;
	const width = Math.max(1, Math.round(image.width * scale));
	const height = Math.max(1, Math.round(image.height * scale));

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	ctx.drawImage(image, 0, 0, width, height);

	return { canvas, ctx, width, height };
}

/**
 * Find a QR in a canvas and return what it says, or null.
 *
 * `attemptBoth` covers slips printed light-on-dark, which some banking apps
 * produce in dark mode and which a decoder will otherwise stare straight past.
 */
async function scanCanvas({ ctx, width, height }) {
	const { default: jsQR } = await import('jsqr');
	const pixels = ctx.getImageData(0, 0, width, height);
	const found = jsQR(pixels.data, width, height, { inversionAttempts: 'attemptBoth' });
	return found?.data ? String(found.data).trim() || null : null;
}

/**
 * Read the QR out of a picture.
 *
 * Two passes, and the second one matters more than it looks: a screenshot of a
 * banking app is mostly interface, so the QR inside it can be a couple of
 * hundred pixels once the shot has been shrunk to fit a phone's upload budget.
 * Failing on that would send people back to typing thirteen digits by hand,
 * which is the thing this exists to avoid. So a miss is retried at the image's
 * own resolution before it is called a miss.
 */
async function scanQr(file) {
	const small = await drawToCanvas(file, MAX_EDGE);
	const found = await scanCanvas(small);
	if (found) return found;

	// Nothing was shrunk, so a second pass would be the same pass.
	if (Math.max(small.width, small.height) < MAX_EDGE) return null;
	return scanCanvas(await drawToCanvas(file, 0));
}

/**
 * Shrink a picture for sending, and read its QR on the way past.
 *
 * The QR is a bonus, never a requirement: a slip that will not decode is still
 * perfectly good evidence for a human to look at.
 */
async function prepareUpload(file, { scan = true } = {}) {
	const drawn = await drawToCanvas(file, MAX_EDGE);

	let text = null;
	try {
		if (!scan) {
			return {
				dataUrl: drawn.canvas.toDataURL('image/jpeg', JPEG_QUALITY),
				canvas: drawn.canvas,
				text: null,
			};
		}
		text = await scanCanvas(drawn);
		if (!text && Math.max(drawn.width, drawn.height) >= MAX_EDGE) {
			text = await scanCanvas(await drawToCanvas(file, 0));
		}
	}
	catch {
		// The QR is a bonus. A decoder that threw — an image too large for the
		// worker, a browser without the API — must not take the upload down
		// with it, because the picture is still perfectly good evidence.
	}

	return {
		dataUrl: drawn.canvas.toDataURL('image/jpeg', JPEG_QUALITY),
		canvas: drawn.canvas,
		text,
	};
}

module.exports = { drawToCanvas, scanCanvas, scanQr, prepareUpload, MAX_EDGE };
