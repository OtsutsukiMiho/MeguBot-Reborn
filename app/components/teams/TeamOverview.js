'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Plus, Settings2 } from 'lucide-react';
import AuthGate from '../AuthGate';
import { useCopy } from '../../copy';
import TeamMark from './TeamMark';
import styles from '../../teams/teams.module.css';

export default function TeamOverview({ teamId }) {
	const { t } = useCopy();
	const c = t.teams;
	const p = t.projects;
	const [data, setData] = useState(null);
	const [state, setState] = useState('loading');
	const [error, setError] = useState('');
	useEffect(() => {
		Promise.all([fetch('/api/megu/me'), fetch(`/api/megu/teams/${encodeURIComponent(teamId)}`)])
			.then(async ([meResponse, teamResponse]) => {
				const me = await meResponse.json();
				if (!me.loggedIn) { setState('signed-out'); return; }
				const body = await teamResponse.json();
				if (!teamResponse.ok) throw body;
				setData(body); setState('ready');
			})
			.catch(problem => { setError(c.errors[problem?.code] || c.errors.failed); setState('error'); });
	}, [c.errors, teamId]);
	if (state === 'signed-out') return <AuthGate title={c.signedOutTitle} lede={c.signedOutLede} />;
	if (!data) return <main className={styles.shell} aria-busy={state === 'loading'}><Link href="/teams" className={styles.back}><ArrowLeft size={15} />{c.backToTeams}</Link>{error ? <p className={styles.error}>{error}</p> : <span className="skeleton-line" style={{ width: '24ch' }} />}</main>;
	const { team, projects, capabilities } = data;
	return <main className={styles.shell}>
		<Link href="/teams" className={styles.back}><ArrowLeft size={15} />{c.backToTeams}</Link>
		<header className={styles.header}><div className={styles.identity}><TeamMark name={team.name} color={team.color} size="large" /><div><h1>{team.name}</h1><p>{team.description || c.peopleHint}</p></div></div><div className={styles.headerActions}>{capabilities.canCreateProject && <Link href={`/projects?team=${encodeURIComponent(team.id)}&create=1`} className="btn btn-primary"><Plus size={16} />{c.createProject}</Link>}<Link href={`/teams/${team.id}/manage`} className="btn btn-secondary"><Settings2 size={16} />{c.settings}</Link></div></header>
		<section><h2>{c.teamProjects}</h2>{projects.length ? <div className={styles.projectList}>{projects.map(project => <Link key={project.id} href={`/p/${project.code}`} className={styles.projectRow}><div><strong>{project.title}</strong><small>{p.state[project.status]} · {p.topicsCount(project.topicCount)}</small></div><span className={styles.progress}>{project.progress}%</span><span className={styles.role}>{p.role[project.role]}</span><ArrowRight size={16} /></Link>)}</div> : <div className={styles.empty}><div><h2>{c.noProjects}</h2><p>{c.peopleHint}</p></div>{capabilities.canCreateProject && <Link href={`/projects?team=${encodeURIComponent(team.id)}&create=1`} className="btn btn-primary">{c.createProject}</Link>}</div>}</section>
	</main>;
}
