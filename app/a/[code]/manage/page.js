'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import PromptPaySetup from '../../../components/PromptPaySetup';
import PaymentOptionsSetup from '../../../components/PaymentOptionsSetup';
import { AddPerson, AttendancePanel, ExpenseRow, PaymentHistory, PendingRow } from '../../../components/activity/Rows';
import { PersonAccount, rosterOrder } from '../../../components/activity/Ledger';
import { AddExpense, CancelActivity, CashPaymentForm, PaymentDeadline, PlanControls, cashRecipients } from '../../../components/activity/OwnerTools';
import { ScreenHead, useActivity } from '../../../components/activity/ActivityShell';
import { Rise, Stagger } from '../../../components/activity/Motion';
import { useCopy } from '../../../copy';

/**
 * The organizer's console.
 *
 * All of this used to live in a sidebar on the page every participant landed
 * on, which is why that page was twice as long for the person who least needed
 * the length. Moving it to its own screen fixed the participant's problem and
 * left the organizer with a different one: one scroll holding every job they
 * have. Measured on a three-person trip with four costs — 2.75 screens on a
 * desktop, 4.7 on a phone, with the receipt scanner three screens down and the
 * button that cancels the activity sitting directly under the submit button of
 * the expense form. The right-hand rail alone was a single 2,200px panel with
 * one heading, eleven field labels and two forms in it.
 *
 * So the jobs are separated, one tab each, with the strip that says how much is
 * still owed above all of them.
 *
 * The claim queue was above the tabs too, for a while, on the grounds that it
 * is the organizer's actual job and a tab is a place to hide things. That was
 * half right and cost the other half: a payment's life — claimed, confirmed,
 * reversed — was then told in two places at once, with the part that has
 * buttons on it outside the tab named after it. What it needed was not to be
 * outside the tabs but to be the tab the screen opens on. It is, whenever
 * anybody is waiting.
 */

const TABS = ['people', 'costs', 'payments', 'payout', 'settings'];

/**
 * Which tab, remembered in the URL.
 *
 * A query parameter rather than a route: every tab reads the same activity, and
 * `ActivityShell` deliberately refetches on every navigation between screens
 * ("money changes underneath you"), so sub-routes would put a network round
 * trip behind each tab press. `replaceState` rather than `push`, because
 * looking at the costs tab is not a thing anybody wants the back button to
 * undo — but a reload, or a link pasted to somebody else, lands where it left.
 *
 * `preferred` is where the screen opens when the URL does not say. Almost every
 * visit here starts with a notification that somebody has paid, so opening on
 * the queue costs that reader nothing and saves them a click; an explicit
 * `?tab=` always wins, because somebody who asked for a tab meant it.
 */
function useTab(preferred) {
	const [tab, setTab] = useState(() => {
		if (typeof window === 'undefined') return preferred;
		const asked = new URLSearchParams(window.location.search).get('tab');
		return TABS.includes(asked) ? asked : preferred;
	});

	useEffect(() => {
		const url = new URL(window.location.href);
		url.searchParams.set('tab', tab);
		window.history.replaceState(null, '', url);
	}, [tab]);

	return [tab, setTab];
}

export default function ManageScreen() {
	const { code, activity, busy, problem, call, lang, reload, requestAction } = useActivity();
	const { t, fmt } = useCopy(activity.currency);
	const waiting = activity.payments.some(p => p.status === 'pending');
	const [tab, setTab] = useTab(waiting ? 'payments' : 'people');
	// Two panels, two buttons, two states. They shared one before, so pressing
	// Edit on the costs put the roster into edit mode and opened the add-person
	// form under it.
	const [editingPeople, setEditingPeople] = useState(false);
	const [editingCosts, setEditingCosts] = useState(false);

	const { role, participants, expenses, payments, totals, period, payTo } = activity;
	const recurring = activity.kind === 'recurring';
	const pending = payments.filter(p => p.status === 'pending');
	const confirmed = payments.filter(p => p.status === 'confirmed');
	const corrected = payments.filter(p => ['rejected', 'reversed'].includes(p.status));
	const nameOf = id => participants.find(p => p.id === id)?.displayName || '—';

	// What still has to move, taken from the obligation graph rather than from
	// a sum of balances. They differ: a balance nets what somebody owes against
	// what they are owed, so a person in the middle of two transfers counts
	// once instead of twice, and the total under-reports the work left.
	const stillToMove = (activity.obligations || []).reduce((sum, o) => sum + o.outstandingSatang, 0);
	const canRecordCash = cashRecipients(participants).length > 0;
	// Only reaches `PersonAccount` as the legacy credit fallback, for activities
	// old enough to predate the obligation graph. Never used when `owedBy` has
	// anything in it.
	const totalOutstanding = participants.reduce((sum, p) => sum + Math.max(0, p.outstanding || 0), 0);
	const roster = rosterOrder(participants, { payeeParticipantId: payTo?.participantId, totalOutstanding });

	if (role !== 'owner') {
		return (
			<Stagger className="focus-screen">
				<Rise as="header"><ScreenHead title={t.screens.manageTitle} backTo={`/a/${code}`} backLabel={t.screens.back} /></Rise>
				<Rise as="section" className="panel settled-note">
					<p>{t.screens.manageDenied}</p>
					<Link className="btn btn-secondary" href={`/a/${code}`}>{t.screens.summary}</Link>
				</Rise>
			</Stagger>
		);
	}

	const counts = {
		people: participants.length,
		costs: expenses.length,
		// The number on this tab answers "is anything waiting on me?" first and
		// "how much is on file?" only when nothing is. A records count sitting
		// where an unanswered queue should be reads as reassurance.
		payments: pending.length || confirmed.length + corrected.length,
		payout: (activity.paymentOptions || []).length,
		settings: null,
	};

	return (
		<Stagger className="focus-screen focus-screen-wide">
			<Rise as="header">
				<ScreenHead
					title={t.screens.manageTitle}
					sub={t.screens.manageFor(activity.title)}
					backTo={`/a/${code}`}
					backLabel={t.screens.back}
				/>
			</Rise>

			{problem && <div className="error-note">{problem}</div>}

			{/* The state of the thing, in one line. The panel this replaces
			    carried a count of who had answered an RSVP, printed beside the
			    payout settings, which measured nothing anyone opens this screen
			    to find out. */}
			<Rise as="section" className="console-status" aria-label={t.screens.manageTitle}>
				{activity.moneyState !== 'none' && (
					stillToMove > 0
						? <span className="console-stat"><span className="console-stat-label">{t.console.outstanding}</span><strong className="fig-due">{fmt.money(stillToMove)}</strong></span>
						: <span className="console-stat"><strong className="fig-clear">{t.console.settled}</strong></span>
				)}
				{pending.length > 0 && (
					<span className="console-stat"><span className="console-stat-label">{t.console.waiting}</span><strong className="fig-due">{pending.length}</strong></span>
				)}
				{!recurring && activity.paymentDueAt && (
					<span className="console-stat">{t.console.payBy(fmt.when(activity.paymentDueAt, { time: false }))}</span>
				)}
				{recurring && period && <span className="console-stat">{fmt.period(period.key)}</span>}
			</Rise>

			<Rise as="nav" className="console-tabs" aria-label={t.screens.manageTitle}>
				{TABS.map(name => (
					<button
						key={name}
						type="button"
						className={`tab-btn ${tab === name ? 'active' : ''} ${name === 'payments' && pending.length > 0 ? 'has-attention' : ''}`}
						aria-current={tab === name ? 'page' : undefined}
						onClick={() => setTab(name)}
					>
						{t.console.tabs[name]}
						{counts[name] > 0 && <span className="tab-count">{counts[name]}</span>}
					</button>
				))}
			</Rise>

			<Rise as="div" className="console-body" key={tab}>
				{tab === 'people' && (
					<>
						<section className="panel">
							<div className="panel-head">
								<span className="panel-title">{recurring ? t.roster.titleRecurring : t.roster.titleEvent}</span>
								<button type="button" className="link-btn" onClick={() => setEditingPeople(v => !v)}>{editingPeople ? t.common.done : t.common.edit}</button>
							</div>
							<div>
								{roster.map(p => (
									<PersonAccount
										key={p.id}
										p={p}
										activity={activity}
										recurring={recurring}
										editing={editingPeople}
										payeeParticipantId={payTo?.participantId}
										totalOutstanding={totalOutstanding}
										busy={busy}
										call={call}
										requestAction={requestAction}
									/>
								))}
								{editingPeople && <AddPerson busy={busy} call={call} />}
							</div>
						</section>

						{!recurring && activity.planState === 'done' && (
							<AttendancePanel participants={participants} busy={busy} call={call} />
						)}
					</>
				)}

				{tab === 'costs' && (
					<>
						{/* Reading the bill is the first thing offered, not the
						    fifth. On a phone it used to start 2,532px down. */}
						<section className="panel">
							<div className="panel-head"><span className="panel-title">{t.owner.addExpense}</span></div>
							<AddExpense activity={activity} participants={participants} busy={busy} call={call} />
						</section>

						{expenses.length > 0 && (
							<section className="panel">
								<div className="panel-head">
									<span className="panel-title">{t.expenses.title}</span>
									<button type="button" className="link-btn" onClick={() => setEditingCosts(v => !v)}>{editingCosts ? t.common.done : t.common.edit}</button>
								</div>
								<div>
									{expenses.map(e => (
										<ExpenseRow key={e.id} e={e} editing={editingCosts} participants={participants} nameOf={nameOf} busy={busy} call={call} requestAction={requestAction} />
									))}
									<div className="total-row">
										<span className="label">{t.expenses.total}</span>
										<span className="amount">{fmt.money(totals.total)}</span>
									</div>
								</div>
							</section>
						)}
					</>
				)}

				{tab === 'payments' && (
					<>
						{/* One payment, one life: claimed, then confirmed, then
						    reversed if it comes to that. The queue is the head of
						    that timeline rather than a panel bolted above the
						    tabs, and the screen opens here whenever it has
						    anything in it. */}
						{pending.length > 0 && (
							<section className="panel panel-attention">
								<div className="panel-head">
									<span className="panel-title">{t.pending.title}</span>
									<span className="panel-count">{pending.length}</span>
								</div>
								<div>
									{pending.map(p => (
										<PendingRow key={p.id} p={p} code={code} nameOf={nameOf} busy={busy} call={call} lang={lang} requestAction={requestAction} />
									))}
								</div>
							</section>
						)}

						{/* No panel head: the form names itself, and two headings
						    saying "Received outside Megu" is one more than the
						    reader needs. The panel is drawn only when the form
						    has somebody to offer, because the form returns null
						    when it does not and an empty bordered box is worse
						    than nothing. */}
						{canRecordCash && (
							<section className="panel">
								<CashPaymentForm participants={participants} period={period} busy={busy} call={call} />
							</section>
						)}

						{pending.length === 0 && !canRecordCash && confirmed.length === 0 && corrected.length === 0 && (
							<section className="panel settled-note">
								<p className="quiet-note">{t.console.noPaymentRecords}</p>
							</section>
						)}

						{confirmed.length > 0 && (
							<section className="panel">
								<div className="panel-head">
									<span className="panel-title">{t.pending.confirmedTitle}</span>
									<span className="panel-count">{confirmed.length}</span>
								</div>
								<div>
									{confirmed.map(p => (
										<div key={p.id} className="row">
											<div className="row-main">
												<div className="row-name">{nameOf(p.participantId)}</div>
												<div className="row-sub">
													{p.confirmationSource === 'system_slip_match'
														? t.pending.autoMatched
														: p.confirmationSource === 'owner_cash' ? t.pending.cashConfirmed : t.pending.ownerConfirmed}
												</div>
											</div>
											<span className="row-figure fig-clear">{fmt.money(p.amountSatang)}</span>
											<span className="row-tools">
												{p.hasSlip && (
													<a className="link-btn" href={`/api/megu/a/${code}/payments/${p.id}/slip?lang=${lang}`} target="_blank" rel="noreferrer">
														{t.pay.viewSlip}
													</a>
												)}
												<button type="button" className="link-btn" disabled={busy} onClick={() => requestAction({
													title: t.pending.undo,
													reasonLabel: t.pending.reversalReason,
													submitLabel: t.pending.undo,
													method: 'POST',
													path: `/payments/${p.id}/undo`,
												})}>
													{t.pending.undo}
												</button>
											</span>
										</div>
									))}
								</div>
							</section>
						)}

						{corrected.length > 0 && (
							<PaymentHistory payments={corrected} code={code} nameOf={nameOf} lang={lang} />
						)}
					</>
				)}

				{tab === 'payout' && (
					<section className="panel">
						<div className="panel-head"><span className="panel-title">{t.console.tabs.payout}</span></div>
						<div className="stack-fields">
							{activity.currency === 'THB' && (
								<PromptPaySetup
									payTo={payTo}
									participants={participants}
									busy={busy}
									call={call}
									onSaved={reload}
								/>
							)}
							<PaymentOptionsSetup
								options={activity.paymentOptions || []}
								busy={busy}
								call={call}
							/>
							{!recurring && <PaymentDeadline activity={activity} busy={busy} call={call} />}
						</div>
					</section>
				)}

				{tab === 'settings' && (
					<>
						<section className="panel">
							<div className="panel-head"><span className="panel-title">{t.owner.planTitle}</span></div>
							<PlanControls activity={activity} busy={busy} call={call} />
						</section>
						<CancelActivity activity={activity} busy={busy} requestAction={requestAction} />
					</>
				)}
			</Rise>
		</Stagger>
	);
}
