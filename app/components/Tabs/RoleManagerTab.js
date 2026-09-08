'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clipboard, Pencil, Trash2 } from 'lucide-react';
import ColorPicker from '../ColorPicker';
import { useCopy } from '../../copy';
import { TabActionBar, TabConfirmDialog, TabDialog, TabEmpty, TabFieldMessage, TabFilterBar, TabInlineActions, TabPagination, TabSettingRow, TabSettingsList, TabStatus, TabSwitch, TabTable, TabWorkspace, tabWorkspaceStyles } from './TabWorkspace';

const PAGE_SIZES = [10, 30, 50, 100];
const DEFAULT_COLOR = '#6366f1';

function roleColor(value) {
	if (!value || value === '#000000') return '#8A8F9E';
	if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return value;
	const numeric = Number(value);
	return Number.isFinite(numeric) ? `#${numeric.toString(16).padStart(6, '0').slice(-6)}` : '#8A8F9E';
}

function roleIsLocked(role, guildId) {
	return Boolean(role?.managed || role?.canManage === false || String(role?.id) === String(guildId) || role?.name === '@everyone');
}

function roleLabel(name = '') {
	return name.startsWith('@') ? name : `@${name}`;
}

function RoleForm({ values, setValues, copy }) {
	return (
		<TabSettingsList>
			<TabSettingRow label={copy.name}><input className="form-control" aria-label={copy.name} value={values.name} onChange={event => setValues(current => ({ ...current, name: event.target.value }))} placeholder={copy.namePlaceholder} autoFocus /></TabSettingRow>
			<TabSettingRow label={copy.color} stacked><ColorPicker color={values.color} onChange={color => setValues(current => ({ ...current, color }))} roleName={values.name || copy.namePlaceholder} label={copy.color} /></TabSettingRow>
			<TabSettingRow label={copy.display} control={<TabSwitch checked={values.hoist} onChange={event => setValues(current => ({ ...current, hoist: event.target.checked }))} label={copy.display} />} />
			<TabSettingRow label={copy.allowMentions} control={<TabSwitch checked={values.mentionable} onChange={event => setValues(current => ({ ...current, mentionable: event.target.checked }))} label={copy.allowMentions} />} />
		</TabSettingsList>
	);
}

export default function RoleManagerTab({ roles, guildId, showToast, onRefresh, onEditorDirtyChange }) {
	const { t } = useCopy();
	const copy = t.serverTabs.roles;
	const shared = t.serverTabs.shared;
	const allRoles = Array.isArray(roles) ? roles : [];
	const [search, setSearch] = useState('');
	const [pageSize, setPageSize] = useState(10);
	const [page, setPage] = useState(1);
	const [copiedId, setCopiedId] = useState('');
	const [createOpen, setCreateOpen] = useState(false);
	const [createValues, setCreateValues] = useState({ name: '', color: DEFAULT_COLOR, hoist: false, mentionable: false });
	const [editingRole, setEditingRole] = useState(null);
	const [editValues, setEditValues] = useState({ name: '', color: DEFAULT_COLOR, hoist: false, mentionable: false });
	const [deleteRole, setDeleteRole] = useState(null);
	const [busy, setBusy] = useState('');
	const [formError, setFormError] = useState('');
	const createDirty = createOpen && (createValues.name.trim() || createValues.color !== DEFAULT_COLOR || createValues.hoist || createValues.mentionable);
	const originalEditValues = editingRole ? { name: editingRole.name, color: roleColor(editingRole.hexColor || editingRole.color), hoist: !!editingRole.hoist, mentionable: !!editingRole.mentionable } : null;
	const editDirty = Boolean(originalEditValues && JSON.stringify(editValues) !== JSON.stringify(originalEditValues));
	useEffect(() => {
		onEditorDirtyChange?.('roles', Boolean(createDirty || editDirty));
		return () => onEditorDirtyChange?.('roles', false);
	}, [createDirty, editDirty, onEditorDirtyChange]);

	useEffect(() => setPage(1), [search, pageSize]);
	const filteredRoles = useMemo(() => {
		const query = search.trim().toLocaleLowerCase();
		return allRoles.filter(role => !query || role.name.toLocaleLowerCase().includes(query) || String(role.id).includes(query));
	}, [allRoles, search]);
	const totalPages = Math.max(1, Math.ceil(filteredRoles.length / pageSize));
	const currentPage = Math.min(page, totalPages);
	const start = (currentPage - 1) * pageSize;
	const visibleRoles = filteredRoles.slice(start, start + pageSize);

	const request = async (url, payload, successMessage, failureMessage, key) => {
		setBusy(key); setFormError('');
		try {
			const response = await fetch(url, { method: 'POST', headers: payload ? { 'Content-Type': 'application/json' } : undefined, body: payload ? JSON.stringify(payload) : undefined });
			const data = await response.json().catch(() => ({}));
			if (!response.ok || !data.success) throw new Error(data.error || failureMessage);
			showToast(successMessage);
			await onRefresh?.();
			return true;
		} catch (error) {
			setFormError(error.message || failureMessage);
			showToast(error.message || failureMessage, true);
			return false;
		} finally { setBusy(''); }
	};

	const createRole = async event => {
		event.preventDefault();
		if (!createValues.name.trim()) { setFormError(copy.required); return; }
		const ok = await request(`/api/guilds/${guildId}/roles/create`, { ...createValues, name: createValues.name.trim() }, copy.createSuccess(`@${createValues.name.trim()}`), copy.createError, 'create');
		if (ok) { setCreateOpen(false); setCreateValues({ name: '', color: DEFAULT_COLOR, hoist: false, mentionable: false }); }
	};
	const openEdit = role => {
		if (roleIsLocked(role, guildId)) return;
		setEditingRole(role); setEditValues({ name: role.name, color: roleColor(role.hexColor || role.color), hoist: !!role.hoist, mentionable: !!role.mentionable }); setFormError('');
	};
	const saveRole = async event => {
		event.preventDefault();
		if (!editValues.name.trim()) { setFormError(copy.required); return; }
		const ok = await request(`/api/guilds/${guildId}/roles/${editingRole.id}/update`, { ...editValues, name: editValues.name.trim() }, copy.updateSuccess(`@${editValues.name.trim()}`), copy.updateError, 'edit');
		if (ok) setEditingRole(null);
	};
	const removeRole = async () => {
		const ok = await request(`/api/guilds/${guildId}/roles/${deleteRole.id}/delete`, null, copy.deleteSuccess(`@${deleteRole.name}`), copy.deleteError, 'delete');
		if (ok) setDeleteRole(null);
	};
	const copyId = async role => {
		try { await navigator.clipboard.writeText(String(role.id)); setCopiedId(role.id); showToast(copy.copied); window.setTimeout(() => setCopiedId(''), 1800); }
		catch { showToast(copy.copyId, true); }
	};

	const dialogFooter = (submitLabel, key, close) => <><button type="button" className="btn btn-secondary" onClick={close} disabled={!!busy}>{shared.cancel}</button><button type="submit" form={`role-${key}-form`} className="btn btn-primary" disabled={!!busy}>{busy === key ? shared.working : submitLabel}</button></>;

	return (
		<TabWorkspace>
			<TabActionBar actions={<TabStatus tone="accent">{copy.count(allRoles.length)}</TabStatus>}><span>{shared.loadedMatches(filteredRoles.length)}</span></TabActionBar>
			<TabFilterBar actions={<button type="button" className="btn btn-primary" onClick={() => { setCreateOpen(true); setFormError(''); }}>{copy.create}</button>}>
				<div className="form-group"><label className="form-label" htmlFor="role-search">{copy.search}</label><input id="role-search" className="form-control" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={copy.searchPlaceholder} /></div>
				<div className="form-group"><label className="form-label" htmlFor="role-page-size">{copy.pageSize}</label><select id="role-page-size" className="form-control" value={pageSize} onChange={event => setPageSize(Number(event.target.value))}>{PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}</select></div>
			</TabFilterBar>

			{visibleRoles.length ? <><TabTable label={copy.role}><table><thead><tr><th>{copy.role}</th><th>{copy.properties}</th><th>{copy.actions}</th></tr></thead><tbody>{visibleRoles.map(role => {
				const locked = roleIsLocked(role, guildId);
				const baseRole = String(role.id) === String(guildId) || role.name === '@everyone';
				const lockedReason = role.managed ? copy.managedReason : baseRole ? copy.everyoneReason : copy.hierarchyReason;
				const properties = [role.managed && copy.managed, baseRole && copy.everyone, !role.managed && !baseRole && role.canManage === false && copy.restricted, role.hoist && copy.hoisted, role.mentionable && copy.mentionable].filter(Boolean);
				return <tr key={role.id}><td><div className={tabWorkspaceStyles.compactIdentity}><span className={tabWorkspaceStyles.resourceMarker} style={{ '--resource-color': roleColor(role.hexColor || role.color) }} aria-hidden="true" /><div><strong>{roleLabel(role.name)}</strong><small>{role.id}</small></div></div></td><td>{properties.length ? <div className={tabWorkspaceStyles.tagList}>{properties.map(item => <span key={item} className={tabWorkspaceStyles.tag}>{item}</span>)}</div> : copy.noProperties}</td><td><TabInlineActions align="start"><button type="button" className="btn btn-secondary btn-sm" onClick={() => copyId(role)}><Clipboard size={14} aria-hidden="true" /> {copiedId === role.id ? copy.copied : copy.copyId}</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(role)} disabled={locked} title={locked ? lockedReason : undefined}><Pencil size={14} aria-hidden="true" /> {shared.edit}</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => setDeleteRole(role)} disabled={locked} title={locked ? lockedReason : undefined}><Trash2 size={14} aria-hidden="true" /> {copy.deleteAction}</button></TabInlineActions></td></tr>;
			})}</tbody></table></TabTable><TabPagination page={currentPage} totalPages={totalPages} onPageChange={setPage} summary={shared.showing(start + 1, Math.min(start + pageSize, filteredRoles.length), filteredRoles.length)} /></> : <TabEmpty title={copy.emptyTitle} description={copy.emptyDescription} action={<button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>{copy.create}</button>} />}

			<TabDialog open={createOpen} onClose={busy ? undefined : () => setCreateOpen(false)} title={copy.createTitle} footer={dialogFooter(copy.createAction, 'create', () => setCreateOpen(false))}><form id="role-create-form" onSubmit={createRole} aria-describedby={formError ? 'role-create-error' : undefined}><RoleForm values={createValues} setValues={setCreateValues} copy={copy} />{formError ? <TabFieldMessage id="role-create-error" tone="error">{formError}</TabFieldMessage> : null}</form></TabDialog>
			<TabDialog open={!!editingRole} onClose={busy ? undefined : () => setEditingRole(null)} title={copy.editTitle(`@${editingRole?.name || ''}`)} footer={dialogFooter(copy.saveAction, 'edit', () => setEditingRole(null))}><form id="role-edit-form" onSubmit={saveRole} aria-describedby={formError ? 'role-edit-error' : undefined}><RoleForm values={editValues} setValues={setEditValues} copy={copy} />{formError ? <TabFieldMessage id="role-edit-error" tone="error">{formError}</TabFieldMessage> : null}</form></TabDialog>
			<TabConfirmDialog open={!!deleteRole} onClose={() => setDeleteRole(null)} onConfirm={removeRole} title={copy.deleteTitle(`@${deleteRole?.name || ''}`)} description={copy.deleteDescription} confirmLabel={copy.deleteAction} cancelLabel={shared.cancel} busy={busy === 'delete'} />
		</TabWorkspace>
	);
}
