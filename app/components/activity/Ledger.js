'use client';

import { useState } from 'react';
import { PersonEditRow } from './Rows';
import { useCopy } from '../../copy';

/**
 * One person, as transfers rather than as a balance.
 *
 * The roster this replaces printed a single figure per person, taken from
 * `outstanding`, and that figure is a net. On a trip where two people fronted
 * cash it produced a number that corresponds to nothing: ฟิก owed เม ฿550 and
 * was owed ฿100 by นิค, and the screen said ฿450 — an amount no one would ever
 * transfer, sitting next to a name, on the screen an organizer uses to chase
 * people. Worse, the branch that drew it returned as soon as `outstanding > 0`,
 * so the ฿100 coming back was not merely netted away, it was never read.
 *
 * The server has said all of this for a while. `owesTo` and `owedBy` on each
 * participant are the real transfers, `pairwiseObligations` in core computes
 * them, and the pay screen already asks "who are you paying?" when there is
 * more than one answer. This is the roster's half of that same question.
 *
 * Both screens draw their roster with this. They did not to begin with — the
 * summary kept its own copy of the figure logic in `PersonRow`, and the two
 * drifted immediately: the organizer's screen was corrected and the page every
 * participant lands on went on printing ฿450. One component, one answer.
 *
 * `estimated` on an obligation means it was reconstructed from payments written
 * before Megu recorded who they were sent to. It is said out loud rather than
 * quietly rendered as fact.
 */
/**
 * What this person still has to send.
 *
 * `outstanding` is the fallback for a row that arrived without obligation lines
 * at all, so a caller holding one but not the other still shows a number rather
 * than nothing.
 */
function stillToSend(p) {
	const owesTo = (p.owesTo || []).filter(o => o.outstandingSatang > 0);
	return owesTo.length > 0
		? owesTo.reduce((sum, o) => sum + o.outstandingSatang, 0)
		: Math.max(0, p.outstanding || 0);
}

/**
 * What the rest of the roster still owes them.
 *
 * The second half is the old model showing through: before obligations were
 * tracked pairwise, the only creditor that could be expressed was the
 * activity's payee, credited with the group's whole unpaid total.
 */
function stillToReceive(p, payeeParticipantId, totalOutstanding) {
	return (p.owedBy || []).filter(o => o.outstandingSatang > 0).reduce((sum, o) => sum + o.outstandingSatang, 0)
		|| (p.id === payeeParticipantId ? totalOutstanding : 0);
}

/**
 * The roster in the order somebody actually reads it: who owes the most, first.
 *
 * Roster order was insertion order — the sequence names happened to be typed in
 * on the evening the activity was made, which is a fact about that evening and
 * about nothing since. An organizer opening this screen is looking for who has
 * not paid, and on a roster of eleven that meant reading all eleven.
 *
 * Debtors by amount, then creditors by amount, then everyone who is square.
 * Settled people keep their original order among themselves — there is no
 * meaningful way to rank nothing, and shuffling them between visits would make
 * the list feel unstable for no gain.
 *
 * Sorts a copy: the array belongs to the activity the shell fetched, and a
 * component that reorders its own props in place is a bug waiting for a second
 * reader.
 */
export function rosterOrder(participants, { payeeParticipantId, totalOutstanding = 0 } = {}) {
	return participants
		.map((p, index) => ({
			p,
			index,
			send: stillToSend(p),
			receive: stillToReceive(p, payeeParticipantId, totalOutstanding),
		}))
		.sort((a, b) => (b.send - a.send) || (b.receive - a.receive) || (a.index - b.index))
		.map(entry => entry.p);
}

export function PersonAccount({
	p,
	activity,
	recurring,
	editing = false,
	// The summary shows the roster for orientation, not for working through:
	// no breakdown, and no money at all to somebody who is not on the roster.
	expandable = true,
	canSeeMoney = true,
	// Only for activities predating the obligation graph, where the payee was
	// the one person the old model could credit. See `owedToThem` below.
	payeeParticipantId,
	totalOutstanding = 0,
	busy,
	call,
	requestAction,
}) {
	const { t, fmt } = useCopy();
	const [open, setOpen] = useState(false);

	// Editing a name is a different job from reading an account, and the row
	// that does it already exists.
	if (editing) {
		return <PersonEditRow p={p} busy={busy} call={call} requestAction={requestAction} />;
	}

	const moneyState = activity.moneyState;
	const showMoney = canSeeMoney && moneyState !== 'none' && p.outstanding != null;

	const owesTo = (p.owesTo || []).filter(o => o.outstandingSatang > 0);
	const owedBy = (p.owedBy || []).filter(o => o.outstandingSatang > 0);

	// The same two functions the roster is sorted by, so the order down the page
	// and the figures across it can never disagree.
	const toSend = stillToSend(p);
	const toReceive = stillToReceive(p, payeeParticipantId, totalOutstanding);
	const bothWays = toSend > 0 && toReceive > 0;

	// A monthly agreement has nowhere to go, so "going" is not a fact about
	// anyone on it. What matters there is whether this month is paid.
	const status = recurring
		? (showMoney ? (p.outstanding > 0 ? t.money.open : t.roster.clear) : null)
		: (activity.planState === 'done' && p.attended != null
			? (p.attended ? t.attendance.came : t.attendance.absent)
			: p.rsvp === 'yes' ? t.roster.going : p.rsvp === 'no' ? t.roster.notGoing : t.roster.noAnswer);

	// What goes in the figure column.
	//
	// Never a net: ฟิก sending ฿550 and receiving ฿100 is not ฿450, which is an
	// amount nobody will ever transfer. But one red number was not right either
	// — it said ฿550 and left the ฿100 coming back as a chip underneath, which
	// reads as a footnote to a debt rather than as half the answer. Somebody in
	// the middle of two transfers gets both, stacked, each in its own colour.
	//
	// Everyone else has exactly one thing to say, and says it on one line.
	let figure = null;
	if (showMoney && !bothWays) {
		if (toSend > 0) figure = { className: 'fig-due', label: fmt.money(toSend) };
		else if (moneyState === 'open' && toReceive > 0) figure = { className: 'fig-credit', label: t.roster.getsBack(fmt.money(toReceive)) };
		else if (p.overpaid > 0) figure = { className: 'fig-credit', label: t.ledger.overpaid };
		else if (p.owes > 0 || p.paidOut > 0 || recurring) figure = { className: 'fig-clear', label: p.paidOut > 0 ? t.roster.clear : t.roster.paidUp };
	}

	// Named transfers, printed only when a single figure cannot carry them: two
	// creditors, two debtors, or somebody pointing both ways. One transfer needs
	// no list — the figure already is it.
	const namedTransfers = showMoney && (bothWays || owesTo.length > 1 || owedBy.length > 1);
	const estimated = [...owesTo, ...owedBy].some(o => o.estimated);

	return (
		<div className={`row account-row ${p.isMe ? 'is-me' : ''} ${open ? 'is-open' : ''}`}>
			<div className="row-main">
				<div className="row-name">
					{/* The name in its own element so it, and not the badges
					    beside it, is what gets truncated when the row is narrow.
					    Left as a bare text node it was "ฟิก…" on a phone, with
					    the chip that pushed it out still fully legible. */}
					<span className="account-name">{p.displayName}</span>
					{p.isMe && <span className="me-tag">{t.common.you}</span>}
					{p.deferral && <span className="chip chip-due chip-sm">{t.defer.badge}</span>}
					{/* No "owes and is owed" chip beside the name any more: the
					    two-legged figure to the right says it, in the only terms
					    that matter, without competing with the name for width on
					    a phone. */}
				</div>
				<div className="row-sub">
					{[status, !p.isMe && !p.claimed ? t.roster.notLinked : null].filter(Boolean).join(' · ')}
				</div>

				{/* Why, in their own words. The whole reason the defer button
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

				{namedTransfers && (
					<div className="transfer-lines">
						{owesTo.map(o => (
							<span className="transfer transfer-out" key={`out-${o.creditorId}`}>
								{t.ledger.sends(o.creditorName, fmt.money(o.outstandingSatang))}
							</span>
						))}
						{owedBy.map(o => (
							<span className="transfer transfer-in" key={`in-${o.debtorId}`}>
								{t.ledger.receives(o.debtorName, fmt.money(o.outstandingSatang))}
							</span>
						))}
					</div>
				)}

				{open && <AccountDetail p={p} activity={activity} owesTo={owesTo} owedBy={owedBy} />}
				{open && estimated && <p className="quiet-note">{t.ledger.estimated}</p>}
			</div>

			{figure && <span className={`row-figure ${figure.className}`}>{figure.label}</span>}

			{showMoney && bothWays && (
				<span className="row-figure figure-both">
					<span className="figure-leg fig-due">
						<span className="figure-leg-label">{t.ledger.outLeg}</span>
						{fmt.money(toSend)}
					</span>
					<span className="figure-leg fig-credit">
						<span className="figure-leg-label">{t.ledger.inLeg}</span>
						{fmt.money(toReceive)}
					</span>
				</span>
			)}

			{expandable && showMoney && (
				<span className="row-tools">
					<button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen(v => !v)}>
						{open ? t.ledger.close : t.ledger.open}
					</button>
				</span>
			)}
		</div>
	);
}

/**
 * Where the figure came from: the shares that built it, the money already
 * moved, and what is left to move.
 *
 * Every line is a number the server already sent. Nothing here recomputes a
 * balance — a client that does its own arithmetic is a client that will one day
 * disagree with the server about somebody's money.
 */
function AccountDetail({ p, activity, owesTo, owedBy }) {
	const { t, fmt } = useCopy();

	const shares = activity.expenses
		.map(expense => ({
			id: expense.id,
			label: expense.label,
			amountSatang: (expense.shares || []).find(share => share.participantId === p.id)?.amountSatang,
		}))
		.filter(share => share.amountSatang != null);

	const theirs = activity.payments.filter(payment => payment.participantId === p.id);
	const nameOf = id => activity.participants.find(person => person.id === id)?.displayName || '—';

	return (
		<div className="account-detail">
			<dl className="account-figures">
				<Figure label={t.ledger.share} satang={p.owes} />
				{p.paidOut > 0 && <Figure label={t.ledger.fronted} satang={p.paidOut} />}
				{p.settled > 0 && <Figure label={t.ledger.confirmed} satang={p.settled} tone="clear" />}
				{p.pending > 0 && <Figure label={t.ledger.awaiting} satang={p.pending} tone="due" />}
				{p.overpaid > 0 && <Figure label={t.ledger.overpaid} satang={p.overpaid} tone="clear" />}
			</dl>

			{(owesTo.length > 0 || owedBy.length > 0) && (
				<dl className="account-figures">
					{owesTo.map(o => (
						<Figure key={`d-out-${o.creditorId}`} label={`${t.ledger.toSend} ${t.ledger.sendsShort(o.creditorName)}`} satang={o.outstandingSatang} tone="due" />
					))}
					{owedBy.map(o => (
						<Figure key={`d-in-${o.debtorId}`} label={`${t.ledger.toReceive} ${t.ledger.receivesShort(o.debtorName)}`} satang={o.outstandingSatang} tone="credit" />
					))}
				</dl>
			)}

			<div className="account-list">
				<span className="field-label">{t.ledger.inCosts}</span>
				{shares.length === 0 && <p className="quiet-note">{t.ledger.noCosts}</p>}
				{shares.map(share => (
					<div className="account-line" key={share.id}>
						<span>{share.label}</span>
						<span className="mono">{fmt.money(share.amountSatang)}</span>
					</div>
				))}
			</div>

			<div className="account-list">
				<span className="field-label">{t.ledger.paymentsTitle}</span>
				{theirs.length === 0 && <p className="quiet-note">{t.ledger.noPayments}</p>}
				{theirs.map(payment => (
					<div className="account-line" key={payment.id}>
						<span>
							{t.ledger.sendsShort(nameOf(payment.creditorParticipantId))}
							{' · '}
							{t.receiptPage.statuses[payment.status] || payment.status}
						</span>
						<span className="mono">{fmt.money(payment.amountSatang)}</span>
					</div>
				))}
			</div>
		</div>
	);
}

function Figure({ label, satang, tone }) {
	const { fmt } = useCopy();
	return (
		<div className="account-figure">
			<dt>{label}</dt>
			<dd className={`mono ${tone ? `fig-${tone}` : ''}`}>{fmt.money(satang || 0)}</dd>
		</div>
	);
}
