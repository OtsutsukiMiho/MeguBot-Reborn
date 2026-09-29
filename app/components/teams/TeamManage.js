'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Inbox, Link2, Search, Server, Shield, Trash2, UserPlus, Users } from 'lucide-react';
import AuthGate from '../AuthGate';
import CustomSelect from '../CustomSelect';
import ProjectAvatar from '../projects/ProjectAvatar';
import MemberTitleBadges, { useTeamMemberTitles } from './TeamMemberTitles';
import useDraftGuard from '../useDraftGuard';
import { useCopy } from '../../copy';
import TeamMark from './TeamMark';
import TeamMembershipSource from './TeamMembershipSource';
import TeamRoleMapping from './TeamRoleMapping';
import WorkspaceSkeleton from '../WorkspaceSkeleton';
import { useTeamWorkspace } from './TeamWorkspaceShell';
import styles from '../../teams/teams.module.css';

const COLORS = ['indigo', 'blue', 'cyan', 'emerald', 'amber', 'rose', 'violet'];
const SETTINGS_TABS = ['general', 'lifecycle'];
const DISCORD_ENABLED = process.env.NEXT_PUBLIC_MEGU_PROJECT_TEAMS_DISCORD_ENABLED !== '0';

export default function TeamManage({ teamId, section = 'general', goalsEnabled = false }) {
	const router = useRouter();
	const workspace = useTeamWorkspace();
	const { t, lang } = useCopy();
	const c = t.teams;
	const [data, setData] = useState(null);
	const [members, setMembers] = useState([]);
	const [memberMeta, setMemberMeta] = useState({ total: 0, nextOffset: null });
	const [requests, setRequests] = useState({ requests: [], link: null });
	const [notificationPreferences, setNotificationPreferences] = useState(null);
	const [auth, setAuth] = useState('loading');
	const tab = section;
	const tabHref = value => `/teams/${encodeURIComponent(teamId)}/${value === 'general' ? 'settings' : value === 'lifecycle' ? 'settings?section=lifecycle' : value}`;
	const setTab = value => router.push(tabHref(value));
	const [error, setError] = useState('');
	const readError = useCallback(problem => c.errors[problem?.code] || c.errors.failed, [c.errors]);
	const load = useCallback(async () => {
		setError('');
		try {
			const [meResponse, teamResponse, memberResponse] = await Promise.all([
				fetch('/api/megu/me'), fetch(`/api/megu/teams/${encodeURIComponent(teamId)}`),
				['people', 'lifecycle'].includes(tab) ? fetch(`/api/megu/teams/${encodeURIComponent(teamId)}/members?limit=100`) : Promise.resolve(null),
			]);
			const me = await meResponse.json();
			if (!me.loggedIn) { setAuth('signed-out'); return; }
			const teamBody = await teamResponse.json(); const memberBody = memberResponse ? await memberResponse.json() : {};
			if (!teamResponse.ok) throw teamBody; if (memberResponse && !memberResponse.ok) throw memberBody;
			setData(teamBody); setNotificationPreferences(me.notificationPreferences || null); setMembers(memberBody.members || []); setMemberMeta({ total: memberBody.total || 0, nextOffset: memberBody.nextOffset }); setAuth('ready');
			if (tab === 'requests' && teamBody.capabilities.canManageJoinLink) {
				const requestResponse = await fetch(`/api/megu/teams/${encodeURIComponent(teamId)}/join-requests`);
				const requestBody = await requestResponse.json();
				if (!requestResponse.ok) throw requestBody;
				setRequests(requestBody);
			}
		}
		catch (problem) { setError(readError(problem)); setAuth('error'); }
	}, [readError, teamId, tab]);
	const loadMoreMembers = async () => {
		if (memberMeta.nextOffset == null) return;
		try { const response = await fetch(`/api/megu/teams/${encodeURIComponent(teamId)}/members?limit=100&offset=${memberMeta.nextOffset}`); const body = await response.json(); if (!response.ok) throw body; setMembers(current => [...current, ...(body.members || []).filter(member => !current.some(existing => existing.userId === member.userId))]); setMemberMeta({ total: body.total || memberMeta.total, nextOffset: body.nextOffset }); }
		catch (problem) { setError(readError(problem)); }
	};
	useEffect(() => { load(); }, [load]);
	const changed = async () => { await load(); workspace?.reload(); };
	if (auth === 'signed-out') return <AuthGate title={c.signedOutTitle} lede={c.signedOutLede} />;
	if (!data) return error ? <div role="alert" className={styles.error}><p>{error}</p><button type="button" className="btn btn-secondary" onClick={load}>{c.workspace.retry}</button></div> : <WorkspaceSkeleton kind="detail" />;
	const { team, me, capabilities } = data;
	return <section className={`${styles.managePage} ${tab === 'people' ? styles.peopleMode : ''}`}>
		{SETTINGS_TABS.includes(tab) && <div className={styles.pageHeading}><div><h2>{c.settings}</h2><p>{c.settingsLede}</p></div></div>}
		{tab === 'requests' && <div className={styles.pageHeading}><div><h2>{c.workspace.requests}</h2><p>{c.ux.requestsHint}</p></div></div>}
		{error && <p className={styles.error} role="alert">{error}</p>}
		<div>
			{SETTINGS_TABS.includes(tab) && <nav className={`${styles.headerActions} ${styles.settingsNav}`} aria-label={c.settings}>{SETTINGS_TABS.map(value => <Link key={value} href={tabHref(value)} aria-current={tab===value ? 'page' : undefined} className="btn btn-secondary">{c.tabs[value]}</Link>)}</nav>}
			{tab === 'general' && <><General team={team} editable={capabilities.canEdit} capabilities={capabilities} c={c} readError={readError} onChanged={changed} />{DISCORD_ENABLED && team.discordGuild && ['owner', 'admin'].includes(team.role) && <TeamRoleMapping key={`${team.id}:${team.discordGuild.id}`} team={team} readError={readError} />}</>}
			{tab === 'people' && <People team={team} me={me} members={members} memberMeta={memberMeta} onLoadMore={loadMoreMembers} capabilities={capabilities} c={c} lang={lang} readError={readError} onChanged={changed} onOpenRequests={() => setTab('requests')} />}
			{tab === 'requests' && <Requests team={team} me={me} requests={requests} capabilities={capabilities} notificationPreferences={notificationPreferences} c={c} lang={lang} readError={readError} onChanged={changed} />}
			{tab === 'lifecycle' && <Lifecycle data={data} members={members} c={c} readError={readError} onChanged={changed} />}
		</div>
	</section>;
}

function General({ team, editable, capabilities, c, readError, onChanged }) {
	const initial = useMemo(() => ({ name: team.name, description: team.description || '', color: team.color }), [team]);
	const [form, setForm] = useState(initial);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [saved, setSaved] = useState(initial);
	const [savedNotice, setSavedNotice] = useState(false);
	const dirty = JSON.stringify(form) !== JSON.stringify(saved);
	useDraftGuard(dirty, busy);
	// Refresh clean forms only; a failed save/refresh must not replace an edit.
	useEffect(() => { if (!dirty) { setForm(initial); setSaved(initial); } }, [initial]);
	const submit = async event => {
		event.preventDefault(); if (busy) return; setBusy(true); setError(''); setSavedNotice(false);
		try { const response = await fetch(`/api/megu/teams/${team.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, expectedRevision: team.revision }) }); const body = await response.json(); if (!response.ok) throw body; setSaved(form); setSavedNotice(true); await onChanged(); }
		catch (problem) { setError(readError(problem)); }
		finally { setBusy(false); }
	};
	return <section><h2>{c.profileTitle}</h2><p className={styles.lede}>{c.createHint}</p><form className={styles.form} onSubmit={submit}><label><span>{c.name}</span><input required disabled={!editable || busy} maxLength={120} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></label><label><span>{c.description}</span><textarea disabled={!editable || busy} rows={3} maxLength={4000} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} /></label><fieldset disabled={!editable || busy} className={`${styles.field} ${styles.wide}`}><legend>{c.color}</legend><div className={styles.colorChoices}>{COLORS.map(color => <button key={color} type="button" className={styles.colorChoice} aria-label={color} aria-pressed={form.color === color} onClick={() => setForm(current => ({ ...current, color }))}><TeamMark name="" color={color} /></button>)}</div></fieldset>{error && <p className={`${styles.error} ${styles.wide}`} role="alert">{error}</p>}{editable && <div className={`${styles.actions} ${styles.wide}`}><button type="submit" className="btn btn-primary" disabled={busy || !dirty}>{busy ? c.saving : c.save}</button></div>}</form>{savedNotice && !dirty && !error && <p role="status">{c.ux.saved}</p>}{DISCORD_ENABLED && <DiscordConnection team={team} capabilities={capabilities} c={c} readError={readError} onChanged={onChanged} />}</section>;
}

function People({ team, me, members, memberMeta, onLoadMore, capabilities, c, lang, readError, onChanged, onOpenRequests }) {
	const { t } = useCopy();
	const [query, setQuery] = useState('');
	const [searchResults, setSearchResults] = useState(null);
	const [searchMeta, setSearchMeta] = useState({ total: 0, nextOffset: null });
	const [searching, setSearching] = useState(false);
	const [error, setError] = useState('');
	const [pendingRemoval, setPendingRemoval] = useState(null);
	const [removing, setRemoving] = useState(false);
	const normalizedQuery = query.trim();
	const visible = searchResults || members;
	const titles = useTeamMemberTitles(team.id, visible, Boolean(DISCORD_ENABLED && team.discordGuild && !team.archivedAt));
	useEffect(() => {
		if (!normalizedQuery) { setSearchResults(null); setSearchMeta({ total: 0, nextOffset: null }); setSearching(false); return undefined; }
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			setSearching(true); setError('');
			try {
				const response = await fetch(`/api/megu/teams/${team.id}/members?limit=100&q=${encodeURIComponent(normalizedQuery)}`, { signal: controller.signal });
				const body = await response.json(); if (!response.ok) throw body;
				setSearchResults(body.members || []); setSearchMeta({ total: body.total || 0, nextOffset: body.nextOffset });
			}
			catch (problem) { if (problem?.name !== 'AbortError') setError(readError(problem)); }
			finally { if (!controller.signal.aborted) setSearching(false); }
		}, 180);
		return () => { clearTimeout(timer); controller.abort(); };
	}, [normalizedQuery, readError, team.id, team.revision]);
	const loadMoreSearch = async () => {
		if (searchMeta.nextOffset == null) return;
		setSearching(true); setError('');
		try { const response = await fetch(`/api/megu/teams/${team.id}/members?limit=100&offset=${searchMeta.nextOffset}&q=${encodeURIComponent(normalizedQuery)}`); const body = await response.json(); if (!response.ok) throw body; setSearchResults(current => [...(current || []), ...(body.members || [])]); setSearchMeta({ total: body.total || searchMeta.total, nextOffset: body.nextOffset }); }
		catch (problem) { setError(readError(problem)); }
		finally { setSearching(false); }
	};
	const mutate = async (member, role) => {
		setError('');
		try { const response = await fetch(`/api/megu/teams/${team.id}/members/${member.userId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, expectedRevision: team.revision }) }); const body = await response.json(); if (!response.ok) throw body; setSearchResults(current => current?.map(person => person.userId === member.userId ? { ...person, role } : person)); await onChanged(); }
		catch (problem) { setError(readError(problem)); }
	};
	const remove = async member => {
		setError(''); setRemoving(true);
		try { const response = await fetch(`/api/megu/teams/${team.id}/members/${member.userId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: team.revision }) }); const body = await response.json(); if (!response.ok) throw body; setPendingRemoval(null); setSearchResults(current => current?.filter(person => person.userId !== member.userId)); if (member.userId === me.userId) window.location.assign('/teams'); else await onChanged(); }
		catch (problem) { setError(readError(problem)); setRemoving(false); }
	};
return <section><div className={styles.pageHeading}><h2>{c.peopleTitle}</h2>{capabilities.canManageJoinLink && <button type="button" className="btn btn-primary" onClick={onOpenRequests}><UserPlus size={16} aria-hidden="true" />{c.ux.invitePeople}</button>}</div><details className={styles.privacyNote}><summary>{c.overviewCopy.membershipHelp}</summary><p>{c.peopleHint}</p>{DISCORD_ENABLED && team.discordGuild && !team.archivedAt && <p>{t.serverTitles.badgesHint} <button type="button" className="btn btn-secondary btn-sm" disabled={titles.loading} onClick={titles.reload}>{t.serverTitles.refreshBadges}</button></p>}</details>{titles.loading && <p className={styles.lede} role="status">{t.serverTitles.badgesLoading}</p>}{titles.unavailable && <p className={styles.lede} role="status">{t.serverTitles.badgesUnavailable} <button type="button" className="btn btn-secondary btn-sm" disabled={titles.loading} onClick={titles.reload}>{t.projects.retry}</button></p>}<div className={styles.memberTools}><label className={styles.search}><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={c.searchMembers} aria-label={c.searchMembers} /></label><span className={styles.memberCount}>{c.members(normalizedQuery ? searchMeta.total : (memberMeta.total || members.length))}</span></div>{error && <p className={styles.error} role="alert">{error}</p>}{pendingRemoval && <div className={styles.confirmation} role="alertdialog" aria-labelledby="team-remove-title" aria-describedby="team-remove-impact"><div><strong id="team-remove-title">{pendingRemoval.userId === me.userId ? c.leaveConfirmTitle : c.removeConfirmTitle(pendingRemoval.displayName)}</strong><p id="team-remove-impact">{c.removeConfirmImpact(pendingRemoval.removalImpact?.projectCount || 0, pendingRemoval.removalImpact?.assignmentCount || 0)}</p></div><div className={styles.confirmationActions}><button type="button" className="btn btn-secondary btn-sm" disabled={removing} onClick={() => setPendingRemoval(null)}>{c.keepMember}</button><button type="button" className="btn btn-danger btn-sm" disabled={removing} onClick={() => remove(pendingRemoval)}>{pendingRemoval.userId === me.userId ? c.confirmLeaveTeam : c.confirmRemoveMember}</button></div></div>}<div className={styles.members} aria-busy={searching}>{visible.map(member => { const owner = member.role === 'owner'; const canChange = capabilities.canManageAdmins && !owner; const canRemove = !owner && (member.userId === me.userId || (capabilities.canManageMembers && !(me.role === 'admin' && member.role === 'admin'))); return <div className={styles.member} key={member.userId}><ProjectAvatar name={member.displayName} avatarUrl={member.avatarUrl} className={styles.avatar} /><div className={styles.memberIdentity}><strong>{member.displayName}</strong><small>{c.memberSince} {new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'medium' }).format(new Date(member.joinedAt))}</small><MemberTitleBadges titles={titles.byUser[member.userId]} /><TeamMembershipSource team={team} member={member} c={c} readError={readError} onChanged={onChanged} /></div>{canChange ? <CustomSelect size="compact" searchable={false} value={member.role} onChange={role => mutate(member, role)} ariaLabel={`${member.displayName} ${c.requestRole}`} options={['member', 'admin'].map(role => ({ value: role, label: c.role[role] }))} /> : <span className={styles.role}>{c.role[member.role]}</span>}{canRemove && <button type="button" className={styles.iconButton} onClick={() => { setError(''); setRemoving(false); setPendingRemoval(member); }} aria-label={member.userId === me.userId ? c.leaveTeam : `${c.removeMember} ${member.displayName}`}><Trash2 size={16} /></button>}</div>; })}{normalizedQuery && !searching && visible.length === 0 && <p className={styles.lede}>{c.noSearchResults}</p>}</div>{((normalizedQuery && searchMeta.nextOffset != null) || (!normalizedQuery && memberMeta.nextOffset != null)) && <div className={styles.actions} style={{ marginTop: '1rem' }}><button type="button" className="btn btn-secondary" disabled={searching} onClick={normalizedQuery ? loadMoreSearch : onLoadMore}>{c.loadMore}</button></div>}{team.discordGuild && capabilities.canBrowseDiscordMembers && <DiscordRoster team={team} c={c} readError={readError} onChanged={onChanged} onOpenRequests={onOpenRequests} />}</section>;
}

function DiscordConnection({ team, capabilities, c, readError, onChanged }) {
	const [guilds, setGuilds] = useState([]);
	const [guildId, setGuildId] = useState(team.discordGuild?.id || '');
	const [loading, setLoading] = useState(Boolean(capabilities.canConnectDiscord));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	useEffect(() => {
		if (!capabilities.canConnectDiscord) return undefined;
		const controller = new AbortController();
		fetch('/api/megu/teams/discord-guilds', { signal: controller.signal })
			.then(async response => { const body = await response.json(); if (!response.ok) throw body; setGuilds(body.guilds || []); })
			.catch(problem => { if (problem?.name !== 'AbortError') setError(readError(problem)); })
			.finally(() => { if (!controller.signal.aborted) setLoading(false); });
		return () => controller.abort();
	}, [capabilities.canConnectDiscord, readError]);
	const changeConnection = async action => {
		setBusy(true); setError('');
		try {
			const response = await fetch(`/api/megu/teams/${team.id}/discord-guild`, {
				method: action === 'disconnect' ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(action === 'disconnect' ? { expectedRevision: team.revision } : { guildId, expectedRevision: team.revision }),
			});
			const body = await response.json(); if (!response.ok) throw body;
			await onChanged();
		}
		catch (problem) { setError(readError(problem)); }
		finally { setBusy(false); }
	};
	return <section className={styles.section}><h2>{c.discordConnectionTitle}</h2><p className={styles.lede}>{c.discordConnectionHint}</p>{team.discordGuild && <div className={styles.connectedServer}><Server size={19} /><div><strong>{team.discordGuild.name}</strong><small>{c.discordConnectionPreservesAccess}</small></div></div>}{capabilities.canConnectDiscord && <div className={styles.connectionControls}><CustomSelect value={guildId} onChange={setGuildId} ariaLabel={c.discordServer} disabled={loading || busy} searchable={guilds.length > 5} placeholder={loading ? c.loadingDiscordServers : c.chooseDiscordServer} options={guilds.map(guild => ({ value: guild.id, label: guild.name, subtitle: guild.owner ? c.discordOwner : c.discordManager }))} /><button type="button" className="btn btn-primary" disabled={!guildId || busy || loading} onClick={() => changeConnection('connect')}>{team.discordGuild ? c.changeDiscordServer : c.connectDiscordServer}</button>{team.discordGuild && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => changeConnection('disconnect')}>{c.disconnectDiscordServer}</button>}</div>}{!capabilities.canConnectDiscord && !team.discordGuild && <p className={styles.lede}>{c.discordConnectionOwnerOnly}</p>}{error && <p className={styles.error} role="alert">{error}</p>}</section>;
}

function DiscordRoster({ team, c, readError, onChanged, onOpenRequests }) {
	const [query, setQuery] = useState('');
	const [roleId, setRoleId] = useState('');
	const [roles, setRoles] = useState([]);
	const [candidates, setCandidates] = useState([]);
	const [nextOffset, setNextOffset] = useState(null);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState('');
	const [error, setError] = useState('');
	const load = useCallback(async ({ offset = 0, append = false } = {}) => {
		setLoading(true); setError('');
		try {
			const params = new URLSearchParams({ limit: '30', offset: String(offset) });
			if (query.trim()) params.set('q', query.trim());
			if (roleId) params.set('roleId', roleId);
			const response = await fetch(`/api/megu/teams/${team.id}/discord-candidates?${params}`);
			const body = await response.json(); if (!response.ok) throw body;
			setRoles(body.roles || []); setTotal(Number(body.total || 0)); setNextOffset(body.nextOffset ?? null);
			setCandidates(current => append ? [...current, ...(body.candidates || []).filter(candidate => !current.some(existing => existing.discordUserId === candidate.discordUserId))] : body.candidates || []);
		}
		catch (problem) { setError(readError(problem)); if (!append) setCandidates([]); }
		finally { setLoading(false); }
	}, [query, readError, roleId, team.id]);
	useEffect(() => { const timer = setTimeout(() => load(), 180); return () => clearTimeout(timer); }, [load]);
	const approve = async candidate => {
		setBusy(candidate.requestId); setError('');
		try {
			const response = await fetch(`/api/megu/teams/${team.id}/join-requests/${candidate.requestId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve', role: 'member' }) });
			const body = await response.json(); if (!response.ok) throw body;
			await Promise.all([load(), onChanged()]);
		}
		catch (problem) { setError(readError(problem)); }
		finally { setBusy(''); }
	};
	return <section className={styles.section}><div className={styles.discordRosterHead}><div><h2>{c.addFromDiscord}</h2><p className={styles.lede}>{c.addFromDiscordHint(team.discordGuild.name)}</p></div><button type="button" className="btn btn-secondary btn-sm" onClick={onOpenRequests}><Link2 size={15} />{c.openJoinRequests}</button></div><div className={styles.discordRosterTools}><label className={styles.search}><Search size={16} /><input maxLength={120} value={query} onChange={event => setQuery(event.target.value)} placeholder={c.searchDiscordMembers} aria-label={c.searchDiscordMembers} /></label><CustomSelect value={roleId} onChange={setRoleId} ariaLabel={c.filterDiscordRole} searchable={roles.length > 8} options={[{ value: '', label: c.allDiscordRoles }, ...roles.map(role => ({ value: role.id, label: role.name, subtitle: c.discordRole }))]} /></div>{error && <p className={styles.error} role="alert">{error}</p>}<div className={styles.discordCandidates} aria-busy={loading}>{candidates.map(candidate => <div className={styles.discordCandidate} key={candidate.discordUserId}><ProjectAvatar name={candidate.displayName} avatarUrl={candidate.avatarUrl} className={styles.avatar} /><div className={styles.memberIdentity}><strong>{candidate.displayName}</strong><small>{candidate.teamRole ? c.alreadyTeamMember : candidate.requestId ? c.waitingApproval : candidate.linkedAccount ? c.needsJoinRequest : c.needsMeguAccount}</small></div>{candidate.teamRole ? <span className={styles.role}>{c.role[candidate.teamRole]}</span> : candidate.requestId && candidate.restoreRequired ? <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenRequests}>{c.reviewMemberRestore}</button> : candidate.requestId ? <button type="button" className="btn btn-primary btn-sm" disabled={busy === candidate.requestId} onClick={() => approve(candidate)}><UserPlus size={15} />{c.approveAsMember}</button> : <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenRequests}>{c.shareJoinLink}</button>}</div>)}</div>{!loading && !candidates.length && !error && <p className={styles.lede}>{c.noDiscordCandidates}</p>}<div className={styles.discordRosterFooter}><span>{c.discordCandidatesCount(candidates.length, total)}</span>{nextOffset != null && <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={() => load({ offset: nextOffset, append: true })}>{c.loadMore}</button>}</div></section>;
}

function Requests({ team, me, requests, capabilities, notificationPreferences, c, lang, readError, onChanged }) {
	const [link, setLink] = useState('');
	const [copied, setCopied] = useState(false);
	const [notice, setNotice] = useState('');
	const [busy, setBusy] = useState('');
	const [error, setError] = useState('');
	const [roles, setRoles] = useState({});
	const [restores, setRestores] = useState({});
	useEffect(() => { setRestores({}); }, [requests.requests]);
	const linkAction = async action => {
		if (busy) return; setBusy(action); setError(''); setNotice(''); setCopied(false);
		try { const response = await fetch(`/api/megu/teams/${team.id}/join-link`, { method: action === 'revoke' ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const body = await response.json(); if (!response.ok) throw body; if (body.token) setLink(`${window.location.origin}/teams/join/${body.token}`); else setLink(''); setNotice(action === 'revoke' ? c.ux.linkDisabled : c.ux.inviteReady); await onChanged(); }
		catch (problem) { setError(readError(problem)); }
		finally { setBusy(''); }
	};
	const review = async (request, action) => {
		setBusy(request.id); setError('');
		try { const response = await fetch(`/api/megu/teams/${team.id}/join-requests/${request.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, role: roles[request.id] || 'member', confirmRestore: action === 'approve' && restores[request.id] === true, expectedRevision: requests.teamRevision }) }); const body = await response.json(); if (!response.ok) throw body; setRestores({}); await onChanged(); }
		catch (problem) { setError(readError(problem)); }
		finally { setBusy(''); }
	};
	if (!capabilities.canManageJoinLink) return <section><h2>{c.requestsTitle}</h2><p className={styles.lede}>{c.peopleHint}</p></section>;
	return <div className={styles.requestWorkspace}><section className={styles.requestQueue}>
		<div className={styles.requestQueueHead}><Inbox size={18} aria-hidden="true" /><h3>{c.requestsTitle}</h3><span className={styles.role}>{requests.requests.length}</span></div>
		<div className={styles.section} id="join-requests">{requests.requests.length ? requests.requests.map(request => <div className={`${styles.request} ${request.restoreRequired ? styles.restorationRequest : ''}`} key={request.id}><ProjectAvatar name={request.displayName} avatarUrl={request.avatarUrl} className={styles.avatar} /><div className={styles.memberIdentity}><strong>{request.displayName}</strong><small>{new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'medium' }).format(new Date(request.requestedAt))}</small></div><CustomSelect size="compact" searchable={false} disabled={me.role === 'admin' || Boolean(busy)} value={roles[request.id] || 'member'} onChange={role => setRoles(current => ({ ...current, [request.id]: role }))} ariaLabel={`${request.displayName} ${c.requestRole}`} options={(me.role === 'owner' ? ['member', 'admin'] : ['member']).map(role => ({ value: role, label: c.role[role] }))} />{request.restoreRequired && <label className={styles.restoreConsent}><input type="checkbox" checked={restores[request.id] === true} disabled={Boolean(busy)} onChange={event => setRestores(current => ({ ...current, [request.id]: event.target.checked }))} /><span>{c.memberRestoreConsent}</span></label>}<div className={styles.requestActions}><button type="button" className="btn btn-primary btn-sm" disabled={Boolean(busy) || (request.restoreRequired && !restores[request.id])} onClick={() => review(request, 'approve')}>{request.restoreRequired ? c.restoreMember : c.approve}</button><button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => review(request, 'reject')}>{c.decline}</button></div></div>) : <p className={styles.lede}>{c.noRequests}</p>}</div>
	</section><section className={styles.invitePanel}>
		<h2>{c.ux.invitePeople}</h2><p className={styles.lede}>{c.ux.inviteHint}</p><p className={styles.lede}>{c.joinHint}</p>
		<p className={styles.notificationPreference}><Shield size={16} />{c.joinNotificationPreference(c.notificationMode[notificationPreferences?.mode || 'off'])} <Link href="/account">{c.changeNotificationPreference}</Link></p>
		<div className={styles.headerActions} style={{ marginTop: '1rem' }}><button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => linkAction('create')}>{busy === 'create' ? c.saving : requests.link || link ? c.ux.replaceLink : c.createJoinLink}</button>{(requests.link || link) && <button type="button" className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => linkAction('revoke')}>{busy === 'revoke' ? c.saving : c.revokeJoinLink}</button>}</div>
		{(requests.link || link) && <p className={styles.notice}>{c.joinActive}</p>}{link && <div className={styles.joinLink}><input readOnly value={link} aria-label={c.joinTitle} /><button type="button" className="btn btn-secondary" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setError(''); } catch { setCopied(false); setError(c.ux.copyFailed); } }}>{copied ? c.copied : c.copyLink}</button></div>}{error && <p className={styles.error} role="alert">{error}</p>}
		<p role="status" aria-live="polite">{notice || (copied ? c.copied : busy ? c.saving : '')}</p>
	</section></div>;
}

function Lifecycle({ data, members, c, readError, onChanged }) {
	const { team, me, ownershipTransfer: transfer, capabilities } = data;
	const [proposedOwnerId, setProposedOwnerId] = useState('');
	const [busy, setBusy] = useState('');
	const [error, setError] = useState('');
	const [confirmation, setConfirmation] = useState(null);
	const [notice, setNotice] = useState('');
	const action = async (kind, reviewed = null) => {
		if (busy) return;
		setBusy(kind); setError(''); setNotice('');
		try {
			let path = `/api/megu/teams/${team.id}`; let method = 'POST'; let body;
			const expectedRevision = reviewed?.revision ?? team.revision;
			if (kind === 'propose') { path += '/ownership-transfer'; body = JSON.stringify({ proposedOwnerId: reviewed?.ownerId ?? proposedOwnerId, expectedRevision }); }
			if (kind === 'accept') path += `/ownership-transfer/${reviewed?.transferId ?? transfer.id}`;
			if (kind === 'cancel') { path += `/ownership-transfer/${transfer.id}`; method = 'DELETE'; }
			if (kind === 'archive' || kind === 'restore') { path += `/${kind}`; body = JSON.stringify({ expectedRevision }); }
			const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body });
			const responseBody = await response.json(); if (!response.ok) throw responseBody;
			setConfirmation(null); setNotice(c.ux.lifecycleSaved); await onChanged();
		} catch (problem) { setError(readError(problem)); }
		finally { setBusy(''); }
	};
	const candidates = members.filter(member => member.userId !== me.userId);
	const review = kind => { setError(''); setNotice(''); setConfirmation({kind, revision:team.revision, ownerId:proposedOwnerId, ownerName:candidates.find(member=>member.userId===proposedOwnerId)?.displayName, transferId:transfer?.id}); };
	const fromName = members.find(member=>member.role==='owner')?.displayName || c.role.owner;
	return <section><h2>{c.ownershipTitle}</h2><p className={styles.lede}>{c.ownershipHint}</p>
		{transfer ? <div className={styles.section}><p>{c.transferPending(transfer.proposedOwnerName || c.role.member)}</p><p>{c.ux.transferSummary(fromName,transfer.proposedOwnerName || c.role.member,team.name)}</p><div className={styles.headerActions}>
			{transfer.proposedOwnerId === me.userId && <button type="button" className="btn btn-primary" disabled={Boolean(busy) || Boolean(confirmation)} onClick={() => review('accept')}>{c.acceptTransfer}</button>}
			{me.role === 'owner' && <button type="button" className="btn btn-secondary" disabled={Boolean(busy) || Boolean(confirmation)} onClick={() => action('cancel')}>{c.cancelTransfer}</button>}
		</div></div> : capabilities.canTransferOwnership && candidates.length ? <div className={styles.section}><label className={styles.field}><span>{c.newOwner}</span><CustomSelect type="member" ariaLabel={c.newOwner} value={proposedOwnerId} disabled={Boolean(busy) || Boolean(confirmation)} onChange={setProposedOwnerId} options={candidates.map(member => ({ value: member.userId, label: member.displayName, subtitle: c.role[member.role], avatar: member.avatarUrl }))} /></label><button style={{ marginTop: '.8rem' }} type="button" className="btn btn-secondary" disabled={!proposedOwnerId || Boolean(busy) || Boolean(confirmation)} onClick={() => review('propose')}>{c.proposeTransfer}</button></div> : null}
		{error && <p className={styles.error} role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
		{(capabilities.canArchive || capabilities.canRestore) && <div className={styles.dangerZone}><h2>{team.archivedAt ? c.restore : c.archiveTitle}</h2><p>{c.archiveHint}</p><button type="button" className={team.archivedAt ? 'btn btn-primary' : 'btn btn-danger'} disabled={Boolean(busy) || Boolean(confirmation)} onClick={() => team.archivedAt ? action('restore') : review('archive')}><Archive size={16} aria-hidden="true" />{team.archivedAt ? c.restore : c.archive}</button></div>}
		{confirmation && <div className={styles.confirmation} role="group" aria-labelledby="team-action-review"><div><h3 id="team-action-review">{confirmation.kind==='archive' ? c.ux.archiveConfirm : c.ux.reviewTransfer}</h3><p>{confirmation.kind==='archive' ? c.archiveHint : confirmation.kind==='accept' ? c.ux.acceptSummary(team.name) : c.ux.transferSummary(fromName,confirmation.ownerName || c.role.member,team.name)}</p>{confirmation.kind==='propose' && <p>{c.ownershipHint}</p>}</div><div className={styles.confirmationActions}><button type="button" className="btn btn-secondary" disabled={Boolean(busy)} onClick={()=>setConfirmation(null)}>{c.ux.keepEditing}</button><button type="button" className={confirmation.kind==='archive' ? 'btn btn-danger' : 'btn btn-primary'} disabled={Boolean(busy)} onClick={()=>action(confirmation.kind,confirmation)}>{busy ? c.saving : c.ux.confirmAction}</button></div></div>}
	</section>;
}
