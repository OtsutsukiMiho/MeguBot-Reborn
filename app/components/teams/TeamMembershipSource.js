'use client';

import { useEffect, useRef, useState } from 'react';
import styles from '../../teams/teams.module.css';

export default function TeamMembershipSource({ team, member, c, readError, onChanged }) {
	const [review, setReview] = useState(null);
	const [confirmed, setConfirmed] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [saved, setSaved] = useState(false);
	const trigger = useRef(null);
	const success = useRef(null);
	useEffect(() => { if (saved) success.current?.focus(); }, [saved]);
	const source = member.membershipSources;
	const label = source?.manual ? (source.discordRole ? c.sourceBoth : c.sourceManual) : source?.discordRole ? c.sourceDiscord : c.sourceUnknown;
	const cancel = () => { setReview(null); setConfirmed(false); setError(''); trigger.current?.focus(); };
	const retain = async () => {
		if (!confirmed || busy) return;
		setBusy(true); setError('');
		try {
			const response = await fetch(`/api/megu/teams/${team.id}/members/${member.userId}/manual-grant`, {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ confirmed: true, expectedRevision: review.revision }),
			});
			const body = await response.json(); if (!response.ok) throw body;
			setSaved(true); setReview(null); setConfirmed(false);
			await onChanged();
		} catch (problem) { setError(readError(problem)); }
		finally { setBusy(false); }
	};
	return <div className={styles.membershipSource}>
		<small>{label}</small>
		{member.canRetainManual && !saved && <button ref={trigger} type="button" className="btn btn-secondary btn-sm" aria-expanded={review !== null} disabled={busy} onClick={() => { if (review) cancel(); else { setReview({ revision: team.revision }); setConfirmed(false); setError(''); } }}>{c.retainMember}</button>}
		{review && <div className={styles.membershipReview}>
			<p>{c.retainMemberHint}</p>
			<label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /> {c.retainMemberConsent(member.displayName)}</label>
			<div className={styles.confirmationActions}><button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={cancel}>{c.cancel}</button><button type="button" className="btn btn-primary btn-sm" disabled={!confirmed || busy} onClick={retain}>{busy ? c.saving : c.confirmRetainMember}</button></div>
		</div>}
		{saved && <p ref={success} tabIndex={-1} role="status">{c.memberRetained}</p>}
		{error && <p className={styles.error} role="alert">{error} <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={async () => { cancel(); await onChanged(); }}>{c.reloadMembership}</button></p>}
	</div>;
}
