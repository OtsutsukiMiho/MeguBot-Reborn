'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import useDraftGuard from '../useDraftGuard';
import { useCopy } from '../../copy';
import AuthGate from '../AuthGate';
import CustomSelect from '../CustomSelect';
import ProjectAvatar from '../projects/ProjectAvatar';
import { guildIconUrl } from '../../lib/discord-guild-icon';
import useWorkspaceResource from '../useWorkspaceResource';
import styles from './serverWorkspace.module.css';
import teamStyles from '../../teams/teams.module.css';

export default function ServerTitleSettings({ guildId }) {
	const { t } = useCopy();
	const c = t.serverTitles;
	const router = useRouter();
	const back = `/teams/server/${encodeURIComponent(guildId)}`;
	const base = `/api/megu/teams/discord-guilds/${encodeURIComponent(guildId)}`;
	const resource = useWorkspaceResource(`${base}/title-roles`);
	const discovery = useWorkspaceResource(`${base}/roles`);
	const [draft, setDraft] = useState(() => resource.data ? { revision: resource.data.revision, roleIds: resource.data.roles.map(role => role.id) } : null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [message, setMessage] = useState('');
	const [pendingDiscard, setPendingDiscard] = useState(null);
	const keepEditing = useRef(null);
	const discardTrigger = useRef(null);
	const inFlight = useRef(false);
	const dirty = Boolean(draft && (!resource.data || draft.roleIds.slice().sort().join(',') !== resource.data.roles.map(role => role.id).sort().join(',')));
	const stale = Boolean(draft && resource.data && draft.revision !== resource.data.revision);
	useEffect(() => {
		if (!draft && resource.data) setDraft({ revision: resource.data.revision, roleIds: resource.data.roles.map(role => role.id) });
	}, [draft, resource.data]);
	useEffect(() => {
		document.title = `${resource.data?.guild?.name ? `${resource.data.guild.name} · ` : ''}${c.title} · Megu`;
	}, [c.title, resource.data?.guild?.name]);
	useDraftGuard(dirty, busy);
	useEffect(() => { if (pendingDiscard) keepEditing.current?.focus(); else discardTrigger.current?.focus(); }, [pendingDiscard]);
	function reset() {
		setDraft(null); setError(''); setMessage('');
	}
	function requestDiscard(action, event) {
		event.preventDefault();
		if (busy || pendingDiscard) return;
		if (!dirty) { if (action === 'back') router.push(back); else reset(); return; }
		discardTrigger.current = event.currentTarget;
		setPendingDiscard(action);
	}
	function cancelDiscard() {
		setPendingDiscard(null);
	}
	async function save(event) {
		event.preventDefault();
		if (inFlight.current || pendingDiscard || !draft || stale || !resource.data) return;
		inFlight.current = true; setBusy(true); setError(''); setMessage('');
		try {
			const response = await fetch(`${base}/title-roles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roleIds: draft.roleIds, expectedRevision: draft.revision }) });
			const body = await response.json();
			if (!response.ok) throw body;
			setMessage(c.saved); await resource.reload(); setDraft(null);
		} catch (problem) {
			setError(problem.code === 'revision_conflict' ? c.changed : t.roleMappings.errors[problem.code] || t.roleMappings.memberErrors[problem.code] || c.saveFailed);
			await resource.reload();
		} finally { inFlight.current = false; setBusy(false); }
	}
	if (resource.error?.status === 401) return <AuthGate title={t.teams.signedOutTitle} lede={t.teams.signedOutLede} />;
	const available = discovery.data?.roles || [];
	return <section className={styles.shell}>
		<Link data-draft-navigation className={styles.back} href={back} onClick={event => requestDiscard('back', event)}><ArrowLeft size={16} />{c.back}</Link>
		<header className={styles.header}>{resource.data?.guild && <ProjectAvatar name={resource.data.guild.name || c.title} avatarUrl={guildIconUrl(resource.data.guild)} className={styles.serverIcon} />}<div><h1>{resource.data?.guild?.name ? c.titleFor(resource.data.guild.name) : c.title}</h1><p>{c.hint}</p></div></header>
		{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
		{resource.error && <div><p role="alert">{resource.error.status === 403 ? c.forbidden : c.loadFailed}</p><button type="button" className="btn btn-secondary" disabled={busy} onClick={resource.reload}>{t.projects.retry}</button></div>}
		{resource.loading && <p role="status">{t.common.loading}</p>}
		{pendingDiscard && <div className={teamStyles.confirmation} role="alertdialog" aria-labelledby="titles-discard-title" aria-describedby="titles-discard-detail" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancelDiscard(); } }}><div><strong id="titles-discard-title">{t.projects.unsavedTitle}</strong><p id="titles-discard-detail">{t.projects.unsavedDetail}</p></div><div className={teamStyles.confirmationActions}><button ref={keepEditing} type="button" className="btn btn-secondary" onClick={cancelDiscard}>{t.projects.keepEditing}</button><button type="button" className="btn btn-danger" onClick={() => { const action = pendingDiscard; setPendingDiscard(null); reset(); if (action === 'back') router.push(back); else discardTrigger.current?.focus(); }}>{t.projects.discardChanges}</button></div></div>}
		{resource.data && draft && <form className={styles.setupForm} onSubmit={save} aria-busy={busy} inert={pendingDiscard ? true : undefined}>
			<p className={styles.notice}>{c.noAccess}</p>
			{stale && <p role="alert">{c.changed}</p>}
			<CustomSelect ariaLabel={c.addRole} placeholder={c.addRole} value="" disabled={busy || stale || resource.loading || discovery.loading || draft.roleIds.length >= 50} options={available.filter(role => !draft.roleIds.includes(role.id)).map(role => ({ value: role.id, label: `${role.name} (${role.id})` }))} onChange={id => setDraft(current => ({ ...current, roleIds: [...new Set([...current.roleIds, id])] }))} />
			{discovery.error && <p role="status">{c.rolesUnavailable} <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={discovery.reload}>{t.projects.retry}</button></p>}
			{!draft.roleIds.length ? <p className={styles.muted}>{c.none}</p> : <ul className={styles.rows}>{draft.roleIds.map(id => {
				const role = available.find(role => role.id === id) || resource.data.roles.find(role => role.id === id);
				return <li className={styles.row} key={id}><div className={styles.identity}><strong>{role?.name || c.unavailableRole}</strong><small>{id}{discovery.data && !available.some(role => role.id === id) ? ` · ${c.unavailableRole}` : ''}</small></div><button type="button" className="btn btn-secondary btn-sm" disabled={busy || stale || resource.loading} aria-label={`${c.remove}: ${role?.name || id}`} onClick={() => setDraft(current => ({ ...current, roleIds: current.roleIds.filter(value => value !== id) }))}>{c.remove}</button></li>;
			})}</ul>}
			<p className={styles.muted}>{c.clearHint}</p>
			<div className={styles.controls}><button type="button" className="btn btn-secondary" disabled={busy || resource.loading || (!dirty && !stale)} onClick={event => requestDiscard('reset', event)}>{c.reset}</button><button className="btn btn-primary" disabled={busy || resource.loading || stale || !dirty}>{busy ? c.saving : c.save}</button></div>
		</form>}
	</section>;
}
