'use client';

import { useState } from 'react';
import Link from 'next/link';
import PromptPaySetup from '../../../components/PromptPaySetup';
import PaymentOptionsSetup from '../../../components/PaymentOptionsSetup';
import { AddPerson, AttendancePanel, ExpenseRow, PaymentHistory, PendingRow, PersonRow } from '../../../components/activity/Rows';
import { CashPaymentForm, OwnerControls } from '../../../components/activity/OwnerTools';
import { ScreenHead, useActivity } from '../../../components/activity/ActivityShell';
import { LiftCard, Rise, Stagger } from '../../../components/activity/Motion';
import { useCopy } from '../../../copy';

/**
 * Everything only the organizer can do.
 *
 * All of this used to live in a sidebar and a run of panels on the page every
 * participant landed on, which is why that page was twice as long for the
 * person who least needed the length. Moving it here is not only tidiness: the
 * claim queue is the organizer's actual job, and on the old page it sat below
 * the roster and the costs, four screens down, behind work that was not theirs.
 * Here it is first.
 */
export default function ManageScreen() {
	const { code, activity, busy, problem, call, lang, reload, requestAction } = useActivity();
	const { t, fmt } = useCopy(activity.currency);
	const [editing, setEditing] = useState(false);

	const { role, participants, expenses, payments, totals, period, payTo } = activity;
	const recurring = activity.kind === 'recurring';
	const pending = payments.filter(p => p.status === 'pending');
	const confirmed = payments.filter(p => p.status === 'confirmed');
	const corrected = payments.filter(p => ['rejected', 'reversed'].includes(p.status));
	const nameOf = id => participants.find(p => p.id === id)?.displayName || '—';
	const totalOutstanding = participants.reduce((sum, p) => sum + Math.max(0, p.outstanding || 0), 0);
	const going = participants.filter(p => p.rsvp === 'yes').length;

	if (role !== 'owner') {
		return (
			<Stagger className="focus-screen">
				<Rise as="header"><ScreenHead title={t.screens.manageTitle} backTo={`/a/${code}`} backLabel={t.screens.back} /></Rise>
				<LiftCard as="section" className="panel settled-note">
					<p>{t.screens.manageDenied}</p>
					<Link className="btn btn-secondary" href={`/a/${code}`}>{t.screens.summary}</Link>
				</LiftCard>
			</Stagger>
		);
	}

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

			{/* The organizer's actual job, first. On the old page it was below
			    the roster and the costs — work that is not theirs — while the
			    thing waiting on a decision sat four screens down. */}
			{pending.length > 0 && (
				<LiftCard as="section" className="panel">
					<div className="panel-head">
						<span className="panel-title">{t.pending.title}</span>
						<span className="panel-count">{pending.length}</span>
					</div>
					<div>
						{pending.map(p => (
							<PendingRow key={p.id} p={p} code={code} nameOf={nameOf} busy={busy} call={call} lang={lang} requestAction={requestAction} />
						))}
					</div>
				</LiftCard>
			)}

			<Rise className="two-col">
				<div className="stack-lg" style={{ paddingBottom: 0 }}>
					<LiftCard as="section" className="panel">
						<div className="panel-head">
							<span className="panel-title">{recurring ? t.roster.titleRecurring : t.roster.titleEvent}</span>
							<button type="button" className="link-btn" onClick={() => setEditing(v => !v)}>{editing ? t.common.done : t.common.edit}</button>
						</div>
						<div>
							{participants.map(p => (
								<PersonRow
									key={p.id}
									p={p}
									recurring={recurring}
									editing={editing}
									canSeeMoney
									moneyState={activity.moneyState}
									planState={activity.planState}
									totalOutstanding={totalOutstanding}
									payeeParticipantId={payTo?.participantId}
									busy={busy}
									call={call}
									requestAction={requestAction}
								/>
							))}
							{editing && <AddPerson busy={busy} call={call} />}
						</div>
					</LiftCard>

					{expenses.length > 0 && (
						<LiftCard as="section" className="panel">
							<div className="panel-head">
								<span className="panel-title">{t.expenses.title}</span>
								<button type="button" className="link-btn" onClick={() => setEditing(v => !v)}>{editing ? t.common.done : t.common.edit}</button>
							</div>
							<div>
								{expenses.map(e => (
									<ExpenseRow key={e.id} e={e} editing={editing} participants={participants} nameOf={nameOf} busy={busy} call={call} requestAction={requestAction} />
								))}
								<div className="total-row">
									<span className="label">{t.expenses.total}</span>
									<span className="amount">{fmt.money(totals.total)}</span>
								</div>
							</div>
						</LiftCard>
					)}

					{!recurring && activity.planState === 'done' && (
						<AttendancePanel participants={participants} busy={busy} call={call} />
					)}

					{confirmed.length > 0 && (
						<LiftCard as="section" className="panel">
							<div className="panel-head"><span className="panel-title">{t.pending.confirmedTitle}</span></div>
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
						</LiftCard>
					)}

					{corrected.length > 0 && (
						<PaymentHistory payments={corrected} code={code} nameOf={nameOf} lang={lang} />
					)}
				</div>

				<aside className="stack-lg" style={{ paddingBottom: 0 }}>
					<LiftCard as="section" className="panel">
						<div className="panel-head">
							<span className="panel-title">{t.owner.title}</span>
							<span className="panel-count">{recurring ? participants.length : `${going}/${participants.length}`}</span>
						</div>
						<div>
							{activity.currency === 'THB' && <PromptPaySetup
								payTo={payTo}
								participants={participants}
								busy={busy}
								call={call}
								onSaved={reload}
							/>}
							<PaymentOptionsSetup
								options={activity.paymentOptions || []}
								busy={busy}
								call={call}
							/>
							<OwnerControls activity={activity} busy={busy} call={call} participants={participants} requestAction={requestAction} />
							<CashPaymentForm participants={participants} period={period} busy={busy} call={call} />
						</div>
					</LiftCard>
				</aside>
			</Rise>
		</Stagger>
	);
}
