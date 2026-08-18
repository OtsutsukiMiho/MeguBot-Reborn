'use client';

import { useRef, useState } from 'react';
import { scanQr } from '../lib/scan';
import { readQr } from '../../core/promptpay.js';

/**
 * Import an account from the QR the bank already gave you.
 *
 * Every Thai banking app will hand its owner a PromptPay QR as a picture, and
 * that picture contains the number in a form no one can mistype. Asking someone
 * to read thirteen digits off it and enter them by hand is asking for the one
 * transposed pair that quietly sends a group's money to a stranger — a wrong
 * number does not fail, it succeeds at paying somebody else.
 *
 * The picture is never uploaded. It is decoded here, the account comes out, and
 * the image is dropped — what gets saved is the same field a person could have
 * typed, so nothing downstream has to learn about images.
 */
export default function QrPicker({ onRead, label, busyLabel, disabled }) {
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
			const text = await scanQr(file);
			if (!text) return onRead({ error: 'qr_unreadable' });
			onRead(readQr(text));
		}
		catch (error) {
			// `readQr` throws a code per reason — a shop's bill-payment code, a
			// bank-account proxy, or not a payment code at all — and each of
			// those is a different thing for the reader to do next.
			onRead({ error: error?.message || 'qr_unreadable' });
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
				className="btn btn-secondary btn-sm"
				disabled={disabled || working}
				onClick={() => inputRef.current?.click()}
			>
				{working ? busyLabel : label}
			</button>
		</>
	);
}
