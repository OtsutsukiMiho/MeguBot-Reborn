'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useCopy } from '../../copy';
import AuthGate from '../AuthGate';
import CustomSelect from '../CustomSelect';
import useWorkspaceResource from '../useWorkspaceResource';
import TeamMark from './TeamMark';
import ProjectAvatar from '../projects/ProjectAvatar';
import { guildIconUrl } from '../../lib/discord-guild-icon';
import styles from './serverWorkspace.module.css';

export default function ServerTeamWorkspace({ guildId, section = 'teams', offset = 0 }) {
	const { t } = useCopy();
	const c = t.serverWorkspaces;
	const router = useRouter();
	const root = `/teams/server/${encodeURIComponent(guildId)}`;
	const resource = useWorkspaceResource(`/api/megu/teams/discord-guilds/${encodeURIComponent(guildId)}/workspace/${section}?limit=30&offset=${offset}`);
	const discovery = useWorkspaceResource('/api/megu/teams/workspace-guilds');
	useEffect(() => {
		if (resource.data?.guild.name) document.title = `${resource.data.guild.name} · ${c.title} · Megu`;
	}, [resource.data, c.title]);
	const select = value => router.push(`${root}/${value}`);
	if (resource.error?.status === 401) return <AuthGate title={t.teams.signedOutTitle} lede={t.teams.signedOutLede} />;
	if (!resource.data) return <section className={styles.shell}><Link className={styles.back} href="/teams"><ArrowLeft size={16} />{c.back}</Link><h1>{c.title}</h1>{resource.loading ? <p role="status">{t.common.loading}</p> : <><p role="alert">{t.teams.serverWorkspaceUnavailable}</p><button className="btn btn-secondary" onClick={resource.reload}>{t.projects.retry}</button></>}</section>;
	const { guild, teams, projects } = resource.data;
	const guildOptions = [guild, ...(discovery.data?.guilds || []).filter(item => item.id !== guildId)].map(item => ({ value: item.id, label: item.name || c.title, avatar: guildIconUrl(item) }));
	const options = [{ value: 'teams', label: t.teams.title }, { value: 'projects', label: t.projects.title }, ...(resource.data.canManageTitles ? [{ value: 'titles', label: t.serverTitles.title }] : [])];
	return <section className={styles.shell}>
		<Link className={styles.back} href="/teams"><ArrowLeft size={16} />{c.back}</Link>
		<header className={styles.header}><ProjectAvatar name={guild.name || c.title} avatarUrl={guildIconUrl(guild)} className={styles.serverIcon} /><div className={styles.identity}><h1>{guild.name || c.title}</h1><p>{c.hint}</p></div><div className={styles.serverSwitcher}><CustomSelect type="member" ariaLabel={c.switchServer} value={guildId} options={guildOptions} disabled={discovery.loading} onChange={id => router.push(`/teams/server/${encodeURIComponent(id)}/${section}`)} /></div></header>
		{discovery.error && <p className={styles.muted} role="status">{c.switchUnavailable} <button type="button" className="btn btn-secondary btn-sm" onClick={discovery.reload}>{t.projects.retry}</button></p>}
		<div className={styles.layout}>
			<nav className={styles.navigation} aria-label={c.section}>{options.map(option => <Link key={option.value} href={`${root}/${option.value}`} aria-current={section === option.value ? 'page' : undefined}>{option.label}</Link>)}</nav>
			<div className={styles.mobileNavigation}><CustomSelect ariaLabel={c.section} options={options} value={section} onChange={select} searchable={false} /></div>
			<section className={styles.content} aria-labelledby="server-team-section"><h2 id="server-team-section">{section === 'teams' ? c.yourTeams : c.yourProjects}</h2><p className={styles.muted}>{c.privateHint}</p>
				{section === 'teams' && resource.data.canManageTitles && <Link className="btn btn-primary" href={`${root}/create-from-roles`}>{t.roleTeamCreation.title}</Link>}
				{section === 'teams' && resource.data.canManageTitles && <Link className="btn btn-secondary" href={`${root}/role-mappings`}>{t.teams.ux.configureDiscord}</Link>}
				<div className={styles.rows}>{section === 'teams' ? teams.length ? teams.map(team => <Link className={styles.row} href={`/teams/${team.id}`} key={team.id}><TeamMark name={team.name} color={team.color} /><div className={styles.identity}><strong>{team.name}</strong><small>{t.teams.role[team.role]} · {t.teams.projects(team.projectCount)}</small></div><ArrowRight size={17} aria-hidden="true" /></Link>) : <p>{t.teams.noServerTeams}</p> : projects.length ? projects.map(project => <Link className={styles.row} href={`/p/${project.code}`} key={project.id}><TeamMark name={project.team.name} color={project.team.color} /><div className={styles.identity}><strong>{project.title}</strong><small>{project.team.name} · {t.projects.state[project.status]}</small></div><ArrowRight size={17} aria-hidden="true" /></Link>) : <p>{t.teams.noProjects}</p>}</div>
				{(offset > 0 || resource.data.nextOffset != null) && <nav className={styles.controls} aria-label={c.pagination}>
					{offset > 0 && <Link className="btn btn-secondary" href={`${root}/${section}?offset=${Math.max(0, offset - 30)}`}>{c.previous}</Link>}
					<span className={styles.muted}>{c.page(Math.floor(offset / 30) + 1)}</span>
					{resource.data.nextOffset != null && <Link className="btn btn-secondary" href={`${root}/${section}?offset=${resource.data.nextOffset}`}>{c.next}</Link>}
				</nav>}
			</section>
		</div>
	</section>;
}
