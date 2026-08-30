'use client';

import { useEffect, useState } from 'react';
import ReceiptScanner from '../ReceiptScanner';
import { ProposeSlots } from './Scheduling';
import { useCopy } from '../../copy';

// Everything only the organizer can do. It used to sit in a sidebar beside
// the payment panel, which meant a participant scrolled past an entire
// column of controls they could not use to reach the QR they came for.

/**
 * When the money is due.
 *
 * A bare `<input type="date">` rather than a datetime: an organizer thinks in
 * days ("จ่ายวันที่ 21"), not in minutes, and the server reads a bare date as
 * the end of that day in Bangkok so the 21st is not over until it is over.
 */
export function PaymentDeadline({ activity, busy, call }) {
	const { t } = useCopy();
	const current = activity.paymentDueAt ? bangkokDateInput(activity.paymentDueAt) : '';
	const [value, setValue] = useState(current);

	useEffect(() => { setValue(current); }, [current]);

	return (
		<div>
			<span className="field-label">{t.owner.payByLabel}</span>
			<div className="share-row" style={{ marginTop: '.35rem' }}>
				<input
					type="date"
					className="form-control"
					value={value}
					onChange={event => setValue(event.target.value)}
					aria-label={t.owner.payByLabel}
				/>
				<button
					type="button"
					className="btn btn-secondary btn-sm"
					disabled={busy || value === current}
					onClick={() => call('PATCH', '', { paymentDueAt: value || null })}
				>
					{value ? t.owner.payBySave : t.owner.payByClear}
				</button>
			</div>
			<p className="field-hint">{t.owner.payByHint}</p>
		</div>
	);
}

/**
 * A timestamp as the calendar day it falls on in Bangkok, which is the day the
 * organizer chose. Reading it back with the browser's own timezone would show
 * the 20th to anyone sitting west of here.
 */
function bangkokDateInput(value) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	const bangkok = new Date(date.getTime() + 7 * 3600 * 1000);
	return bangkok.toISOString().slice(0, 10);
}

/**
 * Whether the numbers typed so far add up, and by how much they miss.
 *
 * Returned rather than rendered so the submit button and the running total read
 * the same answer. `ready` false with `gap` zero is the empty form — nothing
 * typed yet, which is not an error worth shouting about.
 */
function splitStanding(mode, sharing, values, amountText) {
	if (mode === 'even') return { ready: true, gap: 0, target: 0, assigned: 0 };

	const target = mode === 'percent' ? 100 : Number(amountText || 0);
	let assigned = 0;
	let typed = 0;
	for (const person of sharing) {
		const raw = values[person.id];
		if (raw === undefined || raw === '') continue;
		const value = Number(raw);
		if (!Number.isFinite(value) || value < 0) return { ready: false, gap: null, target, assigned };
		assigned += value;
		typed += 1;
	}

	// Weights do not have to add up to anything — 2:1:1 is complete as it is.
	if (mode === 'shares') {
		return { ready: typed === sharing.length && assigned > 0, gap: 0, target: 0, assigned };
	}

	// Rounded because 33.33 + 33.33 + 33.34 arrives as 100.00000000000001.
	const gap = Math.round((target - assigned) * 100) / 100;
	return { ready: typed === sharing.length && gap === 0 && target > 0, gap, target, assigned };
}

export function OwnerControls({ activity, busy, call, participants, requestAction }) {
	const { t, fmt } = useCopy();
	const [label, setLabel] = useState('');
	const [amount, setAmount] = useState('');
	const [paidBy, setPaidBy] = useState(participants[0]?.id || '');
	const recurring = activity.kind === 'recurring';
	const defaultShares = participants.filter(p => recurring || p.rsvp !== 'no').map(p => p.id);
	const [shareParticipantIds, setShareParticipantIds] = useState(defaultShares.length > 0 ? defaultShares : participants.map(p => p.id));

	// Dividing it by something other than "everybody the same".
	//
	// Even stays the default and stays one tap, because it is what most bills
	// are. The rest appears only once somebody asks for it: a row of inputs
	// beside the names, and a line saying whether they add up yet. The running
	// total is the point — an expense that does not reconcile is refused by the
	// server, and finding that out after pressing the button is the version of
	// this that people give up on.
	const [splitMode, setSplitMode] = useState('even');
	const [splitValues, setSplitValues] = useState({});
	const sharing = participants.filter(p => shareParticipantIds.includes(p.id));
	const splitBalance = splitStanding(splitMode, sharing, splitValues, amount);

	const nextPlan = {
		open: { planState: 'confirmed', label: t.owner.confirmTime },
		confirmed: { planState: 'done', label: t.owner.finish },
		done: null,
		cancelled: null,
	}[activity.planState];

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem', paddingTop: '.5rem' }}>
			{!recurring && activity.planState === 'open' && activity.poll && (
				<div>
					<span className="field-label">{activity.poll ? t.owner.proposeAgain : t.owner.findTime}</span>
					<ProposeSlots busy={busy} call={call} />
				</div>
			)}

			{/* Set once, and the chasing takes care of itself. A monthly
			    agreement answers the same question through its collection day,
			    so this belongs to one-off activities only. */}
			{!recurring && <PaymentDeadline activity={activity} busy={busy} call={call} />}

			{!recurring && nextPlan && (
				<button type="button" className="btn btn-primary btn-block" disabled={busy || (nextPlan.planState === 'confirmed' && !activity.startsAt)} onClick={() => call('POST', '/plan', { planState: nextPlan.planState })}>
					{nextPlan.label}
				</button>
			)}

			{/* Opening a month must not read the amount out of the expense form
			    below it. They used to share one field, so an empty form opened
			    an unbilled month and a half-typed expense billed the wrong
			    figure — both silently. */}
			{recurring && (
				<button type="button" className="btn btn-secondary btn-block" disabled={busy} onClick={() => call('POST', '/periods')}>
					{t.owner.openMonth}
				</button>
			)}

			{/* Reading the bill sits above typing it, because on the evening it
			    matters somebody is holding the receipt and eleven people are
			    waiting. Typing stays exactly where it was for the ฿60 court
			    fee, which no one would photograph. */}
			<ReceiptScanner
				participants={participants}
				defaultPaidBy={paidBy}
				periodId={activity.period?.id}
				busy={busy}
				call={call}
				shareParticipantIds={shareParticipantIds}
			/>

			<form
				onSubmit={(e) => {
					e.preventDefault();
					if (!amount) return;
					call('POST', '/expenses', {
						label: label || activity.title,
						amount: Number(amount),
						paidBy,
						shareParticipantIds,
						// Bill the month being looked at, not whichever one
						// happens to be current on the server.
						periodId: activity.period?.id || undefined,
						split: splitMode === 'even' ? undefined : {
							mode: splitMode,
							values: Object.fromEntries(sharing.map(p => [p.id, Number(splitValues[p.id])])),
						},
					})
						.then((result) => {
							if (!result) return;
							setLabel('');
							setAmount('');
							setSplitMode('even');
							setSplitValues({});
						});
				}}
				style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}
			>
				<span className="field-label">{t.owner.addExpense}</span>
				<input className="form-control" placeholder={t.expenses.labelField} value={label} onChange={e => setLabel(e.target.value)} aria-label={t.expenses.labelField} />
				<input className="form-control" type="number" min="0.01" step="0.01" placeholder={t.expenses.amountField} value={amount} onChange={e => setAmount(e.target.value)} aria-label={t.expenses.amountField} />
				<select className="form-control" value={paidBy} onChange={e => setPaidBy(e.target.value)} aria-label={t.expenses.payerField}>
					{participants.map(p => <option key={p.id} value={p.id}>{t.expenses.payerOption(p.displayName)}</option>)}
				</select>
				<fieldset className="expense-split">
					<legend className="field-label">{t.expenses.splitField}</legend>
					<p className="quiet-note">{t.expenses.splitHint}</p>
					<div className="expense-split-list">
						{participants.map(p => (
							<label key={p.id} className="expense-split-person">
								<input
									type="checkbox"
									checked={shareParticipantIds.includes(p.id)}
									onChange={e => setShareParticipantIds(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))}
								/>
								<span>{p.displayName}</span>
								{/* The input appears next to the name it belongs to
								    rather than in a second list below, so nobody has
								    to hold two orderings in their head at once. */}
								{splitMode !== 'even' && shareParticipantIds.includes(p.id) && (
									<input
										className="form-control expense-split-value"
										type="number"
										min="0"
										step={splitMode === 'shares' ? '1' : '0.01'}
										inputMode="decimal"
										value={splitValues[p.id] ?? ''}
										placeholder={t.expenses.splitModes[splitMode]}
										aria-label={t.expenses.splitValueFor(p.displayName, t.expenses.splitModes[splitMode])}
										onChange={e => setSplitValues(v => ({ ...v, [p.id]: e.target.value }))}
									/>
								)}
							</label>
						))}
					</div>

					<div className="expense-split-modes" role="group" aria-label={t.expenses.splitHow}>
						{['even', 'exact', 'percent', 'shares'].map(mode => (
							<button
								key={mode}
								type="button"
								className={`chip chip-choice ${splitMode === mode ? 'is-on' : ''}`}
								aria-pressed={splitMode === mode}
								onClick={() => { setSplitMode(mode); setSplitValues({}); }}
							>
								{t.expenses.splitModes[mode]}
							</button>
						))}
					</div>

					{/* Said in words as well as colour: a red number nobody can
					    see is not an error message. */}
					{splitMode !== 'even' && (
						<p className={`quiet-note ${splitBalance.ready ? 'split-balanced' : 'split-unbalanced'}`}>
							{splitBalance.gap === null ? t.expenses.splitNotANumber
								: splitMode === 'shares' ? (splitBalance.ready ? t.expenses.splitSharesReady : t.expenses.splitSharesMissing)
									: splitBalance.ready ? t.expenses.splitBalanced
										: splitBalance.gap > 0 ? t.expenses.splitLeft(splitMode === 'percent' ? `${splitBalance.gap}%` : fmt.money(Math.round(splitBalance.gap * 100)))
											: t.expenses.splitOver(splitMode === 'percent' ? `${-splitBalance.gap}%` : fmt.money(Math.round(-splitBalance.gap * 100)))}
						</p>
					)}
				</fieldset>
				<button type="submit" className="btn btn-secondary btn-block" disabled={busy || !amount || shareParticipantIds.length === 0 || !splitBalance.ready}>
					{t.owner.addAndSplit}
				</button>
			</form>

			{activity.planState !== 'cancelled' && !recurring && (
				<button
					type="button"
					className="link-btn danger"
					style={{ alignSelf: 'flex-start' }}
					disabled={busy}
					onClick={() => requestAction({
						title: t.owner.cancelActivity,
						message: t.owner.confirmCancel,
						submitLabel: t.owner.cancelActivity,
						method: 'POST',
						path: '/plan',
						body: { planState: 'cancelled' },
					})}
				>
					{t.owner.cancelActivity}
				</button>
			)}
		</div>
	);
}

export function CashPaymentForm({ participants, period, busy, call }) {
	const { t } = useCopy();
	const eligible = participants
		.map(participant => ({
			...participant,
			available: Math.max(0, (participant.outstanding || 0) - (participant.pending || 0)),
		}))
		.filter(participant => participant.available > 0);
	const [participantId, setParticipantId] = useState('');
	const [amount, setAmount] = useState('');

	useEffect(() => {
		const selected = eligible.find(participant => participant.id === participantId) || eligible[0];
		setParticipantId(selected?.id || '');
		setAmount(selected ? (selected.available / 100).toFixed(2) : '');
	}, [participants, period?.id]);

	if (eligible.length === 0) return null;
	const selected = eligible.find(participant => participant.id === participantId);
	const satang = Math.round(Number(amount) * 100);
	const valid = selected && Number.isSafeInteger(satang) && satang > 0 && satang <= selected.available;

	return (
		<form
			className="cash-payment-form"
			onSubmit={async (event) => {
				event.preventDefault();
				if (!valid) return;
				await call('POST', '/payments/manual', {
					participantId,
					amountSatang: satang,
					periodId: period?.id || null,
					reason: t.cash.reason,
				});
			}}
		>
			<div className="field-label">{t.cash.title}</div>
			<p className="quiet-note">{t.cash.hint}</p>
			<label className="field">
				<span>{t.cash.person}</span>
				<select
					className="form-control"
					value={participantId}
					onChange={(event) => {
						const next = eligible.find(participant => participant.id === event.target.value);
						setParticipantId(event.target.value);
						setAmount(next ? (next.available / 100).toFixed(2) : '');
					}}
				>
					{eligible.map(participant => <option key={participant.id} value={participant.id}>{participant.displayName}</option>)}
				</select>
			</label>
			<label className="field">
				<span>{t.cash.amount}</span>
				<input
					className="form-control"
					type="number"
					min="0.01"
					max={selected ? (selected.available / 100).toFixed(2) : undefined}
					step="0.01"
					value={amount}
					onChange={event => setAmount(event.target.value)}
				/>
			</label>
			<button type="submit" className="btn btn-secondary btn-block" disabled={busy || !valid}>{t.cash.received}</button>
		</form>
	);
}
