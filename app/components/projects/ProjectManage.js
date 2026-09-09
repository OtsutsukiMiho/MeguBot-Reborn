'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bell, Check, Copy, Link2, Settings2, Shield, Trash2, UserPlus, Users } from 'lucide-react';
import AuthGate from '../AuthGate';
import ProjectAvatar from './ProjectAvatar';
import ProjectJoinSettings from './ProjectJoinSettings';
import CustomSelect from '../CustomSelect';
import { useCopy } from '../../copy';
import styles from './projectManage.module.css';

const TABS = ['general', 'people', 'notifications', 'lifecycle'];
const CLOSED = new Set(['completed', 'cancelled']);

function dateLabel(value, lang, timezone) {
	if (!value) return null;
	try { return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'medium', timeZone: timezone }).format(new Date(canonicalProjectDate(value))); }
	catch { return null; }
}

function canonicalProjectDate(value) {
	const source = String(value || '');
	const match = /^(\d{4})(-\d{2}-\d{2})(.*)$/.exec(source);
	if (!match) return value;
	const year = Number(match[1]);
	return year >= 2400 && year <= 2699 ? `${year - 543}${match[2]}${match[3]}` : value;
}


export default function ProjectManage({ code }) {
	const { t, lang } = useCopy();
	const p = t.projects;
	const [data, setData] = useState(null);
	const [invitations, setInvitations] = useState([]);
	const [loading, setLoading] = useState(true);
	const [signedOut, setSignedOut] = useState(false);
	const [error, setError] = useState('');
	const [tab, setTab] = useState('general');
	const [dirty, setDirty] = useState(false);
	const [pendingNavigation, setPendingNavigation] = useState(null);

	const readError = useCallback(problem => p.errors[problem?.code] || p.errors.failed, [p.errors]);
	const load = useCallback(async () => {
		setLoading(true); setError('');
		try {
			const response = await fetch(`/api/megu/projects/${encodeURIComponent(code)}`, { credentials: 'same-origin' });
			if (response.status === 401) { setSignedOut(true); return; }
			const body = await response.json();
			if (!response.ok) throw body;
			setData(body);
			if (['owner', 'lead'].includes(body.me.role)) {
				const inviteResponse = await fetch(`/api/megu/projects/${encodeURIComponent(code)}/invitations`, { credentials: 'same-origin' });
				const inviteBody = await inviteResponse.json();
				if (!inviteResponse.ok) throw inviteBody;
				setInvitations(inviteBody.invitations || []);
			}
		}
		catch (problem) { setError(readError(problem)); }
		finally { setLoading(false); }
	}, [code, readError]);

	useEffect(() => { load(); }, [load]);
	useEffect(() => {
		if (!dirty) return undefined;
		const warn = event => { event.preventDefault(); event.returnValue = ''; };
		window.addEventListener('beforeunload', warn);
		return () => window.removeEventListener('beforeunload', warn);
	}, [dirty]);
	const requestNavigation = destination => {
		if (!dirty) {
			if (destination.href) window.location.assign(destination.href); else setTab(destination.tab);
			return;
		}
		setPendingNavigation(destination);
	};
	const discardAndContinue = () => {
		const destination = pendingNavigation;
		setDirty(false); setPendingNavigation(null);
		if (destination?.href) window.location.assign(destination.href);
		else if (destination?.tab) setTab(destination.tab);
	};
	if (loading) return <main className={styles.shell} aria-busy="true"><span className="skeleton-line" style={{ width: '20ch' }} /></main>;
	if (signedOut) return <AuthGate title={p.signedOutTitle} lede={p.signedOutLede} />;
	if (!data) return <main className={styles.shell}><p role="alert">{error}</p><Link href="/projects" className="btn btn-secondary">{p.title}</Link></main>;

	const { project, members, me } = data;
	return <main className={styles.shell}>
		<Link href={`/p/${project.code}`} className={styles.back} onClick={event => { if (dirty) { event.preventDefault(); requestNavigation({ href: `/p/${project.code}` }); } }}><ArrowLeft size={15} />{p.backToProject}</Link>
		<header className={styles.header}><div><h1>{p.manage}</h1><p>{project.title} · {p.manageLede}</p></div><span className={styles.code}>{project.code}</span></header>
		{error && <p className={styles.alert} role="alert">{error}</p>}
		{pendingNavigation && <div className={styles.unsavedWarning} role="alertdialog" aria-labelledby="project-unsaved-title" aria-describedby="project-unsaved-detail"><div><strong id="project-unsaved-title">{p.unsavedTitle}</strong><p id="project-unsaved-detail">{p.unsavedDetail}</p></div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setPendingNavigation(null)}>{p.keepEditing}</button><button type="button" className="btn btn-primary btn-sm" onClick={discardAndContinue}>{p.discardChanges}</button></div>}
		<div className={styles.layout}>
			<nav className={styles.nav} aria-label={p.manage}>
				{TABS.map((value, index) => { const Icon = [Settings2, Users, Bell, Shield][index]; return <button key={value} type="button" aria-current={tab === value ? 'page' : undefined} onClick={() => requestNavigation({ tab: value })}><Icon size={17} />{p.manageTabs[value]}</button>; })}
			</nav>
			<section className={styles.content}>
				{tab === 'general' && <General project={project} me={me} p={p} lang={lang} readError={readError} onChanged={load} onDirtyChange={setDirty} />}
				{tab === 'people' && <People project={project} members={members} me={me} invitations={invitations} setInvitations={setInvitations} p={p} lang={lang} readError={readError} onChanged={load} setError={setError} />}
				{tab === 'notifications' && <NotificationSettings project={project} me={me} initial={data.notificationSettings} p={p} readError={readError} onChanged={load} onDirtyChange={setDirty} />}
				{tab === 'lifecycle' && <Lifecycle project={project} members={members} transfer={data.ownershipTransfer} me={me} p={p} readError={readError} onChanged={load} />}
			</section>
		</div>
	</main>;
}

function NotificationSettings({ project, me, initial, p, readError, onChanged, onDirtyChange }) {
	const initialForm = useMemo(() => ({ enabled: initial.enabled, dmEnabled: initial.dmEnabled !== false, blockerNotifications: initial.blockerNotifications, reminder48h: initial.reminder48h, reminder24h: initial.reminder24h, channelEnabled: initial.channelEnabled, guildId: initial.guildId || '', channelId: initial.channelId || '', channelName: initial.channelName || '' }), [initial]);
	const [form, setForm] = useState(initialForm);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [lastFailure, setLastFailure] = useState(null);
	const [servers, setServers] = useState([]);
	const [channels, setChannels] = useState([]);
	const editable = me.role === 'owner';
	useEffect(() => { setForm(initialForm); onDirtyChange(false); }, [initialForm, onDirtyChange]);
	useEffect(() => { onDirtyChange(editable && JSON.stringify(form) !== JSON.stringify(initialForm)); }, [editable, form, initialForm, onDirtyChange]);
	useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
	useEffect(() => {
		let current = true;
		fetch(`/api/megu/projects/${project.code}/notification-settings`, { credentials: 'same-origin' })
			.then(response => response.ok ? response.json() : null)
			.then(body => { if (current) setLastFailure(body?.lastFailure || null); })
			.catch(() => undefined);
		return () => { current = false; };
	}, [project.code]);
	useEffect(() => {
		if (!editable) return undefined;
		let current = true;
		fetch('/api/megu/me', { credentials: 'same-origin' }).then(response => response.ok ? response.json() : null).then(body => {
			if (current) setServers((body?.servers || []).filter(server => server.canManage));
		}).catch(() => undefined);
		return () => { current = false; };
	}, [editable]);
	useEffect(() => {
		if (!form.guildId || !editable) { setChannels([]); return undefined; }
		let current = true;
		fetch(`/api/guilds/${form.guildId}`, { credentials: 'same-origin' }).then(response => response.ok ? response.json() : null).then(body => {
			if (current) setChannels((body?.channels || []).filter(channel => [0, 5, 'GUILD_TEXT', 'GUILD_ANNOUNCEMENT'].includes(channel.type)));
		}).catch(() => { if (current) setChannels([]); });
		return () => { current = false; };
	}, [editable, form.guildId]);
	const submit = async event => {
		event.preventDefault(); setError('');
		if (form.channelEnabled && (!form.guildId || !form.channelId)) {
			setError(p.errors.project_channel_invalid);
			return;
		}
		setBusy(true);
		try { const response = await fetch(`/api/megu/projects/${project.code}/notification-settings`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, expectedRevision: project.revision }) }); const body = await response.json(); if (!response.ok) throw body; onDirtyChange(false); await onChanged(); }
		catch (problem) { setError(readError(problem)); setBusy(false); }
	};
	return <section><h2>{p.notificationsTitle}</h2><form className={styles.notificationForm} onSubmit={submit}><label><input type="checkbox" disabled={!editable} checked={form.enabled} onChange={event => setForm(current => ({ ...current, enabled: event.target.checked, blockerNotifications: event.target.checked && current.blockerNotifications, reminder48h: event.target.checked && current.reminder48h, reminder24h: event.target.checked && current.reminder24h, channelEnabled: event.target.checked && current.channelEnabled }))} /><span>{p.notificationsEnabled}</span></label><label><input type="checkbox" disabled={!editable || !form.enabled} checked={form.dmEnabled} onChange={event => setForm(current => ({ ...current, dmEnabled: event.target.checked }))} /><span>{p.dmEnabled}</span></label><small>{p.dmHint}</small><fieldset disabled={!editable || !form.enabled}><legend>{p.deadlineReminders}</legend><label><input type="checkbox" checked={form.reminder48h} onChange={event => setForm(current => ({ ...current, reminder48h: event.target.checked }))} /><span>{p.reminder48h}</span></label><label><input type="checkbox" checked={form.reminder24h} onChange={event => setForm(current => ({ ...current, reminder24h: event.target.checked }))} /><span>{p.reminder24h}</span></label><small>{p.reminderHint(project.timezone)}</small></fieldset><label><input type="checkbox" disabled={!editable || !form.enabled} checked={form.blockerNotifications} onChange={event => setForm(current => ({ ...current, blockerNotifications: event.target.checked }))} /><span>{p.blockerNotifications}</span></label><fieldset disabled={!editable || !form.enabled}><legend>{p.channelDelivery}</legend><label><input type="checkbox" checked={form.channelEnabled} onChange={event => setForm(current => ({ ...current, channelEnabled: event.target.checked }))} /><span>{p.channelEnabled}</span></label>{form.channelEnabled && <div className={styles.channelFields}><label><span>{p.channelServer}</span><CustomSelect required ariaLabel={p.channelServer} value={form.guildId} onChange={guildId => setForm(current => ({ ...current, guildId, channelId: '', channelName: '' }))} options={servers.map(server => ({ value: server.id, label: server.name }))} searchable={servers.length > 5} /></label><label><span>{p.channelName}</span><CustomSelect required type="channel" ariaLabel={p.channelName} value={form.channelId} onChange={(channelId, option) => setForm(current => ({ ...current, channelId, channelName: option?.label || '' }))} options={channels.map(channel => ({ value: channel.id, label: channel.name }))} searchable={channels.length > 5} disabled={!form.guildId} /></label></div>}<small>{p.channelDisclosure}</small>{form.channelEnabled && <div className={styles.channelPreview}><strong>{p.channelPreview}</strong><p>🚧 {project.title} · Topic name is blocked / ติดปัญหา</p><span>{p.channelPreviewPrivate}</span></div>}</fieldset><div className={styles.note}><Bell size={20} /><p>{p.notificationPrivacy}</p></div>{lastFailure && <div className={styles.deliveryFailure} role="status"><strong>{p.deliveryFailure}</strong><span>{p.deliveryFailureDetail(lastFailure.channel, lastFailure.error)}</span></div>}{error && <p className={styles.alert} role="alert">{error}</p>}{editable && <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? p.saving : p.saveNotifications}</button>}</form></section>;
}

function dateInput(value, timezone) {
	if (!value) return '';
	const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(canonicalProjectDate(value))).map(part => [part.type, part.value]));
	return `${parts.year}-${parts.month}-${parts.day}`;
}

function General({ project, me, p, lang, readError, onChanged, onDirtyChange }) {
	const editable = ['owner', 'lead'].includes(me.role) && !CLOSED.has(project.status);
	const initialForm = useMemo(() => ({ title: project.title, description: project.description || '', startsAt: dateInput(project.startsAt, project.timezone), deadlineAt: dateInput(project.deadlineAt, project.timezone), timezone: project.timezone, timezoneChangeMode: 'keep_local' }), [project.deadlineAt, project.description, project.startsAt, project.timezone, project.title]);
	const [form, setForm] = useState(initialForm);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const timezoneChanged = form.timezone.trim() !== project.timezone;
	useEffect(() => { setForm(initialForm); onDirtyChange(false); }, [initialForm, onDirtyChange]);
	useEffect(() => { onDirtyChange(editable && JSON.stringify(form) !== JSON.stringify(initialForm)); }, [editable, form, initialForm, onDirtyChange]);
	useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
	const submit = async event => {
		event.preventDefault(); setBusy(true); setError('');
		try { const payload = { title: form.title, description: form.description, expectedRevision: project.revision, ...(timezoneChanged ? { timezone: form.timezone, timezoneChangeMode: form.timezoneChangeMode } : { startsAt: form.startsAt || null, startsPrecision: form.startsAt ? 'date' : null, deadlineAt: form.deadlineAt || null, deadlinePrecision: form.deadlineAt ? 'date' : null }) }; const response = await fetch(`/api/megu/projects/${project.code}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const body = await response.json(); if (!response.ok) throw body; onDirtyChange(false); await onChanged(); }
		catch (problem) { setError(readError(problem)); setBusy(false); }
	};
	return <section><h2>{p.generalTitle}</h2>{editable ? <form className={styles.generalForm} onSubmit={submit}><label><span>{p.name}</span><input required maxLength={120} value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} /></label><label><span>{p.description}</span><textarea rows={4} maxLength={4000} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} /></label><div className={styles.dateFields}><label><span>{p.startDate}</span><input type="date" disabled={timezoneChanged} value={form.startsAt} onChange={event => setForm(current => ({ ...current, startsAt: event.target.value }))} /></label><label><span>{p.deadline}</span><input type="date" disabled={timezoneChanged} value={form.deadlineAt} onChange={event => setForm(current => ({ ...current, deadlineAt: event.target.value }))} /></label></div><label><span>{p.timezone}</span><input required list="project-timezones" value={form.timezone} onChange={event => setForm(current => ({ ...current, timezone: event.target.value }))} /><datalist id="project-timezones"><option value="Asia/Bangkok" /><option value="Asia/Tokyo" /><option value="Asia/Singapore" /><option value="Europe/London" /><option value="America/New_York" /><option value="America/Los_Angeles" /><option value="UTC" /></datalist></label>{timezoneChanged && <fieldset className={styles.timezoneChoice}><legend>{p.timezoneChangeTitle}</legend><label><input type="radio" name="timezone-mode" value="keep_local" checked={form.timezoneChangeMode === 'keep_local'} onChange={event => setForm(current => ({ ...current, timezoneChangeMode: event.target.value }))} /><span>{p.keepLocalDates}</span></label><label><input type="radio" name="timezone-mode" value="keep_instants" checked={form.timezoneChangeMode === 'keep_instants'} onChange={event => setForm(current => ({ ...current, timezoneChangeMode: event.target.value }))} /><span>{p.keepExactTimes}</span></label><p>{form.timezoneChangeMode === 'keep_local' ? p.keepLocalPreview(form.startsAt || '—', form.deadlineAt || '—') : p.keepExactPreview(dateLabel(project.startsAt, lang, form.timezone) || '—', dateLabel(project.deadlineAt, lang, form.timezone) || '—')}</p></fieldset>}{error && <p className={styles.alert} role="alert">{error}</p>}<button className="btn btn-primary" type="submit" disabled={busy}>{busy ? p.saving : p.saveProject}</button></form> : <dl className={styles.facts}><div><dt>{p.name}</dt><dd>{project.title}</dd></div><div><dt>{p.description}</dt><dd>{project.description || '—'}</dd></div><div><dt>{p.timezone}</dt><dd>{project.timezone}</dd></div><div><dt>{p.deadline}</dt><dd>{dateLabel(project.deadlineAt, lang, project.timezone) || p.noDeadline}</dd></div><div><dt>{p.status}</dt><dd>{p.state[project.status]}</dd></div></dl>}</section>;
}

function People({ project, members, me, invitations, setInvitations, p, lang, readError, onChanged, setError }) {
	const canLead = ['owner', 'lead'].includes(me.role);
	const changeRole = async (member, role) => {
		setError('');
		try {
			const response = await fetch(`/api/megu/projects/${project.code}/members/${member.userId}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, expectedRevision: project.revision }) });
			const body = await response.json(); if (!response.ok) throw body; await onChanged();
		}
		catch (problem) { setError(readError(problem)); }
	};
	const remove = async member => {
		setError('');
		try {
			const response = await fetch(`/api/megu/projects/${project.code}/members/${member.userId}`, { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: project.revision }) });
			const body = await response.json(); if (!response.ok) throw body;
			if (member.userId === me.userId) window.location.href = '/projects'; else await onChanged();
		}
		catch (problem) { setError(readError(problem)); }
	};
	return <section><h2>{p.peopleTitle}</h2><p className={styles.lede}>{p.peopleHint}</p>
		<div className={styles.members}>{members.map(member => {
			const owner = member.role === 'owner';
			const mayManage = canLead && !owner && !(me.role === 'lead' && member.role === 'lead');
			const roleOptions = ['member', 'viewer', ...(me.role === 'owner' ? ['lead'] : [])].map(role => ({ value: role, label: p.role[role] }));
			return <div className={styles.member} key={member.userId}><ProjectAvatar name={member.displayName} avatarUrl={member.avatarUrl} className={styles.avatar} /><div><strong>{member.displayName}</strong><small>{p.memberSince} {dateLabel(member.joinedAt, lang, project.timezone) || '—'}</small></div>{mayManage ? <CustomSelect className={styles.memberSelect} size="compact" searchable={false} value={member.role} onChange={role => changeRole(member, role)} ariaLabel={`${member.displayName} ${p.inviteRole}`} options={roleOptions} /> : <span className={styles.role}>{p.role[member.role]}</span>}{!owner && (mayManage || member.userId === me.userId) && <button type="button" className={styles.iconButton} onClick={() => remove(member)} aria-label={member.userId === me.userId ? p.leaveProject : `${p.removeMember} ${member.displayName}`}><Trash2 size={16} /></button>}</div>;
		})}</div>
		{me.role === 'owner' && <ProjectJoinSettings code={project.code} p={p} onChanged={onChanged} />}
		{canLead && <InviteForm project={project} me={me} invitations={invitations} setInvitations={setInvitations} p={p} lang={lang} readError={readError} setError={setError} />}
	</section>;
}

function InviteForm({ project, me, invitations, setInvitations, p, lang, readError, setError }) {
	const [form, setForm] = useState({ provider: 'discord', recipient: '', role: 'member' });
	const [busy, setBusy] = useState(false);
	const [link, setLink] = useState('');
	const [copied, setCopied] = useState(false);
	const roles = useMemo(() => me.role === 'owner' ? ['lead', 'member', 'viewer'] : ['member', 'viewer'], [me.role]);
	const submit = async event => {
		event.preventDefault(); setBusy(true); setError(''); setLink('');
		try {
			const response = await fetch(`/api/megu/projects/${project.code}/invitations`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
			const body = await response.json(); if (!response.ok) throw body;
			setLink(`${window.location.origin}/projects/invitations/${body.token}`); setForm(current => ({ ...current, recipient: '' })); setInvitations(current => [body.invitation, ...current]);
		}
		catch (problem) { setError(readError(problem)); }
		finally { setBusy(false); }
	};
	const revoke = async id => {
		setError('');
		try { const response = await fetch(`/api/megu/projects/${project.code}/invitations/${id}`, { method: 'DELETE', credentials: 'same-origin' }); const body = await response.json(); if (!response.ok) throw body; setInvitations(current => current.filter(invite => invite.id !== id)); }
		catch (problem) { setError(readError(problem)); }
	};
	return <div className={styles.inviteArea}><div><h3>{p.inviteTitle}</h3><p>{p.inviteHint}</p></div><form className={styles.inviteForm} onSubmit={submit}>
		<label><span>{p.inviteProvider}</span><CustomSelect searchable={false} ariaLabel={p.inviteProvider} value={form.provider} onChange={provider => setForm(current => ({ ...current, provider }))} options={Object.entries(p.inviteProviders).map(([value, label]) => ({ value, label }))} /></label>
		<label><span>{p.inviteRecipient}</span><input required value={form.recipient} onChange={event => setForm(current => ({ ...current, recipient: event.target.value }))} /></label>
		<label><span>{p.inviteRole}</span><CustomSelect searchable={false} ariaLabel={p.inviteRole} value={form.role} onChange={role => setForm(current => ({ ...current, role }))} options={roles.map(role => ({ value: role, label: p.role[role] }))} /></label>
		<button className="btn btn-primary" type="submit" disabled={busy}><UserPlus size={16} />{busy ? p.inviting : p.sendInvite}</button>
	</form>{link && <div className={styles.inviteReady} role="status"><Link2 size={19} /><div><strong>{p.inviteReady}</strong><p>{p.inviteReadyHint}</p><code>{link}</code></div><button type="button" className="btn btn-secondary btn-sm" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); }}><Copy size={15} />{copied ? p.copied : p.copyLink}</button></div>}
		<div className={styles.pending}><h3>{p.pendingInvites}</h3>{invitations.length === 0 ? <p>{p.noPendingInvites}</p> : invitations.map(invite => <div className={styles.pendingRow} key={invite.id}><div><strong>{invite.recipient}</strong><small>{p.role[invite.role]} · {p.expires} {dateLabel(invite.expiresAt, lang, project.timezone)}</small></div><button type="button" className="btn btn-secondary btn-sm" onClick={() => revoke(invite.id)}>{p.revoke}</button></div>)}</div>
	</div>;
}

function Lifecycle({ project, members, transfer, me, p, readError, onChanged }) {
	const [reason, setReason] = useState('');
	const [busy, setBusy] = useState('');
	const [error, setError] = useState('');
	const [proposedOwnerId, setProposedOwnerId] = useState('');
	const [pendingState, setPendingState] = useState(null);
	const available = project.status === 'planning' ? ['active', 'cancelled'] : project.status === 'active' ? ['paused', 'completed', 'cancelled'] : project.status === 'paused' ? ['active', 'completed', 'cancelled'] : ['active'];
	const allowed = me.role === 'owner' ? available : me.role === 'lead' ? available.filter(value => ['active', 'paused'].includes(value) && !CLOSED.has(project.status)) : [];
	const change = async status => {
		setBusy(status); setError('');
		try { const response = await fetch(`/api/megu/projects/${project.code}/state`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, reason, expectedRevision: project.revision }) }); const body = await response.json(); if (!response.ok) throw body; setReason(''); setPendingState(null); await onChanged(); }
		catch (problem) { setError(readError(problem)); }
		finally { setBusy(''); }
	};
	const transferAction = async action => {
		setBusy(action); setError('');
		try {
			const path = action === 'propose' ? `/api/megu/projects/${project.code}/ownership-transfer` : `/api/megu/projects/${project.code}/ownership-transfer/${transfer.id}${action === 'accept' ? '/accept' : ''}`;
			const response = await fetch(path, { method: action === 'cancel' ? 'DELETE' : 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: action === 'propose' ? JSON.stringify({ proposedOwnerId, expectedRevision: project.revision }) : undefined });
			const body = await response.json(); if (!response.ok) throw body; await onChanged();
		}
		catch (problem) { setError(readError(problem)); setBusy(''); }
	};
	const candidates = members.filter(member => member.userId !== me.userId);
	return <section><h2>{p.lifecycleTitle}</h2><p className={styles.lede}>{p.lifecycleHint}</p><div className={styles.currentState}><span>{p.status}</span><strong>{p.state[project.status]}</strong></div><label className={styles.reason}><span>{p.stateReason}</span><textarea rows={3} required={Boolean(pendingState)} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>{pendingState && <div className={styles.stateConfirm} role="alert"><strong>{p.confirmStateTitle(p.state[pendingState])}</strong><p>{p.confirmStateHint}</p><div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setPendingState(null)}>{p.keep}</button><button type="button" className={pendingState === 'cancelled' ? 'btn btn-danger btn-sm' : 'btn btn-primary btn-sm'} disabled={!reason.trim() || Boolean(busy)} onClick={() => change(pendingState)}>{busy ? p.changingState : p.stateActions[pendingState]}</button></div></div>}{error && <p className={styles.alert} role="alert">{error}</p>}<div className={styles.stateButtons}>{allowed.map(status => <button key={status} type="button" className={status === 'cancelled' ? 'btn btn-danger' : 'btn btn-secondary'} disabled={Boolean(busy)} onClick={() => ['completed', 'cancelled'].includes(status) ? setPendingState(status) : change(status)}>{busy === status ? p.changingState : p.stateActions[status]}</button>)}</div>{(me.role === 'owner' || transfer?.proposedOwnerId === me.userId) && <div className={styles.transfer}><h3>{p.transferTitle}</h3><p>{p.transferHint}</p>{transfer ? <div className={styles.transferPending}><span>{p.transferPending(transfer.proposedOwnerName || members.find(member => member.userId === transfer.proposedOwnerId)?.displayName || p.role.member)}</span>{me.role === 'owner' ? <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => transferAction('cancel')}>{p.cancelTransfer}</button> : <button type="button" className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => transferAction('accept')}>{p.acceptTransfer}</button>}</div> : me.role === 'owner' && candidates.length > 0 ? <div className={styles.transferForm}><label><span>{p.newOwner}</span><CustomSelect type="member" ariaLabel={p.newOwner} value={proposedOwnerId} onChange={setProposedOwnerId} options={candidates.map(member => ({ value: member.userId, label: member.displayName, subtitle: p.role[member.role], avatar: member.avatarUrl }))} searchable={candidates.length > 5} /></label><button type="button" className="btn btn-secondary" disabled={!proposedOwnerId || Boolean(busy)} onClick={() => transferAction('propose')}>{p.proposeTransfer}</button></div> : null}</div>}</section>;
}
