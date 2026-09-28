'use client';

import Link from 'next/link';
import { ArrowLeft, ArrowRight, Plus, Server } from 'lucide-react';
import AuthGate from '../AuthGate';
import { useCopy } from '../../copy';
import TeamMark from './TeamMark';
import TeamWorkspaceNav from './TeamWorkspaceNav';
import useWorkspaceResource from '../useWorkspaceResource';
import styles from '../../teams/teams.module.css';

export default function TeamOverview({ teamId, goalsEnabled = false, section = 'overview', cursor = '' }) {
	const { t } = useCopy();
	const c = t.teams;
	const p = t.projects;
	const base = `/teams/${encodeURIComponent(teamId)}`;
	const resource = useWorkspaceResource(`/api/megu/teams/${encodeURIComponent(teamId)}/summary`);
	const directory = useWorkspaceResource(section === 'projects' && resource.data ? `/api/megu/projects?teamId=${encodeURIComponent(teamId)}&limit=30&cursor=${encodeURIComponent(cursor)}` : null);
	if (resource.error?.status === 401) return <AuthGate title={c.signedOutTitle} lede={c.signedOutLede} />;
	const { team, capabilities } = resource.data || {};
	return <main className={styles.shell} aria-busy={resource.loading}>
		<nav className="workspace-context" aria-label={c.ux.context}><Link href="/teams" className={styles.back}><ArrowLeft size={15} aria-hidden="true" />{c.backToTeams}</Link>{team?.discordGuild && <Link href={`/teams/server/${encodeURIComponent(team.discordGuild.id)}/teams`}>{team.discordGuild.name}</Link>}{team && <span aria-current="page">{team.name}</span>}</nav>
		{team && <header className={styles.header}><div className={styles.identity}><TeamMark name={team.name} color={team.color} size="large" /><div><h1>{team.name}</h1><p>{team.description || c.peopleHint}</p></div></div>{section === 'projects' && capabilities.canCreateProject && <Link href={`/projects/new?team=${encodeURIComponent(team.id)}`} className="btn btn-primary"><Plus size={16} aria-hidden="true" />{c.createProject}</Link>}</header>}
		{resource.loading && <p role="status">{c.workspace.loading}</p>}
		{resource.error && <div className={styles.error} role="alert"><p>{c.errors[resource.error.code] || c.errors.failed}</p><button type="button" className="btn btn-secondary" onClick={resource.reload}>{c.workspace.retry}</button></div>}
		{team && <div className={styles.layout}><TeamWorkspaceNav teamId={teamId} section={section} goalsEnabled={goalsEnabled} /><section className={styles.content}>
			{section === 'overview' ? <>
				<h2>{c.workspace.overview}</h2><p className={styles.lede}>{c.peopleHint}</p>
				{team.archivedAt && <p className={styles.notice}>{c.archived}</p>}
				{team.discordGuild && <Link className={styles.serverConnection} href={`/teams/server/${encodeURIComponent(team.discordGuild.id)}/teams`}><Server size={18} aria-hidden="true" /><span><small>{c.connectedToDiscord}</small><strong>{team.discordGuild.name}</strong></span><ArrowRight size={16} aria-hidden="true" /></Link>}
				<h3>{c.ux.shortcuts}</h3><div className={styles.headerActions}>
					<Link className="btn btn-secondary" href={`${base}/projects`}>{c.workspace.projects}<ArrowRight size={16} aria-hidden="true" /></Link>
					<Link className="btn btn-secondary" href={`${base}/people`}>{c.workspace.people}</Link>
					{capabilities.canManageJoinLink && <Link className="btn btn-secondary" href={`${base}/requests`}>{c.ux.invitePeople}</Link>}
					{goalsEnabled && <Link className="btn btn-secondary" href={`${base}/goals`}>{c.workspace.goals}</Link>}
					{capabilities.canCreateProject && <Link className="btn btn-primary" href={`/projects/new?team=${encodeURIComponent(team.id)}`}>{c.createProject}</Link>}
					{process.env.NEXT_PUBLIC_MEGU_PROJECT_TEAMS_DISCORD_ENABLED !== '0' && team.discordGuild && capabilities.canEdit && ['owner','admin'].includes(team.role) && <Link className="btn btn-secondary" href={`${base}/settings#discord-roles`}>{c.ux.configureDiscord}</Link>}
				</div>
			</> : <>
				<h2>{c.teamProjects}</h2>
				{directory.loading && <p role="status">{c.workspace.loading}</p>}
				{directory.error && <div className={styles.error} role="alert"><p>{c.errors.failed}</p><button type="button" className="btn btn-secondary" onClick={directory.reload}>{c.workspace.retry}</button></div>}
				{directory.data && <>{directory.data.projects.length ? <div className={styles.projectList}>{directory.data.projects.map(project => <Link key={project.id} href={`/p/${project.code}`} className={styles.projectRow}><div><strong>{project.title}</strong><small>{p.state[project.status]} · {p.topicsCount(project.topicCount)}</small></div><span className={styles.progress}>{project.topicCount ? `${project.progress}%` : c.workspace.noTopics}</span><span className={styles.role}>{p.role[project.role]}</span><ArrowRight size={16} aria-hidden="true" /></Link>)}</div> : <div className={styles.empty}><div><h3>{c.noProjects}</h3><p>{c.ux.noProjectsHint}</p>{capabilities.canCreateProject && <Link className="btn btn-primary" href={`/projects/new?team=${encodeURIComponent(team.id)}`}>{c.createProject}</Link>}</div></div>}
				{(cursor || directory.data.nextCursor) && <nav className={styles.headerActions} aria-label={c.workspace.pagination}>{cursor && <Link className="btn btn-secondary" href={`${base}/projects`}>{c.workspace.firstPage}</Link>}{directory.data.nextCursor && <Link className="btn btn-secondary" href={`${base}/projects?cursor=${encodeURIComponent(directory.data.nextCursor)}`}>{c.workspace.nextPage}</Link>}</nav>}</>}
			</>}
		</section></div>}
	</main>;
}
