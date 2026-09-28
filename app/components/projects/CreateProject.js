'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import CustomSelect from '../CustomSelect';
import useDraftGuard, { requestDraftNavigation } from '../useDraftGuard';
import useCreationRequest from '../useCreationRequest';
import { useCopy } from '../../copy';
import styles from '../../projects/projects.module.css';

export default function CreateProject({ actorId, teams, allowTeams, defaultTeamId, lockTeam = false, onCancel, onCreated }) {
	const { t } = useCopy();
	const p = t.projects;
	const eligibleTeams = teams.filter(team => ['owner', 'admin'].includes(team.role) && !team.archivedAt);
	const initialTeam = eligibleTeams.some(team => team.id === defaultTeamId) ? defaultTeamId : '';
	const [mode, setMode] = useState(initialTeam ? 'team' : 'standalone');
	const [form, setForm] = useState({ title: '', description: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok', deadlineAt: '', teamId: initialTeam });
	const { busy, frozen, pending, ready, restored, abandon, submit: send } = useCreationRequest('/api/megu/projects', { actorId, scope: defaultTeamId || 'directory' });
	const [error, setError] = useState('');
	const [dirty, setDirty] = useState(false);
	const release = useDraftGuard(dirty, busy, abandon);
	const leave = () => { if (abandon()) onCancel(); };
	const cancel = () => { if (!pending.current && requestDraftNavigation(leave)) leave(); };
	useEffect(() => { if (restored) { setForm({ ...restored, teamId: restored.teamId || '', deadlineAt: restored.deadlineAt || '' }); setMode(restored.teamId ? 'team' : 'standalone'); setDirty(true); } }, [restored]);
	const set = (key, value) => { if (pending.current || frozen) return; setDirty(true); setForm(current => ({ ...current, [key]: value })); };
	useEffect(() => {
		if (restored || pending.current || frozen || !defaultTeamId || !eligibleTeams.some(team => team.id === defaultTeamId)) return;
		setMode('team'); setForm(current => ({ ...current, teamId: defaultTeamId }));
	}, [defaultTeamId, teams, frozen, restored]);
	const submit = async (event) => {
		event.preventDefault(); if (pending.current) return; setError('');
		try {
			if (mode === 'team' && !form.teamId) throw { code: 'team_not_found' };
			const data = await send({ ...form, teamId: mode === 'team' ? form.teamId : null, deadlineAt: form.deadlineAt || null, deadlinePrecision: form.deadlineAt ? 'date' : null });
			if (!data) return;
			release(); setDirty(false);
			onCreated(data.project);
		}
		catch (problem) { setError(p.errors[problem?.code] || p.errors.failed); }
	};
	return (
		<section className={styles.createPanel} aria-labelledby="create-project-title">
			<div className={styles.sectionHead}><div><h2 id="create-project-title">{p.createTitle}</h2><p>{p.createHint}</p></div><button type="button" className={styles.iconButton} disabled={busy} onClick={cancel} aria-label={p.cancel}><X size={18} /></button></div>
			<form onSubmit={submit} className={styles.createForm}>
				{allowTeams && !lockTeam && <fieldset disabled={frozen} className={`${styles.field} ${styles.fieldWide}`}><legend>{p.projectMode}</legend><div className={styles.modeChoices}><button type="button" aria-pressed={mode === 'standalone'} onClick={() => { setDirty(true); setMode('standalone'); }}><strong>{p.standalone}</strong><span>{p.standaloneHint}</span></button><button type="button" aria-pressed={mode === 'team'} disabled={frozen || !eligibleTeams.length} onClick={() => { setDirty(true); setMode('team'); }}><strong>{p.teamProject}</strong><span>{p.teamProjectHint}</span></button></div></fieldset>}
				{mode === 'team' && <label className={`${styles.field} ${styles.fieldWide}`}><span>{p.selectTeam}</span><CustomSelect required ariaLabel={p.selectTeam} disabled={lockTeam || frozen} type="default" value={form.teamId} onChange={value => set('teamId', value)} options={eligibleTeams.map(team => ({ value: team.id, label: team.name, subtitle: t.teams.role[team.role] }))} /></label>}
				<label className={styles.field}><span>{p.name}</span><input disabled={frozen} autoFocus required maxLength={120} value={form.title} onChange={e => set('title', e.target.value)} placeholder={p.namePlaceholder} /></label>
				<label className={`${styles.field} ${styles.fieldWide}`}><span>{p.description}</span><textarea disabled={frozen} maxLength={4000} value={form.description} onChange={e => set('description', e.target.value)} placeholder={p.descriptionPlaceholder} rows={2} /></label>
				<label className={styles.field}><span>{p.timezone}</span><input disabled={frozen} required value={form.timezone} onChange={e => set('timezone', e.target.value)} /></label>
				<label className={styles.field}><span>{p.deadline}</span><input disabled={frozen} type="date" value={form.deadlineAt} onChange={e => set('deadlineAt', e.target.value)} /><small>{p.deadlineHint}</small></label>
				{restored && <p className={styles.fieldWide} role="status">{p.creationRestored}</p>}
				{!ready && <p className={styles.fieldWide} role="alert">{p.creationStorageUnavailable}</p>}
				{error && <p className={`${styles.formError} ${styles.fieldWide}`} role="alert">{error}</p>}
				<div className={`${styles.formActions} ${styles.fieldWide}`}><button type="button" className="btn btn-secondary" disabled={busy} onClick={cancel}>{p.cancel}</button><button disabled={busy || !ready} className="btn btn-primary" type="submit">{busy ? p.creating : (frozen || restored) ? p.retry : p.create}</button></div>
			</form>
		</section>
	);
}
