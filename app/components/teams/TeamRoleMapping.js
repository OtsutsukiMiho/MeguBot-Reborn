'use client';

import { useEffect, useRef, useState } from 'react';
import { Hash } from 'lucide-react';
import { useCopy } from '../../copy';
import CustomSelect from '../CustomSelect';
import AuthGate from '../AuthGate';
import ProjectAvatar from '../projects/ProjectAvatar';
import useWorkspaceResource from '../useWorkspaceResource';
import useDraftGuard, { requestDraftNavigation } from '../useDraftGuard';
import styles from '../../teams/teams.module.css';

export default function TeamRoleMapping({ team, readError, serverManagement = false }) {
	const { t } = useCopy();
	const c = t.roleMappings;
	const endpoint = serverManagement ? `/api/megu/teams/discord-guilds/${team.discordGuild.id}/role-mappings/${encodeURIComponent(team.id)}` : `/api/megu/teams/${encodeURIComponent(team.id)}/role-mapping`;
	const resource = useWorkspaceResource(endpoint);
	const syncResource = useWorkspaceResource(resource.data ? `${endpoint}/sync` : null);
	const [roles, setRoles] = useState(null);
	const [syncLocked, setSyncLocked] = useState(false);
	const [selected, setSelected] = useState([]);
	const [shared, setShared] = useState(false);
	const [removing, setRemoving] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [message, setMessage] = useState('');
	const mapping = resource.data?.mapping;
	const automaticBlocked = mapping?.mode === 'automatic';
	const dirty = roles !== null && (shared || JSON.stringify([...selected].sort()) !== JSON.stringify((mapping?.roles || []).map(role => role.id).sort()));
	useDraftGuard(dirty, busy);
	const cancelEdit = () => { if (requestDraftNavigation(() => setRoles(null))) setRoles(null); };
	const explain = problem => (serverManagement ? c.errors[problem?.code] : c.memberErrors[problem?.code]) || c.errors[problem?.code] || c.memberErrors[problem?.code] || readError(problem);
	async function edit() {
		setBusy(true); setError(''); setMessage('');
		try {
			const response = await fetch(`/api/megu/teams/discord-guilds/${team.discordGuild.id}/roles`);
			const body = await response.json(); if (!response.ok) throw body;
			setRoles(body.roles); setSelected(mapping?.roles.map(role => role.id) || []); setShared(false);
		} catch (problem) { setError(explain(problem)); }
		finally { setBusy(false); }
	}
	async function mutate(action) {
		setBusy(true); setError(''); setMessage('');
		try {
			const url = action === 'save' ? `/api/megu/teams/discord-guilds/${team.discordGuild.id}/role-mappings/${encodeURIComponent(team.id)}` : action === 'approve' ? `${endpoint}/approve` : endpoint;
			const body = { expectedRevision: mapping?.revision || 0, ...(action === 'save' ? { roleIds: selected, confirmSharedRoles: shared } : {}) };
			const response = await fetch(url, { method: action === 'remove' ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
			const result = await response.json(); if (!response.ok) throw result;
			setRoles(null); setRemoving(false); setMessage(c.saved); await resource.reload(); await syncResource.reload();
		} catch (problem) { setError(explain(problem)); }
		finally { setBusy(false); }
	}
	if(resource.error?.status===401)return <AuthGate title={t.teams.signedOutTitle} lede={t.teams.signedOutLede} />;
	return <section id={serverManagement ? undefined : 'discord-roles'} className={styles.section} aria-labelledby="team-role-mapping-title">
		<h2 id="team-role-mapping-title">{c.title}</h2><p className={styles.lede}>{c.hint}</p><p className={styles.lede}>{serverManagement ? c.ux.manager : c.ux.owner}</p><details><summary>{c.ux.howMembershipWorks}</summary><p>{c.ux.approval}</p><p>{c.ux.automatic}</p></details>
		{error && <p className={styles.error} role="alert">{error}</p>}{message && <p role="status">{message}</p>}
		{!resource.data ? <><p role={resource.error ? 'alert' : 'status'}>{resource.loading ? t.common.loading : resource.error ? explain(resource.error) : c.loadFailed}</p>{resource.error && <button type="button" className="btn btn-secondary" onClick={resource.reload}>{t.projects.retry}</button>}</> : <>
			<h3>{c.ux.configuration}</h3><p className={styles.roleMappingStatus}>{automaticBlocked ? syncResource.data?.supported ? mapping.enabled ? c.sync.active : c.sync.paused : c.automaticBlocked : mapping ? mapping.enabled ? c.approved : c.pending : c.none}</p>
			{mapping && <><ul className={styles.roleLinks}>{mapping.roles.map(role => <li className={styles.roleLink} key={role.id}><Hash size={16} aria-hidden="true" /><span><strong>{role.name}</strong><small>{c.discordRoleId}: {role.id}</small></span></li>)}</ul><p className={styles.roleLinkHint}>{mapping.mode === 'automatic' ? c.roleLinkAutomaticHint : c.roleLinkReviewHint}</p></>}
			{roles !== null ? <form className={styles.form} onSubmit={event => { event.preventDefault(); mutate('save'); }}>
				<div className={styles.wide}><CustomSelect ariaLabel={c.addRole} placeholder={c.addRole} value="" disabled={busy || syncLocked || selected.length >= 50} options={roles.filter(role => !selected.includes(role.id)).map(role => ({ value: role.id, label: `${role.name} (${role.id})` }))} onChange={id => setSelected(current => [...current, id])} /></div>
				<ul className={styles.wide}>{selected.map(id => <li key={id}>{roles.find(role => role.id === id)?.name || mapping?.roles.find(role => role.id === id)?.name || id} <button type="button" className="btn btn-secondary btn-sm" disabled={busy || syncLocked} aria-label={c.removeRole(id)} onClick={() => setSelected(current => current.filter(value => value !== id))}>{c.remove}</button></li>)}</ul>
				<label className={`${styles.goalCheck} ${styles.wide}`}><input type="checkbox" checked={shared} disabled={busy || syncLocked} onChange={event => setShared(event.target.checked)} /> {c.shared}</label>
				<div className={`${styles.actions} ${styles.wide}`}><button type="button" className="btn btn-secondary" disabled={busy || syncLocked} onClick={cancelEdit}>{t.teams.cancel}</button><button className="btn btn-primary" disabled={busy || syncLocked || selected.length === 0}>{c.propose}</button></div>
			</form> : <div className={`${styles.actions} ${styles.roleMappingActions}`}>
				<button type="button" className="btn btn-secondary" disabled={busy || syncLocked} onClick={() => { setError(''); setMessage(''); resource.reload(); syncResource.reload(); }}>{c.reloadConfiguration}</button>
				<button type="button" className="btn btn-secondary" disabled={busy || syncLocked || team.archivedAt || automaticBlocked} onClick={edit}>{c.configure}</button>
				{mapping && team.role === 'owner' && !team.archivedAt && !automaticBlocked && <>{!mapping.enabled && <button type="button" className="btn btn-primary" disabled={busy || syncLocked} onClick={() => mutate('approve')}>{c.approve}</button>}<button type="button" className="btn btn-secondary" disabled={busy || syncLocked} onClick={() => setRemoving(true)}>{c.unlink}</button></>}
			</div>}
			{removing && <div role="group" aria-label={c.unlink}><p>{c.unlinkHint}</p><div className={styles.actions}><button type="button" className="btn btn-secondary" disabled={busy || syncLocked} onClick={() => setRemoving(false)}>{t.teams.cancel}</button><button type="button" className="btn btn-danger" disabled={busy || syncLocked} onClick={() => mutate('remove')}>{c.unlink}</button></div></div>}
			{mapping?.enabled && !team.archivedAt && !serverManagement && !automaticBlocked && <RoleMembers key={mapping.revision} endpoint={endpoint} revision={mapping.revision} explain={explain} disabled={busy || syncLocked || roles !== null || removing} />}
			<RoleSyncControls team={team} mapping={mapping} endpoint={endpoint} resource={syncResource} serverManagement={serverManagement} explain={explain} disabled={busy || roles !== null || removing} onLockChange={setSyncLocked} onChanged={async()=>{await resource.reload();await syncResource.reload();}} />
		</>}
	</section>;
}

function RoleSyncControls({ team, mapping, endpoint, resource, serverManagement, explain, disabled, onChanged, onLockChange }) {
	const { t, lang } = useCopy(), s = t.roleMappings.sync;
	const [preview, setPreview] = useState(null), [ack, setAck] = useState(false), [busy, setBusy] = useState(false);
	const [error, setError] = useState(''), [message, setMessage] = useState(''), [uncertain, setUncertain] = useState(false);
	const attempt = useRef(null);
	useEffect(()=>{onLockChange?.(Boolean(busy || uncertain || preview || ack));return ()=>onLockChange?.(false);},[busy,uncertain,preview,ack,onLockChange]);
	useDraftGuard(Boolean(preview || ack || uncertain), busy);
	const status = resource.data, locked = disabled || busy || uncertain || resource.loading || Boolean(resource.error);
	const owner = !serverManagement && status?.canConfirmTransitions;
	async function review(action, offset = 0) {
		setBusy(true); setError(''); setMessage(''); setAck(false); setPreview(null);
		try {
			const response = await fetch(`${endpoint}/sync/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: status.revision, action, offset }) });
			const body = await response.json(); if (!response.ok) throw body;
			if (!body.previewToken || body.action !== action || body.revision !== status.revision) throw new Error('Invalid preview');
			setPreview(body);
		} catch (problem) { setError(s.errors[problem.code] || explain(problem)); }
		finally { setBusy(false); }
	}
	async function save(operation = 'consent') {
		if (!attempt.current) attempt.current = { url: operation === 'reconcile' ? `${endpoint}/sync/reconcile` : serverManagement ? `${endpoint}/automatic` : `${endpoint}/sync/confirm`, body: {
			expectedRevision: preview?.revision ?? status.revision, requestKey: crypto.randomUUID(),
			...(operation === 'reconcile' ? {} : {delegationVersion: status.policyVersion, confirmedDelegation: true, ...(serverManagement ? {} : { action: preview.action, previewToken: preview.previewToken })}) } };
		setBusy(true); setError(''); setMessage('');
		let definitive = false, recoveryDenied = false;
		try {
			const response = await fetch(attempt.current.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(attempt.current.body) });
			definitive = response.status >= 400 && response.status < 500;
			recoveryDenied = uncertain && [401,403,404,429].includes(response.status);
			const body = await response.json(); if (!response.ok) throw body;
			if (!body.id || !Number.isSafeInteger(body.revision) || !['awaiting_automatic_owner_consent','reconciliation_queued','retirement_queued'].includes(body.status)) throw new Error('Invalid receipt');
			attempt.current = null; setUncertain(false); setPreview(null); setAck(false); setMessage(body.status === 'awaiting_automatic_owner_consent' ? s.requested : s.queued);
		} catch (problem) {
			if (definitive && !recoveryDenied && !(uncertain && problem.code === 'role_mapping_automatic_not_supported')) { attempt.current = null; setUncertain(false); setError(s.errors[problem.code] || explain(problem)); }
			else { setUncertain(true); setError(s.uncertain); }
		} finally { setBusy(false); }
		if (!attempt.current && !definitive) await onChanged();
	}
	if (!status?.supported && !resource.error && !uncertain) return null;
	return <section className={styles.section} aria-label={s.title}>
		<h3>{s.title}</h3><p className={styles.lede}>{s.policy}</p>
		{resource.error && <p className={styles.error} role="alert">{explain(resource.error)}</p>}
		{error && <p className={styles.error} role="alert">{error}</p>}{message && <p role="status">{message}</p>}
		{status?.supported && <>
			{!status.capability?.available && <p role="status">{s.unavailable}</p>}
			{status.pendingDelegation && <p>{s.pending}</p>}
			{status.jobs.map((job, index) => <div key={index}><p>{s.states[job.state] || s.states.degraded}{job.lastSuccessAt && <> · {s.lastSuccess}: <time dateTime={job.lastSuccessAt}>{new Date(job.lastSuccessAt).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</time></>}</p>{job.counts && <p>{s.counts(job.counts.granted,job.counts.revoked,job.counts.blocked,job.counts.capacityBlocked)}</p>}</div>)}
			{status.blockedRevocations?.length > 0 && <><p>{s.blockedHint}</p><ul>{status.blockedRevocations.map(row => <li key={row.userId}>{row.userId} · {s.ownershipBlock}</li>)}</ul>{status.moreBlockedRevocations && <p>{s.moreBlocked}</p>}</>}
			{!preview && !uncertain && <div className={styles.headerActions}>
				{serverManagement && mapping && !status.retired && !(mapping.mode === 'automatic' && mapping.enabled) && <form onSubmit={event=>{event.preventDefault();save();}}>
					<label className={styles.goalCheck}><input type="checkbox" checked={ack} disabled={locked || !status.capability?.available} onChange={event=>setAck(event.target.checked)} />{s.ack}</label>
					<button className="btn btn-primary" disabled={locked || !ack || !status.capability?.available}>{s.request}</button>
				</form>}
				{owner && status.pendingDelegation && <button type="button" className="btn btn-primary" disabled={locked || !status.capability?.available} onClick={()=>review('enable')}>{s.review}</button>}
				{owner && mapping?.mode === 'automatic' && !status.retired && <>{mapping.enabled && <button type="button" className="btn btn-secondary" disabled={locked} onClick={()=>review('disable')}>{s.disable}</button>}<button type="button" className="btn btn-secondary" disabled={locked} onClick={()=>review('approval')}>{s.approval}</button><button type="button" className="btn btn-secondary" disabled={locked} onClick={()=>review('unlink')}>{s.unlink}</button></>}
				{(owner || serverManagement) && (mapping?.mode === 'automatic' || status.retired) && <button type="button" className="btn btn-secondary" disabled={locked} onClick={()=>save('reconcile')}>{s.reconcile}</button>}
			</div>}
			{preview && <div role="group" aria-label={s.review}>
				<h4>{s.actions[preview.action]}</h4><p>{s.impact(preview.impact.derivedSources,preview.impact.finalSources,preview.impact.ownershipBlocks)}</p><p>{s.retention}</p>
				{preview.memberPreview && <><p>{s.partial}</p><ul>{preview.memberPreview.candidates.map(row=><li key={row.discordUserId}>{row.displayName} · {row.restoreRequired ? s.suppressed : row.userId ? row.teamRole ? s.existing : s.registered : s.unregistered}</li>)}</ul>{preview.memberPreview.nextOffset !== null && <button type="button" className="btn btn-secondary" disabled={locked} onClick={()=>review(preview.action,preview.memberPreview.nextOffset)}>{t.roleMappings.next}</button>}</>}
				<label className={styles.goalCheck}><input type="checkbox" checked={ack} disabled={locked} onChange={event=>setAck(event.target.checked)} />{preview.action === 'enable' ? s.ack : s.retireAck}</label>
				<div className={styles.headerActions}><button type="button" className="btn btn-secondary" disabled={busy || uncertain} onClick={()=>{if(requestDraftNavigation(()=>{setPreview(null);setAck(false);})) {setPreview(null);setAck(false);}}}>{t.teams.cancel}</button><button type="button" className="btn btn-primary" disabled={locked || !ack || !owner} onClick={()=>save()}>{s.confirm}</button></div>
			</div>}
		</>}
		{uncertain && <button type="button" className="btn btn-primary" disabled={busy || disabled || resource.loading || Boolean(resource.error) || !status?.supported || (!serverManagement && !status?.canConfirmTransitions)} onClick={()=>save()}>{s.retrySave}</button>}
		<button type="button" className="btn btn-secondary" disabled={busy} onClick={resource.reload}>{s.refresh}</button>
	</section>;
}

function RoleMembers({ endpoint, revision, explain, disabled }) {
	const { t } = useCopy();
	const c = t.roleMappings;
	const [opened, setOpened] = useState(false);
	return <section className={styles.section} aria-label={c.membersTitle}>
		<h3>{c.membersTitle}</h3><p className={styles.lede}>{c.membersHint}</p>
		{opened ? <RoleMemberPage endpoint={endpoint} revision={revision} explain={explain} disabled={disabled} /> : <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => setOpened(true)}>{c.preview}</button>}
	</section>;
}

function RoleMemberPage({ endpoint, revision, explain, disabled }) {
	const { t } = useCopy();
	const c = t.roleMappings;
	const [offset, setOffset] = useState(0);
	const resource = useWorkspaceResource(`${endpoint}/members?offset=${offset}`);
	const [busy, setBusy] = useState(false);
	const [restore, setRestore] = useState(null);
	const [error, setError] = useState('');
	const [message, setMessage] = useState('');
	const stale = resource.data?.revision !== revision;
	async function approve(candidate) {
		setBusy(true); setError(''); setMessage('');
		try {
			const response = await fetch(`${endpoint}/members`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: candidate.userId, expectedRevision: revision, expectedTeamRevision: resource.data?.teamRevision, restoreRemoved: candidate.restoreRequired && restore === candidate.userId }) });
			const body = await response.json(); if (!response.ok) throw body;
			setRestore(null); setMessage(c.memberApproved(candidate.displayName)); await resource.reload();
		} catch (problem) { setError(explain(problem)); }
		finally { setBusy(false); }
	}
	async function dismiss(candidate) {
		setBusy(true); setError(''); setMessage('');
		try {
			const response = await fetch(`${endpoint}/suggestions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ discordUserId: candidate.discordUserId, dismissed: !candidate.dismissed, expectedRevision: revision }) });
			const body = await response.json(); if (!response.ok) throw body;
			setRestore(null); setMessage(candidate.dismissed ? c.suggestionReset : c.suggestionDismissed); await resource.reload();
		} catch (problem) { setError(explain(problem)); }
		finally { setBusy(false); }
	}
	const unavailable = disabled || busy || resource.loading || stale;
	return <div aria-busy={busy || resource.loading}>
		<p className={styles.lede}>{c.partialHint}</p><p className={styles.lede}>{c.dismissHint}</p>
		{(error || resource.error) && <p className={styles.error} role="alert">{error || explain(resource.error)}</p>}
		{message && <p role="status">{message}</p>}
		{resource.loading && <p role="status">{t.common.loading}</p>}
		{resource.data && stale && <p role="alert">{c.changed}</p>}
		{!resource.loading && resource.data && !resource.data.candidates.length && <p className={styles.lede}>{c.noMatches}</p>}
		<div className={styles.discordCandidates}>{!resource.loading && resource.data?.candidates.map(candidate => <div className={`${styles.discordCandidate} ${styles.roleCandidate}`} key={candidate.discordUserId}>
			<ProjectAvatar name={candidate.displayName} avatarUrl={candidate.avatarUrl} className={styles.avatar} />
			<div className={styles.memberIdentity}><strong>{candidate.displayName}</strong><small>{candidate.teamRole ? t.teams.alreadyTeamMember : candidate.dismissed ? c.dismissed : !candidate.linkedAccount ? t.teams.needsMeguAccount : candidate.restoreRequired ? c.removedMember : c.eligibleMember}</small></div>
			{candidate.teamRole ? <span className={styles.role}>{t.teams.role[candidate.teamRole]}</span> : <div className={styles.actions}>
				<button type="button" className="btn btn-secondary btn-sm" disabled={unavailable} aria-label={`${candidate.dismissed ? c.resetSuggestion : c.dismissSuggestion}: ${candidate.displayName}`} onClick={() => dismiss(candidate)}>{candidate.dismissed ? c.resetSuggestion : c.dismissSuggestion}</button>
				{!candidate.dismissed && candidate.linkedAccount && <>
					{candidate.restoreRequired && <button type="button" className="btn btn-secondary btn-sm" disabled={unavailable} aria-expanded={restore === candidate.userId} onClick={() => setRestore(current => current === candidate.userId ? null : candidate.userId)}>{c.reviewRestore}</button>}
					{(!candidate.restoreRequired || restore === candidate.userId) && <>
					{candidate.restoreRequired && <><span>{c.restoreHint}</span><button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={event => { setRestore(null); event.currentTarget.parentElement.querySelector('button[aria-expanded]')?.focus(); }}>{t.teams.cancel}</button></>}
					<button type="button" className="btn btn-primary btn-sm" disabled={unavailable} aria-label={`${candidate.restoreRequired ? c.confirmRestore : c.approveMember}: ${candidate.displayName}`} onClick={() => approve(candidate)}>{candidate.restoreRequired ? c.confirmRestore : c.approveMember}</button>
					</>}
				</>}
			</div>}
		</div>)}</div>
		<div className={styles.discordRosterFooter}>
			<button type="button" className="btn btn-secondary btn-sm" disabled={busy || resource.loading || disabled} onClick={resource.reload}>{c.refresh}</button>
			<div className={styles.actions}>{offset > 0 && <button type="button" className="btn btn-secondary btn-sm" disabled={busy || resource.loading} onClick={() => { setRestore(null); setOffset(Math.max(0, offset - 30)); }}>{c.previous}</button>}{resource.data?.nextOffset != null && <button type="button" className="btn btn-secondary btn-sm" disabled={unavailable} onClick={() => { setRestore(null); setOffset(resource.data.nextOffset); }}>{c.next}</button>}</div>
		</div>
	</div>;
}
