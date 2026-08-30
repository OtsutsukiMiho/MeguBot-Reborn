'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import SlipPicker from '../SlipPicker';
import SlipReading from '../SlipReading';
import { useCopy } from '../../copy';

// The repeating pieces of an activity: one person, one claim, one cost.
// They were defined inside the single activity page, which is why every
// screen that needed one had to be part of that page. Out here, the roster
// can appear on the summary and the claim queue on the organizer's screen
// without either screen carrying the other's code.

/**
 * Renaming and removing one person.
 *
 * This used to render the roster row as well, and `PersonAccount` in Ledger.js
 * grew a second copy of the same figure logic for the organizer's screen — two
 * places deciding what number goes next to a name, which is exactly how the two
 * screens came to disagree about ฟิก. Display lives there now, for both
 * screens; what is left here is the part that is genuinely a different job.
 */
export function PersonEditRow({ p, busy, call, requestAction }) {
	const { t } = useCopy();
	const [name, setName] = useState(p.displayName);

	return (
		<div className="row row-editing">
			<input
				className="form-control inline-input"
				value={name}
				onChange={e => setName(e.target.value)}
				onBlur={() => name.trim() && name !== p.displayName && call('PATCH', `/participants/${p.id}`, { displayName: name })}
				aria-label={t.roster.nameOf(p.displayName)}
			/>
			<span className="row-tools">
				{p.claimed && (
					<button type="button" className="link-btn" disabled={busy} onClick={() => call('PATCH', `/participants/${p.id}`, { resetClaim: true })}>
						{t.roster.returnName}
					</button>
				)}
				<button
					type="button"
					className="link-btn danger"
					disabled={busy}
					onClick={() => requestAction({
						title: t.common.remove,
						message: t.roster.confirmRemove(p.displayName),
						submitLabel: t.common.remove,
						method: 'DELETE',
						path: `/participants/${p.id}`,
					})}
				>
					{t.common.remove}
				</button>
			</span>
		</div>
	);
}

export function AttendancePanel({ participants, busy, call }) {
	const { t } = useCopy();
	const rows = participants;

	if (rows.length === 0) return null;

	return (
		<section className="panel">
			<div className="panel-head">
				<span className="panel-title">{t.attendance.title}</span>
				<span className="panel-count">{t.attendance.marked(rows.filter(p => p.attended != null).length, rows.length)}</span>
			</div>
			<div>
				<p className="quiet-note attendance-hint">{t.attendance.hint}</p>
				{rows.map(p => (
					<div className="row attendance-row" key={p.id}>
						<div className="row-main"><div className="row-name">{p.displayName}</div></div>
						<div className="attendance-actions">
							<button type="button" className={`vote-btn ${p.attended === true ? 'on-yes' : ''}`} disabled={busy} onClick={() => call('POST', '/attendance', { attendance: { [p.id]: true } })}>{t.attendance.came}</button>
							<button type="button" className={`vote-btn ${p.attended === false ? 'on-no' : ''}`} disabled={busy} onClick={() => call('POST', '/attendance', { attendance: { [p.id]: false } })}>{t.attendance.absent}</button>
						</div>
					</div>
				))}
			</div>
		</section>
	);
}

/**
 * A claim waiting on the owner, with whatever evidence came with it.
 *
 * The expected amount is printed beside the claimed one whenever they differ:
 * someone transferring ฿60 and typing ฿6 is the mistake worth catching here,
 * and it is invisible if the page only shows one number.
 */
export function PendingRow({ p, code, nameOf, busy, call, lang, requestAction }) {
	const { t, fmt } = useCopy();
	const [showSlip, setShowSlip] = useState(false);
	const [attaching, setAttaching] = useState(false);

	const mismatch = p.expectedSatang != null && p.expectedSatang !== p.amountSatang;

	// What `SlipReading` below is measuring the slip against. Held here rather
	// than inlined at the call site so the duplicate check underneath cannot
	// disagree with the chip it is suppressing.
	const expectedForSlip = p.expectedSatang ?? p.amountSatang;

	// `SlipReading` already prints an amount mismatch in red — "the slip reads
	// ฿120.00, but ฿549.50 was asked for" — whenever it could read an amount at
	// all, which is the only circumstance in which `amount_mismatch` fires. So
	// listing it again below says nothing new and pushes down the reason the
	// owner has not already seen.
	const readDiffersShown = p.slipAmountSatang != null
		&& expectedForSlip != null
		&& p.slipAmountSatang !== expectedForSlip;
	const held = (p.slipReasons || []).filter(reason => !(readDiffersShown && reason === 'amount_mismatch'));

	async function attach(slip) {
		if (slip?.error || !slip?.dataUrl) return;
		setAttaching(true);
		try {
			await call('POST', `/payments/${p.id}/slip`, {
				dataUrl: slip.dataUrl,
			});
		}
		finally {
			setAttaching(false);
		}
	}

	return (
		<div className="row row-pending">
			<div className="row-main">
				<div className="row-name">{nameOf(p.participantId)}</div>
				<div className="row-sub">
					{t.pending.saidTheyPaid}
					{mismatch && ` · ${t.slip.expected(fmt.money(p.expectedSatang))}`}
					{p.hasSlip && ` · ${p.slipVerdict === 'duplicate'
						? t.slip.verdictDuplicate
						: p.slipVerdict === 'review' ? t.slip.verdictReview : p.slipVerdict === 'matched' ? t.slip.verdictMatched : t.slip.verdictUnread}`}
				</div>

				{/* What the slip says, before it has to be opened. The whole
				    point of reading it was to save the owner this trip. */}
				{p.hasSlip && <SlipReading slip={p} expectedSatang={expectedForSlip} />}

				{/* And why it is still sitting here.
				    Without this the queue said "waiting for owner review" and
				    left the reader to spot the problem themselves — next to a
				    green chip saying the amount matched, which is exactly the
				    reassuring half of a slip dated three months in the future. */}
				{p.hasSlip && held.length > 0 && (
					<div className="slip-held">
						<span className="slip-held-title">{t.slip.heldTitle}</span>
						<ul>
							{held.map(reason => (
								<li key={reason}>{t.slip.held[reason] || reason}</li>
							))}
							{(p.slipFlags || []).map(flag => (
								<li className="slip-held-flag" key={flag}>{t.slip.flags[flag] || flag}</li>
							))}
						</ul>
					</div>
				)}

				{p.hasSlip && (
					<div className="slip-review">
						<button type="button" className="link-btn" onClick={() => setShowSlip(v => !v)}>
							{showSlip ? t.common.close : t.pay.viewSlip}
						</button>
						{showSlip && (
							<figure className="slip-figure">
								<img src={`/api/megu/a/${code}/payments/${p.id}/slip?lang=${lang}`} alt={t.pay.viewSlip} />
								<figcaption className="quiet-note">{t.slip.privacyNote}</figcaption>
							</figure>
						)}
					</div>
				)}

				{!p.hasSlip && (
					<div className="slip-review">
						<SlipPicker
							label={t.pay.attachSlip}
							busyLabel={t.pay.reading}
							disabled={busy || attaching}
							onPicked={attach}
						/>
					</div>
				)}
			</div>

			<span className={`row-figure ${mismatch ? 'fig-due' : ''}`}>{fmt.money(p.amountSatang)}</span>
			<span className="row-tools">
				<button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => call('POST', `/payments/${p.id}/confirm`)}>
					{t.pending.received}
				</button>
				<button type="button" className="link-btn" disabled={busy} onClick={() => requestAction({
					title: t.pending.notYet,
					reasonLabel: t.pending.rejectionReason,
					submitLabel: t.pending.notYet,
					method: 'POST',
					path: `/payments/${p.id}/reject`,
				})}>
					{t.pending.notYet}
				</button>
			</span>
		</div>
	);
}

export function AddPerson({ busy, call }) {
	const { t } = useCopy();
	const [name, setName] = useState('');

	return (
		<form
			className="row row-editing"
			onSubmit={(e) => {
				e.preventDefault();
				if (!name.trim()) return;
				call('POST', '/participants', { displayName: name }).then(() => setName(''));
			}}
		>
			<input
				className="form-control inline-input"
				placeholder={t.roster.addPerson}
				value={name}
				onChange={e => setName(e.target.value)}
				aria-label={t.roster.addPerson}
			/>
			<span className="row-tools">
				<button type="submit" className="link-btn" disabled={busy || !name.trim()}>{t.common.add}</button>
			</span>
		</form>
	);
}

export function PaymentHistory({ payments, code, nameOf, lang }) {
	const { t, fmt } = useCopy();

	return (
		<section className="panel">
			<div className="panel-head">
				<span className="panel-title">{t.pending.historyTitle}</span>
				<span className="panel-count">{payments.length}</span>
			</div>
			<div>
				{payments.map(p => (
					<div key={p.id} className="row">
						<div className="row-main">
							<div className="row-name">{nameOf(p.participantId)}</div>
							<div className="row-sub">
								{p.status === 'rejected'
									? t.pending.rejectedNotice(p.reversalReason || '—')
									: t.pending.reversedNotice(p.reversalReason || '—')}
							</div>
							{p.transferAmountSatang !== p.amountSatang && (
								<div className="row-sub">
									{t.pending.allocatedFromTransfer(fmt.money(p.amountSatang), fmt.money(p.transferAmountSatang))}
								</div>
							)}
						</div>
						<span className="row-figure fig-due">{fmt.money(p.amountSatang)}</span>
						<span className="row-tools">
							{/* The record of what happened, for the two people at
							    either end of it. Reachable from the row rather
							    than only after paying, because the moment somebody
							    wants it is the moment they are arguing about it. */}
							<Link className="link-btn" href={`/a/${code}/receipt/${p.id}`}>
								{t.receiptPage.title}
							</Link>
							{p.hasSlip && (
								<a className="link-btn" href={`/api/megu/a/${code}/payments/${p.id}/slip?lang=${lang}`} target="_blank" rel="noreferrer">
									{t.pay.viewSlip}
								</a>
							)}
						</span>
					</div>
				))}
			</div>
		</section>
	);
}

export function ExpenseRow({ e, editing, participants, nameOf, busy, call, requestAction }) {
	const { t, fmt } = useCopy();
	const [label, setLabel] = useState(e.label);
	const [amount, setAmount] = useState((e.amountSatang / 100).toString());
	const shareRows = (e.shares || []).map(share => ({
		...share,
		displayName: nameOf(share.participantId),
	}));
	const shareSummary = shareRows.length === 1
		? t.expenses.forPerson(shareRows[0].displayName)
		: t.expenses.splitBetween(fmt.names(shareRows.map(share => share.displayName)));

	if (!editing) {
		return (
			<div className="row">
				<div className="row-main">
					<div className="row-name">{e.label}</div>
					<div className="row-sub">{t.expenses.frontedBy(nameOf(e.paidBy))}</div>
					{shareRows.length > 0 && (
						<details className="expense-detail">
							<summary>
								<span>{shareSummary}</span>
								<span className="expense-detail-hint">{t.expenses.viewSplit}</span>
							</summary>
							<div className="expense-share-list">
								{shareRows.map(share => (
									<div className="expense-share-row" key={share.participantId}>
										<span>{share.displayName}</span>
										<span className="mono">{fmt.money(share.amountSatang)}</span>
									</div>
								))}
							</div>
						</details>
					)}
				</div>
				<span className="row-figure">{fmt.money(e.amountSatang)}</span>
			</div>
		);
	}

	const save = patch => call('PATCH', `/expenses/${e.id}`, patch);

	return (
		<div className="row row-editing">
			<input
				className="form-control inline-input"
				value={label}
				onChange={ev => setLabel(ev.target.value)}
				onBlur={() => label.trim() && label !== e.label && save({ label })}
				aria-label={t.expenses.labelField}
			/>
			<input
				className="form-control inline-input mono"
				type="number"
				min="0.01"
				step="0.01"
				value={amount}
				onChange={ev => setAmount(ev.target.value)}
				onBlur={() => Number(amount) > 0 && Number(amount) * 100 !== e.amountSatang && save({ amount: Number(amount) })}
				aria-label={t.expenses.amountField}
			/>
			<span className="row-tools">
				<select className="form-control inline-input" value={e.paidBy} onChange={ev => save({ paidBy: ev.target.value })} aria-label={t.expenses.payerField}>
					{participants.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
				</select>
				<button
					type="button"
					className="link-btn danger"
					disabled={busy}
					onClick={() => requestAction({
						title: t.common.remove,
						message: t.expenses.confirmDelete(e.label, fmt.money(e.amountSatang)),
						submitLabel: t.common.remove,
						method: 'DELETE',
						path: `/expenses/${e.id}`,
					})}
				>
					{t.common.remove}
				</button>
			</span>
		</div>
	);
}
