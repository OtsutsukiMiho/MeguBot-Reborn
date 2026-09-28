'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AuthGate from '../AuthGate';
import CreateProject from './CreateProject';
import { useCopy } from '../../copy';
import styles from '../../projects/projects.module.css';

const TEAMS_ENABLED = process.env.NEXT_PUBLIC_MEGU_PROJECT_TEAMS_ENABLED !== '0';

export default function NewProject({ teamId }) {
	const { t } = useCopy();
	const p = t.projects;
	const router = useRouter();
	const [state, setState] = useState({ loading: true, me: null, teams: [], error: false });
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		const controller = new AbortController();
		setState({ loading: true, me: null, teams: [], error: false });
		(async () => {
			try {
				const meResponse = await fetch('/api/megu/me', { signal: controller.signal });
				if (!meResponse.ok) throw new Error('load_failed');
				const me = await meResponse.json();
				let teams = [];
				if (me.loggedIn && TEAMS_ENABLED) {
					const response = await fetch('/api/megu/teams', { signal: controller.signal });
					if (!response.ok) throw new Error('load_failed');
					teams = (await response.json()).teams || [];
				}
				if (!controller.signal.aborted) setState({ loading: false, me, teams, error: false });
			} catch { if (!controller.signal.aborted) setState({ loading: false, me: null, teams: [], error: true }); }
		})();
		return () => controller.abort();
	}, [attempt]);
	if (state.loading) return <div className={styles.directory} aria-busy="true"><h1>{p.newProject}</h1><p role="status">{t.common.loading}</p></div>;
	if (state.error) return <div className={styles.directory}><h1>{p.newProject}</h1><p role="alert">{p.loadFailed}</p><button className="btn btn-secondary" onClick={() => setAttempt(value => value + 1)}>{p.retry}</button></div>;
	if (!state.me?.loggedIn) return <AuthGate title={p.signedOutTitle} lede={p.signedOutLede} />;
	const team = state.teams.find(item => item.id === teamId && ['owner', 'admin'].includes(item.role) && !item.archivedAt);
	if (teamId && !team) return <div className={styles.directory}><h1>{p.newProject}</h1><p role="alert">{p.errors.team_not_found || p.errors.failed}</p><Link href="/projects">{p.title}</Link></div>;
	return <div className={styles.directory}><header className={styles.directoryHead}><div><h1>{p.newProject}</h1>{team && <p>{team.name}</p>}</div></header><CreateProject teams={state.teams} key={`${state.me.user.id}:${teamId || "directory"}`} actorId={state.me.user.id} allowTeams={TEAMS_ENABLED} defaultTeamId={teamId} lockTeam={Boolean(teamId)} onCancel={() => router.push(teamId ? `/teams/${encodeURIComponent(teamId)}` : '/projects')} onCreated={project => router.push(`/p/${project.code}`)} /></div>;
}
