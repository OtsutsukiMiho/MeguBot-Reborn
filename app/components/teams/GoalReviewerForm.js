'use client';

import { useState } from 'react';
import CustomSelect from '../CustomSelect';
import useDraftGuard from '../useDraftGuard';
import { useCopy } from '../../copy';
import styles from '../../teams/teams.module.css';

export default function GoalReviewerForm({ goal, allowed, busy, members, loadError, onRetry, onAssign }) {
	const { t } = useCopy(); const c = t.teamGoals;
	const [reviewerId, setReviewerId] = useState('');
	const [reason, setReason] = useState('');
	const [draftRevision, setDraftRevision] = useState(null);
	useDraftGuard(draftRevision !== null, busy);
	if (!goal || !allowed) return null;
	const eligible = (members || []).filter(member => member.userId !== goal.subjectId && member.userId !== goal.reviewerId && ['owner', 'admin'].includes(member.role));
	const stale = draftRevision !== null && draftRevision !== goal.revision;
	const submit = async event => {
		event.preventDefault(); if (busy || stale || loadError || !eligible.some(member => member.userId === reviewerId)) return;
		if (await onAssign({ reviewerId, reason })) { setReviewerId(''); setReason(''); setDraftRevision(null); }
	};
	const form = <><p className={styles.lede}>{goal.reviewerId ? c.reassignHint : c.assignHint}</p>
		{loadError ? <div className={styles.error} role="alert"><p>{c.reviewerLoadFailed}</p><button type="button" className="btn btn-secondary" onClick={onRetry}>{c.retry}</button></div> : !members ? <p role="status">{c.loading}</p> : !eligible.length ? <p>{c.noEligibleReviewer}</p> : <form className={styles.form} onSubmit={submit} aria-busy={busy} noValidate>
			<div className={styles.field}><span>{c.reviewer}</span><CustomSelect type="member" required disabled={busy} ariaLabel={c.reviewer} value={reviewerId} onChange={value => { setReviewerId(value); setDraftRevision(current => current ?? goal.revision); }} options={eligible.map(member => ({ value: member.userId, label: member.displayName, avatar: member.avatarUrl, subtitle: t.teams.role[member.role] }))} /></div>
			<label className={`${styles.field} ${styles.wide}`}>{c.reassignReason}<textarea required rows={3} maxLength={4000} disabled={busy} value={reason} onChange={event => { setReason(event.target.value); setDraftRevision(current => current ?? goal.revision); }} /></label>
			{stale && <div className={`${styles.notice} ${styles.wide}`} role="alert"><p>{c.conflict}</p><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setDraftRevision(goal.revision)}>{c.useLatest}</button></div>}
			<div className={`${styles.actions} ${styles.wide}`}><button type="submit" className="btn btn-primary" disabled={busy || stale || !eligible.some(member => member.userId === reviewerId) || !reason.trim()}>{busy ? c.saving : goal.reviewerId ? c.changeReviewer : c.reassign}</button></div>
		</form>}</>;
	return goal.reviewerId ? <details className={styles.goalReviewerChange}><summary id="goal-reviewer-heading">{c.changeReviewer}</summary>{form}</details>
		: <section className={styles.goalDetail} aria-labelledby="goal-reviewer-heading"><h2 id="goal-reviewer-heading">{c.reassign}</h2>{form}</section>;
}
