'use client';

import { useEffect, useRef, useState } from 'react';
import CustomSelect from '../CustomSelect';
import useDraftGuard from '../useDraftGuard';
import { useCopy } from '../../copy';
import styles from '../../teams/teams.module.css';

const ACTIONS = [['evidence', 'canAddEvidence', 'addEvidence'], ['submit', 'canSubmit', 'submitReview'], ['review', 'canReview', 'publishReview'], ['return', 'canReturn', 'returnGoal'], ['respond', 'canRespond', 'respond'], ['cancel', 'canCancel', 'cancelGoal']];
const EMPTY = { note: '', value: '', links: '', referenceLink: '', selfReview: '', explanation: '', nextStep: '', reason: '', outcome: 'met', response: '', acknowledged: false, confirmed: false, cancelConfirmed: false };

function invalidEvidence(field, code) {
	const error = new Error(code);
	error.field = field;
	throw error;
}

export function goalActionPayload(action, form, kind) {
	if (action === 'evidence') {
		if (typeof form.note !== 'string' || !form.note.trim()) invalidEvidence('note', 'noteRequired');
		if (form.note.length > 4000) invalidEvidence('note', 'noteTooLong');
		const links = form.links.split(/\r?\n/).map(link => link.trim()).filter(Boolean);
		if (links.length > 10) invalidEvidence('links', 'linksTooMany');
		for (const link of links) {
			if (link.length > 2048) invalidEvidence('links', 'linkTooLong');
			let url;
			try { url = new URL(link); } catch { invalidEvidence('links', 'linkInvalid'); }
			if (url.protocol !== 'https:') invalidEvidence('links', 'linkHttps');
			if (url.username || url.password) invalidEvidence('links', 'linkCredentials');
		}
		const value = kind === 'numeric' && form.value !== '' ? Number(form.value) : null;
		if (value !== null && !Number.isFinite(value)) invalidEvidence('value', 'valueInvalid');
		const payload = { note: form.note, value, links };
		if (form.referenceLink?.trim()) {
			const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
			let url;
			try { url = new URL(form.referenceLink.trim(), origin); } catch { invalidEvidence('referenceLink', 'referenceInvalid'); }
			const match = /^\/p\/([a-zA-Z0-9_-]{1,100})\/?$/.exec(url.pathname);
			const topicId = url.searchParams.get('topic');
			if (!match || url.origin !== origin || url.username || url.password || url.searchParams.getAll('topic').length > 1 || (topicId !== null && !/^[a-zA-Z0-9_-]{1,200}$/.test(topicId))) invalidEvidence('referenceLink', 'referenceInvalid');
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

export default function GoalActionForm({ goal, capabilities = {}, busy, onTransition, preferredAction = null }) {
	const { t } = useCopy(); const c = t.teamGoals;
	const [selected, setSelected] = useState('');
	const [form, setForm] = useState(EMPTY);
	const [draftRevision, setDraftRevision] = useState(null);
	const [error, setError] = useState('');
	const [fieldErrors, setFieldErrors] = useState({});
	const fields = useRef({});
	const focusAfterError = useRef(null);
	useEffect(() => {
		const field = focusAfterError.current;
		if (field) { fields.current[field]?.focus(); focusAfterError.current = null; }
	}, [fieldErrors]);
	useDraftGuard(draftRevision !== null, busy);
	if (!goal) return null;
	const actions = ACTIONS.filter(([, permission]) => capabilities[permission]);
	if (!actions.length) return null;
	const action = actions.some(([value]) => value === selected) ? selected : actions.some(([value]) => value === preferredAction) ? preferredAction : actions[0][0];
	const stale = draftRevision !== null && draftRevision !== goal.revision;
	const set = (key, value) => {
		setDraftRevision(current => current ?? goal.revision);
		setForm(current => ({ ...current, [key]: value }));
		setFieldErrors(current => { if (!current[key]) return current; const next = { ...current }; delete next[key]; return next; });
		if (error) setError('');
	};
	const submit = async event => {
		event.preventDefault(); if (busy || stale) return; setError(''); setFieldErrors({});
		let payload;
		try { payload = goalActionPayload(action, form, goal.measurement.kind); }
		catch (validation) {
			if (action === 'evidence' && validation.field) {
				focusAfterError.current = validation.field;
				setFieldErrors({ [validation.field]: c.evidenceErrors[validation.message] });
			} else setError(c.invalidAction);
			return;
		}
		if (await onTransition(action, payload)) { setForm(EMPTY); setDraftRevision(null); }
	};
	const requirement = required => <small className={styles.fieldRequirement}>{required ? c.required : c.optional}</small>;
	const fieldError = (key, id) => fieldErrors[key] && <span className={styles.fieldError} id={id} role="alert">{fieldErrors[key]}</span>;
	const text = (key, label) => <label className={`${styles.field} ${styles.wide}`}>{label}{requirement(true)}<textarea required aria-required="true" maxLength={4000} rows={3} disabled={busy} value={form[key]} onChange={event => set(key, event.target.value)} /></label>;
	return <section className={`${styles.goalDetail} ${styles.goalActionPanel}`} aria-labelledby="goal-action-heading"><h2 id="goal-action-heading">{actions.length === 1 ? c[actions[0][2]] : c.action}</h2>
		<form className={styles.form} onSubmit={submit} aria-busy={busy} noValidate={action === 'evidence'}>
			{actions.length > 1 && <div className={`${styles.field} ${styles.wide}`}><CustomSelect ariaLabel={c.action} searchable={false} disabled={busy} value={action} onChange={value => { setSelected(value); setForm(current => ({ ...current, confirmed: false, cancelConfirmed: false })); setError(''); setFieldErrors({}); }} options={actions.map(([value, , label]) => ({ value, label: c[label] }))} /></div>}
			{action === 'evidence' && <>
				<label className={`${styles.field} ${styles.wide}`}>{c.note}{requirement(true)}<textarea ref={node => { fields.current.note = node; }} id="goal-evidence-note" required aria-required="true" aria-invalid={Boolean(fieldErrors.note)} aria-describedby={fieldErrors.note ? 'goal-evidence-note-error' : undefined} maxLength={4000} rows={3} disabled={busy} value={form.note} onChange={event => set('note', event.target.value)} />{fieldError('note', 'goal-evidence-note-error')}</label>
				{goal.measurement.kind === 'numeric' && <label className={styles.field}>{c.current} ({goal.measurement.unit}){requirement(false)}<input ref={node => { fields.current.value = node; }} id="goal-evidence-value" type="number" step="any" disabled={busy} value={form.value} aria-invalid={Boolean(fieldErrors.value)} aria-describedby={fieldErrors.value ? 'goal-evidence-value-error' : undefined} onChange={event => set('value', event.target.value)} />{fieldError('value', 'goal-evidence-value-error')}</label>}
				<label className={`${styles.field} ${styles.wide}`}>{c.links}{requirement(false)}<textarea ref={node => { fields.current.links = node; }} id="goal-evidence-links" rows={3} maxLength={20500} disabled={busy} value={form.links} aria-invalid={Boolean(fieldErrors.links)} aria-describedby={fieldErrors.links ? 'goal-evidence-links-error' : undefined} onChange={event => set('links', event.target.value)} />{fieldError('links', 'goal-evidence-links-error')}</label>
			</>}
			{action === 'evidence' && <label className={`${styles.field} ${styles.wide}`}>{c.referenceLink}{requirement(false)}<input ref={node => { fields.current.referenceLink = node; }} id="goal-evidence-reference" type="text" maxLength={500} disabled={busy} value={form.referenceLink} aria-invalid={Boolean(fieldErrors.referenceLink)} aria-describedby={`goal-evidence-reference-hint${fieldErrors.referenceLink ? ' goal-evidence-reference-error' : ''}`} onChange={event => set('referenceLink', event.target.value)} /><span className={styles.lede} id="goal-evidence-reference-hint">{c.referenceHint}</span>{fieldError('referenceLink', 'goal-evidence-reference-error')}</label>}
			{action === 'submit' && text('selfReview', c.selfReview)}
			{action === 'return' && text('reason', c.reason)}
			{action === 'cancel' && <>{text('reason', c.cancelReason)}<label className={`${styles.goalCheck} ${styles.wide}`}><input type="checkbox" required disabled={busy} checked={form.cancelConfirmed} onChange={event => set('cancelConfirmed', event.target.checked)} />{c.cancelConfirm}</label></>}
			{action === 'review' && <><div className={styles.field}><span>{c.outcomeLabel}</span><CustomSelect ariaLabel={c.outcomeLabel} searchable={false} disabled={busy} value={form.outcome} onChange={value => set('outcome', value)} options={Object.entries(c.outcome).filter(([value]) => goal.measurement.kind === 'numeric' || value !== 'exceeded').map(([value, label]) => ({ value, label }))} /></div>{text('explanation', c.explanation)}{text('nextStep', c.nextStep)}<label className={`${styles.goalCheck} ${styles.wide}`}><input type="checkbox" required disabled={busy} checked={form.confirmed} onChange={event => set('confirmed', event.target.checked)} />{c.publishConfirm}</label></>}
			{action === 'respond' && <><label className={`${styles.field} ${styles.wide}`}>{c.response}{requirement(false)}<textarea rows={3} maxLength={4000} disabled={busy} value={form.response} onChange={event => set('response', event.target.value)} /></label><label className={`${styles.goalCheck} ${styles.wide}`}><input type="checkbox" disabled={busy} checked={form.acknowledged} onChange={event => set('acknowledged', event.target.checked)} />{c.acknowledge}</label></>}
			{stale && <div className={`${styles.notice} ${styles.wide}`} role="alert"><p>{c.conflict}</p><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setDraftRevision(goal.revision); setForm(current => ({ ...current, confirmed: false, cancelConfirmed: false })); }}>{c.useLatest}</button></div>}
			{error && <p className={`${styles.error} ${styles.wide}`} role="alert">{error}</p>}
			<div className={`${styles.actions} ${styles.wide}`}><button type="submit" className={`btn ${action === 'cancel' ? 'btn-danger' : 'btn-primary'}`} disabled={busy || stale}>{busy ? c.saving : c[ACTIONS.find(([value]) => value === action)[2]]}</button></div>
		</form>
	</section>;
}
