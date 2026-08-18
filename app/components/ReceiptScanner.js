'use client';

import { useRef, useState } from 'react';
import { useCopy } from '../copy';
import { drawToCanvas } from '../lib/scan';
import { readReceipt, releaseReceiptReader } from '../lib/receipt';

/**
 * Photograph the bill, and get the bill.
 *
 * The case this is for: eleven people, one long receipt, and somebody at the
 * table typing dish names into a phone while everyone else waits. The receipt
 * already has the list on it. Reading it back off the paper is strictly less
 * work than retyping it, even allowing for the corrections — and corrections
 * are expected, which is why nothing here is saved until a human has looked at
 * every line.
 *
 * Three rules shape the whole component:
 *
 *   Nothing is added silently. What OCR read is a filled-in form, not a
 *   transaction. Every line can be edited, unticked, or thrown away, and the
 *   button that commits says how many rows and how much.
 *
 *   The total is the arbiter. A restaurant printed one number at the bottom and
 *   that is what was charged; if the lines this read do not add up to it, that
 *   is said out loud rather than papered over. Two readings that agree is the
 *   only evidence on offer here, and its absence is worth as much as its
 *   presence.
 *
 *   Reading is never the same act as paying. This produces expenses, which is
 *   the thing the group then splits — it does not touch anybody's claim to have
 *   paid, and it never marks anything settled.
 */
export default function ReceiptScanner({ participants, defaultPaidBy, shareParticipantIds, busy, call, periodId, onDone }) {
	const { t, fmt } = useCopy();
	const inputRef = useRef(null);

	const [stage, setStage] = useState(null);
	const [reading, setReading] = useState(null);
	const [rows, setRows] = useState([]);
	const [paidBy, setPaidBy] = useState(defaultPaidBy || participants[0]?.id || '');
	const [problem, setProblem] = useState('');
	const [saving, setSaving] = useState(false);

	function reset() {
		setReading(null);
		setRows([]);
		setProblem('');
		// The recogniser holds tens of megabytes of WebAssembly heap, and this
		// is a phone. Closing the panel is the moment to give it back.
		releaseReceiptReader();
		onDone?.();
	}

	async function pick(event) {
		const file = event.target.files?.[0];
		event.target.value = '';
		if (!file) return;

		setProblem('');
		setStage('preparing');
		try {
			const { canvas } = await drawToCanvas(file, 0);
			setStage('reading');
			const result = await readReceipt(canvas, { kind: 'receipt' });

			setReading(result);
			setRows(result.items.map((item, index) => ({
				id: `${index}`,
				include: true,
				label: item.quantity && item.quantity > 1 ? `${item.label} ×${item.quantity}` : item.label,
				baht: (item.amountSatang / 100).toFixed(2),
			})));

			// A picture that produced nothing is not an error — it is a bad
			// photograph, and the fix is another photograph, not a bug report.
			if (result.items.length === 0 && result.amountSatang == null) setProblem(t.receipt.nothingFound);
		}
		catch (error) {
			setProblem(error?.message === 'ocr_unavailable' ? t.receipt.unavailable : t.receipt.failed);
		}
		finally {
			setStage(null);
		}
	}

	function edit(id, patch) {
		setRows(list => list.map(row => (row.id === id ? { ...row, ...patch } : row)));
	}

	const chosen = rows.filter(row => row.include && Number(row.baht) > 0);
	const chosenSatang = chosen.reduce((sum, row) => sum + Math.round(Number(row.baht) * 100), 0);

	// Against the number the restaurant printed, not against what this read.
	const printed = reading?.totalSatang ?? null;
	const agrees = printed != null ? chosenSatang === printed : null;

	/**
	 * Add the ticked lines as expenses, one at a time.
	 *
	 * Sequential rather than concurrent, and it stops at the first failure with
	 * a count of what did land. A half-added bill is confusing; a half-added
	 * bill that will not say how far it got is worse, and the alternative —
	 * firing eleven requests and reporting whichever rejected — leaves the
	 * ledger in a state nobody can reason about.
	 */
	async function addAll() {
		if (chosen.length === 0) return;
		setSaving(true);
		setProblem('');

		let added = 0;
		try {
			for (const row of chosen) {
				await call('POST', '/expenses', {
					label: row.label.trim() || t.receipt.untitled,
					amountBaht: Number(row.baht),
					paidBy,
					shareParticipantIds,
					periodId: periodId || undefined,
				});
				added++;
			}
			reset();
		}
		catch {
			setProblem(added > 0 ? t.receipt.partial(added, chosen.length) : t.receipt.failed);
		}
		finally {
			setSaving(false);
		}
	}

	const working = stage != null;

	return (
		<div className="receipt-scan">
			<input
				ref={inputRef}
				type="file"
				accept="image/*"
				capture="environment"
				onChange={pick}
				style={{ display: 'none' }}
				tabIndex={-1}
			/>

			{!reading && (
				<>
					<button
						type="button"
						className="btn btn-secondary btn-block"
						disabled={busy || working}
						onClick={() => inputRef.current?.click()}
					>
						{stage === 'reading' ? t.receipt.reading : stage === 'preparing' ? t.common.saving : t.receipt.scan}
					</button>
					<small className="quiet-note">{t.receipt.hint}</small>
				</>
			)}

			{problem && <div className="error-note">{problem}</div>}

			{reading && (
				<div className="receipt-result">
					<div className="receipt-head">
						<span className="field-label" style={{ margin: 0 }}>{t.receipt.found(rows.length)}</span>
						<button type="button" className="link-btn" onClick={reset}>{t.common.close}</button>
					</div>

					{/* The caveat sits above the numbers, not below them. Someone
					    who reads one line before acting should read this one. */}
					<p className="quiet-note">{t.receipt.checkNote}</p>

					<ul className="receipt-lines">
						{rows.map(row => (
							<li key={row.id} className={row.include ? '' : 'receipt-line-off'}>
								<label className="receipt-tick">
									<input
										type="checkbox"
										checked={row.include}
										onChange={e => edit(row.id, { include: e.target.checked })}
										aria-label={t.receipt.includeLine(row.label)}
									/>
								</label>
								<input
									className="form-control inline-input"
									value={row.label}
									onChange={e => edit(row.id, { label: e.target.value })}
									aria-label={t.expenses.labelField}
								/>
								<input
									className="form-control inline-input receipt-amount"
									type="number"
									min="0"
									step="0.01"
									value={row.baht}
									onChange={e => edit(row.id, { baht: e.target.value })}
									aria-label={t.expenses.amountField}
								/>
							</li>
						))}
					</ul>

					<div className="receipt-sums">
						<span>{t.receipt.selected(chosen.length)}</span>
						<strong>{fmt.money(chosenSatang)}</strong>
					</div>

					{printed != null && (
						<div className={`receipt-check ${agrees ? 'ok' : 'off'}`}>
							{agrees
								? t.receipt.matchesPrinted(fmt.money(printed))
								: t.receipt.differsFromPrinted(fmt.money(printed), fmt.money(Math.abs(printed - chosenSatang)))}
						</div>
					)}

					{/* Service and tax are charges on the bill, not dishes. They
					    are read and shown, and adding them is a decision rather
					    than something that happens on the way past. */}
					{(reading.serviceSatang != null || reading.taxSatang != null) && (
						<div className="receipt-extras">
							{reading.serviceSatang != null && (
								<button type="button" className="link-btn" onClick={() => setRows(list => [...list, { id: `svc-${list.length}`, include: true, label: t.receipt.serviceLine, baht: (reading.serviceSatang / 100).toFixed(2) }])}>
									{t.receipt.addService(fmt.money(reading.serviceSatang))}
								</button>
							)}
							{reading.taxSatang != null && (
								<button type="button" className="link-btn" onClick={() => setRows(list => [...list, { id: `vat-${list.length}`, include: true, label: t.receipt.taxLine, baht: (reading.taxSatang / 100).toFixed(2) }])}>
									{t.receipt.addTax(fmt.money(reading.taxSatang))}
								</button>
							)}
						</div>
					)}

					{participants.length > 1 && (
						<select
							className="form-control"
							value={paidBy}
							onChange={e => setPaidBy(e.target.value)}
							aria-label={t.expenses.payerField}
						>
							{participants.map(p => <option key={p.id} value={p.id}>{t.expenses.payerOption(p.displayName)}</option>)}
						</select>
					)}

					<div className="receipt-actions">
						<button
							type="button"
							className="btn btn-primary btn-block"
							disabled={busy || saving || chosen.length === 0}
							onClick={addAll}
						>
							{saving ? t.common.saving : t.receipt.addAll(chosen.length, fmt.money(chosenSatang))}
						</button>

						{/* One expense for the whole bill, for the group that
						    splits the total evenly and does not care which dish
						    was whose. It is a different intent, not a fallback. */}
						{printed != null && (
							<button
								type="button"
								className="link-btn"
								disabled={busy || saving}
								onClick={() => setRows([{ id: 'whole', include: true, label: t.receipt.wholeBill, baht: (printed / 100).toFixed(2) }])}
							>
								{t.receipt.asOneLine(fmt.money(printed))}
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
