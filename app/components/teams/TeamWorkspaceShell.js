'use client';

import { createContext, useContext } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import AuthGate from '../AuthGate';
import { useCopy } from '../../copy';
import useWorkspaceResource from '../useWorkspaceResource';
import { WorkspaceHeaderSkeleton } from '../WorkspaceSkeleton';
import TeamMark from './TeamMark';
import TeamWorkspaceNav from './TeamWorkspaceNav';
import styles from '../../teams/teams.module.css';

const TeamWorkspaceContext = createContext(null);
export const useTeamWorkspace = () => useContext(TeamWorkspaceContext);

export default function TeamWorkspaceShell({ teamId, goalsEnabled, children }) {
	const { t } = useCopy();
	const c = t.teams;
	const pathname = usePathname();
	const route = pathname?.split('/')[3];
	const section = route === 'join-requests' ? 'requests' : ['projects', 'people', 'requests', 'goals', 'settings'].includes(route) ? route : 'overview';
	const workspace = useWorkspaceResource(`/api/megu/teams/${encodeURIComponent(teamId)}/summary`);
	const team = workspace.data?.team;
	if (workspace.error?.status === 401) return <AuthGate title={c.signedOutTitle} lede={c.signedOutLede} />;
	return <TeamWorkspaceContext.Provider value={workspace}><main className={`${styles.shell} ${styles.teamWorkspace}`}>
		<nav className="workspace-context" aria-label={c.ux.context}><Link href="/teams" className={styles.back}><ArrowLeft size={15} aria-hidden="true" />{c.backToTeams}</Link>{team?.discordGuild && <Link href={`/teams/server/${encodeURIComponent(team.discordGuild.id)}/teams`}>{team.discordGuild.name}</Link>}</nav>
		{team ? <header className={`${styles.header} ${styles.workspaceIdentity}`}><div className={styles.identity}><TeamMark name={team.name} color={team.color} size="large" /><div><h1>{team.name}</h1><p>{team.description || c.overviewCopy.teamFallback}</p><span className={styles.teamRole}>{c.role[team.role]}</span></div></div>{team.archivedAt && <span className={styles.role}>{c.archived}</span>}</header> : <WorkspaceHeaderSkeleton />}
		<div className={styles.layout}><TeamWorkspaceNav teamId={teamId} section={section} goalsEnabled={goalsEnabled} /><div className={styles.content}>
			{workspace.error ? <div className={styles.error} role="alert"><p>{c.errors[workspace.error.code] || c.errors.failed}</p><button type="button" className="btn btn-secondary" onClick={workspace.reload}>{c.workspace.retry}</button></div> : children}
		</div></div>
	</main></TeamWorkspaceContext.Provider>;
}
