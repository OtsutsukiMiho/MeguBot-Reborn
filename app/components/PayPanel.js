'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCopy } from '../copy';
import SlipPicker from './SlipPicker';
import SlipReading from './SlipReading';

/**
 * The screen where someone actually parts with money.
 *
 * Two things shape it, and neither is obvious from a desk:
 *
 * 1. The reader is on the phone they would scan with. A QR on the screen you
 *    are holding cannot be scanned by the camera on the back of that same
 *    screen — so saving the image and letting the banking app read it out of
 *    the photo library is the primary path, not a fallback, and the number is
 *    offered in copyable text beside it for anyone who would rather type.
 *
 * 2. The amount is stated three times: as the figure, inside the QR, and on
 *    the copy button. Retyping ฿60 as ฿6 is the mistake this page exists to
 *    remove, and repetition is cheap.
 *
 * The full PromptPay number is never printed — it goes on the clipboard, and
 * the masked form goes on the screen. Screens get photographed and shared into
 * the same group chat the link came from.
 */
export default function PayPanel({ code, payTo, amountSatang, periodId, periods = [], pending, busy, call, onError }) {
	const { t, fmt } = useCopy();
	const [flash, setFlash] = useState('');
	const [saving, setSaving] = useState(false);
	const [attaching, setAttaching] = useState(false);
	const [selected, setSelected] = useState({});
	const [amounts, setAmounts] = useState({});
	const payablePeriods = useMemo(() => periods
		.map(period => ({ ...period, available: Math.max(0, (period.outstandingSatang || 0) - (period.pendingSatang || 0)) }))
		.filter(period => period.available > 0)
		.sort((a, b) => a.key.localeCompare(b.key)), [periods]);

	useEffect(() => {
		if (!payablePeriods.length) return;
		setAmounts(previous => Object.fromEntries(payablePeriods.map(period => [
			period.id,
			previous[period.id] ?? (period.available / 100).toFixed(2),
		])));
		setSelected((previous) => {
			if (Object.values(previous).some(Boolean)) return previous;
			const initial = payablePeriods.find(period => period.id === periodId) || payablePeriods[0];
			return { [initial.id]: true };
		});
	}, [periodId, payablePeriods]);

	const allocations = useMemo(() => payablePeriods
		.filter(period => selected[period.id])
		.map((period) => {
			const satang = Math.round(Number(amounts[period.id]) * 100);
			return { periodId: period.id, amountSatang: satang, available: period.available };
		})
		.filter(allocation => Number.isSafeInteger(allocation.amountSatang) && allocation.amountSatang > 0 && allocation.amountSatang <= allocation.available)
		.map(({ periodId: id, amountSatang: value }) => ({ periodId: id, amountSatang: value })),
	[amounts, payablePeriods, selected]);
	const chosenAmount = payablePeriods.length
		? allocations.reduce((sum, allocation) => sum + allocation.amountSatang, 0)
		: amountSatang;
	const payAmount = pending?.transferAmountSatang || chosenAmount;
	const allocationInvalid = payablePeriods.length > 0
		&& allocations.length !== payablePeriods.filter(period => selected[period.id]).length;
	const claimBody = payablePeriods.length > 0 ? { allocations } : (periodId ? { periodId } : undefined);

	const qrUrl = `/api/megu/a/${code}/qr?amount=${payAmount}${periodId ? `&period=${periodId}` : ''}`;

	function say(message) {
		setFlash(message);
		setTimeout(() => setFlash(''), 2000);
	}

	async function copy(text, message) {
		try {
			await navigator.clipboard.writeText(text);
			say(message);
		}
		catch {
			// Clipboard access is refused on insecure origins and in some
			// in-app browsers. Selecting the text by hand still works, so this
			// is not worth an error banner.
		}
	}

	/**
	 * Get the QR into the photo library.
	 *
	 * The share sheet is tried first because on iOS it is the only route that
	 * reliably offers "Save Image"; a download attribute there tends to open
	 * the file rather than store it. Everywhere else the download is the
	 * shorter path, so it is the fallback rather than the other way round.
	 */
	async function saveQr() {
		setSaving(true);
		try {
			const res = await fetch(qrUrl, { credentials: 'same-origin' });
			if (!res.ok) throw new Error('qr');
			const blob = await res.blob();
			const filename = `megu-${code}-${(payAmount / 100).toFixed(2)}.png`;

			const file = new File([blob], filename, { type: 'image/png' });
			if (navigator.canShare?.({ files: [file] })) {
				await navigator.share({ files: [file] });
				return;
			}

			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = filename;
			document.body.appendChild(link);
			link.click();
			link.remove();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
			say(t.pay.saved);
		}
		catch (error) {
			// A cancelled share sheet lands here too, and cancelling is not an
			// error worth reporting back to someone who just changed their mind.
			if (error?.name !== 'AbortError') onError?.({ code: 'failed' });
		}
		finally {
			setSaving(false);
		}
	}

	async function attachSlip(slip) {
		if (slip?.error) return onError?.({ code: slip.error });
		if (!pending?.id || !slip?.dataUrl) return;

		setAttaching(true);
		try {
			await call('POST', `/payments/${pending.id}/slip`, {
				dataUrl: slip.dataUrl,
			});
		}
		finally {
			setAttaching(false);
		}
	}

	const periodPicker = !pending && payablePeriods.length > 0 && (
		<div className="allocation-picker">
			<div className="allocation-head">
				<span className="field-label">{t.pay.choosePeriods}</span>
				{payablePeriods.length > 1 && (
					<button
						type="button"
						className="link-btn"
						onClick={() => setSelected(Object.fromEntries(payablePeriods.map(period => [period.id, true])))}
					>
						{t.pay.selectAllOutstanding}
					</button>
				)}
			</div>
			{payablePeriods.map(period => (
				<label className="allocation-row" key={period.id}>
					<input
						type="checkbox"
						checked={Boolean(selected[period.id])}
						onChange={event => setSelected(previous => ({ ...previous, [period.id]: event.target.checked }))}
					/>
					<span>{fmt.period(period.key)}</span>
					<span className="allocation-amount">
						<input
							type="number"
							min="0.01"
							max={(period.available / 100).toFixed(2)}
							step="0.01"
							value={amounts[period.id] || ''}
							disabled={!selected[period.id]}
							onChange={event => setAmounts(previous => ({ ...previous, [period.id]: event.target.value }))}
							aria-label={t.pay.amountFor(fmt.period(period.key))}
						/>
						<span>{t.pay.baht}</span>
					</span>
				</label>
			))}
			<p className="quiet-note">{t.pay.allocationHint}</p>
		</div>
	);

	// Nobody has told this person where to send anything yet.
	if (!payTo?.ready) {
		return (
			<section className="panel pay-panel">
				<div className="panel-head"><span className="panel-title">{t.pay.title}</span></div>
				<div className="pay-body">
					<div className="pay-figure">
						<span className="pay-amount">{fmt.money(payAmount)}</span>
						<span className="pay-to">{t.pay.payTo(payTo?.displayName || '—')}</span>
					</div>
					<p className="quiet-note">
						{payTo?.isMe ? t.pay.noPromptPayOwner : t.pay.noPromptPay(payTo?.displayName || '—')}
					</p>
					{periodPicker}
					{!pending && (
						<button type="button" className="btn btn-pay btn-block" disabled={busy || allocationInvalid || payAmount <= 0} onClick={() => call('POST', '/pay', claimBody)}>
							{t.pay.iHavePaid}
						</button>
					)}
					{pending && <p className="quiet-note">{t.pay.waitingConfirm}</p>}
				</div>
			</section>
		);
	}

	return (
		<section className="panel pay-panel">
			<div className="panel-head">
				<span className="panel-title">{t.pay.title}</span>
				{flash && <span className="panel-count pay-flash">{flash}</span>}
			</div>

			<div className="pay-body">
				<div className="pay-figure">
					<span className="pay-amount">{fmt.money(payAmount)}</span>
					<span className="pay-to">{t.pay.payTo(payTo.displayName)}</span>
				</div>

				{periodPicker}

				<figure className="pay-qr">
					{/* A plain <img> and not a background image, so that a long
					    press offers "Add to Photos" without any of our code
					    being involved. */}
					<img src={qrUrl} alt={`${t.pay.scanHint} — ${fmt.money(payAmount)}`} width={640} height={640} />
				</figure>

				<p className="pay-hint">{t.pay.sameDeviceHint}</p>

				<button type="button" className="btn btn-primary btn-block" disabled={saving} onClick={saveQr}>
					{saving ? t.common.saving : t.pay.saveImage}
				</button>

				<div className="pay-fallback">
					<span className="field-label">{t.pay.orTransferTo}</span>

					<div className="pay-copy-row">
						<div>
							<span className="pay-number">{payTo.masked}</span>
							{payTo.accountName && <span className="pay-account">{payTo.accountName}</span>}
						</div>
						<button type="button" className="btn btn-sm btn-secondary" onClick={() => copy(payTo.number, t.pay.numberCopied)}>
							{t.pay.copyNumber}
						</button>
					</div>

					<div className="pay-copy-row">
						<span className="pay-number">{fmt.money(payAmount)}</span>
						<button type="button" className="btn btn-sm btn-secondary" onClick={() => copy((payAmount / 100).toFixed(2), t.pay.amountCopied)}>
							{t.pay.copyAmount}
						</button>
					</div>
				</div>

				{!pending ? (
					<button
						type="button"
						className="btn btn-pay btn-block btn-lg"
						disabled={busy || allocationInvalid || payAmount <= 0}
						onClick={() => call('POST', '/pay', claimBody)}
					>
						{t.pay.iHavePaid}
					</button>
				) : (
					<div className="pay-claimed">
						<p className="quiet-note">{t.pay.waitingConfirm}</p>

						{pending.hasSlip
							? (
								<div className="slip-state">
									<span className={`chip ${pending.slipVerdict === 'duplicate' ? 'chip-due' : 'chip-clear'}`}>
										{pending.slipVerdict === 'duplicate'
											? t.slip.verdictDuplicate
										: pending.slipVerdict === 'matched'
											? t.slip.verdictMatched
											: pending.slipVerdict === 'review' ? t.slip.verdictReview : t.slip.verdictUnread}
									</span>
									<SlipReading slip={pending} expectedSatang={payAmount} />
									<SlipPicker
										label={t.pay.replaceSlip}
										busyLabel={t.pay.reading}
										readingLabel={t.slip.readingImage}
										disabled={busy || attaching}
										onPicked={attachSlip}
									/>
								</div>
							)
							: (
								<div className="slip-state">
									<SlipPicker
										label={t.pay.attachSlip}
										busyLabel={t.pay.reading}
										readingLabel={t.slip.readingImage}
										disabled={busy || attaching}
										onPicked={attachSlip}
									/>
									<p className="quiet-note">{t.pay.attachSlipHint}</p>
								</div>
							)}
					</div>
				)}
			</div>
		</section>
	);
}
