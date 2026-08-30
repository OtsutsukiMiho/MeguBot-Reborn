'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import PayPanel from '../../../components/PayPanel';
import { ScreenHead, deferDialog, useActivity } from '../../../components/activity/ActivityShell';
import { Rise, Stagger } from '../../../components/activity/Motion';
import { useCopy } from '../../../copy';

/**
 * The payment screen, and nothing else.
 *
 * This is the destination the reminder points at, and the reason it is a route
 * rather than an anchor. As a panel halfway down the activity page it had three
 * problems that no amount of styling fixes: the QR sat next to a box inviting
 * you to share the link with other people, arriving meant a scroll that landed
 * wherever the layout happened to be at that instant, and there was no address
 * for "the payment screen" to send anyone to or to go back from.
 *
 * What is deliberately absent: the roster, the costs, the poll, the invite
 * link, Megu's commentary, the plan chips. Somebody is about to move real money
 * on a phone. The only things on screen are the amount, where it goes, and the
 * two honest answers — I have paid, or not yet and here is why.
 */
export default function PayScreen() {
	const { code, activity, busy, problem, call, setProblem, readError, requestAction, viewCreditor, setViewCreditor } = useActivity();
	const { t, fmt } = useCopy(activity.currency);
	const { me, participants, payments, period, periods, payTo, payToChoices, kind } = activity;
	const myRow = me ? participants.find(p => p.id === me.id) : null;
	const recurring = kind === 'recurring';
	const scope = period?.id || null;

	// Who this screen is about. On a trip where two people fronted cash there is
	// more than one answer, and the server declines to guess — so the first
	// thing shown is the question, not somebody's account number.
	const creditorId = viewCreditor || payTo?.participantId || null;
	const mustChoose = (payToChoices || []).length > 0;
	const owedHere = myRow?.owesTo || [];
	const dueHere = creditorId
		? (owedHere.find(o => o.creditorId === creditorId)?.outstandingSatang ?? myRow?.outstanding ?? 0)
		: (myRow?.outstanding || 0);

	const myPending = me
		? payments.find(p => p.participantId === me.id
			&& p.status === 'pending'
			&& (!creditorId || !p.creditorParticipantId || p.creditorParticipantId === creditorId))
		: null;

	// The quiet button on a reminder email cannot open a modal by itself, so it
	// arrives here with `?defer=1` and this finishes the gesture. The query is
	// stripped afterwards, or a refresh reopens a dialog already answered.
	const arrived = useRef(false);
	useEffect(() => {
		if (arrived.current) return;
		const params = new URLSearchParams(window.location.search);
		if (params.get('defer') !== '1') return;
		arrived.current = true;
		requestAction(deferDialog(t, scope));
		params.delete('defer');
		const rest = params.toString();
		window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
	}, [requestAction, t, scope]);

	const sub = [
		t.screens.payFor(activity.title),
		recurring && period ? fmt.period(period.key) : null,
		activity.paymentDueAt ? t.activity.payBy(fmt.when(activity.paymentDueAt, { time: false })) : null,
	].filter(Boolean).join(' · ');

	return (
		<Stagger className="focus-screen">
			<Rise as="header">
				<ScreenHead title={t.screens.payTitle} sub={sub} backTo={`/a/${code}`} backLabel={t.screens.back} />
			</Rise>

			{problem && <div className="error-note">{problem}</div>}

			{!myRow ? (
				<Rise as="section" className="panel">
					<p className="quiet-note">{t.screens.payClaimFirst}</p>
					<Link className="btn btn-secondary" href={`/a/${code}`}>{t.screens.summary}</Link>
				</Rise>
			) : mustChoose ? (
				/* Two people fronted money, so there are two transfers to make.
				   Asking which one first is not an extra step — it is the step
				   that was missing, and skipping it is how the person who covered
				   the taxi ends up never being paid. */
				<Rise>
					<Rise as="section" className="panel">
						<div className="field-label">{t.pay.chooseCreditor}</div>
						<p className="field-hint">{t.pay.chooseCreditorHint}</p>
						<div className="creditor-choices">
							{payToChoices.map(choice => (
								<button
									key={choice.participantId}
									type="button"
									className="btn btn-secondary creditor-choice"
									disabled={busy}
									onClick={() => setViewCreditor(choice.participantId)}
								>
									<span className="creditor-choice-name">{choice.displayName}</span>
									<span className="creditor-choice-amount">{fmt.money(choice.outstandingSatang)}</span>
								</button>
							))}
						</div>
					</Rise>
				</Rise>
			) : dueHere > 0 ? (
				<Rise>
					{owedHere.length > 1 && (
						<button
							type="button"
							className="btn btn-quiet"
							onClick={() => setViewCreditor(null)}
						>
							{t.pay.chooseSomeoneElse}
						</button>
					)}
					<PayPanel
						code={code}
						payTo={payTo}
						creditorParticipantId={creditorId}
						amountSatang={dueHere}
						periodId={scope}
						periods={recurring ? periods : []}
						paymentOptions={myPending?.paymentDestination
						&& !(activity.paymentOptions || []).some(option => option.id === myPending.paymentDestination.id)
						? [myPending.paymentDestination, ...(activity.paymentOptions || [])]
						: activity.paymentOptions || []}
						pending={myPending}
						deferral={myRow.deferral || null}
						busy={busy}
						call={call}
						onDefer={() => requestAction(deferDialog(t, scope))}
						onError={payload => setProblem(readError(payload))}
					/>
				</Rise>
			) : (
				<Rise as="section" className="panel settled-note">
					<p>{t.screens.payNothing}</p>
					<Link className="btn btn-secondary" href={`/a/${code}`}>{t.screens.summary}</Link>
				</Rise>
			)}
		</Stagger>
	);
}
