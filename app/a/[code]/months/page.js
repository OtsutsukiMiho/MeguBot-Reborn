'use client';

import Link from 'next/link';
import { ScreenHead, useActivity } from '../../../components/activity/ActivityShell';
import { Rise, Stagger } from '../../../components/activity/Motion';
import { useCopy } from '../../../copy';

/**
 * Every month of a subscription on one screen.
 *
 * The summary answers "what about this month", one month at a time behind a
 * row of chips. This answers the question a shared subscription is actually
 * argued about: who has been paying, and who has quietly not, across all of
 * it. One statement per month, newest first, and above them the only total
 * that matters, what each person still owes overall.
 */
export default function MonthsScreen() {
	const { code, activity } = useActivity();
	const { t, fmt } = useCopy(activity.currency);
	const { history, participants, kind } = activity;
	const back = `/a/${code}`;
	const nameOf = id => participants.find(p => p.id === id);

	const head = (
		<Rise as="header">
			<ScreenHead title={t.months.title} sub={t.months.for(activity.title)} backTo={back} backLabel={t.screens.summary} />
		</Rise>
	);

	if (kind !== 'recurring' || !history) {
		return (
			<Stagger className="focus-screen">
				{head}
				<Rise as="section" className="panel settled-note">
					<p>{kind !== 'recurring' ? t.months.notMonthly : t.months.hidden}</p>
					<Link className="btn btn-secondary" href={back}>{t.screens.summary}</Link>
				</Rise>
			</Stagger>
		);
	}

	// What each person still owes across every month, and over how many.
	const owed = new Map();
	for (const month of history) {
		for (const row of month.rows) {
			if (row.participantId === month.receiverId || row.outstandingSatang <= 0) continue;
			const entry = owed.get(row.participantId) || { satang: 0, months: 0, checking: 0 };
			entry.satang += row.outstandingSatang;
			entry.months += 1;
			// A slip sent and not yet confirmed is still owed, but it is not
			// the same as never having paid, so it is counted apart.
			if (row.pendingSatang > 0) entry.checking += 1;
			owed.set(row.participantId, entry);
		}
	}
	const owedRows = [...owed.entries()].sort((a, b) => b[1].satang - a[1].satang);

	return (
		<Stagger className="focus-screen">
			{head}

			<Rise as="section" className="ledger">
				<div className="ledger-head">
					<h2>{t.months.owedTitle}</h2>
				</div>
				{owedRows.length === 0 ? (
					<p className="quiet-note">{t.months.owedNone}</p>
				) : (
					<div>
						{owedRows.map(([id, entry]) => {
							const person = nameOf(id);
							return (
								<div className={`row account-row ${person?.isMe ? 'is-me' : ''}`} key={id}>
									<div className="row-main">
										<div className="row-name">
											<span className="account-name">{person?.displayName || '?'}</span>
											{person?.isMe && <span className="me-tag">{t.common.you}</span>}
										</div>
										<div className="row-sub">{t.months.owedMonths(entry.months, entry.checking)}</div>
									</div>
									<span className="row-figure fig-due">{fmt.money(entry.satang)}</span>
								</div>
							);
						})}
					</div>
				)}
			</Rise>

			{history.map(month => (
				<Rise as="section" className="ledger" key={month.id}>
					<div className="ledger-head">
						<h2>{fmt.period(month.key)}</h2>
						<span className="panel-count">
							{t.months.monthTotal(fmt.money(month.totalSatang), month.rows.filter(r => r.owesSatang > 0).length)}
						</span>
					</div>
					<div>
						{month.rows.map((row) => {
							const person = nameOf(row.participantId);
							const receiving = row.participantId === month.receiverId;
							let status;
							let figure;
							if (receiving) {
								status = t.months.receiver;
								figure = month.toReceiveSatang > 0
									? { className: 'fig-credit', label: t.months.toReceive(fmt.money(month.toReceiveSatang)) }
									: { className: 'fig-clear', label: t.months.allIn };
							}
							else if (row.outstandingSatang <= 0) {
								status = t.months.paid;
								figure = { className: 'fig-clear', label: fmt.money(row.owesSatang) };
							}
							else if (row.pendingSatang > 0) {
								status = t.months.checking;
								figure = { className: 'fig-due', label: fmt.money(row.outstandingSatang) };
							}
							else {
								status = t.months.owes;
								figure = { className: 'fig-due', label: fmt.money(row.outstandingSatang) };
							}
							return (
								<div className={`row account-row ${person?.isMe ? 'is-me' : ''}`} key={row.participantId}>
									<div className="row-main">
										<div className="row-name">
											<span className="account-name">{person?.displayName || '?'}</span>
											{person?.isMe && <span className="me-tag">{t.common.you}</span>}
										</div>
										<div className="row-sub">{status}</div>
									</div>
									<span className={`row-figure ${figure.className}`}>{figure.label}</span>
								</div>
							);
						})}
					</div>
				</Rise>
			))}
		</Stagger>
	);
}
