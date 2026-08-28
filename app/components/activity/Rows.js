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

export function PersonRow({ p, recurring, editing, canSeeMoney, moneyState, planState, totalOutstanding, payeeParticipantId, busy, call, requestAction }) {
	const { t, fmt } = useCopy();
	const [name, setName] = useState(p.displayName);

	if (editing) {
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

	// A monthly agreement has nowhere to go, so "going" is not a fact about
	// anyone on it. What matters there is whether this month is paid.
	const status = recurring
		? (canSeeMoney && p.outstanding != null
			? (moneyState === 'none' ? null : p.outstanding > 0 ? t.money.open : t.roster.clear)
			: null)
		: (planState === 'done' && p.attended != null
			? (p.attended ? t.attendance.came : t.attendance.absent)
			: p.rsvp === 'yes' ? t.roster.going : p.rsvp === 'no' ? t.roster.notGoing : t.roster.noAnswer);

	// What this person is still owed by the rest of the roster.
	//
	// It used to be shown only for the activity's payee, using the group's whole
	// unpaid total — which was the only shape the old model could express. On a
	// trip where two people fronted cash that credited one of them with the
	// other's money, and left the other looking square.
	const owedToThem = (p.owedBy || []).reduce((sum, o) => sum + o.outstandingSatang, 0)
		|| (p.id === payeeParticipantId ? totalOutstanding : 0);

	let figure = null;
	if (canSeeMoney && moneyState !== 'none' && p.outstanding != null) {
		if (p.outstanding > 0) figure = { className: 'fig-due', label: fmt.money(p.outstanding) };
		else if (moneyState === 'open' && owedToThem > 0) {
			figure = { className: 'fig-credit', label: t.roster.getsBack(fmt.money(owedToThem)) };
		}
		else if (p.owes > 0 || p.paidOut > 0 || recurring) {
			figure = { className: 'fig-clear', label: p.paidOut > 0 ? t.roster.clear : t.roster.paidUp };
		}
	}

	return (
		<div className={`row ${p.isMe ? 'is-me' : ''}`}>
			<div className="row-main">
				<div className="row-name">
					{p.displayName}
					{p.isMe && <span className="me-tag">{t.common.you}</span>}
					{p.deferral && <span className="chip chip-due chip-sm">{t.defer.badge}</span>}
				</div>
				<div className="row-sub">
					{[status, !p.isMe && !p.claimed ? t.roster.notLinked : null].filter(Boolean).join(' · ')}
				</div>
				{/* Why, in their own words. The whole reason the second button
				    exists: an unpaid row with a sentence beside it is a
				    situation, an unpaid row on its own is a mystery the
				    organizer has to solve in the group chat. */}
				{p.deferral && (
					<div className="row-sub defer-reason">
						{t.defer.reasonBy(p.displayName, p.deferral.reason)}
						{' · '}
						{t.defer.snoozedUntil(fmt.when(p.deferral.snoozeUntil, { time: false }))}
					</div>
				)}
			</div>
			{figure && (
				<span className={`row-figure ${figure.className}`}>
					{figure.label}
				</span>
			)}
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
				{p.hasSlip && <SlipReading slip={p} expectedSatang={p.expectedSatang ?? p.amountSatang} />}

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
