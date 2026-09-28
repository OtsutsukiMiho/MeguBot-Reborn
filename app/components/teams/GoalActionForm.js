'use client';

import { useState } from 'react';
import CustomSelect from '../CustomSelect';
import useDraftGuard from '../useDraftGuard';
import { useCopy } from '../../copy';
import styles from '../../teams/teams.module.css';

const ACTIONS = [['evidence', 'canAddEvidence', 'addEvidence'], ['submit', 'canSubmit', 'submitReview'], ['review', 'canReview', 'publishReview'], ['return', 'canReturn', 'returnGoal'], ['respond', 'canRespond', 'respond'], ['cancel', 'canCancel', 'cancelGoal']];
const EMPTY = { note: '', value: '', links: '', referenceLink: '', selfReview: '', explanation: '', nextStep: '', reason: '', outcome: 'met', response: '', acknowledged: false, confirmed: false, cancelConfirmed: false };

export function goalActionPayload(action, form, kind) {
	if (action === 'evidence') {
		const links = form.links.split(/\r?\n/).map(link => link.trim()).filter(Boolean);
		if (links.length > 10 || links.some(link => { try { const url = new URL(link); return url.protocol !== 'https:' || url.username || url.password || link.length > 2048; } catch { return true; } })) throw new Error('invalid');
		const value = kind === 'numeric' && form.value !== '' ? Number(form.value) : null;
		if (value !== null && !Number.isFinite(value)) throw new Error('invalid');
		const payload = { note: form.note, value, links };
		if (form.referenceLink?.trim()) {
			const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
			const url = new URL(form.referenceLink.trim(), origin);
			const match = /^\/p\/([a-zA-Z0-9_-]{1,100})\/?$/.exec(url.pathname);
			const topicId = url.searchParams.get('topic');
			if (!match || url.origin !== origin || url.username || url.password || url.searchParams.getAll('topic').length > 1 || (topicId !== null && !/^[a-zA-Z0-9_-]{1,200}$/.test(topicId))) throw new Error('invalid');
			payload.reference = { projectCode: match[1].toUpperCase(), topicId };
		}
		return payload;
	}
	if (action === 'submit') return { selfReview: form.selfReview };
	if (action === 'return') return { reason: form.reason };
	if (action === 'cancel') { if (!form.cancelConfirmed || !form.reason.trim()) throw new Error('invalid'); return { reason: form.reason }; }
	if (action === 'review') { if (!form.confirmed) throw new Error('invalid'); return { outcome: form.outcome, explanation: form.explanation, nextStep: form.nextStep }; }
	if (action === 'respond') { if (!form.acknowledged && !form.response.trim()) throw new Error('invalid'); return { response: form.response.trim() || null, acknowledged: form.acknowledged }; }
	throw new Error('invalid');
}

export default function GoalActionForm({ goal, capabilities = {}, busy, onTransition }) {
	const { t } = useCopy(); const c = t.teamGoals;
	const [selected, setSelected] = useState('');
	const [form, setForm] = useState(EMPTY);
	const [draftRevision, setDraftRevision] = useState(null);
	const [error, setError] = useState('');
	useDraftGuard(draftRevision !== null, busy);
	if (!goal) return null;
	const actions = ACTIONS.filter(([, permission]) => capabilities[permission]);
	if (!actions.length) return null;
	const action = actions.some(([value]) => value === selected) ? selected : actions[0][0];
	const stale = draftRevision !== null && draftRevision !== goal.revision;
	const set = (key, value) => { setDraftRevision(current => current ?? goal.revision); setForm(current => ({ ...current, [key]: value })); };
	const submit = async event => {
		event.preventDefault(); if (busy || stale) return; setError('');
		let payload; try { payload = goalActionPayload(action, form, goal.measurement.kind); } catch { setError(c.invalidAction); return; }
		if (await onTransition(action, payload)) { setForm(EMPTY); setDraftRevision(null); }
	};
	const text = (key, label) => <label className={`${styles.field} ${styles.wide}`}>{label}<textarea required maxLength={4000} rows={3} disabled={busy} value={form[key]} onChange={event => set(key, event.target.value)} /></label>;
	return <section className={styles.goalDetail} aria-labelledby="goal-action-heading"><h2 id="goal-action-heading">{c.action}</h2>
		<form className={styles.form} onSubmit={submit} aria-busy={busy}>
			<div className={`${styles.field} ${styles.wide}`}><CustomSelect ariaLabel={c.action} searchable={false} disabled={busy} value={action} onChange={value => { setSelected(value); setForm(current => ({ ...current, confirmed: false, cancelConfirmed: false })); }} options={actions.map(([value, , label]) => ({ value, label: c[label] }))} /></div>
			{action === 'evidence' && <>{text('note', c.note)}{goal.measurement.kind === 'numeric' && <label className={styles.field}>{c.current} ({goal.measurement.unit})<input type="number" step="any" disabled={busy} value={form.value} onChange={event => set('value', event.target.value)} /></label>}<label className={`${styles.field} ${styles.wide}`}>{c.links}<textarea rows={3} maxLength={20500} disabled={busy} value={form.links} onChange={event => set('links', event.target.value)} /></label></>}
			{action === 'evidence' && <label className={`${styles.field} ${styles.wide}`}>{c.referenceLink}<input type="text" maxLength={500} disabled={busy} value={form.referenceLink} onChange={event => set('referenceLink', event.target.value)} /><span className={styles.lede}>{c.referenceHint}</span></label>}
			{action === 'submit' && text('selfReview', c.selfReview)}
			{action === 'return' && text('reason', c.reason)}
			{action === 'cancel' && <>{text('reason', c.cancelReason)}<label className={`${styles.goalCheck} ${styles.wide}`}><input type="checkbox" required disabled={busy} checked={form.cancelConfirmed} onChange={event => set('cancelConfirmed', event.target.checked)} />{c.cancelConfirm}</label></>}
			{action === 'review' && <><div className={styles.field}><span>{c.outcomeLabel}</span><CustomSelect ariaLabel={c.outcomeLabel} searchable={false} disabled={busy} value={form.outcome} onChange={value => set('outcome', value)} options={Object.entries(c.outcome).filter(([value]) => goal.measurement.kind === 'numeric' || value !== 'exceeded').map(([value, label]) => ({ value, label }))} /></div>{text('explanation', c.explanation)}{text('nextStep', c.nextStep)}<label className={`${styles.goalCheck} ${styles.wide}`}><input type="checkbox" required disabled={busy} checked={form.confirmed} onChange={event => set('confirmed', event.target.checked)} />{c.publishConfirm}</label></>}
			{action === 'respond' && <><label className={`${styles.field} ${styles.wide}`}>{c.response}<textarea rows={3} maxLength={4000} disabled={busy} value={form.response} onChange={event => set('response', event.target.value)} /></label><label className={`${styles.goalCheck} ${styles.wide}`}><input type="checkbox" disabled={busy} checked={form.acknowledged} onChange={event => set('acknowledged', event.target.checked)} />{c.acknowledge}</label></>}
			{stale && <div className={`${styles.notice} ${styles.wide}`} role="alert"><p>{c.conflict}</p><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setDraftRevision(goal.revision); setForm(current => ({ ...current, confirmed: false, cancelConfirmed: false })); }}>{c.useLatest}</button></div>}
			{error && <p className={`${styles.error} ${styles.wide}`} role="alert">{error}</p>}
			<div className={`${styles.actions} ${styles.wide}`}><button type="submit" className={`btn ${action === 'cancel' ? 'btn-danger' : 'btn-primary'}`} disabled={busy || stale}>{busy ? c.saving : c[ACTIONS.find(([value]) => value === action)[2]]}</button></div>
		</form>
	</section>;
}
