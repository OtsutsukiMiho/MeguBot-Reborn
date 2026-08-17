'use client';

import { useRef, useState } from 'react';

// A slip photographed on a modern phone is three to six megabytes of detail
// nobody needs. What the owner has to read is an amount, a name and a time —
// all of which survive a long edge of 1600px comfortably, and that is also
// enough resolution for the small QR printed on the slip to still decode.
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

/**
 * Turn whatever came out of the photo library into something small enough to
 * send, and read the transaction reference off it on the way past.
 *
 * Both steps happen here, in the browser, on purpose. Shrinking here keeps
 * megabytes off a phone's mobile data; reading the QR here means the server
 * never has to decode an image, which is the one place in this stack where a
 * malicious file would be worth sending.
 */
async function prepare(file) {
	const dataUrl = await new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = () => reject(new Error('slip_unreadable'));
		reader.readAsDataURL(file);
	});

	const image = await new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('slip_unreadable'));
		img.src = dataUrl;
	});

	const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
	const width = Math.max(1, Math.round(image.width * scale));
	const height = Math.max(1, Math.round(image.height * scale));

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	ctx.drawImage(image, 0, 0, width, height);

	// The reference is a bonus, never a requirement: a slip that will not
	// decode is still perfectly good evidence for a human to look at. So this
	// is allowed to fail quietly and hand back null.
	let ref = null;
	try {
		const { default: jsQR } = await import('jsqr');
		const pixels = ctx.getImageData(0, 0, width, height);
		const found = jsQR(pixels.data, width, height, { inversionAttempts: 'attemptBoth' });
		if (found?.data) ref = String(found.data).trim().slice(0, 200) || null;
	}
	catch {}

	return { dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY), ref };
}

/**
 * @param {object} props
 * @param {(slip: {dataUrl: string, ref: string|null}) => void} props.onPicked
 */
export default function SlipPicker({ onPicked, label, busyLabel, disabled }) {
	const inputRef = useRef(null);
	const [working, setWorking] = useState(false);

	async function handle(event) {
		const file = event.target.files?.[0];
		// Clear it straight away, or picking the same file twice in a row after
		// a failure fires no change event and the button appears dead.
		event.target.value = '';
		if (!file) return;

		setWorking(true);
		try {
			onPicked(await prepare(file));
		}
		catch {
			onPicked({ error: 'slip_unreadable' });
		}
		finally {
			setWorking(false);
		}
	}

	return (
		<>
			<input
				ref={inputRef}
				type="file"
				accept="image/*"
				onChange={handle}
				style={{ display: 'none' }}
				tabIndex={-1}
			/>
			<button
				type="button"
				className="btn btn-secondary btn-block"
				disabled={disabled || working}
				onClick={() => inputRef.current?.click()}
			>
				{working ? busyLabel : label}
			</button>
		</>
	);
}
