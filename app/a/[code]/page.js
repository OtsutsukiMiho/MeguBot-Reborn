'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import MeguMark from '../../components/MeguMark';
import PayPanel from '../../components/PayPanel';
import PromptPaySetup from '../../components/PromptPaySetup';
import PaymentOptionsSetup from '../../components/PaymentOptionsSetup';
import SlipPicker from '../../components/SlipPicker';
import SlipReading from '../../components/SlipReading';
import ReceiptScanner from '../../components/ReceiptScanner';
import { CurrencyProvider, useCopy } from '../../copy';

export default function ActivityPage({ params }) {
	const { code } = use(params);
	const [activity, setActivity] = useState(null);
	const { t, fmt, lang, error: readError } = useCopy(activity?.currency);
	const [problem, setProblem] = useState('');
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [copied, setCopied] = useState(false);
	const [copyFailed, setCopyFailed] = useState(false);
	const [viewPeriod, setViewPeriod] = useState(null);
	const [editing, setEditing] = useState(false);
	const [actionDialog, setActionDialog] = useState(null);
	const shareInputRef = useRef(null);
	const loadRequestRef = useRef(0);

	// Megu's own sentences are written on the server, so every request has to
	// say which language it expects one in.
	const url = useCallback(
		(path = '', extra = '') => `/api/megu/a/${code}${path}?lang=${lang}${extra}`,
		[code, lang],
	);

	const load = useCallback(async (periodId) => {
		const requestId = ++loadRequestRef.current;
		const res = await fetch(url('', periodId ? `&period=${periodId}` : ''), { credentials: 'same-origin' });
		const data = await res.json().catch(() => ({}));
		if (requestId !== loadRequestRef.current) return;
		if (!res.ok) {
			setProblem(readError(data));
			return;
		}
		setActivity(data.activity);
	}, [url, readError]);

	async function submitActionDialog(reason = '') {
		if (!actionDialog) return;
		const body = actionDialog.reasonLabel
			? { ...(actionDialog.body || {}), reason: reason.trim() }
			: actionDialog.body;
		const result = await call(actionDialog.method, actionDialog.path, body);
		if (result) setActionDialog(null);
	}

	const call = useCallback(async (method, path, body) => {
		setBusy(true);
		setProblem('');
		try {
			const res = await fetch(url(path), {
				method,
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: body ? JSON.stringify(body) : undefined,
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				setProblem(readError(data));
				return null;
			}
			if (data.activity) setActivity(data.activity);
			return data;
		}
		catch {
			setProblem(readError({ code: 'offline' }));
			return null;
		}
		finally {
			setBusy(false);
		}
	}, [url, readError]);

	useEffect(() => {
		load(viewPeriod).finally(() => setLoading(false));
	}, [load, viewPeriod]);

	if (loading) {
		return (
			<div className="center-screen">
				<MeguMark size={72} mood="asleep" />
				<p className="quiet-note">{t.common.loading}</p>
			</div>
		);
	}

	if (!activity) {
		return (
			<div className="center-screen">
				<MeguMark size={96} mood="asleep" />
				<h1>{t.errors.notFound}</h1>
				<p className="quiet-note">{t.errors.notFoundHint}</p>
			</div>
		);
	}

	const { role, me, participants, expenses, payments, totals, period, periods, kind, poll, payTo } = activity;
	const isOwner = role === 'owner';
	const canSeeMoney = role !== 'none';
	const myRow = me ? participants.find(p => p.id === me.id) : null;
	const shareUrl = activity.shareUrl || (typeof window !== 'undefined' ? `${window.location.origin}/a/${code}` : '');
	const pending = payments.filter(p => p.status === 'pending');
	const confirmed = payments.filter(p => p.status === 'confirmed');
	const corrected = payments.filter(p => ['rejected', 'reversed'].includes(p.status));
	const disputedMine = me
		? payments.filter(p => p.participantId === me.id && ['rejected', 'reversed'].includes(p.status))
		: [];
	const nameOf = id => participants.find(p => p.id === id)?.displayName || '—';
	const recurring = kind === 'recurring';
	const going = participants.filter(p => p.rsvp === 'yes').length;
	const totalOutstanding = participants.reduce((sum, p) => sum + Math.max(0, p.outstanding || 0), 0);

	// The claim this reader has already made, if any — it carries the slip.
	const myPending = me ? pending.find(p => p.participantId === me.id) : null;
	const iOwe = Boolean(myRow && canSeeMoney && myRow.outstanding > 0);

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
		<CurrencyProvider currency={activity.currency}>
		<div className="stack-lg">
			<header className="page-head rise">
				<h1>{activity.title}</h1>
				<div className="page-meta">
					{recurring
						? <span>{period ? fmt.period(period.key) : t.activity.noPeriodYet}{activity.dueDay ? ` · ${t.activity.dueOn(activity.dueDay)}` : ''}</span>
						: <>
							<span>{fmt.when(activity.startsAt, { long: true }) || t.activity.notScheduled}</span>
							{activity.location && <span>{activity.location}</span>}
						</>}
					<span>{recurring ? t.activity.members(participants.length) : t.activity.peopleGoing(going, participants.length)}</span>
					<span className="code">{activity.code}</span>
				</div>

				{myRow && canSeeMoney && totals?.total > 0 && (
					<div className="headline-figure">
						<div>
							<div className="label">
								{myRow.outstanding > 0
									? t.headline.youOwe
									: activity.moneyState === 'open' && myRow.id === payTo?.participantId && totalOutstanding > 0
										? t.headline.youGetBack
										: t.headline.yourTotal}
							</div>
							<div className={`amount ${myRow.outstanding > 0 ? '' : 'is-clear'}`}>
								{myRow.outstanding > 0
									? fmt.money(myRow.outstanding)
									: activity.moneyState === 'open' && myRow.id === payTo?.participantId && totalOutstanding > 0
										? fmt.money(totalOutstanding)
										: t.headline.clear}
							</div>
						</div>
						{/* The button anchors to the pay panel rather than acting,
						    so there is exactly one place where money is claimed
						    and it is the place that also shows where to send it. */}
						{iOwe && (
							myPending
								? <span className="chip">{t.headline.claimed}</span>
								: <a href="#pay" className="btn btn-pay btn-lg">{t.headline.pay}</a>
						)}
					</div>
				)}
			</header>

			<div className="megu-says rise rise-2">
				<MeguMark size={52} />
				<div>
					<span className="who">Megu</span>
					<p>{activity.megu}</p>
				</div>
			</div>

			{problem && <div className="error-note">{problem}</div>}
			{disputedMine.map(payment => (
				<div className="error-note" key={payment.id} role="status">
					{payment.status === 'rejected'
						? t.pending.rejectedNotice(payment.reversalReason || '—')
						: t.pending.reversedNotice(payment.reversalReason || '—')}
				</div>
			))}

			<div className="chips rise rise-2">
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
			</div>

			<div className="two-col rise rise-3">
				<div className="stack-lg" style={{ paddingBottom: 0 }}>
					{!me && !isOwner && (
						<section className="panel">
							<div className="panel-head">
								<span className="panel-title">{t.claim.title}</span>
							</div>
							<div>
								<p className="quiet-note" style={{ paddingTop: '.4rem' }}>{t.claim.hint}</p>
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
							</div>
						</section>
					)}

					{/* Where the money actually moves. First in the column when
					    this reader owes something, because it is the only thing
					    they came here to do. */}
					{iOwe && (
						<div id="pay">
							<PayPanel
								code={code}
								payTo={payTo}
								amountSatang={myRow.outstanding}
								periodId={period?.id || null}
								periods={recurring ? periods : []}
								paymentOptions={myPending?.paymentDestination
									&& !(activity.paymentOptions || []).some(option => option.id === myPending.paymentDestination.id)
									? [myPending.paymentDestination, ...(activity.paymentOptions || [])]
									: activity.paymentOptions || []}
								pending={myPending}
								busy={busy}
								call={call}
								onError={payload => setProblem(readError(payload))}
							/>
						</div>
					)}

					{poll && activity.planState === 'open' && (
						<TimePoll poll={poll} me={me} isOwner={isOwner} busy={busy} call={call} total={participants.length} />
					)}

					{!recurring && !activity.startsAt && !poll && activity.planState === 'open' && (
						<section className="panel schedule-needed">
							<div className="panel-head"><span className="panel-title">{t.schedule.title}</span></div>
							<div>
								<p className="quiet-note">{isOwner ? t.schedule.ownerHint : t.schedule.waitingHint}</p>
								{isOwner && <ProposeSlots busy={busy} call={call} />}
							</div>
						</section>
					)}

					{me && !recurring && activity.startsAt && !poll && activity.planState === 'open' && (
						<section className="panel">
							<div className="panel-head"><span className="panel-title">{t.rsvp.question(me.displayName)}</span></div>
							<div>
								<div className="names" style={{ paddingTop: '.6rem' }}>
									<button
										type="button"
										className={`vote-btn ${myRow?.rsvp === 'yes' ? 'on-yes' : ''}`}
										disabled={busy}
										onClick={() => call('POST', '/rsvp', { rsvp: 'yes' })}
									>
										{t.rsvp.going}
									</button>
									<button
										type="button"
										className={`vote-btn ${myRow?.rsvp === 'no' ? 'on-no' : ''}`}
										disabled={busy}
										onClick={() => call('POST', '/rsvp', { rsvp: 'no' })}
									>
										{t.rsvp.notGoing}
									</button>
								</div>
							</div>
						</section>
					)}

					<section className="panel">
						<div className="panel-head">
							<span className="panel-title">{recurring ? t.roster.titleRecurring : t.roster.titleEvent}</span>
							{isOwner
								? <button type="button" className="link-btn" onClick={() => setEditing(v => !v)}>{editing ? t.common.done : t.common.edit}</button>
								: <span className="panel-count">{recurring ? participants.length : `${going}/${participants.length}`}</span>}
						</div>
						<div>
							{participants.map(p => (
								<PersonRow
									key={p.id}
									p={p}
									recurring={recurring}
									editing={editing && isOwner}
									canSeeMoney={canSeeMoney}
									moneyState={activity.moneyState}
									planState={activity.planState}
									totalOutstanding={totalOutstanding}
									payeeParticipantId={payTo?.participantId}
									busy={busy}
									call={call}
									requestAction={setActionDialog}
								/>
							))}
							{editing && isOwner && <AddPerson busy={busy} call={call} />}
						</div>
					</section>

					{isOwner && !recurring && activity.planState === 'done' && (
						<AttendancePanel participants={participants} busy={busy} call={call} />
					)}

					{canSeeMoney && expenses.length > 0 && (
						<section className="panel">
							<div className="panel-head">
								<span className="panel-title">{t.expenses.title}</span>
								{isOwner && (
									<button type="button" className="link-btn" onClick={() => setEditing(v => !v)}>{editing ? t.common.done : t.common.edit}</button>
								)}
							</div>
							<div>
								{expenses.map(e => (
									<ExpenseRow key={e.id} e={e} editing={editing && isOwner} participants={participants} nameOf={nameOf} busy={busy} call={call} requestAction={setActionDialog} />
								))}
								<div className="total-row">
									<span className="label">{t.expenses.total}</span>
									<span className="amount">{fmt.money(totals.total)}</span>
								</div>
							</div>
						</section>
					)}

					{isOwner && pending.length > 0 && (
						<section className="panel">
							<div className="panel-head">
								<span className="panel-title">{t.pending.title}</span>
								<span className="panel-count">{pending.length}</span>
							</div>
							<div>
								{pending.map(p => (
									<PendingRow key={p.id} p={p} code={code} nameOf={nameOf} busy={busy} call={call} lang={lang} requestAction={setActionDialog} />
								))}
							</div>
						</section>
					)}

					{isOwner && confirmed.length > 0 && (
						<section className="panel">
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
											<button type="button" className="link-btn" disabled={busy} onClick={() => setActionDialog({
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

					{isOwner && corrected.length > 0 && (
						<PaymentHistory payments={corrected} code={code} nameOf={nameOf} lang={lang} />
					)}
				</div>

				<aside className="stack-lg" style={{ paddingBottom: 0 }}>
					{isOwner && (
						<section className="panel">
							<div className="panel-head"><span className="panel-title">{t.owner.title}</span></div>
							<div>
								{activity.currency === 'THB' && <PromptPaySetup
									payTo={payTo}
									participants={participants}
									busy={busy}
									call={call}
									onSaved={() => load(viewPeriod)}
								/>}
								<PaymentOptionsSetup
									options={activity.paymentOptions || []}
									busy={busy}
									call={call}
								/>
								<OwnerControls activity={activity} busy={busy} call={call} participants={participants} requestAction={setActionDialog} />
								<CashPaymentForm participants={participants} period={period} busy={busy} call={call} />
							</div>
						</section>
					)}

					<section className="panel">
						<div className="panel-head"><span className="panel-title">{t.invite.title}</span></div>
						<div>
							<p className="quiet-note" style={{ paddingTop: '.3rem', paddingBottom: '.6rem' }}>{t.invite.hint}</p>
							<div className="share-row">
								<input ref={shareInputRef} className="form-control" readOnly value={shareUrl} onFocus={e => e.target.select()} aria-label={t.invite.linkLabel} />
								<button
									type="button"
									className="btn btn-secondary btn-sm"
									onClick={copyShareUrl}
								>
									{copied ? t.common.copied : t.common.copy}
								</button>
							</div>
							{activity.shareReachability === 'network' && <p className="field-hint">{t.invite.networkOnly}</p>}
							{activity.shareReachability === 'device' && <p className="field-hint error-text">{t.invite.deviceOnly}</p>}
							{copyFailed && <p className="field-hint error-text" role="alert">{t.invite.copyFailed}</p>}
						</div>
					</section>
				</aside>
			</div>
			{actionDialog && (
				<ActionDialog
					key={`${actionDialog.method}:${actionDialog.path}`}
					action={actionDialog}
					busy={busy}
					onCancel={() => setActionDialog(null)}
					onSubmit={submitActionDialog}
				/>
			)}
		</div>
		</CurrencyProvider>
	);
}

function ActionDialog({ action, busy, onCancel, onSubmit }) {
	const { t } = useCopy();
	const [reason, setReason] = useState('');
	const needsReason = Boolean(action.reasonLabel);
	const valid = !needsReason || reason.trim().length > 0;

	useEffect(() => {
		function closeOnEscape(event) {
			if (event.key === 'Escape' && !busy) onCancel();
		}
		document.addEventListener('keydown', closeOnEscape);
		return () => document.removeEventListener('keydown', closeOnEscape);
	}, [busy, onCancel]);

	return (
		<div className="action-dialog-backdrop" onMouseDown={() => !busy && onCancel()}>
			<section
				className="action-dialog"
				role="dialog"
				aria-modal="true"
				aria-labelledby="action-dialog-title"
				onMouseDown={event => event.stopPropagation()}
			>
				<div className="action-dialog-head">
					<h2 id="action-dialog-title">{action.title}</h2>
					<button type="button" className="link-btn" disabled={busy} onClick={onCancel} aria-label={t.common.close}>✕</button>
				</div>
				<form
					className="form-stack"
					onSubmit={event => {
						event.preventDefault();
						if (valid && !busy) onSubmit(reason);
					}}
				>
					{needsReason ? (
						<label className="field">
							<span className="field-label">{action.reasonLabel}</span>
							<textarea
								className="form-control"
								value={reason}
								onChange={event => setReason(event.target.value)}
								required
								autoFocus
							/>
						</label>
					) : (
						<p className="action-dialog-copy">{action.message}</p>
					)}
					<div className="action-dialog-actions">
						<button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>{t.common.cancel}</button>
						<button type="submit" className="btn btn-danger" disabled={busy || !valid} autoFocus={!needsReason}>
							{busy ? t.common.saving : action.submitLabel}
						</button>
					</div>
				</form>
			</section>
		</div>
	);
}

function CashPaymentForm({ participants, period, busy, call }) {
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

function PersonRow({ p, recurring, editing, canSeeMoney, moneyState, planState, totalOutstanding, payeeParticipantId, busy, call, requestAction }) {
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

	let figure = null;
	if (canSeeMoney && moneyState !== 'none' && p.outstanding != null) {
		if (p.outstanding > 0) figure = { className: 'fig-due', label: fmt.money(p.outstanding) };
		else if (moneyState === 'open' && p.id === payeeParticipantId && totalOutstanding > 0) {
			figure = { className: 'fig-credit', label: t.roster.getsBack(fmt.money(totalOutstanding)) };
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
				</div>
				<div className="row-sub">
					{[status, !p.isMe && !p.claimed ? t.roster.notLinked : null].filter(Boolean).join(' · ')}
				</div>
			</div>
			{figure && (
				<span className={`row-figure ${figure.className}`}>
					{figure.label}
				</span>
			)}
		</div>
	);
}

function AttendancePanel({ participants, busy, call }) {
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
function PendingRow({ p, code, nameOf, busy, call, lang, requestAction }) {
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

function AddPerson({ busy, call }) {
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

function PaymentHistory({ payments, code, nameOf, lang }) {
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
						{p.hasSlip && (
							<span className="row-tools">
								<a className="link-btn" href={`/api/megu/a/${code}/payments/${p.id}/slip?lang=${lang}`} target="_blank" rel="noreferrer">
									{t.pay.viewSlip}
								</a>
							</span>
						)}
					</div>
				))}
			</div>
		</section>
	);
}

function ExpenseRow({ e, editing, participants, nameOf, busy, call, requestAction }) {
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

function TimePoll({ poll, me, isOwner, busy, call, total }) {
	const { t, fmt } = useCopy();
	const leading = poll.slots[0];
	const answered = poll.answered;
	const waiting = Math.max(total - answered, 0);
	const VOTE_LABEL = { yes: t.poll.free, maybe: t.poll.maybe, no: t.poll.busy };

	return (
		<section className="panel">
			<div className="panel-head">
				<span className="panel-title">{t.poll.title}</span>
				<span className="panel-count">{poll.ready ? t.poll.allAnswered : t.poll.waitingFor(waiting)}</span>
			</div>
			<div>
				{poll.slots.map(slot => (
					<div key={slot.id} className={`slot ${slot.id === leading?.id ? 'leading' : ''}`}>
						<div className="slot-main">
							<div className="slot-when">{fmt.when(slot.startsAt, { long: true })}</div>
							<div className="slot-tally">
								<span className="up">{t.poll.freeCount(slot.yes)}</span>
								{slot.maybe > 0 && <span>{t.poll.maybeCount(slot.maybe)}</span>}
								{slot.no > 0 && <span className="down">{t.poll.busyCount(slot.no)}</span>}
							</div>
						</div>
						{me && (
							<div className="slot-vote">
								{['yes', 'maybe', 'no'].map(answer => (
									<button
										key={answer}
										type="button"
										className={`vote-btn ${poll.myVotes[slot.id] === answer ? `on-${answer}` : ''}`}
										disabled={busy}
										onClick={() => call('POST', '/slots/vote', { votes: { [slot.id]: answer } })}
									>
										{VOTE_LABEL[answer]}
									</button>
								))}
							</div>
						)}
					</div>
				))}

				{leading && (
					<div className="verdict">
						<div>
							<div className="row-sub">{t.poll.meguSuggests}</div>
							<div className="verdict-when">{fmt.when(leading.startsAt, { long: true })}</div>
						</div>
						{isOwner && (
							<button type="button" className="btn btn-pay" disabled={busy || !poll.ready} onClick={() => call('POST', '/slots/lock')}>
								{t.poll.lockIt}
							</button>
						)}
					</div>
				)}
			</div>
		</section>
	);
}

function ProposeSlots({ busy, call }) {
	const { t } = useCopy();
	const [times, setTimes] = useState(['', '', '']);

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				const startTimes = times.filter(Boolean);
				if (startTimes.length > 0) call('POST', '/slots', { startTimes });
			}}
			style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}
		>
			{times.map((time, i) => (
				<input
					key={i}
					className="form-control"
					type="datetime-local"
					value={time}
					onChange={e => setTimes(prev => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
					aria-label={t.poll.option(i + 1)}
				/>
			))}
			<button type="button" className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setTimes(prev => [...prev, ''])}>
				{t.poll.anotherOption}
			</button>
			<button type="submit" className="btn btn-primary btn-block" disabled={busy || times.filter(Boolean).length === 0}>
				{t.poll.askForMe}
			</button>
		</form>
	);
}

function OwnerControls({ activity, busy, call, participants, requestAction }) {
	const { t } = useCopy();
	const [label, setLabel] = useState('');
	const [amount, setAmount] = useState('');
	const [paidBy, setPaidBy] = useState(participants[0]?.id || '');
	const recurring = activity.kind === 'recurring';
	const defaultShares = participants.filter(p => recurring || p.rsvp !== 'no').map(p => p.id);
	const [shareParticipantIds, setShareParticipantIds] = useState(defaultShares.length > 0 ? defaultShares : participants.map(p => p.id));

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
					})
						.then(() => {
							setLabel('');
							setAmount('');
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
							</label>
						))}
					</div>
				</fieldset>
				<button type="submit" className="btn btn-secondary btn-block" disabled={busy || !amount || shareParticipantIds.length === 0}>
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
