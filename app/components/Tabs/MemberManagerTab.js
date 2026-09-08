'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clipboard, RefreshCw } from 'lucide-react';
import { useCopy } from '../../copy';
import { TabActionBar, TabDialog, TabEmpty, TabFieldMessage, TabFilterBar, TabInlineActions, TabPagination, TabStatus, TabTable, TabWorkspace, tabWorkspaceStyles } from './TabWorkspace';

function roleColor(value) {
	if (!value || value === '#000000') return '#8A8F9E';
	if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return value;
	const numeric = Number(value);
	return Number.isFinite(numeric) ? `#${numeric.toString(16).padStart(6, '0').slice(-6)}` : '#8A8F9E';
}

function MemberIdentity({ member, shared }) {
	const [failed, setFailed] = useState(false);
	const name = member.displayName || member.username || shared.unknownMember;
	useEffect(() => setFailed(false), [member.avatar]);
	return (
		<div className={tabWorkspaceStyles.compactIdentity}>
			{member.avatar && !failed ? <img className={tabWorkspaceStyles.compactAvatar} src={member.avatar} alt="" onError={() => setFailed(true)} /> : <span className={tabWorkspaceStyles.compactAvatar} aria-hidden="true">{name.slice(0, 2).toUpperCase()}</span>}
			<div><strong>{name}</strong><small>@{member.username || shared.unknownUsername}{member.isBot ? ` · ${shared.bot}` : ''}</small></div>
		</div>
	);
}

function compareSnowflakes(a, b) {
	try { return BigInt(a || 0) < BigInt(b || 0) ? -1 : BigInt(a || 0) > BigInt(b || 0) ? 1 : 0; }
	catch { return String(a).localeCompare(String(b)); }
}

export default function MemberManagerTab({ guildId, roles = [], initialMembers = [], showToast, onRefresh, onEditorDirtyChange }) {
	const { t } = useCopy();
	const copy = t.serverTabs.members;
	const shared = t.serverTabs.shared;
	const [search, setSearch] = useState('');
	const [filter, setFilter] = useState('all');
	const [sort, setSort] = useState('name_asc');
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(15);
	const [members, setMembers] = useState(initialMembers);
	const [refreshing, setRefreshing] = useState(false);
	const [expanded, setExpanded] = useState(new Set());
	const [copiedId, setCopiedId] = useState('');
	const [editingMember, setEditingMember] = useState(null);
	const [roleSearch, setRoleSearch] = useState('');
	const [selectedRoles, setSelectedRoles] = useState(new Set());
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState('');

	useEffect(() => setMembers(Array.isArray(initialMembers) ? initialMembers : []), [initialMembers]);
	useEffect(() => setPage(1), [search, filter, sort, pageSize]);

	const roleMap = useMemo(() => new Map(roles.map(role => [String(role.id), role])), [roles]);
	const filtered = useMemo(() => {
		const query = search.trim().toLocaleLowerCase();
		return [...members].filter(member => {
			if (filter === 'humans' && member.isBot) return false;
			if (filter === 'bots' && !member.isBot) return false;
			if (!query) return true;
			return [member.displayName, member.username, member.id].some(value => String(value || '').toLocaleLowerCase().includes(query));
		}).sort((a, b) => {
			if (sort === 'name_desc') return (b.displayName || b.username || '').localeCompare(a.displayName || a.username || '');
			if (sort === 'id_asc') return compareSnowflakes(a.id, b.id);
			if (sort === 'id_desc') return compareSnowflakes(b.id, a.id);
			if (sort === 'roles_desc') return (b.roles?.length || 0) - (a.roles?.length || 0);
			return (a.displayName || a.username || '').localeCompare(b.displayName || b.username || '');
		});
	}, [filter, members, search, sort]);
	const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
	const currentPage = Math.min(page, totalPages);
	const start = (currentPage - 1) * pageSize;
	const visibleMembers = filtered.slice(start, start + pageSize);
	const editorRoles = useMemo(() => roles.filter(role => !roleSearch.trim() || role.name.toLocaleLowerCase().includes(roleSearch.trim().toLocaleLowerCase()) || String(role.id).includes(roleSearch.trim())), [roleSearch, roles]);

	const openEditor = member => {
		setEditingMember(member);
		setSelectedRoles(new Set((member.roles || []).map(String)));
		setRoleSearch('');
		setSaveError('');
	};
	const originalRoles = new Set((editingMember?.roles || []).map(String));
	const addedCount = [...selectedRoles].filter(id => !originalRoles.has(id)).length;
	const removedCount = [...originalRoles].filter(id => !selectedRoles.has(id)).length;
	const editorDirty = Boolean(editingMember && (addedCount || removedCount));
	useEffect(() => {
		onEditorDirtyChange?.('members', editorDirty);
		return () => onEditorDirtyChange?.('members', false);
	}, [editorDirty, onEditorDirtyChange]);

	const saveRoles = async () => {
		if (!editingMember) return;
		setSaving(true);
		setSaveError('');
		try {
			const response = await fetch(`/api/guilds/${guildId}/members/${editingMember.id}/roles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roleIds: [...selectedRoles] }) });
			const data = await response.json().catch(() => { throw new Error(copy.unexpectedError); });
			if (!response.ok || !data.success) throw new Error(data.error || copy.updateError);
			const nextRoles = data.roles || [...selectedRoles];
			setMembers(current => current.map(member => member.id === editingMember.id ? { ...member, roles: nextRoles } : member));
			showToast(copy.updateSuccess(editingMember.displayName || editingMember.username));
			setEditingMember(null);
		} catch (error) {
			setSaveError(error.message || copy.updateError);
			showToast(error.message || copy.updateError, true);
		} finally { setSaving(false); }
	};

	const refresh = async () => {
		setRefreshing(true);
		try { const refreshed = await onRefresh?.(); if (refreshed === false) return; showToast(copy.refreshSuccess); }
		catch { showToast(copy.updateError, true); }
		finally { setRefreshing(false); }
	};
	const copyId = async member => {
		try { await navigator.clipboard.writeText(String(member.id)); setCopiedId(member.id); showToast(copy.copied); window.setTimeout(() => setCopiedId(''), 1800); }
		catch { showToast(copy.copyId, true); }
	};

	return (
		<TabWorkspace>
			<TabActionBar actions={<TabStatus tone="accent">{copy.count(members.length)}</TabStatus>}><span>{shared.loadedMatches(filtered.length)}</span></TabActionBar>
			<TabFilterBar actions={<button type="button" className="btn btn-secondary" onClick={refresh} disabled={refreshing}><RefreshCw size={16} aria-hidden="true" /> {refreshing ? shared.working : shared.refresh}</button>}>
				<div className="form-group"><label className="form-label" htmlFor="member-search">{copy.search}</label><input id="member-search" className="form-control" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={copy.searchPlaceholder} /></div>
				<div className="form-group"><label className="form-label" htmlFor="member-filter">{copy.filter}</label><select id="member-filter" className="form-control" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">{copy.all}</option><option value="humans">{copy.humans}</option><option value="bots">{copy.bots}</option></select></div>
				<div className="form-group"><label className="form-label" htmlFor="member-sort">{copy.sort}</label><select id="member-sort" className="form-control" value={sort} onChange={event => setSort(event.target.value)}><option value="name_asc">{copy.nameAsc}</option><option value="name_desc">{copy.nameDesc}</option><option value="id_asc">{copy.idAsc}</option><option value="id_desc">{copy.idDesc}</option><option value="roles_desc">{copy.rolesDesc}</option></select></div>
				<div className="form-group"><label className="form-label" htmlFor="member-page-size">{copy.perPage}</label><select id="member-page-size" className="form-control" value={pageSize} onChange={event => setPageSize(Number(event.target.value))}><option value="15">15</option><option value="30">30</option></select></div>
			</TabFilterBar>

			{visibleMembers.length ? <><TabTable label={copy.member} mobileRecords><table><thead><tr><th>{copy.member}</th><th>{copy.roles}</th><th>{copy.actions}</th></tr></thead><tbody>{visibleMembers.map(member => {
				const memberRoles = (member.roles || []).map(id => roleMap.get(String(id))).filter(Boolean);
				const showAll = expanded.has(member.id);
				const shownRoles = showAll ? memberRoles : memberRoles.slice(0, 3);
				return <tr key={member.id}>
					<td data-label={copy.member}><MemberIdentity member={member} shared={shared} /><TabInlineActions align="start"><button type="button" className="btn btn-secondary btn-sm" onClick={() => copyId(member)}><Clipboard size={14} aria-hidden="true" /> {copiedId === member.id ? copy.copied : copy.copyId}</button></TabInlineActions></td>
					<td data-label={copy.roles}><div className={tabWorkspaceStyles.tagList}>{shownRoles.length ? shownRoles.map(role => <span key={role.id} className={tabWorkspaceStyles.tag}>@{role.name}</span>) : <span>{copy.roles}: 0</span>}{memberRoles.length > 3 ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(member.id)) next.delete(member.id); else next.add(member.id); return next; })}>{showAll ? copy.showLess : copy.showAll(memberRoles.length)}</button> : null}</div></td>
					<td data-label={copy.actions}><button type="button" className="btn btn-primary btn-sm" onClick={() => openEditor(member)}>{copy.manage}</button></td>
				</tr>;
			})}</tbody></table></TabTable><TabPagination page={currentPage} totalPages={totalPages} onPageChange={setPage} summary={shared.showing(start + 1, Math.min(start + pageSize, filtered.length), filtered.length)} /></> : <TabEmpty title={copy.emptyTitle} description={copy.emptyDescription} action={(search || filter !== 'all') ? <button type="button" className="btn btn-secondary" onClick={() => { setSearch(''); setFilter('all'); }}>{shared.clearFilters}</button> : null} />}

			<TabDialog open={!!editingMember} onClose={saving ? undefined : () => setEditingMember(null)} title={copy.editorTitle(editingMember?.displayName || editingMember?.username || '')} description={copy.editorDescription} footer={<><button type="button" className="btn btn-secondary" onClick={() => setEditingMember(null)} disabled={saving}>{shared.cancel}</button><button type="button" className="btn btn-primary" onClick={saveRoles} disabled={saving || (!addedCount && !removedCount)}>{saving ? shared.working : copy.apply}</button></>}>
				<div className="form-group"><label className="form-label" htmlFor="member-role-search">{copy.roleSearch}</label><input id="member-role-search" className="form-control" type="search" value={roleSearch} onChange={event => setRoleSearch(event.target.value)} /></div>
				<TabFieldMessage>{copy.changes(addedCount, removedCount)}</TabFieldMessage>
				{saveError ? <TabFieldMessage id="member-role-error" tone="error">{saveError}</TabFieldMessage> : null}
				<div className={tabWorkspaceStyles.editorList} role="group" aria-label={copy.roles} aria-describedby={saveError ? 'member-role-error' : undefined}>{editorRoles.map(role => {
					const roleId = String(role.id);
					const baseRole = role.name === '@everyone' || roleId === String(guildId);
					const locked = role.managed || baseRole || role.canManage === false;
					const reason = role.managed ? copy.managedRoleReason : baseRole ? copy.everyoneRoleReason : copy.hierarchyRoleReason;
					return <label key={role.id} className={tabWorkspaceStyles.editorOption}><input type="checkbox" checked={selectedRoles.has(roleId)} disabled={locked} onChange={() => setSelectedRoles(current => { const next = new Set(current); if (next.has(roleId)) next.delete(roleId); else next.add(roleId); return next; })} /><span className={tabWorkspaceStyles.resourceMarker} style={{ '--resource-color': roleColor(role.hexColor || role.color) }} aria-hidden="true" /><span>@{role.name}{locked ? <small>{reason}</small> : null}</span></label>;
				})}</div>
			</TabDialog>
		</TabWorkspace>
	);
}
