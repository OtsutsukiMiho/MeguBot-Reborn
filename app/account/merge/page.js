'use client';

import { useEffect, useMemo, useState } from 'react';
import MeguMark from '../../components/MeguMark';
import { useCopy } from '../../copy';

/**
 * The screen that turns "that sign-in belongs to someone else" into a decision.
 *
 * There is deliberately no second trip to Discord or Google from here. Both
 * sides are already proven by the time this page loads — the session proves one
 * account, and the OAuth round trip that redirected here proves the other — so
 * asking again would be a browser redirect into /api/auth/*, which is what
 * DISCORD-RATE-LIMITS.md rule 4 exists to prevent. The confirmation is a button.
 */
export default function AccountMergePage() {
	const { t } = useCopy();
	const copy = t.account.merge;

	const [state, setState] = useState({ status: 'loading' });
	const [profileSource, setProfileSource] = useState(null);
	const [merging, setMerging] = useState(false);

	useEffect(() => {
		let cancelled = false;
		fetch('/api/account/merge')
			.then(async response => ({ ok: response.ok, body: await response.json() }))
			.then(({ ok, body }) => {
				if (cancelled) return;
				if (!ok) return setState({ status: 'unavailable', reason: body.error });
				setState({ status: 'ready', ...body });
			})
			.catch(() => { if (!cancelled) setState({ status: 'unavailable', reason: 'failed' }); });
		return () => { cancelled = true; };
	}, []);

	const plan = state.plan || null;

	// The identities the merged account will hold, which is every identity from
	// both sides — one per provider, guaranteed by the collision check.
	const profileChoices = useMemo(() => {
		if (!plan) return [];
		return ['google', 'discord']
			.map(provider => {
				const identity = plan.identities.find(item => item.provider === provider);
				return identity ? { provider, identity } : null;
			})
			.filter(Boolean);
	}, [plan]);

	// Default to the account they were already signed in as, because that is the
	// name they were looking at when they started this.
	useEffect(() => {
		if (profileSource || !plan || !state.signedInUserId) return;
		const signedIn = plan.identities.find(item => item.userId === state.signedInUserId);
		setProfileSource(signedIn?.provider || profileChoices[0]?.provider || null);
	}, [plan, profileSource, profileChoices, state.signedInUserId]);

	async function merge() {
		setMerging(true);
		const response = await fetch('/api/account/merge', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ profileSource }),
		});
		const body = await response.json().catch(() => ({}));
		setMerging(false);
		if (!response.ok) return setState(current => ({ ...current, error: body.error || 'failed' }));
		window.location.href = '/account?merge=done';
	}

	async function cancel() {
		await fetch('/api/account/merge/cancel', { method: 'POST' }).catch(() => undefined);
		window.location.href = '/account';
	}

	if (state.status === 'loading') {
		return <div className="center-screen"><MeguMark size={72} mood="asleep" /><p>{copy.checking}</p></div>;
	}
	if (state.status === 'unavailable') {
		return <div className="center-screen account-signin">
			<MeguMark size={92} />
			<h1>{copy.title}</h1>
			<p className="quiet-note">{copy.expired}</p>
			<a className="btn btn-primary" href="/account">{t.nav.account}</a>
		</div>;
	}

	const blocked = plan.blockedBy;
	// Everything that moves, reported as one list rather than two columns: the
	// reader is one person and does not think of these as two piles.
	const totals = ['owned_activities', 'participant_rows', 'payments', 'identities']
		.map(key => ({ key, n: (plan.counts.survivor[key] || 0) + (plan.counts.merged[key] || 0) }))
		.filter(item => item.n > 0);

	return <div className="account-page stack-lg">
		<header className="page-head">
			<div><h1>{copy.title}</h1><p className="quiet-note">{copy.lede}</p></div>
		</header>

		{state.error && <div className="account-notice" role="alert">{t.errors[state.error] || t.errors.failed}</div>}

		{blocked
			? <section className="panel stack-md">
				<p role="alert">{copy.blocked(blocked.providers.join(', '))}</p>
				<div><a className="btn btn-primary" href="/account">{copy.cancel}</a></div>
			</section>
			: <>
				<section className="panel stack-md">
					<div><h2>{copy.movesTitle}</h2><p className="quiet-note">{copy.movesHint}</p></div>
					<ul className="merge-counts">
						{totals.map(item => <li key={item.key}>{copy.counts[item.key](item.n)}</li>)}
					</ul>
					<p className="quiet-note">{copy.ledgerNote}</p>
				</section>

				{plan.duplicateParticipants.length > 0 && <section className="panel stack-md">
					<div><h2>{copy.duplicatesTitle}</h2><p className="quiet-note">{copy.duplicatesHint}</p></div>
					<ul className="merge-counts">
						{plan.duplicateParticipants.map(item => <li key={item.activityId}>
							{copy.duplicatesIn(item.title, item.code)}
							<span className="quiet-note"> — {item.names.join(', ')}</span>
						</li>)}
					</ul>
				</section>}

				<section className="panel stack-md">
					<div><h2>{copy.profileTitle}</h2><p className="quiet-note">{copy.profileHint}</p></div>
					<div className="notification-grid" role="radiogroup" aria-label={copy.profileTitle}>
						{profileChoices.map(({ provider, identity }) => <button
							key={provider}
							type="button"
							role="radio"
							aria-checked={profileSource === provider}
							className={`notification-choice ${profileSource === provider ? 'selected' : ''}`}
							onClick={() => setProfileSource(provider)}
						>
							<strong>{t.account.providers[provider]}</strong>
							<span>{identity.displayName || identity.username || identity.email}</span>
						</button>)}
					</div>
				</section>

				<section className="panel stack-md">
					<div><h2>{copy.notificationTitle}</h2></div>
					<p className="quiet-note">{copy.notificationNote(t.account.modes[plan.notificationMode.result])}</p>
				</section>

				<section className="panel stack-md">
					<p role="note">{copy.irreversible}</p>
					<div className="merge-actions">
						<button className="btn btn-primary" onClick={merge} disabled={merging}>
							{merging ? copy.merging : copy.confirm}
						</button>
						<button className="btn btn-ghost" onClick={cancel} disabled={merging}>{copy.cancel}</button>
					</div>
				</section>
			</>}
	</div>;
}
