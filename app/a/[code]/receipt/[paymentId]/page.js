'use client';

import { use } from 'react';
import Link from 'next/link';
import { ScreenHead, useActivity } from '../../../../components/activity/ActivityShell';
import { LiftCard, Rise, Stagger } from '../../../../components/activity/Motion';
import { useCopy } from '../../../../copy';

/**
 * The record of one payment, for the two people at either end of it.
 *
 * This is the receipt — a page, not a file. That is the important decision and
 * it is worth writing down, because the obvious instinct is to generate a PDF
 * on the server with an embedded font.
 *
 * A server-rendered PDF has to carry its own copy of a Thai typeface, embed it
 * correctly, and shape the glyphs itself. Get any of that wrong and Thai comes
 * out as boxes while the numbers and dates look perfectly fine — which is the
 * exact failure mode, because it survives every test written by somebody
 * reading English. A page cannot fail that way: the browser already has the
 * fonts, already shapes Thai correctly, and is already rendering this exact
 * markup on screen where a human would notice.
 *
 * Export is the browser's own print-to-PDF, driven by the stylesheet at the
 * bottom of globals.css. It produces a real PDF, in the reader's language,
 * with no font to ship and no Unicode pipeline to get wrong. What it does not
 * give is a file the server can attach to an email — nothing here does that
 * today, and when something does, that is the moment to take on a PDF library.
 */
export default function ReceiptScreen({ params }) {
	const { paymentId } = use(params);
	const { code, activity } = useActivity();
	const { t, fmt } = useCopy(activity.currency);

	const payment = (activity.payments || []).find(p => p.id === paymentId);
	const nameOf = id => activity.participants.find(p => p.id === id)?.displayName || null;

	if (!payment) {
		return (
			<Stagger className="focus-screen">
				<Rise as="header">
					<ScreenHead title={t.receiptPage.title} backTo={`/a/${code}`} backLabel={t.screens.back} />
				</Rise>
				<LiftCard as="section" className="panel">
					<p className="quiet-note">{t.errors.payment_not_found}</p>
					<Link className="btn btn-secondary" href={`/a/${code}`}>{t.screens.summary}</Link>
				</LiftCard>
			</Stagger>
		);
	}

	const from = nameOf(payment.participantId);
	const to = nameOf(payment.creditorParticipantId) || activity.payTo?.displayName || null;
	const status = t.receiptPage.statuses[payment.status] || payment.status;
	const method = payment.paymentDestination?.label
		|| t.paymentMethods.types[payment.method]
		|| payment.method;

	return (
		<Stagger className="focus-screen">
			{/* `no-print` on the chrome: what gets exported is the receipt, not
			    the navigation around it. */}
			<Rise as="header" className="no-print">
				<ScreenHead
					title={t.receiptPage.title}
					sub={activity.title}
					backTo={`/a/${code}`}
					backLabel={t.screens.back}
				/>
			</Rise>

			<Rise>
				<LiftCard as="section" className="panel payment-receipt-sheet">
					<div className="payment-receipt-amount">{fmt.money(payment.amountSatang)}</div>

					{from && to && (
						<div className="payment-receipt-parties">{t.receiptPage.fromTo(from, to)}</div>
					)}
					<div className="payment-receipt-activity">{activity.title}</div>
					<div className="payment-receipt-when">{fmt.when(payment.createdAt)}</div>

					<dl className="payment-receipt-facts">
						<div>
							<dt>{t.receiptPage.status}</dt>
							{/* The state is a word. A green tick alone tells somebody
							    who cannot see green nothing at all. */}
							<dd className={`payment-receipt-status is-${payment.status}`}>{status}</dd>
						</div>
						<div>
							<dt>{t.receiptPage.method}</dt>
							<dd>{method}</dd>
						</div>
						<div>
							<dt>{t.receiptPage.reference}</dt>
							<dd className="payment-receipt-reference">{payment.reference}</dd>
						</div>
						{payment.expectedSatang != null && payment.expectedSatang !== payment.amountSatang && (
							<div>
								<dt>{t.receiptPage.asked}</dt>
								<dd>{fmt.money(payment.expectedSatang)}</dd>
							</div>
						)}
						{payment.reversalReason && (
							<div>
								<dt>{t.receiptPage.reason}</dt>
								<dd>{payment.reversalReason}</dd>
							</div>
						)}
					</dl>

					{/* Megu is not a bank and this is not proof of a transfer. Saying
					    so on the receipt itself is the only place it cannot be
					    missed — a printed page outlives the screen that explained
					    it. */}
					<p className="payment-receipt-note">{t.receiptPage.disclaimer}</p>
				</LiftCard>
			</Rise>

			<Rise className="no-print">
				<div className="share-row payment-receipt-actions">
					<button type="button" className="btn btn-secondary" onClick={() => window.print()}>
						{t.receiptPage.export}
					</button>
					{payment.hasSlip && (
						<a
							className="btn btn-secondary"
							href={`/api/megu/a/${code}/payments/${payment.id}/slip`}
							target="_blank"
							rel="noreferrer"
						>
							{t.receiptPage.viewSlip}
						</a>
					)}
				</div>
			</Rise>
		</Stagger>
	);
}
