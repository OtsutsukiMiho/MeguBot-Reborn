'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, Check, Clock3, LockKeyhole, Plus, Search, Users, X } from 'lucide-react';
import AuthGate from '../components/AuthGate';
import MeguMark from '../components/MeguMark';
import CustomSelect from '../components/CustomSelect';
import { useCopy } from '../copy';
import styles from './projects.module.css';

const CLOSED = new Set(['completed', 'cancelled']);
const TEAMS_ENABLED = process.env.NEXT_PUBLIC_MEGU_PROJECT_TEAMS_ENABLED !== '0';

function dateLabel(value, lang, timezone) {
	if (!value) return null;
	return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', {
		day: 'numeric', month: 'short', year: 'numeric', timeZone: timezone || 'Asia/Bangkok',
	}).format(new Date(value));
}

export default function ProjectsPage() {
	const { t, lang } = useCopy();
	const p = t.projects;
	const [me, setMe] = useState(null);
	const [projects, setProjects] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [query, setQuery] = useState('');
	const [bucket, setBucket] = useState('active');
	const [mine, setMine] = useState(false);
	const [creating, setCreating] = useState(false);
	const [nextCursor, setNextCursor] = useState(null);
	const [loadingMore, setLoadingMore] = useState(false);
	const [hasAnyProjects, setHasAnyProjects] = useState(false);
	const [teams, setTeams] = useState([]);
	const [scope, setScope] = useState('all');
	const [defaultTeamId, setDefaultTeamId] = useState('');
	const requestSequence = useRef(0);

	const load = useCallback(async ({ cursor = null } = {}) => {
		const requestId = ++requestSequence.current;
		if (cursor) setLoadingMore(true); else setLoading(true);
		setError('');
		try {
			const params = new URLSearchParams({ bucket, limit: '30' });
			if (query.trim()) params.set('q', query.trim());
			if (mine) params.set('assigned', 'true');
			if (scope !== 'all') params.set('teamId', scope);
			if (cursor) params.set('cursor', cursor);
			const [meResponse, projectsResponse, teamsResponse] = await Promise.all([
				fetch('/api/megu/me', { credentials: 'same-origin' }),
				fetch(`/api/megu/projects?${params}`, { credentials: 'same-origin' }),
				TEAMS_ENABLED ? fetch('/api/megu/teams', { credentials: 'same-origin' }) : Promise.resolve(null),
			]);
			const meData = await meResponse.json();
			if (requestId !== requestSequence.current) return;
			setMe(meData);
			if (meData.loggedIn && !projectsResponse.ok) throw new Error('load_failed');
			const projectData = projectsResponse.ok ? await projectsResponse.json() : { projects: [] };
			const incoming = projectData.projects || [];
			setProjects(current => cursor ? [...current, ...incoming.filter(project => !current.some(existing => existing.id === project.id))] : incoming);
			setNextCursor(projectData.nextCursor || null);
			setHasAnyProjects(Boolean(projectData.hasAnyProjects));
			if (teamsResponse?.ok) { const teamData = await teamsResponse.json(); setTeams(teamData.teams || []); }
		}
		catch {
			if (requestId === requestSequence.current) setError(p.loadFailed);
		}
		finally { if (requestId === requestSequence.current) { setLoading(false); setLoadingMore(false); } }
	}, [bucket, mine, p.loadFailed, query, scope]);

	useEffect(() => { const timer = setTimeout(() => load(), 180); return () => clearTimeout(timer); }, [load]);
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const team = params.get('team') || '';
		if (TEAMS_ENABLED && team) { setScope(team); setDefaultTeamId(team); }
		if (params.get('create') === '1') setCreating(true);
	}, []);

	const visible = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase(lang);
		return projects.filter(project => {
			if ((bucket === 'closed') !== CLOSED.has(project.status)) return false;
			if (mine && Number(project.assignedCount || 0) === 0) return false;
			return !needle || project.title.toLocaleLowerCase(lang).includes(needle) || project.code.toLowerCase().includes(needle);
		});
	}, [projects, bucket, mine, query, lang]);

	if (loading && !me) return <ProjectsSkeleton title={p.title} />;
	if (!me?.loggedIn) return <AuthGate title={p.signedOutTitle} lede={p.signedOutLede} />;

	return (
		<div className={styles.directory} aria-busy={loading || loadingMore}>
			<header className={styles.directoryHead}>
				<div><h1>{p.title}</h1><p>{p.lede}</p></div>
				{!creating && <button className="btn btn-primary" type="button" onClick={() => setCreating(true)}><Plus size={17} />{p.newProject}</button>}
			</header>

			{creating && <CreateProject teams={teams} allowTeams={TEAMS_ENABLED} defaultTeamId={defaultTeamId || (scope !== 'all' && scope !== 'standalone' ? scope : '')} onCancel={() => setCreating(false)} onCreated={project => { window.location.href = `/p/${project.code}`; }} />}

			{error ? (
				<section className={styles.notice} role="alert"><span>{error}</span><button type="button" className="btn btn-secondary btn-sm" onClick={load}>{p.retry}</button></section>
			) : !hasAnyProjects && projects.length === 0 && !creating ? (
				<section className={styles.empty}>
					<MeguMark size={48} mood="happy" />
					<div><h2>{p.emptyTitle}</h2><p>{p.emptyBody}</p></div>
					<button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={17} />{p.newProject}</button>
				</section>
			) : (
				<>
					<div className={styles.directoryTools}>
						<div className={styles.segmented} aria-label={p.title}>
							{['active', 'closed'].map(value => <button key={value} type="button" aria-pressed={bucket === value} onClick={() => setBucket(value)}>{p.filters[value]}</button>)}
						</div>
						<label className={styles.search}><Search size={16} aria-hidden="true" /><input maxLength={120} value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" onClick={() => setQuery('')} aria-label={p.clearFilters}><X size={15} /></button>}</label>
						<label className={styles.checkFilter}><input type="checkbox" checked={mine} onChange={event => setMine(event.target.checked)} /><span><Check size={14} />{p.filters.mine}</span></label>
						{TEAMS_ENABLED && <div className={styles.scopeSelect}><CustomSelect size="compact" searchable={teams.length > 5} ariaLabel={p.scope} value={scope} onChange={setScope} options={[{ value: 'all', label: p.scopes.all }, { value: 'standalone', label: p.scopes.standalone }, ...teams.map(team => ({ value: team.id, label: team.name, subtitle: t.teams.role[team.role] }))]} /></div>}
						{TEAMS_ENABLED && <Link href="/teams" className="btn btn-secondary btn-sm">{p.manageTeams}</Link>}
					</div>

					{visible.length === 0 ? <section className={styles.filteredEmpty}><p>{p.filteredEmpty}</p><button className="btn btn-secondary btn-sm" type="button" onClick={() => { setQuery(''); setMine(false); setBucket('active'); }}>{p.clearFilters}</button></section> : (
						<section className={styles.projectList} aria-label={p.title}>
							{visible.map(project => <ProjectRow key={project.id} project={project} p={p} lang={lang} />)}
						</section>
					)}
					{nextCursor && visible.length > 0 && <div className={styles.directoryMore}><button type="button" className="btn btn-secondary" disabled={loadingMore} onClick={() => load({ cursor: nextCursor })}>{loadingMore ? p.loadingMore : p.loadMoreProjects}</button></div>}
				</>
			)}
		</div>
	);
}

function ProjectRow({ project, p, lang }) {
	const due = dateLabel(project.nextDueAt, lang, project.timezone);
	const updated = dateLabel(project.lastUpdatedAt, lang, project.timezone);
	return (
		<Link className={styles.projectRow} href={`/p/${project.code}`}>
			<div className={styles.projectIdentity}>
				<div className={styles.projectTitleLine}><h2>{project.title}</h2><span className={styles.code}>{project.code}</span></div>
				<div className={styles.rowMeta}><span className={styles.scopeBadge}>{project.team?.name || p.standalone}</span><span><LockKeyhole size={14} />{p.private}</span><span><Users size={14} />{p.role[project.role]}</span><span><CalendarDays size={14} />{due ? `${p.nextDue} ${due}` : p.noDeadline}</span><span><Clock3 size={14} />{updated ? `${p.lastUpdated} ${updated}` : p.noUpdates}</span></div>
			</div>
			<div className={styles.projectStanding}>
				<div><strong>{project.progress}%</strong><span>{p.progress}</span></div>
				<div className={styles.progressTrack} aria-label={`${project.progress}% ${p.progress}`}><span style={{ width: `${project.progress}%` }} /></div>
			</div>
			<span className={`${styles.state} ${styles[`state_${project.status}`]}`}>{p.state[project.status]}</span>
		</Link>
	);
}

function CreateProject({ teams, allowTeams, defaultTeamId, onCancel, onCreated }) {
	const { t } = useCopy();
	const p = t.projects;
	const eligibleTeams = teams.filter(team => ['owner', 'admin'].includes(team.role) && !team.archivedAt);
	const initialTeam = eligibleTeams.some(team => team.id === defaultTeamId) ? defaultTeamId : '';
	const [mode, setMode] = useState(initialTeam ? 'team' : 'standalone');
	const [form, setForm] = useState({ title: '', description: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok', deadlineAt: '', teamId: initialTeam });
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
	useEffect(() => {
		if (!defaultTeamId || !eligibleTeams.some(team => team.id === defaultTeamId)) return;
		setMode('team'); set('teamId', defaultTeamId);
	}, [defaultTeamId, teams]);
	const submit = async (event) => {
		event.preventDefault(); setBusy(true); setError('');
		try {
			if (mode === 'team' && !form.teamId) throw { code: 'team_not_found' };
			const response = await fetch('/api/megu/projects', {
				method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...form, teamId: mode === 'team' ? form.teamId : null, deadlineAt: form.deadlineAt || null, deadlinePrecision: form.deadlineAt ? 'date' : null }),
			});
			const data = await response.json();
			if (!response.ok) throw data;
			onCreated(data.project);
		}
		catch (problem) { setError(p.errors[problem?.code] || p.errors.failed); setBusy(false); }
	};
	return (
		<section className={styles.createPanel} aria-labelledby="create-project-title">
			<div className={styles.sectionHead}><div><h2 id="create-project-title">{p.createTitle}</h2><p>{p.createHint}</p></div><button type="button" className={styles.iconButton} onClick={onCancel} aria-label={p.cancel}><X size={18} /></button></div>
			<form onSubmit={submit} className={styles.createForm}>
				{allowTeams && <fieldset className={`${styles.field} ${styles.fieldWide}`}><legend>{p.projectMode}</legend><div className={styles.modeChoices}><button type="button" aria-pressed={mode === 'standalone'} onClick={() => setMode('standalone')}><strong>{p.standalone}</strong><span>{p.standaloneHint}</span></button><button type="button" aria-pressed={mode === 'team'} disabled={!eligibleTeams.length} onClick={() => { setMode('team'); if (!form.teamId) set('teamId', eligibleTeams[0]?.id || ''); }}><strong>{p.teamProject}</strong><span>{p.teamProjectHint}</span></button></div></fieldset>}
				{mode === 'team' && <label className={`${styles.field} ${styles.fieldWide}`}><span>{p.selectTeam}</span><CustomSelect required type="default" value={form.teamId} onChange={value => set('teamId', value)} options={eligibleTeams.map(team => ({ value: team.id, label: team.name, subtitle: t.teams.role[team.role] }))} /></label>}
				<label className={styles.field}><span>{p.name}</span><input autoFocus required maxLength={120} value={form.title} onChange={e => set('title', e.target.value)} placeholder={p.namePlaceholder} /></label>
				<label className={`${styles.field} ${styles.fieldWide}`}><span>{p.description}</span><textarea maxLength={4000} value={form.description} onChange={e => set('description', e.target.value)} placeholder={p.descriptionPlaceholder} rows={2} /></label>
				<label className={styles.field}><span>{p.timezone}</span><input required value={form.timezone} onChange={e => set('timezone', e.target.value)} /></label>
				<label className={styles.field}><span>{p.deadline}</span><input type="date" value={form.deadlineAt} onChange={e => set('deadlineAt', e.target.value)} /><small>{p.deadlineHint}</small></label>
				{error && <p className={`${styles.formError} ${styles.fieldWide}`} role="alert">{error}</p>}
				<div className={`${styles.formActions} ${styles.fieldWide}`}><button type="button" className="btn btn-secondary" onClick={onCancel}>{p.cancel}</button><button disabled={busy} className="btn btn-primary" type="submit">{busy ? p.creating : p.create}</button></div>
			</form>
		</section>
	);
}

function ProjectsSkeleton({ title }) {
	return <div className={styles.directory} aria-busy="true"><header className={styles.directoryHead}><div><h1>{title}</h1><span className="skeleton-line" style={{ width: '28ch' }} /></div></header><section className={styles.projectList}>{[0, 1, 2].map(i => <div className={styles.projectRow} key={i}><span className="skeleton-line" style={{ width: `${18 + i * 4}ch` }} /></div>)}</section></div>;
}
