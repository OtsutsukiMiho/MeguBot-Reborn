'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import MeguMark from '../MeguMark';
import { CurrencyProvider, useCopy } from '../../copy';

/**
 * One activity, four screens.
 *
 * The activity page used to be a single scroll that answered every question
 * anybody could have about an activity, for every role, at once: pay, RSVP,
 * vote on a time, check somebody's slip, edit the roster, copy the invite link.
 * A participant arriving to send ฿100 got two and a half screens of other
 * people's business, and the organizer got twice that.
 *
 * The work is now split by task — pay, answer, manage — and this shell is what
 * makes that affordable. It owns the one fetch, the one `call`, and the one
 * reason dialog, so a screen is only the part that differs. Without it each
 * screen would carry its own copy of the request plumbing and they would drift.
 *
 * The activity is fetched once per screen rather than held across navigations
 * on purpose: money changes underneath you. Someone opening the pay screen a
 * minute after a reminder must see what they owe now, not what the summary
 * screen was told when it loaded.
 */

const ActivityContext = createContext(null);

export function useActivity() {
	const value = useContext(ActivityContext);
	if (!value) throw new Error('useActivity must be used inside ActivityShell');
	return value;
}

export default function ActivityShell({ code, children }) {
	const [activity, setActivity] = useState(null);
	const { t, lang, error: readError } = useCopy(activity?.currency);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState('');
	const [viewPeriod, setViewPeriod] = useState(null);
	// Which creditor the pay screen is currently asking about. Null means "let
	// the server decide", which it can whenever the reader owes exactly one
	// person — and refuses to when they owe several, rather than picking.
	const [viewCreditor, setViewCreditor] = useState(null);
	const [actionDialog, setActionDialog] = useState(null);
	const [loadRequest, setLoadRequest] = useState(0);

	// Megu's own sentences are written on the server, so every request has to
	// say which language it expects one in.
	const url = useCallback(
		(path = '', extra = '') => `/api/megu/a/${code}${path}?lang=${lang}${extra}`,
		[code, lang],
	);

	// Only the newest request may write.
	//
	// Switching language reissues the fetch, because Megu's own sentences are
	// written on the server and have to be asked for in the language the reader
	// picked. Both requests are in flight at once and the older one is not
	// guaranteed to lose the race — without this counter, the English answer
	// lands after the Thai one and the page settles on a Thai interface with an
	// English Megu in the middle of it. The same race decides which month a
	// recurring activity is showing.
	const loadRequestRef = useRef(0);
	const load = useCallback(async (periodId, creditorId) => {
		const requestId = ++loadRequestRef.current;
		const extra = [
			periodId ? `&period=${periodId}` : '',
			creditorId ? `&creditorParticipantId=${encodeURIComponent(creditorId)}` : '',
		].join('');
		const res = await fetch(url('', extra), { credentials: 'same-origin' });
		const data = await res.json().catch(() => ({}));
		if (requestId !== loadRequestRef.current) return null;
		if (!res.ok) {
			setProblem(readError(data));
			return null;
		}
		setActivity(data.activity);
		return data.activity;
	}, [url, readError]);

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
		let live = true;
		load(viewPeriod, viewCreditor).finally(() => { if (live) setLoading(false); });
		return () => { live = false; };
	}, [load, viewPeriod, viewCreditor, loadRequest]);

	async function submitActionDialog(reason = '') {
		if (!actionDialog) return;
		const body = actionDialog.reasonLabel
			? { ...(actionDialog.body || {}), reason: reason.trim() }
			: actionDialog.body;
		const result = await call(actionDialog.method, actionDialog.path, body);
		if (result) {
			setActionDialog(null);
			actionDialog.onDone?.(result);
		}
	}

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

	const value = {
		code,
		activity,
		busy,
		problem,
		setProblem,
		readError,
		lang,
		call,
		reload: () => setLoadRequest(n => n + 1),
		viewPeriod,
		setViewPeriod,
		viewCreditor,
		setViewCreditor,
		requestAction: setActionDialog,
	};

	return (
		<CurrencyProvider currency={activity.currency}>
			<ActivityContext.Provider value={value}>
				{children}
				{actionDialog && (
					<ActionDialog
						key={`${actionDialog.method}:${actionDialog.path}`}
						action={actionDialog}
						busy={busy}
						onCancel={() => setActionDialog(null)}
						onSubmit={submitActionDialog}
					/>
				)}
			</ActivityContext.Provider>
		</CurrencyProvider>
	);
}

/**
 * The top of a focused screen: one way back, one thing this screen is for.
 *
 * The back link is a real link to the summary rather than `history.back()`,
 * because half the traffic to these screens arrives from an email or a Discord
 * DM — there is nothing behind them to go back to, and a dead button at the top
 * left of a payment screen is worse than no button at all.
 */
export function ScreenHead({ title, sub, backTo, backLabel }) {
	return (
		<header className="screen-head">
			<Link className="link-btn back-link" href={backTo}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
					<path d="M15 18l-6-6 6-6" />
				</svg>
				{backLabel}
			</Link>
			<h1>{title}</h1>
			{sub && <p className="screen-sub">{sub}</p>}
		</header>
	);
}

export function ActionDialog({ action, busy, onCancel, onSubmit }) {
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
								maxLength={200}
								required
								autoFocus
							/>
							{action.hint && <p className="field-hint">{action.hint}</p>}
						</label>
					) : (
						<p className="action-dialog-copy">{action.message}</p>
					)}
					<div className="action-dialog-actions">
						<button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>{t.common.cancel}</button>
						<button type="submit" className={`btn ${action.submitClass || 'btn-danger'}`} disabled={busy || !valid} autoFocus={!needsReason}>
							{busy ? t.common.saving : action.submitLabel}
						</button>
					</div>
				</form>
			</section>
		</div>
	);
}

/**
 * "Not now, and here is why", as the web sees it.
 *
 * The same dialog the reversal and rejection flows use, because it is the same
 * gesture: an action only worth recording with a sentence attached. Styled as
 * an ordinary action rather than a destructive one — deferring is not a
 * mistake, it is the answer the organizer actually wants when the money is not
 * there yet.
 */
export function deferDialog(t, periodId) {
	return {
		title: t.defer.title,
		reasonLabel: t.defer.reasonLabel,
		hint: t.defer.hint,
		submitLabel: t.defer.submit,
		submitClass: 'btn-primary',
		method: 'POST',
		path: '/defer',
		body: periodId ? { periodId } : {},
	};
}
