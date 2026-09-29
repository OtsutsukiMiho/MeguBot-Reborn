'use client';

import Link from 'next/link';
import useCreationRequest from '../useCreationRequest';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, FolderKanban, Plus, Server, Users } from 'lucide-react';
import AuthGate from '../AuthGate';
import CustomSelect from '../CustomSelect';
import MeguMark from '../MeguMark';
import ProjectDirectoryNav from '../projects/ProjectDirectoryNav';
import MainContextLoading from '../MainContextLoading';
import { useCopy } from '../../copy';
import TeamMark from './TeamMark';
import useDraftGuard, { requestDraftNavigation } from '../useDraftGuard';
import styles from '../../teams/teams.module.css';

const COLORS = ['indigo', 'blue', 'cyan', 'emerald', 'amber', 'rose', 'violet'];
const DISCORD_ENABLED = process.env.NEXT_PUBLIC_MEGU_PROJECT_TEAMS_DISCORD_ENABLED !== '0';

export default function TeamDirectory() {
	const { t } = useCopy();
	const c = t.teams;
	const [auth, setAuth] = useState('loading');
	const [actorId, setActorId] = useState(null);
	const [teams, setTeams] = useState([]);
	const [guilds, setGuilds] = useState([]);
	const [workspaceGuilds, setWorkspaceGuilds] = useState([]);
	const [discoveryUnavailable, setDiscoveryUnavailable] = useState(false);
	const [serverFilter, setServerFilter] = useState('');
	const [creating, setCreating] = useState(false);
	const createButton = useRef(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const loadVersion = useRef(0);
	const load = async () => {
		const current = ++loadVersion.current;
		setLoading(true); setError('');
		try {
			const guildTask = DISCORD_ENABLED ? fetch('/api/megu/teams/discord-guilds').then(response => response.ok ? response.json() : null).catch(() => null) : Promise.resolve(null);
			const workspaceTask = DISCORD_ENABLED ? fetch('/api/megu/teams/workspace-guilds').then(async response => ({ unavailable: !response.ok, body: response.ok ? await response.json() : null })).catch(() => ({ unavailable: true, body: null })) : Promise.resolve(null);
			const [meResponse, teamResponse] = await Promise.all([fetch('/api/megu/me'), fetch('/api/megu/teams?includeArchived=true')]);
			const me = await meResponse.json();
			if (current !== loadVersion.current) return;
			if (!me.loggedIn) { setAuth('signed-out'); return; }
			const body = await teamResponse.json();
			if (!teamResponse.ok) throw body;
			setActorId(me.user.id); setAuth('ready'); setTeams(body.teams || []);
			Promise.all([guildTask, workspaceTask]).then(([guild, workspace]) => {
				if (current !== loadVersion.current) return;
				if (guild) setGuilds(guild.guilds || []);
				setDiscoveryUnavailable(Boolean(workspace?.unavailable));
				if (workspace?.body) setWorkspaceGuilds(workspace.body.guilds || []);
			});
		}
		catch (problem) { if (current === loadVersion.current) { setAuth('error'); setError(c.errors[problem?.code] || c.errors.failed); } }
		finally { if (current === loadVersion.current) setLoading(false); }
	};
	useEffect(() => { load(); return () => { loadVersion.current++; }; }, []);
	useEffect(() => { setServerFilter(new URLSearchParams(window.location.search).get('server') || ''); }, []);
	const visibleTeams = serverFilter ? teams.filter(team => team.discordGuild?.id === serverFilter) : teams;
	const groups = useMemo(() => {
		const grouped = new Map();
		for (const guild of [...guilds, ...workspaceGuilds]) {
			if (!serverFilter || guild.id === serverFilter) grouped.set(guild.id, { key: guild.id, guild, teams: [] });
		}
		for (const team of visibleTeams) {
			const key = team.discordGuild?.id || 'independent';
			if (!grouped.has(key)) grouped.set(key, { key, guild: team.discordGuild || null, teams: [] });
			grouped.get(key).teams.push(team);
		}
		return [...grouped.values()].sort((left, right) => left.key === 'independent' ? 1 : right.key === 'independent' ? -1 :
			Number(Boolean(right.teams.length)) - Number(Boolean(left.teams.length)) || left.guild.name.localeCompare(right.guild.name) || left.key.localeCompare(right.key));
	}, [visibleTeams, guilds, workspaceGuilds, serverFilter]);
	if (auth === 'loading') return <main className={styles.shell} aria-busy="true"><MainContextLoading title={c.loadingTeams} description={c.loadingTeamsLede} /></main>;
	if (auth === 'signed-out') return <AuthGate title={c.signedOutTitle} lede={c.signedOutLede} />;
	if (auth === 'error') return <main className={styles.shell}><header className={styles.header}><div><h1>{c.title}</h1><p>{c.lede}</p></div></header><p className={styles.error} role="alert">{error}</p><button type="button" className="btn btn-secondary" disabled={loading} onClick={load}>{c.workspace.retry}</button></main>;
	return <main className={styles.shell} aria-busy={loading}>
		<header className={styles.header}><div><h1>{c.title}</h1><p>{c.lede}</p></div>{!creating && <button ref={createButton} type="button" className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={17} />{c.newTeam}</button>}</header>
		<ProjectDirectoryNav current="teams" />
		{discoveryUnavailable && <p className={styles.lede} role="status">{t.serverWorkspaces.discoveryUnavailable} <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={load}>{t.projects.retry}</button></p>}
		{creating && <CreateTeam c={c} guilds={guilds} key={actorId} actorId={actorId} onCancel={() => { setCreating(false); requestAnimationFrame(()=>createButton.current?.focus()); }} />}
		{error && <p className={styles.error} role="alert">{error}</p>}
		{serverFilter && <div className={styles.notice}><span>{c.filteredByServer(guilds.find(guild => guild.id === serverFilter)?.name || visibleTeams[0]?.discordGuild?.name || c.discordServer)}</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => { setServerFilter(''); window.history.replaceState({}, '', '/teams'); }}>{c.showAllTeams}</button></div>}
		{!loading && !groups.length && !creating ? <section className={styles.empty}><MeguMark size={46} mood="happy" /><div><h2>{serverFilter ? c.noServerTeams : c.emptyTitle}</h2><p>{serverFilter ? c.noServerTeamsHint : c.emptyBody}</p></div><button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={17} />{c.newTeam}</button></section> : groups.map(group => <section className={styles.teamGroup} key={group.key} aria-labelledby={`team-group-${group.key}`}><header><span className={styles.groupIcon}><Server size={16} /></span><div><h2 id={`team-group-${group.key}`}>{group.guild ? <Link href={`/teams/server/${encodeURIComponent(group.guild.id)}/teams`}>{group.guild.name}<ArrowRight size={17} aria-hidden="true" /></Link> : c.independentTeams}</h2><p>{group.guild ? c.connectedGroupHint : c.independentGroupHint}</p></div></header>{group.guild && !group.teams.length && <p className={styles.lede}>{c.noServerTeams}</p>}<div className={styles.teamList}>{group.teams.map(team => <Link href={`/teams/${team.id}`} className={styles.teamCard} key={team.id}><TeamMark name={team.name} color={team.color} /><div><h2>{team.name}</h2><p>{team.description || c.peopleHint}</p><div className={styles.teamMeta}><span><Users size={14} />{c.members(team.memberCount)}</span><span><FolderKanban size={14} />{c.projects(team.projectCount)}</span></div></div><span className={styles.role}>{team.archivedAt ? c.archived : c.role[team.role]}</span><ArrowRight size={17} aria-hidden="true" /></Link>)}</div></section>)}
	</main>;
}

function CreateTeam({ actorId, c, guilds, onCancel }) {
	const [form, setForm] = useState({ name: '', description: '', color: 'indigo', discordGuildId: '' });
	const { busy, frozen, ready, restored, abandon, submit: send, pending: submitting } = useCreationRequest('/api/megu/teams', { actorId });
	const [error, setError] = useState('');
	const dirty = Boolean(form.name || form.description || form.discordGuildId || form.color !== 'indigo');
	const release = useDraftGuard(dirty, busy, abandon);
	const leave = () => { if (abandon()) onCancel(); };
	const cancel = () => { if (!submitting.current && requestDraftNavigation(leave)) leave(); };
	useEffect(() => { if (restored) setForm(restored); }, [restored]);
	const submit = async event => {
		event.preventDefault(); if (submitting.current) return; setError('');
		try {
			const body = await send(form);
			if (!body) return;
			release(); window.location.assign(`/teams/${body.team.id}`);
		}
		catch (problem) { setError(c.errors[problem?.code] || c.errors.failed); }
	};
	return <section className={styles.createPanel} aria-labelledby="create-team-title"><h2 id="create-team-title">{c.createTitle}</h2><p>{c.createHint}</p><form className={styles.form} onSubmit={submit}><label><span>{c.name}</span><input autoFocus disabled={frozen} required maxLength={120} value={form.name} placeholder={c.namePlaceholder} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></label><label><span>{c.description}</span><textarea disabled={frozen} rows={2} maxLength={4000} value={form.description} placeholder={c.descriptionPlaceholder} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} /></label>{DISCORD_ENABLED && guilds.length > 0 && <label className={styles.wide}><span>{c.teamSource}</span><CustomSelect disabled={frozen} value={form.discordGuildId} onChange={discordGuildId => setForm(current => ({ ...current, discordGuildId }))} ariaLabel={c.teamSource} options={[{ value: '', label: c.independentTeam, subtitle: c.independentTeamHint }, ...guilds.map(guild => ({ value: guild.id, label: guild.name, subtitle: c.connectedTeamHint }))]} searchable={guilds.length > 5} /></label>}<fieldset disabled={frozen} className={`${styles.field} ${styles.wide}`}><legend>{c.color}</legend><div className={styles.colorChoices}>{COLORS.map(color => <button key={color} type="button" className={styles.colorChoice} aria-label={color} aria-pressed={form.color === color} onClick={() => setForm(current => ({ ...current, color }))}><TeamMark name="" color={color} /></button>)}</div></fieldset>{restored && <p className={styles.wide} role="status">{c.creationRestored}</p>}{!ready && <p className={styles.wide} role="alert">{c.creationStorageUnavailable}</p>}{error && <p className={`${styles.error} ${styles.wide}`} role="alert">{error}</p>}<div className={`${styles.actions} ${styles.wide}`}><button type="button" className="btn btn-secondary" disabled={busy} onClick={cancel}>{c.cancel}</button><button type="submit" className="btn btn-primary" disabled={busy || !ready}>{busy ? c.creating : (frozen || restored) ? c.workspace.retry : c.create}</button></div></form></section>;
}
