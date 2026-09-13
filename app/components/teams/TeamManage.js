'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Archive, Link2, Search, Settings2, Shield, Trash2, Users } from 'lucide-react';
import AuthGate from '../AuthGate';
import CustomSelect from '../CustomSelect';
import ProjectAvatar from '../projects/ProjectAvatar';
import { useCopy } from '../../copy';
import TeamMark from './TeamMark';
import styles from '../../teams/teams.module.css';

const COLORS = ['indigo', 'blue', 'cyan', 'emerald', 'amber', 'rose', 'violet'];
const TABS = ['general', 'people', 'requests', 'lifecycle'];
const ICONS = [Settings2, Users, Link2, Shield];

export default function TeamManage({ teamId }) {
	const { t, lang } = useCopy();
	const c = t.teams;
	const [data, setData] = useState(null);
	const [members, setMembers] = useState([]);
	const [memberMeta, setMemberMeta] = useState({ total: 0, nextOffset: null });
	const [requests, setRequests] = useState({ requests: [], link: null });
	const [auth, setAuth] = useState('loading');
	const [tab, setTab] = useState('general');
	const [error, setError] = useState('');
	const readError = useCallback(problem => c.errors[problem?.code] || c.errors.failed, [c.errors]);
	const load = useCallback(async () => {
		setError('');
		try {
			const [meResponse, teamResponse, memberResponse] = await Promise.all([
				fetch('/api/megu/me'), fetch(`/api/megu/teams/${encodeURIComponent(teamId)}`), fetch(`/api/megu/teams/${encodeURIComponent(teamId)}/members?limit=100`),
			]);
			const me = await meResponse.json();
			if (!me.loggedIn) { setAuth('signed-out'); return; }
			const teamBody = await teamResponse.json(); const memberBody = await memberResponse.json();
			if (!teamResponse.ok) throw teamBody; if (!memberResponse.ok) throw memberBody;
			setData(teamBody); setMembers(memberBody.members || []); setMemberMeta({ total: memberBody.total || 0, nextOffset: memberBody.nextOffset }); setAuth('ready');
			if (teamBody.capabilities.canManageJoinLink) {
				const requestResponse = await fetch(`/api/megu/teams/${encodeURIComponent(teamId)}/join-requests`);
				const requestBody = await requestResponse.json();
				if (requestResponse.ok) setRequests(requestBody);
			}
		}
		catch (problem) { setError(readError(problem)); setAuth('error'); }
	}, [readError, teamId]);
	const loadMoreMembers = async () => {
		if (memberMeta.nextOffset == null) return;
		try { const response = await fetch(`/api/megu/teams/${encodeURIComponent(teamId)}/members?limit=100&offset=${memberMeta.nextOffset}`); const body = await response.json(); if (!response.ok) throw body; setMembers(current => [...current, ...(body.members || []).filter(member => !current.some(existing => existing.userId === member.userId))]); setMemberMeta({ total: body.total || memberMeta.total, nextOffset: body.nextOffset }); }
		catch (problem) { setError(readError(problem)); }
	};
	useEffect(() => { load(); }, [load]);
	if (auth === 'signed-out') return <AuthGate title={c.signedOutTitle} lede={c.signedOutLede} />;
	if (!data) return <main className={styles.shell} aria-busy={auth === 'loading'}><Link className={styles.back} href="/teams"><ArrowLeft size={15} />{c.backToTeams}</Link>{error ? <p className={styles.error}>{error}</p> : <span className="skeleton-line" style={{ width: '24ch' }} />}</main>;
	const { team, me, capabilities } = data;
	return <main className={styles.shell}>
		<Link className={styles.back} href={`/teams/${team.id}`}><ArrowLeft size={15} />{c.backToTeam}</Link>
		<header className={styles.header}><div className={styles.identity}><TeamMark name={team.name} color={team.color} size="large" /><div><h1>{c.settings}</h1><p>{team.name} · {c.settingsLede}</p></div></div>{team.archivedAt && <span className={styles.role}>{c.archived}</span>}</header>
		{error && <p className={styles.error} role="alert">{error}</p>}
		<div className={styles.layout}><nav className={styles.sideNav} aria-label={c.settings}>{TABS.map((value, index) => { const Icon = ICONS[index]; return <button type="button" key={value} aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}><Icon size={17} />{c.tabs[value]}</button>; })}</nav><section className={styles.content}>
			{tab === 'general' && <General team={team} editable={capabilities.canEdit} c={c} readError={readError} onChanged={load} />}
			{tab === 'people' && <People team={team} me={me} members={members} memberMeta={memberMeta} onLoadMore={loadMoreMembers} capabilities={capabilities} c={c} lang={lang} readError={readError} onChanged={load} />}
			{tab === 'requests' && <Requests team={team} me={me} requests={requests} capabilities={capabilities} c={c} readError={readError} onChanged={load} />}
			{tab === 'lifecycle' && <Lifecycle data={data} members={members} c={c} readError={readError} onChanged={load} />}
		</section></div>
	</main>;
}

function General({ team, editable, c, readError, onChanged }) {
	const initial = useMemo(() => ({ name: team.name, description: team.description || '', color: team.color }), [team]);
	const [form, setForm] = useState(initial);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	useEffect(() => setForm(initial), [initial]);
	const submit = async event => {
		event.preventDefault(); setBusy(true); setError('');
		try { const response = await fetch(`/api/megu/teams/${team.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, expectedRevision: team.revision }) }); const body = await response.json(); if (!response.ok) throw body; await onChanged(); }
		catch (problem) { setError(readError(problem)); }
		finally { setBusy(false); }
	};
	return <section><h2>{c.profileTitle}</h2><p className={styles.lede}>{c.createHint}</p><form className={styles.form} onSubmit={submit}><label><span>{c.name}</span><input required disabled={!editable} maxLength={120} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></label><label><span>{c.description}</span><textarea disabled={!editable} rows={3} maxLength={4000} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} /></label><fieldset disabled={!editable} className={`${styles.field} ${styles.wide}`}><legend>{c.color}</legend><div className={styles.colorChoices}>{COLORS.map(color => <button key={color} type="button" className={styles.colorChoice} aria-label={color} aria-pressed={form.color === color} onClick={() => setForm(current => ({ ...current, color }))}><TeamMark name="" color={color} /></button>)}</div></fieldset>{error && <p className={`${styles.error} ${styles.wide}`} role="alert">{error}</p>}{editable && <div className={`${styles.actions} ${styles.wide}`}><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? c.saving : c.save}</button></div>}</form></section>;
}

function People({ team, me, members, memberMeta, onLoadMore, capabilities, c, lang, readError, onChanged }) {
	const [query, setQuery] = useState('');
	const [searchResults, setSearchResults] = useState(null);
	const [searchMeta, setSearchMeta] = useState({ total: 0, nextOffset: null });
	const [searching, setSearching] = useState(false);
	const [error, setError] = useState('');
	const [pendingRemoval, setPendingRemoval] = useState(null);
	const [removing, setRemoving] = useState(false);
	const normalizedQuery = query.trim();
	const visible = searchResults || members;
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
	}, [normalizedQuery, readError, team.id]);
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
	return <section><h2>{c.peopleTitle}</h2><p className={styles.lede}>{c.peopleHint}</p><div className={styles.memberTools}><label className={styles.search}><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={c.searchMembers} aria-label={c.searchMembers} /></label><span className={styles.role}>{c.members(normalizedQuery ? searchMeta.total : (memberMeta.total || members.length))}</span></div>{error && <p className={styles.error} role="alert">{error}</p>}{pendingRemoval && <div className={styles.confirmation} role="alertdialog" aria-labelledby="team-remove-title" aria-describedby="team-remove-impact"><div><strong id="team-remove-title">{pendingRemoval.userId === me.userId ? c.leaveConfirmTitle : c.removeConfirmTitle(pendingRemoval.displayName)}</strong><p id="team-remove-impact">{c.removeConfirmImpact(pendingRemoval.removalImpact?.projectCount || 0, pendingRemoval.removalImpact?.assignmentCount || 0)}</p></div><div className={styles.confirmationActions}><button type="button" className="btn btn-secondary btn-sm" disabled={removing} onClick={() => setPendingRemoval(null)}>{c.keepMember}</button><button type="button" className="btn btn-danger btn-sm" disabled={removing} onClick={() => remove(pendingRemoval)}>{pendingRemoval.userId === me.userId ? c.confirmLeaveTeam : c.confirmRemoveMember}</button></div></div>}<div className={styles.members} aria-busy={searching}>{visible.map(member => { const owner = member.role === 'owner'; const canChange = capabilities.canManageAdmins && !owner; const canRemove = !owner && (member.userId === me.userId || (capabilities.canManageMembers && !(me.role === 'admin' && member.role === 'admin'))); return <div className={styles.member} key={member.userId}><ProjectAvatar name={member.displayName} avatarUrl={member.avatarUrl} className={styles.avatar} /><div className={styles.memberIdentity}><strong>{member.displayName}</strong><small>{c.memberSince} {new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'medium' }).format(new Date(member.joinedAt))}</small></div>{canChange ? <CustomSelect size="compact" searchable={false} value={member.role} onChange={role => mutate(member, role)} ariaLabel={`${member.displayName} ${c.requestRole}`} options={['member', 'admin'].map(role => ({ value: role, label: c.role[role] }))} /> : <span className={styles.role}>{c.role[member.role]}</span>}{canRemove && <button type="button" className={styles.iconButton} onClick={() => { setError(''); setRemoving(false); setPendingRemoval(member); }} aria-label={member.userId === me.userId ? c.leaveTeam : `${c.removeMember} ${member.displayName}`}><Trash2 size={16} /></button>}</div>; })}{normalizedQuery && !searching && visible.length === 0 && <p className={styles.lede}>{c.noSearchResults}</p>}</div>{((normalizedQuery && searchMeta.nextOffset != null) || (!normalizedQuery && memberMeta.nextOffset != null)) && <div className={styles.actions} style={{ marginTop: '1rem' }}><button type="button" className="btn btn-secondary" disabled={searching} onClick={normalizedQuery ? loadMoreSearch : onLoadMore}>{c.loadMore}</button></div>}</section>;
}

function Requests({ team, me, requests, capabilities, c, readError, onChanged }) {
	const [link, setLink] = useState('');
	const [copied, setCopied] = useState(false);
	const [busy, setBusy] = useState('');
	const [error, setError] = useState('');
	const [roles, setRoles] = useState({});
	const linkAction = async action => {
		setBusy(action); setError('');
		try { const response = await fetch(`/api/megu/teams/${team.id}/join-link`, { method: action === 'revoke' ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const body = await response.json(); if (!response.ok) throw body; if (body.token) setLink(`${window.location.origin}/teams/join/${body.token}`); else setLink(''); await onChanged(); }
		catch (problem) { setError(readError(problem)); }
		finally { setBusy(''); }
	};
	const review = async (request, action) => {
		setBusy(request.id); setError('');
		try { const response = await fetch(`/api/megu/teams/${team.id}/join-requests/${request.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, role: roles[request.id] || 'member' }) }); const body = await response.json(); if (!response.ok) throw body; await onChanged(); }
		catch (problem) { setError(readError(problem)); }
		finally { setBusy(''); }
	};
	if (!capabilities.canManageJoinLink) return <section><h2>{c.requestsTitle}</h2><p className={styles.lede}>{c.peopleHint}</p></section>;
	return <section><h2>{c.joinTitle}</h2><p className={styles.lede}>{c.joinHint}</p><div className={styles.headerActions} style={{ marginTop: '1rem' }}><button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => linkAction('create')}>{c.createJoinLink}</button>{(requests.link || link) && <button type="button" className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => linkAction('revoke')}>{c.revokeJoinLink}</button>}</div>{(requests.link || link) && <p className={styles.notice}>{c.joinActive}</p>}{link && <div className={styles.joinLink}><input readOnly value={link} aria-label={c.joinTitle} /><button type="button" className="btn btn-secondary" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); }}>{copied ? c.copied : c.copyLink}</button></div>}{error && <p className={styles.error}>{error}</p>}<div className={styles.section}><h2>{c.requestsTitle}</h2>{requests.requests.length ? requests.requests.map(request => <div className={styles.request} key={request.id}><ProjectAvatar name={request.displayName} avatarUrl={request.avatarUrl} className={styles.avatar} /><div className={styles.memberIdentity}><strong>{request.displayName}</strong><small>{new Intl.DateTimeFormat().format(new Date(request.requestedAt))}</small></div><CustomSelect size="compact" searchable={false} disabled={me.role === 'admin'} value={roles[request.id] || 'member'} onChange={role => setRoles(current => ({ ...current, [request.id]: role }))} ariaLabel={`${request.displayName} ${c.requestRole}`} options={(me.role === 'owner' ? ['member', 'admin'] : ['member']).map(role => ({ value: role, label: c.role[role] }))} /><div className={styles.requestActions}><button type="button" className="btn btn-primary btn-sm" disabled={busy === request.id} onClick={() => review(request, 'approve')}>{c.approve}</button><button type="button" className="btn btn-secondary btn-sm" disabled={busy === request.id} onClick={() => review(request, 'reject')}>{c.decline}</button></div></div>) : <p className={styles.lede}>{c.noRequests}</p>}</div></section>;
}

function Lifecycle({ data, members, c, readError, onChanged }) {
	const { team, me, ownershipTransfer: transfer, capabilities } = data;
	const [proposedOwnerId, setProposedOwnerId] = useState('');
	const [busy, setBusy] = useState('');
	const [error, setError] = useState('');
	const action = async kind => {
		setBusy(kind); setError('');
		try {
			let path = `/api/megu/teams/${team.id}`; let method = 'POST'; let body;
			if (kind === 'propose') { path += '/ownership-transfer'; body = JSON.stringify({ proposedOwnerId, expectedRevision: team.revision }); }
			if (kind === 'accept') path += `/ownership-transfer/${transfer.id}`;
			if (kind === 'cancel') { path += `/ownership-transfer/${transfer.id}`; method = 'DELETE'; }
			if (kind === 'archive' || kind === 'restore') { path += `/${kind}`; body = JSON.stringify({ expectedRevision: team.revision }); }
			const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body }); const responseBody = await response.json(); if (!response.ok) throw responseBody; await onChanged();
		}
		catch (problem) { setError(readError(problem)); }
		finally { setBusy(''); }
	};
	const candidates = members.filter(member => member.userId !== me.userId);
	return <section><h2>{c.ownershipTitle}</h2><p className={styles.lede}>{c.ownershipHint}</p>{transfer ? <div className={styles.section}><p>{c.transferPending(transfer.proposedOwnerName || c.role.member)}</p><div className={styles.headerActions}>{transfer.proposedOwnerId === me.userId && <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => action('accept')}>{c.acceptTransfer}</button>}{me.role === 'owner' && <button type="button" className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => action('cancel')}>{c.cancelTransfer}</button>}</div></div> : capabilities.canTransferOwnership && candidates.length ? <div className={styles.section}><label className={styles.field}><span>{c.newOwner}</span><CustomSelect type="member" value={proposedOwnerId} onChange={setProposedOwnerId} options={candidates.map(member => ({ value: member.userId, label: member.displayName, subtitle: c.role[member.role], avatar: member.avatarUrl }))} /></label><button style={{ marginTop: '.8rem' }} type="button" className="btn btn-secondary" disabled={!proposedOwnerId || Boolean(busy)} onClick={() => action('propose')}>{c.proposeTransfer}</button></div> : null}{error && <p className={styles.error}>{error}</p>}{(capabilities.canArchive || capabilities.canRestore) && <div className={styles.dangerZone}><h2>{team.archivedAt ? c.restore : c.archiveTitle}</h2><p>{c.archiveHint}</p><button type="button" className={team.archivedAt ? 'btn btn-primary' : 'btn btn-danger'} disabled={Boolean(busy)} onClick={() => action(team.archivedAt ? 'restore' : 'archive')}><Archive size={16} />{team.archivedAt ? c.restore : c.archive}</button></div>}</section>;
}
