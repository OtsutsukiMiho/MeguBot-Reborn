'use client';

import { useEffect, useState } from 'react';
import CustomSelect from '../CustomSelect';
import useDraftGuard from '../useDraftGuard';
import { useCopy } from '../../copy';
import { loadTeamGoalMembers } from './loadTeamGoalMembers.mjs';
import styles from '../../teams/teams.module.css';

export default function GoalReviewerForm({ teamId, goal, allowed, busy, onAssign }) {
	const { t } = useCopy(); const c = t.teamGoals;
	const [members, setMembers] = useState(null);
	const [loadError, setLoadError] = useState(false);
	const [retry, setRetry] = useState(0);
	const [reviewerId, setReviewerId] = useState('');
	const [reason, setReason] = useState('');
	const [draftRevision, setDraftRevision] = useState(null);
	useEffect(() => {
		if (!allowed) { setMembers(null); return; }
		const controller = new AbortController(); setLoadError(false);
		loadTeamGoalMembers(teamId, async url => {
			const response = await fetch(url, { signal: controller.signal });
			if (!response.ok) throw new Error('Roster unavailable');
			return response.json();
		}).then(rows => { if (!controller.signal.aborted) setMembers(rows); }).catch(() => { if (!controller.signal.aborted) setLoadError(true); });
		return () => controller.abort();
	}, [teamId, allowed, retry]);
	useDraftGuard(draftRevision !== null, busy);
	if (!goal || !allowed) return null;
	const eligible = (members || []).filter(member => member.userId !== goal.subjectId && ['owner', 'admin'].includes(member.role));
	const stale = draftRevision !== null && draftRevision !== goal.revision;
	const submit = async event => {
		event.preventDefault(); if (busy || stale || loadError || !eligible.some(member => member.userId === reviewerId)) return;
		if (await onAssign({ reviewerId, reason })) { setReviewerId(''); setReason(''); setDraftRevision(null); }
	};
	return <section className={styles.goalDetail}><h2>{c.reassign}</h2><p className={styles.lede}>{c.reassignHint}</p>
		{loadError ? <div className={styles.error} role="alert"><p>{c.reviewerLoadFailed}</p><button type="button" className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>{c.retry}</button></div> : !members ? <p role="status">{c.loading}</p> : !eligible.length ? <p>{c.noEligibleReviewer}</p> : <form className={styles.form} onSubmit={submit} aria-busy={busy}>
			<div className={styles.field}><span>{c.reviewer}</span><CustomSelect type="member" required disabled={busy} ariaLabel={c.reviewer} value={reviewerId} onChange={value => { setReviewerId(value); setDraftRevision(current => current ?? goal.revision); }} options={eligible.map(member => ({ value: member.userId, label: member.displayName, avatar: member.avatarUrl, subtitle: t.teams.role[member.role] }))} /></div>
			<label className={`${styles.field} ${styles.wide}`}>{c.reassignReason}<textarea required rows={3} maxLength={4000} disabled={busy} value={reason} onChange={event => { setReason(event.target.value); setDraftRevision(current => current ?? goal.revision); }} /></label>
			{stale && <div className={`${styles.notice} ${styles.wide}`} role="alert"><p>{c.conflict}</p><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setDraftRevision(goal.revision)}>{c.useLatest}</button></div>}
			<div className={`${styles.actions} ${styles.wide}`}><button type="submit" className="btn btn-primary" disabled={busy || stale || !eligible.some(member => member.userId === reviewerId) || !reason.trim()}>{busy ? c.saving : c.reassign}</button></div>
		</form>}
	</section>;
}
