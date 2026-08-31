'use client';

import { useEffect, useState } from 'react';
import ReceiptScanner from '../ReceiptScanner';
import { ProposeSlots } from './Scheduling';
import { useCopy } from '../../copy';

// Everything only the organizer can do.
//
// It used to sit in a sidebar beside the payment panel, which meant a
// participant scrolled past an entire column of controls they could not use to
// reach the QR they came for. Then it became one `OwnerControls` component in
// the organizer's own right-hand rail — which fixed the participant's problem
// and gave the organizer a different one: a single 2,200px column holding the
// payout details, the schedule, the receipt scanner, the expense form and the
// button that cancels the whole activity, in that order, with nothing between
// them but a run of field labels.
//
// So they are separate exports now, one per job, and the screen decides where
// each one belongs. Nothing here knows about the others.

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
 * When the thing happens.
 *
 * `PATCH /a/{code}` has accepted `startsAt` all along and nothing in the web
 * app ever sent it, so an activity created without a time could not be given
 * one — not here, and not on the summary, which answered "what should I do?"
 * with "nothing needs you right now" while the one thing that needed doing had
 * no control anywhere.
 *
 * Sent as the browser's bare `datetime-local` string. Core reads a bare wall
 * clock as Bangkok, the same way it already does for the payment deadline, so
 * what the organizer typed is what the group is told regardless of where the
 * server happens to be running.
 */
export function ActivityTime({ activity, busy, call }) {
	const { t } = useCopy();
	const current = activity.startsAt ? bangkokDateTimeInput(activity.startsAt) : '';
	const [value, setValue] = useState(current);

	useEffect(() => { setValue(current); }, [current]);

	return (
		<div>
			<span className="field-label">{t.owner.startsAtLabel}</span>
			<div className="share-row" style={{ marginTop: '.35rem' }}>
				<input
					type="datetime-local"
					className="form-control"
					value={value}
					onChange={event => setValue(event.target.value)}
					aria-label={t.owner.startsAtLabel}
				/>
				<button
					type="button"
					className="btn btn-secondary btn-sm"
					disabled={busy || !value || value === current}
					onClick={() => call('PATCH', '', { startsAt: value })}
				>
					{t.owner.startsAtSave}
				</button>
			</div>
			<p className="field-hint">{activity.startsAt ? t.owner.startsAtHint : t.owner.startsAtMissing}</p>
		</div>
	);
}

/**
 * A timestamp as the wall clock it shows in Bangkok, for an input that has no
 * timezone of its own. Reading it back with the browser's zone would offer an
 * organizer in another country a different hour than the one their group was
 * told.
 */
function bangkokDateTimeInput(value) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Bangkok',
		year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
	}).formatToParts(date).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
	return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
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

/**
 * Getting a cost into the activity, by camera or by keyboard.
 *
 * The two belong together because they produce the same thing and share the
 * same answer to "who is splitting this" — the tick boxes below are the ones
 * the scanner hands its rows to. They were together before; what has changed is
 * that they are no longer wedged into a 343px rail between the payout details
 * and the button that cancels the activity.
 */
export function AddExpense({ activity, participants, busy, call }) {
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

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
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
				<span className="field-label">{t.owner.typeItIn}</span>
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
		</div>
	);
}

/**
 * Where the activity is in its life: finding a time, confirming it, finishing
 * it — or, for a monthly agreement, opening the next month.
 */
export function PlanControls({ activity, busy, call }) {
	const { t } = useCopy();
	const recurring = activity.kind === 'recurring';

	const nextPlan = {
		open: { planState: 'confirmed', label: t.owner.confirmTime },
		confirmed: { planState: 'done', label: t.owner.finish },
		done: null,
		cancelled: null,
	}[activity.planState];

	// While the plan is open, times can be proposed — that is what "open" means.
	//
	// This used to read `&& activity.poll`, which is a condition that can never
	// be satisfied by the thing it guards: `ProposeSlots` is what *creates* a
	// poll, so requiring one first meant the only way to reach it was to
	// already have been somewhere else that offered it. The label underneath
	// gives the game away — `activity.poll ? proposeAgain : findTime` — because
	// `findTime` could not render under a condition that demanded a poll.
	const proposing = !recurring && activity.planState === 'open';

	// A finished or cancelled one-off has no next state and nothing to propose,
	// so every branch below draws nothing. Say so rather than leaving a headed
	// panel with an empty body under it.
	if (!recurring && !proposing && !nextPlan) {
		return <p className="quiet-note">{t.owner.planNothing}</p>;
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
			{/* Typing the time you already agreed on, above asking Megu to find
			    one. Most activities have a time before they have a page; the
			    poll is for the ones that do not, and it was the only option on
			    offer here. */}
			{!recurring && activity.planState === 'open' && (
				<ActivityTime activity={activity} busy={busy} call={call} />
			)}

			{proposing && (
				<div>
					<span className="field-label">{activity.poll ? t.owner.proposeAgain : t.owner.findTime}</span>
					<ProposeSlots busy={busy} call={call} />
				</div>
			)}

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
		</div>
	);
}

/**
 * The one action here that cannot be taken back.
 *
 * It used to be a link directly under the submit button of the expense form,
 * in the same scroll, styled as a slightly redder version of every other link
 * on the page. Its own block, at the bottom of the settings tab and nowhere
 * near a form, is the least this deserves.
 */
export function CancelActivity({ activity, busy, requestAction }) {
	const { t } = useCopy();
	if (activity.kind === 'recurring' || activity.planState === 'cancelled') return null;

	return (
		<div className="danger-zone">
			<span className="field-label">{t.owner.cancelActivity}</span>
			<p className="quiet-note">{t.owner.cancelHint}</p>
			<button
				type="button"
				className="btn btn-danger btn-sm"
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
		</div>
	);
}

/**
 * Who there is anything to record a cash payment against.
 *
 * Exported because the screen has to know before it draws the panel around the
 * form: the form returns null when nobody is eligible, and a panel wrapped
 * around null is an empty bordered box.
 */
export function cashRecipients(participants) {
	return participants
		.map(participant => ({
			...participant,
			available: Math.max(0, (participant.outstanding || 0) - (participant.pending || 0)),
		}))
		.filter(participant => participant.available > 0);
}

export function CashPaymentForm({ participants, period, busy, call }) {
	const { t } = useCopy();
	const eligible = cashRecipients(participants);
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
