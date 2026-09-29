'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, Check, Clock3, LockKeyhole, Plus, Search, Users, X } from 'lucide-react';
import AuthGate from '../components/AuthGate';
import MeguMark from '../components/MeguMark';
import CustomSelect from '../components/CustomSelect';
import ProjectDirectoryNav from '../components/projects/ProjectDirectoryNav';
import WorkspaceSkeleton from '../components/WorkspaceSkeleton';
import { useCopy } from '../copy';
import styles from './projects.module.css';
import { parseDirectoryFilters, serializeDirectoryFilters } from '../../core/project-directory-filters';

const CLOSED = new Set(['completed', 'cancelled']);
const TEAMS_ENABLED = process.env.NEXT_PUBLIC_MEGU_PROJECT_TEAMS_ENABLED !== '0';

function dateLabel(value, lang, timezone) {
	if (!value) return null;
	return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', {
		day: 'numeric', month: 'short', year: 'numeric', timeZone: timezone || 'Asia/Bangkok',
	}).format(new Date(value));
}

export default function ProjectsPage() {
	const router = useRouter();
	const { t, lang } = useCopy();
	const p = t.projects;
	const [me, setMe] = useState(null);
	const [projects, setProjects] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [query, setQuery] = useState('');
	const [bucket, setBucket] = useState('active');
	const [mine, setMine] = useState(false);
	const [nextCursor, setNextCursor] = useState(null);
	const [loadingMore, setLoadingMore] = useState(false);
	const [hasAnyProjects, setHasAnyProjects] = useState(false);
	const [teams, setTeams] = useState([]);
	const [scope, setScope] = useState('all');
	const [server, setServer] = useState('');
	const [filtersReady, setFiltersReady] = useState(false);
	const [cursor, setCursor] = useState('');
	const appendNext = useRef(false);
	const requestSequence = useRef(0);
	const changeFilter = (setter, value) => { appendNext.current = false; setCursor(''); setter(value); ++requestSequence.current; };

	const load = useCallback(async ({ cursor = null, append = false } = {}) => {
		const requestId = ++requestSequence.current;
		if (cursor) setLoadingMore(true); else setLoading(true);
		setError('');
		try {
			const params = new URLSearchParams({ bucket, limit: '30' });
			if (query.trim()) params.set('q', query.trim());
			if (mine) params.set('assigned', 'true');
			if (scope !== 'all') params.set('teamId', scope);
			if (server) params.set('guildId', server);
			if (cursor) params.set('cursor', cursor);
			const [meResponse, projectsResponse, teamsResponse] = await Promise.all([
				fetch('/api/megu/me', { credentials: 'same-origin' }),
				fetch(`/api/megu/projects?${params}`, { credentials: 'same-origin' }),
				TEAMS_ENABLED ? fetch('/api/megu/teams', { credentials: 'same-origin' }) : Promise.resolve(null),
			]);
			const meData = await meResponse.json();
			if (requestId !== requestSequence.current) return;
			if (meData.loggedIn && !projectsResponse.ok) throw new Error('load_failed');
			const projectData = projectsResponse.ok ? await projectsResponse.json() : { projects: [] };
			const teamData = teamsResponse?.ok ? await teamsResponse.json() : null;
			if (requestId !== requestSequence.current) return;
			setMe(meData);
			const incoming = projectData.projects || [];
			setProjects(current => append ? [...current, ...incoming.filter(project => !current.some(existing => existing.id === project.id))] : incoming);
			setNextCursor(projectData.nextCursor || null);
			setHasAnyProjects(Boolean(projectData.hasAnyProjects));
			if (teamData) setTeams(teamData.teams || []);
		}
		catch {
			if (requestId === requestSequence.current) setError(p.loadFailed);
		}
		finally { if (requestId === requestSequence.current) { setLoading(false); setLoadingMore(false); } }
	}, [bucket, mine, p.loadFailed, query, scope, server]);

	useEffect(() => {
		if (!filtersReady) return;
		const timer = setTimeout(() => { const append = appendNext.current; appendNext.current = false; load({ cursor, append }); }, me ? 180 : 0);
		return () => { clearTimeout(timer); ++requestSequence.current; };
	}, [load, filtersReady, cursor]);
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const team = params.get('team') || '';
		if (params.get('create') === '1') router.replace(`/projects/new${team ? `?team=${encodeURIComponent(team)}` : ''}`);
		const restore = () => {
			const filters = parseDirectoryFilters(window.location.search, TEAMS_ENABLED);
			appendNext.current = false; setCursor(filters.cursor);
			setQuery(filters.query); setBucket(filters.bucket); setMine(filters.mine); setScope(filters.scope); setServer(filters.server); setFiltersReady(true);
		};
		restore(); window.addEventListener('popstate', restore);
		return () => window.removeEventListener('popstate', restore);
	}, [router]);
	useEffect(() => {
		if (!filtersReady || new URLSearchParams(window.location.search).get('create') === '1') return;
		const search = serializeDirectoryFilters({ query, bucket, mine, scope, server, cursor });
		const target = `/projects${search ? `?${search}` : ''}${window.location.hash}`;
		if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== target) window.history.replaceState(window.history.state, '', target);
	}, [filtersReady, query, bucket, mine, scope, server, cursor]);
	const loadMore = () => {
		if (!nextCursor || loadingMore) return;
		const search = serializeDirectoryFilters({ query, bucket, mine, scope, server, cursor: nextCursor });
		window.history.pushState(window.history.state, '', `/projects?${search}${window.location.hash}`);
		setLoadingMore(true); ++requestSequence.current;
		appendNext.current = true; setCursor(nextCursor);
	};

	const visible = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase(lang);
		return projects.filter(project => {
			if ((bucket === 'closed') !== CLOSED.has(project.status)) return false;
			if (mine && Number(project.assignedCount || 0) === 0) return false;
			return !needle || project.title.toLocaleLowerCase(lang).includes(needle) || project.code.toLowerCase().includes(needle);
		});
	}, [projects, bucket, mine, query, lang]);
	const selectedTeam = teams.find(team => team.id === scope) || null;
	const scopedTeams = server ? teams.filter(team => team.discordGuild?.id === server) : teams;
	const servers = [...new Map(teams.filter(team => team.discordGuild).map(team => [team.discordGuild.id, team.discordGuild])).values()];
	const createHref = `/projects/new${selectedTeam ? `?team=${encodeURIComponent(selectedTeam.id)}` : ''}`;

	if (loading && !me) return <ProjectsSkeleton title={p.title} />;
	if (error && !me) return <div className={styles.directory}><h1>{p.title}</h1><p role="alert">{error}</p><button type="button" className="btn btn-secondary" onClick={() => load({ cursor })}>{p.retry}</button></div>;
	if (!me?.loggedIn) return <AuthGate title={p.signedOutTitle} lede={p.signedOutLede} />;

	return (
		<div className={styles.directory} aria-busy={loading || loadingMore}>
			<header className={styles.directoryHead}>
				<div><h1>{p.title}</h1><p>{p.lede}</p></div>
				<Link className="btn btn-primary" href={createHref}><Plus size={17} />{p.newProject}</Link>
			</header>
			{TEAMS_ENABLED && <ProjectDirectoryNav current="projects" />}
			{selectedTeam && <div className={styles.teamScopeContext}><div><span>{p.teamProject}</span><strong>{selectedTeam.name}</strong></div><Link href={`/teams/${selectedTeam.id}`} className="btn btn-secondary btn-sm">{p.openTeam}</Link></div>}


			{error ? (
				<section className={styles.notice} role="alert"><span>{error}</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => load({ cursor })}>{p.retry}</button></section>
			) : !hasAnyProjects && projects.length === 0 ? (
				<section className={styles.empty}>
					<MeguMark size={48} mood="happy" />
					<div><h2>{p.emptyTitle}</h2><p>{p.emptyBody}</p></div>
					<Link className="btn btn-primary" href={createHref}><Plus size={17} />{p.newProject}</Link>
				</section>
			) : (
				<>
					<div className={styles.directoryTools}>
						<div className={styles.segmented} aria-label={p.title}>
							{['active', 'closed'].map(value => <button key={value} type="button" aria-pressed={bucket === value} onClick={() => changeFilter(setBucket, value)}>{p.filters[value]}</button>)}
						</div>
						<label className={styles.search}><Search size={16} aria-hidden="true" /><input aria-label={p.search} placeholder={p.searchPlaceholder} maxLength={120} value={query} onChange={event => changeFilter(setQuery, event.target.value)} />{query && <button type="button" onClick={() => changeFilter(setQuery, '')} aria-label={p.clearFilters}><X size={15} /></button>}</label>
						<label className={styles.checkFilter}><input type="checkbox" checked={mine} onChange={event => changeFilter(setMine, event.target.checked)} /><span><Check size={14} />{p.filters.mine}</span></label>
						{TEAMS_ENABLED && <div className={styles.scopeSelect}><CustomSelect size="compact" ariaLabel={t.serverWorkspaces.filter} value={server} onChange={value => { changeFilter(setServer, value); setScope('all'); }} options={[{ value: '', label: t.serverWorkspaces.allServers }, ...servers.map(guild => ({ value: guild.id, label: guild.name }))]} /></div>}
						{TEAMS_ENABLED && <div className={styles.scopeSelect}><CustomSelect size="compact" searchable={scopedTeams.length > 5} ariaLabel={p.scope} value={scope} onChange={value => changeFilter(setScope, value)} options={[{ value: 'all', label: p.scopes.all }, ...(!server ? [{ value: 'standalone', label: p.scopes.standalone }] : []), ...scopedTeams.map(team => ({ value: team.id, label: team.name, subtitle: t.teams.role[team.role] }))]} /></div>}
					</div>

					{loading ? <WorkspaceSkeleton label={p.loadingMore} /> : visible.length === 0 ? <section className={styles.filteredEmpty}><p>{p.filteredEmpty}</p><button className="btn btn-secondary btn-sm" type="button" onClick={() => { changeFilter(setQuery, ''); setMine(false); setBucket('active'); setScope('all'); setServer(''); }}>{p.clearFilters}</button></section> : (
						<section className={styles.projectList} aria-label={p.title}>
							{visible.map(project => <ProjectRow key={project.id} project={project} p={p} lang={lang} />)}
						</section>
					)}
					{nextCursor && visible.length > 0 && <div className={styles.directoryMore}><button type="button" className="btn btn-secondary" disabled={loadingMore || loading} onClick={loadMore}>{loadingMore ? p.loadingMore : p.loadMoreProjects}</button></div>}
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
			{project.topicCount > 0 ? <div className={styles.projectStanding}>
				<div><strong>{project.progress}%</strong><span>{p.progress}</span></div>
				<div className={styles.progressTrack} aria-label={`${project.progress}% ${p.progress}`}><span style={{ width: `${project.progress}%` }} /></div>
			</div> : <div className={styles.projectStanding}><span>{p.noTopicsTitle}</span></div>}
			<span className={`${styles.state} ${styles[`state_${project.status}`]}`}>{p.state[project.status]}</span>
		</Link>
	);
}


function ProjectsSkeleton({ title }) {
	return <div className={styles.directory} aria-busy="true"><header className={styles.directoryHead}><div><h1>{title}</h1><span className="skeleton-line" style={{ width: '28ch' }} /></div></header>{TEAMS_ENABLED && <ProjectDirectoryNav current="projects" />}<WorkspaceSkeleton /></div>;
}
