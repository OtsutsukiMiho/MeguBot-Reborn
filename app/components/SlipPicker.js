'use client';

import { useRef, useState } from 'react';
import { prepareUpload } from '../lib/scan';

/**
 * Shrink the selected photo before upload. QR/OCR decisions are deliberately
 * made from these pixels again on the server; browser-provided structured
 * fields are editable request data and can never authorize a payment.
 */
async function prepare(file) {
	const { dataUrl } = await prepareUpload(file, { scan: false });
	return { dataUrl };
}

/**
 * @param {object} props
 * @param {(slip: {dataUrl: string}|{error: string}) => void} props.onPicked
 */
export default function SlipPicker({ onPicked, label, busyLabel, readingLabel, disabled }) {
	const inputRef = useRef(null);
	const [stage, setStage] = useState(null);

	async function handle(event) {
		const file = event.target.files?.[0];
		// Clear it straight away, or picking the same file twice in a row after
		// a failure fires no change event and the button appears dead.
		event.target.value = '';
		if (!file) return;

		setStage('preparing');
		try {
			const prepared = await prepare(file);
			onPicked(prepared);
		}
		catch {
			onPicked({ error: 'slip_unreadable' });
		}
		finally {
			setStage(null);
		}
	}

	const working = stage != null;
	const busyText = readingLabel || busyLabel;

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
				{working ? busyText : label}
			</button>
		</>
	);
}
