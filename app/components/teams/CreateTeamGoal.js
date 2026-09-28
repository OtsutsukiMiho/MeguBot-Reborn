'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import AuthGate from '../AuthGate';
import CustomSelect from '../CustomSelect';
import GoalTermsFields, { goalTermsPayload } from './GoalTermsFields';
export { canonicalGoalDate } from './GoalTermsFields';
import { loadTeamGoalMembers } from './loadTeamGoalMembers.mjs';
import useDraftGuard from '../useDraftGuard';
import { useCopy } from '../../copy';
import TeamWorkspaceNav from './TeamWorkspaceNav';
import styles from '../../teams/teams.module.css';

export default function CreateTeamGoal({ teamId }) {
	const { t } = useCopy(); const c = t.teamGoals; const p = t.projects;
	const router = useRouter();
	const back = `/teams/${encodeURIComponent(teamId)}/goals`;
	const [context, setContext] = useState(null);
	const [loadError, setLoadError] = useState(null);
	const [retry, setRetry] = useState(0);
	const [form, setForm] = useState({ subjectId: '', reviewerId: '', title: '', successDescription: '', periodStart: '', periodEnd: '', timezone: 'Asia/Bangkok', kind: 'numeric', direction: 'increase', baseline: '', target: '', unit: '', criteria: '' });
	const [dirty, setDirty] = useState(false);
	const [discard, setDiscard] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [uncertain, setUncertain] = useState(false);
	const sending = useRef(false);
	const attempt = useRef(null);
	useEffect(() => {
		const controller = new AbortController(); setLoadError(null);
		const read = async url => { const response = await fetch(url, { signal: controller.signal }); const body = await response.json(); if (!response.ok) throw { status: response.status }; return body; };
		(async () => {
			const team = await read(`/api/megu/teams/${encodeURIComponent(teamId)}`);
			if (team.team.archivedAt) throw { status: 404 };
			const members = await loadTeamGoalMembers(teamId, read);
			if (!controller.signal.aborted) { setContext({ ...team, members }); setForm(current => ({ ...current, subjectId: current.subjectId || team.me.userId })); }
		})().catch(problem => { if (!controller.signal.aborted) setLoadError(problem); });
		return () => controller.abort();
	}, [teamId, retry]);
	const release = useDraftGuard(dirty, busy);
	const set = (key, value) => { setDirty(true); setForm(current => ({ ...current, [key]: value, ...(key === 'subjectId' && current.reviewerId === value ? { reviewerId: '' } : {}) })); };
	const leave = () => { if (!sending.current) { if (dirty) setDiscard(true); else router.push(back); } };
	const submit = async event => {
		event.preventDefault(); if (sending.current) return;
		sending.current = true; setBusy(true); setError('');
		let created = false;
		try {
			attempt.current ||= { ...goalTermsPayload(form), subjectId: form.subjectId, reviewerId: form.reviewerId || null, requestKey: crypto.randomUUID() };
			const response = await fetch(`/api/megu/teams/${encodeURIComponent(teamId)}/goals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(attempt.current) });
			if (!response.ok) {
				// A prior uncertain attempt may have committed. Preserve its exact
				// payload/key even if a retry subsequently loses access or conflicts.
				const problem = await response.json();
				const unconfirmed = uncertain || response.status >= 500 || problem.code === 'idempotency_conflict';
				if (unconfirmed) setUncertain(true);
				else attempt.current = null;
				setError(unconfirmed ? c.createUncertain : c.createFailed); return;
			}
			const body = await response.json(); if (typeof body.id !== 'string' || !body.id) throw new Error('Unconfirmed creation');
			created = true; release(); setDirty(false); router.push(`${back}/${encodeURIComponent(body.id)}`);
		} catch { setUncertain(true); setError(c.createUncertain); }
		finally { if (!created) { sending.current = false; setBusy(false); } }
	};
	if (loadError?.status === 401) return <AuthGate title={t.teams.signedOutTitle} lede={t.teams.signedOutLede} />;
	const option = member => ({ value: member.userId, label: member.displayName, avatar: member.avatarUrl, subtitle: t.teams.role[member.role] });
	return <main className={styles.shell}><div className={styles.layout}><TeamWorkspaceNav teamId={teamId} section="goals" goalsEnabled /><section className={styles.content}>
		<Link data-draft-navigation href={back} className={styles.back} onClick={event => { event.preventDefault(); leave(); }}><ArrowLeft size={15} aria-hidden="true" />{c.back}</Link>
		<header className={styles.header}><div><h1>{c.create}</h1><p>{c.createHint}</p></div></header>
		{discard && <div className={styles.confirmation} role="alertdialog" aria-labelledby="goal-discard-title"><div><strong id="goal-discard-title">{p.unsavedTitle}</strong><p>{p.unsavedDetail}</p></div><div className={styles.confirmationActions}><button type="button" className="btn btn-secondary" onClick={() => setDiscard(false)}>{p.keepEditing}</button><button type="button" className="btn btn-danger" onClick={() => { setDirty(false); router.push(back); }}>{p.discardChanges}</button></div></div>}
		{loadError ? <div className={styles.error} role="alert"><p>{c.unavailable}</p><button type="button" className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>{c.retry}</button></div> : !context ? <p role="status">{c.loading}</p> : <form className={styles.form} onSubmit={submit} aria-busy={busy}>
			<div className={styles.field}><span>{c.member}</span><CustomSelect type="member" required disabled={busy || uncertain || !['owner', 'admin'].includes(context.me.role)} ariaLabel={c.member} value={form.subjectId} onChange={value => set('subjectId', value)} options={context.members.filter(member => ['owner', 'admin'].includes(context.me.role) || member.userId === context.me.userId).map(option)} /></div>
			<div className={styles.field}><span>{c.reviewer}</span><CustomSelect type="member" disabled={busy || uncertain} ariaLabel={c.reviewer} value={form.reviewerId} onChange={value => set('reviewerId', value)} options={[{ value: '', label: c.noReviewer }, ...context.members.filter(member => member.userId !== form.subjectId && ['owner', 'admin'].includes(member.role)).map(option)]} /></div>
			{!form.reviewerId && <p className={`${styles.lede} ${styles.wide}`}>{c.personalOnly}</p>}
			<GoalTermsFields form={form} set={set} busy={busy || uncertain} />
			{error && <p className={`${styles.error} ${styles.wide}`} role="alert">{error}{uncertain && <> <Link href={back}>{c.back}</Link></>}</p>}
			<div className={`${styles.actions} ${styles.wide}`}><button type="button" className="btn btn-secondary" disabled={busy} onClick={leave}>{p.cancel}</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? c.saving : uncertain ? c.retryCreate : c.saveDraft}</button></div>
		</form>}
	</section></div></main>;
}
