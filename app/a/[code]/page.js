'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import MeguMark from '../../components/MeguMark';
import CountUp from '../../components/activity/CountUp';
import { LiftCard, Rise, Stagger } from '../../components/activity/Motion';
import { PersonRow } from '../../components/activity/Rows';
import { useActivity } from '../../components/activity/ActivityShell';
import { useCopy } from '../../copy';

/**
 * The summary. Where you are, and the one thing that needs you.
 *
 * This page used to be the whole product: pay panel, time poll, RSVP, roster,
 * costs, claim queue, organizer tools and invite link, stacked, for every role.
 * A participant who came to send ฿100 scrolled past two and a half screens of
 * other people's business to reach a QR code, and the organizer past twice
 * that. Everything that is a *task* now has its own screen, and what is left
 * here is the two things a summary is actually for: orientation, and the door
 * to whichever task is yours.
 *
 * The "Your turn" card is the point of the redesign. There is exactly one, it
 * is above the fold, and it names one action — because the previous design's
 * answer to "what should I do?" was to render every possible answer at once and
 * let the reader work it out.
 */
export default function ActivitySummary() {
	const { code, activity, busy, problem, call, viewPeriod, setViewPeriod } = useActivity();
	const { t, fmt } = useCopy(activity.currency);
	const [copied, setCopied] = useState(false);
	const [copyFailed, setCopyFailed] = useState(false);
	const shareInputRef = useRef(null);

	const { role, me, participants, expenses, payments, totals, period, periods, kind, poll, payTo } = activity;
	const isOwner = role === 'owner';
	const canSeeMoney = role !== 'none';
	const myRow = me ? participants.find(p => p.id === me.id) : null;
	const shareUrl = activity.shareUrl || (typeof window !== 'undefined' ? `${window.location.origin}/a/${code}` : '');
	const pending = payments.filter(p => p.status === 'pending');
	const recurring = kind === 'recurring';
	const going = participants.filter(p => p.rsvp === 'yes').length;
	const totalOutstanding = participants.reduce((sum, p) => sum + Math.max(0, p.outstanding || 0), 0);
	const nameOf = id => participants.find(p => p.id === id)?.displayName || '—';
	const disputedMine = me
		? payments.filter(p => p.participantId === me.id && ['rejected', 'reversed'].includes(p.status))
		: [];

	async function copyShareUrl() {
		setCopyFailed(false);
		let copiedNow = false;
		const input = shareInputRef.current;

		// The browser error in this flow is literal: "Document is not focused".
		// Put focus inside the document before asking for clipboard permission,
		// and leave the link selected so manual copy remains one gesture away.
		input?.focus();
		input?.select();

		try {
			if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
			await navigator.clipboard.writeText(shareUrl);
			copiedNow = true;
		}
		catch {
			// Clipboard API requires a focused, secure document. LAN test URLs
			// normally use plain HTTP, and embedded browsers can refuse access
			// even after a click, so retain a selection-based fallback.
			try {
				copiedNow = Boolean(input && document.execCommand('copy'));
			}
			catch {
				copiedNow = false;
			}
		}

		if (!copiedNow) {
			setCopyFailed(true);
			return;
		}

		setCopied(true);
		setTimeout(() => setCopied(false), 1800);
	}

	return (
		<Stagger className="stack-lg">
			<Rise as="header" className="page-head">
				<h1>{activity.title}</h1>
				<div className="page-meta">
					{recurring
						? <span>{period ? fmt.period(period.key) : t.activity.noPeriodYet}{activity.dueDay ? ` · ${t.activity.dueOn(activity.dueDay)}` : ''}</span>
						: <>
							<span>{fmt.when(activity.startsAt, { long: true }) || t.activity.notScheduled}</span>
							{activity.location && <span>{activity.location}</span>}
							{/* The day the money is due, which is rarely the day
							    the thing happens. Only shown to people who can
							    see amounts — it is a fact about the bill. */}
							{canSeeMoney && activity.paymentDueAt && (
								<span>{t.activity.payBy(fmt.when(activity.paymentDueAt, { time: false }))}</span>
							)}
						</>}
					<span>{recurring ? t.activity.members(participants.length) : t.activity.peopleGoing(going, participants.length)}</span>
					<span className="code">{activity.code}</span>
				</div>
			</Rise>

			<NextStep
				code={code}
				activity={activity}
				myRow={myRow}
				pending={pending}
				busy={busy}
				call={call}
			/>

			<Rise className="megu-aside">
				<MeguMark size={34} />
				<div>
					<span className="who">Megu</span>
					<p>{activity.megu}</p>
				</div>
			</Rise>

			{problem && <div className="error-note">{problem}</div>}
			{disputedMine.map(payment => (
				<div className="error-note" key={payment.id} role="status">
					{payment.status === 'rejected'
						? t.pending.rejectedNotice(payment.reversalReason || '—')
						: t.pending.reversedNotice(payment.reversalReason || '—')}
				</div>
			))}

			<Rise className="chips">
				{!recurring && (
					<span className={`chip ${activity.planState === 'done' ? '' : 'chip-live'}`}>
						{t.plan[activity.planState]}
					</span>
				)}
				{canSeeMoney && (
					<span className={`chip ${activity.moneyState === 'open' ? 'chip-due' : activity.moneyState === 'settled' ? 'chip-clear' : ''}`}>
						{t.money[activity.moneyState]}
					</span>
				)}
				{recurring && periods.map(p => (
					<button
						key={p.id}
						type="button"
						className={`month-btn ${p.id === period?.id ? 'current' : ''}`}
						onClick={() => setViewPeriod(p.id)}
					>
						{fmt.period(p.key, { short: true })}
					</button>
				))}
			</Rise>

			<Rise className="two-col">
				<div className="stack-lg" style={{ paddingBottom: 0 }}>
					{/* A statement table, not a card. Hairlines between rows and
					    figures on one right axis, so the roster can be read by
					    running an eye down the column — which is the entire
					    reason a receipt has ever been laid out this way. */}
					<LiftCard as="section" className="ledger">
						<div className="ledger-head">
							<h2>{recurring ? t.roster.titleRecurring : t.roster.titleEvent}</h2>
							<span className="panel-count">{recurring ? participants.length : `${going}/${participants.length}`}</span>
						</div>
						<div>
							{participants.map(p => (
								<PersonRow
									key={p.id}
									p={p}
									recurring={recurring}
									editing={false}
									canSeeMoney={canSeeMoney}
									moneyState={activity.moneyState}
									planState={activity.planState}
									totalOutstanding={totalOutstanding}
									payeeParticipantId={payTo?.participantId}
									busy={busy}
									call={call}
								/>
							))}
						</div>
					</LiftCard>

					{canSeeMoney && expenses.length > 0 && (
						<LiftCard as="section" className="ledger">
							<div className="ledger-head">
								<h2>{t.expenses.title}</h2>
							</div>
							<div>
								{expenses.map(e => (
									<div className="row" key={e.id}>
										<div className="row-main">
											<div className="row-name">{e.label}</div>
											<div className="row-sub">{t.expenses.frontedBy(nameOf(e.paidBy))}</div>
										</div>
										<span className="row-figure">{fmt.money(e.amountSatang)}</span>
									</div>
								))}
								<div className="total-row">
									<span className="label">{t.expenses.total}</span>
									<span className="amount">{fmt.money(totals.total)}</span>
								</div>
							</div>
						</LiftCard>
					)}
				</div>

				<aside className="stack-lg" style={{ paddingBottom: 0 }}>
					<LiftCard as="section" className="aside-block">
						<h2>{t.invite.title}</h2>
						<div>
							<p className="quiet-note" style={{ paddingTop: '.3rem', paddingBottom: '.6rem' }}>{t.invite.hint}</p>
							<div className="share-row">
								<input ref={shareInputRef} className="form-control" readOnly value={shareUrl} onFocus={e => e.target.select()} aria-label={t.invite.linkLabel} />
								<button type="button" className="btn btn-secondary btn-sm" onClick={copyShareUrl}>
									{copied ? t.common.copied : t.common.copy}
								</button>
							</div>
							{activity.shareReachability === 'network' && <p className="field-hint">{t.invite.networkOnly}</p>}
							{activity.shareReachability === 'device' && <p className="field-hint error-text">{t.invite.deviceOnly}</p>}
							{copyFailed && <p className="field-hint error-text" role="alert">{t.invite.copyFailed}</p>}
						</div>
					</LiftCard>

					{isOwner && (
						<Link className="btn btn-secondary btn-block" href={`/a/${code}/manage`}>
							{t.screens.openManage}
						</Link>
					)}
				</aside>
			</Rise>
		</Stagger>
	);
}

/**
 * One card, one action, above the fold.
 *
 * The order below is the order of urgency, and only the first match is drawn.
 * Money outranks the plan because money is the thing people avoid; claiming a
 * name outranks everything because nothing else can be personalised until it
 * has happened.
 *
 * Claiming is the one action that stays inline rather than getting its own
 * screen: it is a list of names with no state, and sending somebody to another
 * page to press one of them would be the same mistake in the opposite
 * direction.
 */
function NextStep({ code, activity, myRow, pending, busy, call }) {
	const { t, fmt } = useCopy(activity.currency);
	const { role, me, participants, poll, planState } = activity;
	const isOwner = role === 'owner';
	const recurring = activity.kind === 'recurring';
	const myPending = me ? pending.find(p => p.participantId === me.id) : null;
	const iOwe = Boolean(myRow && role !== 'none' && myRow.outstanding > 0);

	if (!me && !isOwner) {
		return (
			<Rise as="section" className="next-step" aria-labelledby="next-step-title">
				<h2 id="next-step-title">{t.next.claim}</h2>
				<p className="quiet-note">{t.claim.hint}</p>
				<div className="names">
					{participants.map(p => (
						<button
							key={p.id}
							type="button"
							className="name-btn"
							disabled={busy || p.claimed}
							onClick={() => call('POST', '/claim', { participantId: p.id })}
						>
							{p.displayName}
						</button>
					))}
				</div>
			</Rise>
		);
	}

	if (iOwe && myPending) {
		return <Statement label={t.next.pendingLabel} satang={myPending.amountSatang} currency={activity.currency} />;
	}
	if (iOwe) {
		return (
			<Statement
				label={t.next.oweLabel}
				satang={myRow.outstanding}
				currency={activity.currency}
				note={myRow.deferral ? t.next.deferred(fmt.when(myRow.deferral.snoozeUntil, { time: false })) : null}
				action={{ href: `/a/${code}/pay`, label: t.next.oweAction }}
			/>
		);
	}

	const unvoted = poll && me && poll.slots.some(slot => !poll.myVotes[slot.id]);
	if (unvoted && planState === 'open') {
		return <Statement line={t.next.vote} action={{ href: `/a/${code}/rsvp`, label: t.next.voteAction }} />;
	}
	if (me && !recurring && activity.startsAt && !poll && planState === 'open' && myRow?.rsvp === 'pending') {
		return <Statement line={t.next.rsvp} action={{ href: `/a/${code}/rsvp`, label: t.next.rsvpAction }} />;
	}
	if (isOwner && pending.length > 0) {
		return <Statement line={t.next.review(pending.length)} action={{ href: `/a/${code}/manage`, label: t.next.reviewAction }} />;
	}

	return <Statement line={t.next.clear} quiet />;
}

/**
 * The top of the statement.
 *
 * A label naming the value and the value under it, the way a printed statement
 * has always done it — which is not the banned kicker-above-a-heading, because
 * the thing underneath is a figure rather than a headline, and "You owe" is
 * unreadable without the number it introduces.
 *
 * When there is no money to state, the sentence stands on its own with no
 * label above it at all.
 */
function Statement({ label, satang, currency, line, note, action, quiet }) {
	const { fmt } = useCopy(currency);
	return (
		<Rise as="section" className="statement">
			{label && <span className="statement-label">{label}</span>}
			{satang != null && (
				<CountUp className="statement-figure" value={satang} format={value => fmt.money(value)} />
			)}
			{line && <span className={`statement-line ${quiet ? 'is-quiet' : ''}`}>{line}</span>}
			{note && <p className="statement-note">{note}</p>}
			{action && (
				<div className="statement-actions">
					<Link className="btn btn-pay btn-lg" href={action.href}>{action.label}</Link>
				</div>
			)}
		</Rise>
	);
}
