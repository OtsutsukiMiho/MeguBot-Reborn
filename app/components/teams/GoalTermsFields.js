'use client';

import { useId } from 'react';
import CustomSelect from '../CustomSelect';
import { useCopy } from '../../copy';
import styles from '../../teams/teams.module.css';

export function canonicalGoalDate(value) {
	const match = /^(\d{4})(-\d{2}-\d{2})$/.exec(value);
	return match && Number(match[1]) >= 2400 && Number(match[1]) <= 2699 ? `${Number(match[1]) - 543}${match[2]}` : value;
}

export function goalTermsPayload(form) {
	const measurement = form.kind === 'milestone' ? { kind: 'milestone', criteria: form.criteria } : { kind: 'numeric', direction: form.direction, baseline: Number(form.baseline), target: Number(form.target), unit: form.unit };
	return { title: form.title, successDescription: form.successDescription, periodStart: canonicalGoalDate(form.periodStart), periodEnd: canonicalGoalDate(form.periodEnd), timezone: form.timezone, measurement };
}

export default function GoalTermsFields({ form, set, busy }) {
	const { t } = useCopy(); const c = t.teamGoals; const hintId = useId();
	return <>
		<label className={`${styles.field} ${styles.wide}`}>{c.name}<input required maxLength={120} disabled={busy} value={form.title} onChange={event => set('title', event.target.value)} /></label>
		<label className={`${styles.field} ${styles.wide}`}>{c.success}<textarea required rows={3} maxLength={4000} disabled={busy} value={form.successDescription} onChange={event => set('successDescription', event.target.value)} /></label>
		{['periodStart', 'periodEnd'].map(key => <label className={styles.field} key={key}>{key === 'periodStart' ? c.starts : c.ends}<input type="date" required disabled={busy} value={form[key]} onChange={event => set(key, event.target.value)} onBlur={event => { if (canonicalGoalDate(event.target.value) !== event.target.value) set(key, canonicalGoalDate(event.target.value)); }} aria-describedby={hintId} /></label>)}
		<p id={hintId} className={`${styles.lede} ${styles.wide}`}>{c.dateHint}</p>
		<label className={styles.field}>{t.projects.timezone}<input required maxLength={100} disabled={busy} value={form.timezone} onChange={event => set('timezone', event.target.value)} /></label>
		<div className={styles.field}><span>{c.kind}</span><CustomSelect disabled={busy} searchable={false} ariaLabel={c.kind} value={form.kind} onChange={value => set('kind', value)} options={[{ value: 'numeric', label: c.numeric }, { value: 'milestone', label: c.milestone }]} /></div>
		{form.kind === 'milestone' ? <label className={`${styles.field} ${styles.wide}`}>{c.criteria}<textarea required rows={3} maxLength={4000} disabled={busy} value={form.criteria} onChange={event => set('criteria', event.target.value)} /></label> : <>
			<div className={styles.field}><span>{c.direction}</span><CustomSelect disabled={busy} searchable={false} ariaLabel={c.direction} value={form.direction} onChange={value => set('direction', value)} options={['increase', 'decrease'].map(value => ({ value, label: c[value] }))} /></div>
			<label className={styles.field}>{c.unit}<input required maxLength={80} disabled={busy} value={form.unit} onChange={event => set('unit', event.target.value)} /></label>
			{['baseline', 'target'].map(key => <label className={styles.field} key={key}>{c[key]}<input required type="number" step="any" disabled={busy} value={form[key]} onChange={event => set(key, event.target.value)} /></label>)}
		</>}
	</>;
}
