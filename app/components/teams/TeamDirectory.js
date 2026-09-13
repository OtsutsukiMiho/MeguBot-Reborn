'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, FolderKanban, Plus, Users } from 'lucide-react';
import AuthGate from '../AuthGate';
import MeguMark from '../MeguMark';
import { useCopy } from '../../copy';
import TeamMark from './TeamMark';
import styles from '../../teams/teams.module.css';

const COLORS = ['indigo', 'blue', 'cyan', 'emerald', 'amber', 'rose', 'violet'];

export default function TeamDirectory() {
	const { t } = useCopy();
	const c = t.teams;
	const [auth, setAuth] = useState('loading');
	const [teams, setTeams] = useState([]);
	const [creating, setCreating] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const load = async () => {
		setLoading(true); setError('');
		try {
			const [meResponse, teamResponse] = await Promise.all([fetch('/api/megu/me'), fetch('/api/megu/teams?includeArchived=true')]);
			const me = await meResponse.json();
			if (!me.loggedIn) { setAuth('signed-out'); return; }
			const body = await teamResponse.json();
			if (!teamResponse.ok) throw body;
			setAuth('ready'); setTeams(body.teams || []);
		}
		catch (problem) { setAuth('error'); setError(c.errors[problem?.code] || c.errors.failed); }
		finally { setLoading(false); }
	};
	useEffect(() => { load(); }, []);
	if (auth === 'loading') return <main className={styles.shell} aria-busy="true"><header className={styles.header}><div><h1>{c.title}</h1><span className="skeleton-line" style={{ width: '34ch' }} /></div></header><span className="skeleton-line" style={{ width: '100%', minHeight: '7rem' }} /></main>;
	if (auth === 'signed-out') return <AuthGate title={c.signedOutTitle} lede={c.signedOutLede} />;
	if (auth === 'error') return <main className={styles.shell}><header className={styles.header}><div><h1>{c.title}</h1><p>{c.lede}</p></div></header><p className={styles.error} role="alert">{error}</p></main>;
	return <main className={styles.shell} aria-busy={loading}>
		<header className={styles.header}><div><h1>{c.title}</h1><p>{c.lede}</p></div>{!creating && <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={17} />{c.newTeam}</button>}</header>
		{creating && <CreateTeam c={c} onCancel={() => setCreating(false)} />}
		{error && <p className={styles.error} role="alert">{error}</p>}
		{!loading && !teams.length && !creating ? <section className={styles.empty}><MeguMark size={46} mood="happy" /><div><h2>{c.emptyTitle}</h2><p>{c.emptyBody}</p></div><button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={17} />{c.newTeam}</button></section> : <section className={styles.teamList} aria-label={c.title}>{teams.map(team => <Link href={`/teams/${team.id}`} className={styles.teamCard} key={team.id}><TeamMark name={team.name} color={team.color} /><div><h2>{team.name}</h2><p>{team.description || c.peopleHint}</p><div className={styles.teamMeta}><span><Users size={14} />{c.members(team.memberCount)}</span><span><FolderKanban size={14} />{c.projects(team.projectCount)}</span></div></div><span className={styles.role}>{team.archivedAt ? c.archived : c.role[team.role]}</span><ArrowRight size={17} aria-hidden="true" /></Link>)}</section>}
	</main>;
}

function CreateTeam({ c, onCancel }) {
	const [form, setForm] = useState({ name: '', description: '', color: 'indigo' });
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const submit = async event => {
		event.preventDefault(); setBusy(true); setError('');
		try {
			const response = await fetch('/api/megu/teams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
			const body = await response.json();
			if (!response.ok) throw body;
			window.location.assign(`/teams/${body.team.id}`);
		}
		catch (problem) { setError(c.errors[problem?.code] || c.errors.failed); setBusy(false); }
	};
	return <section className={styles.createPanel} aria-labelledby="create-team-title"><h2 id="create-team-title">{c.createTitle}</h2><p>{c.createHint}</p><form className={styles.form} onSubmit={submit}><label><span>{c.name}</span><input autoFocus required maxLength={120} value={form.name} placeholder={c.namePlaceholder} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></label><label><span>{c.description}</span><textarea rows={2} maxLength={4000} value={form.description} placeholder={c.descriptionPlaceholder} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} /></label><fieldset className={`${styles.field} ${styles.wide}`}><legend>{c.color}</legend><div className={styles.colorChoices}>{COLORS.map(color => <button key={color} type="button" className={styles.colorChoice} aria-label={color} aria-pressed={form.color === color} onClick={() => setForm(current => ({ ...current, color }))}><TeamMark name="" color={color} /></button>)}</div></fieldset>{error && <p className={`${styles.error} ${styles.wide}`} role="alert">{error}</p>}<div className={`${styles.actions} ${styles.wide}`}><button type="button" className="btn btn-secondary" onClick={onCancel}>{c.cancel}</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? c.creating : c.create}</button></div></form></section>;
}
