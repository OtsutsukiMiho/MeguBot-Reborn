'use client';

import Link from 'next/link';
import { ArrowRight, FolderKanban, Plus, Users } from 'lucide-react';
import { useCopy } from '../../copy';
import { useTeamWorkspace } from './TeamWorkspaceShell';
import ProjectAvatar from '../projects/ProjectAvatar';
import useWorkspaceResource from '../useWorkspaceResource';
import WorkspaceSkeleton from '../WorkspaceSkeleton';
import styles from '../../teams/teams.module.css';

export default function TeamOverview({ teamId, goalsEnabled = false, section = 'overview', cursor = '' }) {
	const { t } = useCopy();
	const c = t.teams;
	const o = c.overviewCopy;
	const p = t.projects;
	const base = `/teams/${encodeURIComponent(teamId)}`;
	const resource = useTeamWorkspace();
	const directory = useWorkspaceResource(section === 'projects' ? `/api/megu/projects?teamId=${encodeURIComponent(teamId)}&limit=30&cursor=${encodeURIComponent(cursor)}` : null);
	const previewProjects = useWorkspaceResource(section === 'overview' ? `/api/megu/projects?teamId=${encodeURIComponent(teamId)}&limit=3` : null);
	const previewGoals = useWorkspaceResource(section === 'overview' && goalsEnabled ? `/api/megu/teams/${encodeURIComponent(teamId)}/goals?limit=3` : null);
	const previewPeople = useWorkspaceResource(section === 'overview' ? `/api/megu/teams/${encodeURIComponent(teamId)}/members?limit=4` : null);
	const { team, capabilities = {} } = resource?.data || {};
	const memberTotal = previewPeople.data?.total ?? previewPeople.data?.members.length ?? 0;
	const visibleMembers = (previewPeople.data?.members || []).slice(0, Math.min(3, memberTotal));
	if (!team) return <WorkspaceSkeleton kind={section === 'overview' ? 'overview' : 'cards'} />;
	return <section aria-busy={section === 'projects' && directory.loading}>
			{section === 'overview' ? <>
				<div className={styles.overviewHeading}><div><h2>{o.workspaceNow}</h2><p className={styles.lede}>{o.workspaceNowHint}</p></div>{capabilities.canCreateProject && <Link className="btn btn-secondary" href={`/projects/new?team=${encodeURIComponent(team.id)}`}><Plus size={16} aria-hidden="true" />{c.createProject}</Link>}</div>
				{team.archivedAt && <p className={styles.notice}>{c.archived}</p>}
					{team.discordGuild && <section className={styles.discordPreview} aria-label={c.connectedToDiscord}><div className={styles.discordIdentity}><ProjectAvatar name={team.discordGuild.name} avatarUrl={team.discordGuild.icon ? `https://cdn.discordapp.com/icons/${encodeURIComponent(team.discordGuild.id)}/${encodeURIComponent(team.discordGuild.icon)}.png?size=96` : undefined} className={styles.discordAvatar} /><div><p>{c.connectedToDiscord}</p><h3>{team.discordGuild.name}</h3></div></div><div className={styles.discordActions}>{process.env.NEXT_PUBLIC_MEGU_PROJECT_TEAMS_DISCORD_ENABLED !== '0' && capabilities.canEdit && ['owner','admin'].includes(team.role) && <Link href={`${base}/settings#discord-roles`}>{c.ux.configureDiscord}</Link>}<Link className="btn btn-primary" href={`/teams/server/${encodeURIComponent(team.discordGuild.id)}/teams`}>{o.openServer}<ArrowRight size={15} aria-hidden="true" /></Link></div></section>}
				<div className={styles.overviewGrid}>
					<section className={styles.peoplePreview} aria-labelledby="team-people-preview"><div className={styles.peoplePreviewHead}><Users size={20} aria-hidden="true" /><h3 id="team-people-preview">{c.workspace.people}</h3>{previewPeople.data && <span>{c.members(memberTotal)}</span>}</div>{previewPeople.loading && <WorkspaceSkeleton compact />}{previewPeople.error && <div className={styles.previewError} role="alert"><p>{c.errors.failed}</p><button type="button" className="btn btn-secondary btn-sm" onClick={previewPeople.reload}>{c.workspace.retry}</button></div>}{previewPeople.data && (visibleMembers.length ? <ul className={styles.peopleList}>{visibleMembers.map(member => <li key={member.userId}><ProjectAvatar name={member.displayName} avatarUrl={member.avatarUrl} className={styles.peopleAvatar} /><span>{member.displayName}</span></li>)}{memberTotal > visibleMembers.length && <li className={styles.peopleOverflow} aria-label={c.members(memberTotal - visibleMembers.length)}>+{memberTotal - visibleMembers.length}</li>}</ul> : <p>{o.noPeopleYet}</p>)}<div className={styles.headerActions}><Link className="btn btn-secondary" href={`${base}/people`}>{o.viewPeople}</Link>{capabilities.canManageJoinLink && <Link className="btn btn-primary" href={`${base}/join-requests`}>{c.ux.invitePeople}</Link>}</div></section>
					<section className={styles.overviewSection} aria-labelledby="team-project-preview"><div className={styles.overviewSectionHead}><h3 id="team-project-preview">{c.workspace.projects}</h3><Link href={`${base}/projects`}>{o.viewAll}<ArrowRight size={16} aria-hidden="true" /></Link></div>
						{previewProjects.loading && <WorkspaceSkeleton compact />}{previewProjects.error && <div className={styles.previewError} role="alert"><p>{c.errors.failed}</p><button type="button" className="btn btn-secondary btn-sm" onClick={previewProjects.reload}>{c.workspace.retry}</button></div>}
						{previewProjects.data && (previewProjects.data.projects.length ? <ul className={styles.previewList}>{previewProjects.data.projects.map(project => <li key={project.id}><Link href={`/p/${project.code}`}><strong>{project.title}</strong><div className={styles.overviewMeta}><span className={`${styles.role} ${styles.overviewStatus} ${styles.projectStatus}`} data-state={project.status}>{p.state[project.status]}</span>{project.topicCount ? <span className={styles.overviewProgressText}>{project.progress}%</span> : <span>{c.workspace.noTopics}</span>}</div>{project.topicCount > 0 && <span className={styles.previewProgressTrack} role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.max(0, Math.min(100, project.progress || 0))} aria-label={c.workspace.progressLabel}><span style={{ width: `${Math.max(0, Math.min(100, project.progress || 0))}%` }} /></span>}<ArrowRight size={15} aria-hidden="true" /></Link></li>)}</ul> : <div className={styles.previewEmpty}><p>{c.noProjects}</p>{capabilities.canCreateProject && <Link href={`/projects/new?team=${encodeURIComponent(team.id)}`}>{c.createProject}<ArrowRight size={15} aria-hidden="true" /></Link>}</div>)}
					</section>
					{goalsEnabled && <section className={styles.overviewSection} aria-labelledby="team-goal-preview"><div className={styles.overviewSectionHead}><h3 id="team-goal-preview">{c.workspace.goals}</h3><Link href={`${base}/goals`}>{o.viewAll}<ArrowRight size={16} aria-hidden="true" /></Link></div>
						{previewGoals.loading && <WorkspaceSkeleton compact label={t.teamGoals.loading} />}{previewGoals.error && <div className={styles.previewError} role="alert"><p>{t.teamGoals.failed}</p><button type="button" className="btn btn-secondary btn-sm" onClick={previewGoals.reload}>{c.workspace.retry}</button></div>}
						{previewGoals.data && (previewGoals.data.goals.length ? <ul className={styles.previewList}>{previewGoals.data.goals.map(goal => <li key={goal.id}><Link href={`${base}/goals/${encodeURIComponent(goal.id)}`}><strong>{goal.access === 'administration' ? t.teamGoals.administration : goal.title}</strong><div className={styles.overviewMeta}><span className={`${styles.role} ${styles.overviewStatus}`} data-state={goal.needsReviewer && !goal.reviewerId ? 'needs-reviewer' : goal.lifecycle}>{goal.needsReviewer && !goal.reviewerId ? t.teamGoals.needsReviewer : t.teamGoals.state[goal.lifecycle]}</span></div><ArrowRight size={15} aria-hidden="true" /></Link></li>)}</ul> : <div className={styles.previewEmpty}><p>{t.teamGoals.empty}</p><Link href={`${base}/goals/new`}>{t.teamGoals.create}<ArrowRight size={15} aria-hidden="true" /></Link></div>)}
					</section>}
				</div>
			</> : <>
				<div className={styles.pageHeading}><div><h2>{c.teamProjects}</h2><p>{c.projectsIntro}</p></div>{capabilities.canCreateProject && <Link className="btn btn-primary" href={`/projects/new?team=${encodeURIComponent(team.id)}`}><Plus size={16} aria-hidden="true" />{c.createProject}</Link>}</div>
				{directory.loading && <WorkspaceSkeleton kind="cards" />}
				{directory.error && <div className={styles.error} role="alert"><p>{c.errors.failed}</p><button type="button" className="btn btn-secondary" onClick={directory.reload}>{c.workspace.retry}</button></div>}
				{directory.data && <>{directory.data.projects.length ? <div className={styles.projectList}>{directory.data.projects.map(project => <Link key={project.id} href={`/p/${project.code}`} className={styles.projectCard}>
					<span className={styles.projectCardHead}><span className={styles.projectCardIcon}><FolderKanban size={22} aria-hidden="true" /></span><span className={styles.projectCardBody}><small>{c.workspace.projectLabel}</small><strong>{project.title}</strong></span><ArrowRight size={18} aria-hidden="true" /></span>
					<span className={styles.projectCardMeta}><span className={styles.role}>{p.state[project.status]}</span><span>{p.topicsCount(project.topicCount)}</span><span>{p.role[project.role]}</span></span>
					<span className={styles.projectCardProgress}><span>{project.topicCount > 0 ? c.workspace.progressLabel : c.workspace.noTopics}</span>{project.topicCount > 0 && <strong>{project.progress}%</strong>}</span>
					{project.topicCount > 0 && <span className={styles.projectProgressTrack} role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.max(0, Math.min(100, project.progress || 0))} aria-label={c.workspace.progressLabel}><span style={{ width: `${Math.max(0, Math.min(100, project.progress || 0))}%` }} /></span>}
				</Link>)}</div> : <div className={styles.empty}><div><h3>{c.noProjects}</h3><p>{c.ux.noProjectsHint}</p>{capabilities.canCreateProject && <Link className="btn btn-primary" href={`/projects/new?team=${encodeURIComponent(team.id)}`}>{c.createProject}</Link>}</div></div>}
				{(cursor || directory.data.nextCursor) && <nav className={styles.collectionFooter} aria-label={c.workspace.pagination}><span>{c.workspace.pagination}</span><div className={styles.headerActions}>{cursor && <Link className="btn btn-secondary" href={`${base}/projects`}>{c.workspace.firstPage}</Link>}{directory.data.nextCursor && <Link className="btn btn-secondary" href={`${base}/projects?cursor=${encodeURIComponent(directory.data.nextCursor)}`}>{c.workspace.nextPage}</Link>}</div></nav>}</>}
			</>}
	</section>;
}
