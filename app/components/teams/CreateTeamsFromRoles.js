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

export default function CreateTeamsFromRoles({ guildId }) {
	const { t } = useCopy(); const c = t.roleTeamCreation;
	const router = useRouter(); const back = `/teams/server/${encodeURIComponent(guildId)}`;
	const base = `/api/megu/teams/discord-guilds/${encodeURIComponent(guildId)}`;
	const roles = useWorkspaceResource(`${base}/roles`);
	const [search, setSearch] = useState('');
	const [page, setPage] = useState({ query: '', offset: 0 });
	const owners = useWorkspaceResource(`${base}/role-teams/owners?${new URLSearchParams({ query: page.query, offset: String(page.offset) })}`);
	const [rows, setRows] = useState([]);
	const [preview, setPreview] = useState(null);
	const [attempted, setAttempted] = useState(false);
	const [result, setResult] = useState(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [discard, setDiscard] = useState(false);
	const inFlight = useRef(false); const keepEditing = useRef(null); const discardDialog = useRef(null);
	const frozen = busy || Boolean(preview) || discard;
	const dirty = rows.length > 0 && !result;
	const guild = owners.data?.guild;
	useEffect(() => { document.title = `${guild?.name ? `${guild.name} · ` : ''}${c.title} · Megu`; }, [guild?.name, c.title]);
	useEffect(() => {
		if (!discard) return;
		const trigger = document.activeElement, dialog = discardDialog.current;
		const previousOverflow = document.body.style.overflow;
		dialog.showModal(); document.body.style.overflow = 'hidden'; keepEditing.current?.focus();
		return () => { dialog.close(); document.body.style.overflow = previousOverflow; if (trigger?.isConnected) trigger.focus(); };
	}, [discard]);
	const release = useDraftGuard(dirty, busy);
	const change = (id, patch) => { setRows(current => current.map(row => row.roleId === id ? { ...row, ...patch } : row)); setError(''); };
	function containDiscardFocus(event) {
		if (event.key !== 'Tab') return;
		const buttons = discardDialog.current.querySelectorAll('button:not([disabled])');
		const first = buttons[0], last = buttons[buttons.length - 1];
		if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
			event.preventDefault(); (event.shiftKey ? last : first).focus();
		}
	}
	async function submit(action) {
		if (inFlight.current || discard || (action === 'create' && !preview)) return;
		inFlight.current = true; setBusy(true); setError('');
		if (action === 'create') setAttempted(true);
		try {
			const teams = rows.map(row => ({ roleId: row.roleId, name: row.name, ownerUserId: row.owner?.userId || '' }));
			const response = await fetch(`${base}/role-teams/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'preview' ? { teams } : { teams, requestKey: preview.requestKey, expectedPreview: preview.preview }) });
			const body = await response.json();
			if (!response.ok) throw { status: response.status, code: body.code };
			if (action === 'preview') setPreview({ ...body, requestKey: crypto.randomUUID() });
			else { setResult(body); setRows([]); setPreview(null); setAttempted(false); }
		} catch (problem) {
			const definitive = problem.status >= 400 && problem.status < 500 && ![408, 429].includes(problem.status);
			if (action === 'create' && definitive) { setPreview(null); setAttempted(false); }
			setError(action === 'create' && !definitive ? c.uncertain : c.errors[problem.code] || t.roleMappings.errors[problem.code] || c.failed);
		} finally { inFlight.current = false; setBusy(false); }
	}
	if ([roles.error, owners.error].some(problem => problem?.status === 401)) return <AuthGate title={t.teams.signedOutTitle} lede={t.teams.signedOutLede} />;
	return <section className={styles.shell}>
		<Link data-draft-navigation className={styles.back} href={back} onClick={event => { if (busy || dirty) { event.preventDefault(); if (!busy) setDiscard(true); } }}><ArrowLeft size={16} />{t.serverTitles.back}</Link>
		<header className={styles.header}>{guild && <ProjectAvatar name={guild.name || c.title} avatarUrl={guildIconUrl(guild)} className={styles.serverIcon} />}<div><h1>{c.title}</h1>{guild?.name && <p>{guild.name}</p>}<p>{c.hint}</p></div></header>
		<dialog ref={discardDialog} onKeyDown={containDiscardFocus} role="alertdialog" aria-modal="true" aria-labelledby="role-team-discard" className={`${teamStyles.confirmation} ${styles.discardDialog}`} onCancel={event => { event.preventDefault(); setDiscard(false); }}><div><strong id="role-team-discard">{t.projects.unsavedTitle}</strong><p>{attempted ? c.uncertain : t.projects.unsavedDetail}</p></div><div className={teamStyles.confirmationActions}><button ref={keepEditing} className="btn btn-secondary" onClick={() => setDiscard(false)}>{t.projects.keepEditing}</button><button className="btn btn-danger" onClick={() => { release(); router.push(back); }}>{t.projects.discardChanges}</button></div></dialog>
		{error && <p className={teamStyles.error} role="alert">{error}</p>}
		{result ? <section role="status"><h2>{c.created}</h2><p className={styles.muted}>{c.consent}</p><ul>{result.teams.map(team => <li key={team.id}>{team.name}</li>)}</ul><Link className="btn btn-primary" href={back}>{t.serverTitles.back}</Link></section> : <div inert={discard ? true : undefined}>
			<p className={styles.notice}>{c.safety}</p>
			{(roles.error || owners.error) && <p role="alert">{[roles.error, owners.error].some(problem => problem?.status === 403) ? c.forbidden : c.discoveryFailed} <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { roles.reload(); owners.reload(); }}>{t.projects.retry}</button></p>}
			{(roles.loading || owners.loading) && <p role="status">{t.common.loading}</p>}
			{roles.data && <>
				<div className={styles.setupForm}><CustomSelect ariaLabel={c.addRole} placeholder={c.addRole} value="" disabled={frozen || roles.loading || rows.length >= 10} options={roles.data.roles.filter(role => !rows.some(row => row.roleId === role.id)).map(role => ({ value: role.id, label: role.name, subtitle: role.id, color: role.color }))} onChange={id => { const role = roles.data.roles.find(role => role.id === id); setRows(current => [...current, { roleId: id, roleName: role.name, name: role.name.slice(0, 120), owner: null }]); setError(''); }} /></div>
				<form className={styles.searchForm} onSubmit={event => { event.preventDefault(); setPage({ query: search.trim(), offset: 0 }); }}><label htmlFor="role-owner-search">{c.searchOwners}</label><div className={styles.controls}><input id="role-owner-search" value={search} maxLength={100} disabled={frozen} onChange={event => setSearch(event.target.value)} /><button className="btn btn-secondary" disabled={frozen}>{c.search}</button></div><p className={styles.muted}>{c.partial}</p><div className={styles.controls}>{page.offset > 0 && <button type="button" className="btn btn-secondary btn-sm" disabled={frozen || owners.loading} onClick={() => setPage(current => ({ ...current, offset: Math.max(0, current.offset - 30) }))}>{t.serverWorkspaces.previous}</button>}{owners.data?.nextOffset != null && <button type="button" className="btn btn-secondary btn-sm" disabled={frozen || owners.loading} onClick={() => setPage(current => ({ ...current, offset: owners.data.nextOffset }))}>{t.serverWorkspaces.next}</button>}</div>{owners.data && !owners.data.candidates.length && <p role="status">{c.noOwners}</p>}</form>
				<form onSubmit={event => { event.preventDefault(); submit('preview'); }} aria-busy={busy}>
					{!rows.length && <p className={styles.muted}>{c.empty}</p>}
					{rows.map(row => { const candidates = [...new Map([...(row.owner ? [row.owner] : []), ...(owners.data?.candidates || [])].map(owner => [owner.userId, owner])).values()]; return <fieldset key={row.roleId} className={styles.roleCreationRow} disabled={frozen}><legend>{row.roleName} <small>{row.roleId}</small></legend><label>{c.teamName}<input value={row.name} maxLength={120} required onChange={event => change(row.roleId, { name: event.target.value })} /></label><div className={teamStyles.field}><span>{c.owner}</span><CustomSelect type="member" ariaLabel={`${c.owner}: ${row.roleName}`} placeholder={c.chooseOwner} required value={row.owner?.userId || ''} disabled={frozen || owners.loading || Boolean(owners.error)} options={candidates.map(owner => ({ value: owner.userId, label: owner.displayName, subtitle: owner.discordUserId, avatar: owner.avatarUrl }))} onChange={id => change(row.roleId, { owner: candidates.find(owner => owner.userId === id) })} /></div><button type="button" className="btn btn-secondary" onClick={() => setRows(current => current.filter(item => item.roleId !== row.roleId))}>{c.remove}</button></fieldset>; })}
					{!preview && <div className={teamStyles.actions}><button className="btn btn-primary" disabled={busy || !rows.length || rows.some(row => !row.name.trim() || !row.owner) || Boolean(roles.error || owners.error) || roles.loading || owners.loading}>{busy ? c.checking : c.preview}</button></div>}
				</form>
			</>}
			{preview && <section className={styles.rows} aria-labelledby="role-team-preview"><h2 id="role-team-preview">{c.previewTitle}</h2><p className={styles.muted}>{c.consent}</p><ul>{preview.teams.map(team => <li key={team.roleId}>{c.previewRow(team.name, team.roleName, team.ownerName)}</li>)}</ul><div className={teamStyles.actions}>{!attempted && <button className="btn btn-secondary" disabled={busy} onClick={() => { setPreview(null); setError(''); }}>{c.edit}</button>}<button className="btn btn-primary" disabled={busy} onClick={() => submit('create')}>{busy ? c.creating : attempted ? t.projects.retry : c.create}</button></div></section>}
		</div>}
	</section>;
}
