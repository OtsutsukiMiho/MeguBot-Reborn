'use client';

import { useEffect, useState } from 'react';
import GoalTermsFields, { goalTermsPayload } from './GoalTermsFields';
import useDraftGuard from '../useDraftGuard';
import { useCopy } from '../../copy';
import styles from '../../teams/teams.module.css';

export function editableGoalTerms(goal) {
	return { title: goal.title, successDescription: goal.successDescription, periodStart: goal.periodStart, periodEnd: goal.periodEnd, timezone: goal.timezone,
		kind: goal.measurement.kind, direction: goal.measurement.direction || 'increase', baseline: String(goal.measurement.baseline ?? ''), target: String(goal.measurement.target ?? ''), unit: goal.measurement.unit || '', criteria: goal.measurement.criteria || '' };
}

export default function GoalTermsEditor({ goal, capabilities = {}, busy, onTransition }) {
	const { t } = useCopy(); const c = t.teamGoals;
	const [form, setForm] = useState(null);
	const [reason, setReason] = useState('');
	const [draftRevision, setDraftRevision] = useState(null);
	useEffect(() => { if (goal && draftRevision === null) setForm(editableGoalTerms(goal)); }, [goal, draftRevision]);
	useDraftGuard(draftRevision !== null, busy);
	if (!goal || !form || (!capabilities.canEdit && !capabilities.canRevise)) return null;
	const revise = capabilities.canRevise;
	const stale = draftRevision !== null && draftRevision !== goal.revision;
	const set = (key, value) => { setDraftRevision(current => current ?? goal.revision); setForm(current => ({ ...current, [key]: value })); };
	const submit = async event => {
		event.preventDefault(); if (busy || stale || !reason.trim()) return;
		if (await onTransition(revise ? 'revise' : 'edit', { ...goalTermsPayload(form), reason })) { setDraftRevision(null); setReason(''); }
	};
	return <details id="goal-terms-editor" className={styles.goalDetail} open={revise || undefined}><summary>{revise ? c.reviseTerms : c.editTerms}</summary>
		{revise && <p className={styles.lede}>{c.reviseHint}</p>}
		<form className={styles.form} onSubmit={submit} aria-busy={busy}>
			<GoalTermsFields form={form} set={set} busy={busy} />
			<label className={`${styles.field} ${styles.wide}`}>{c.termReason}<textarea required rows={3} maxLength={4000} disabled={busy} value={reason} onChange={event => { setDraftRevision(current => current ?? goal.revision); setReason(event.target.value); }} /></label>
			{stale && <div className={`${styles.notice} ${styles.wide}`} role="alert"><p>{c.conflict}</p><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setDraftRevision(goal.revision)}>{c.useLatest}</button></div>}
			<div className={`${styles.actions} ${styles.wide}`}><button type="submit" className="btn btn-primary" disabled={busy || stale || !reason.trim()}>{busy ? c.saving : revise ? c.reviseTerms : c.saveTerms}</button></div>
		</form>
	</details>;
}
