'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clipboard, RefreshCw } from 'lucide-react';
import { useCopy } from '../../copy';
import { TabActionBar, TabEmpty, TabFieldMessage, TabFilterBar, TabInlineActions, TabNotice, TabPagination, TabStatus, TabTable, TabWorkspace, tabWorkspaceStyles } from './TabWorkspace';

const LEGACY_UNKNOWN_NICKNAME = 'ใครไม่รู้';
const hasCustomNickname = value => Boolean(value && value !== LEGACY_UNKNOWN_NICKNAME);

function MemberIdentity({ member, shared }) {
	const [failed, setFailed] = useState(false);
	const name = member.displayName || member.username || shared.unknownMember;
	useEffect(() => setFailed(false), [member.avatar]);
	return <div className={tabWorkspaceStyles.compactIdentity}>{member.avatar && !failed ? <img className={tabWorkspaceStyles.compactAvatar} src={member.avatar} alt="" onError={() => setFailed(true)} /> : <span className={tabWorkspaceStyles.compactAvatar} aria-hidden="true">{name.slice(0, 2).toUpperCase()}</span>}<div><strong>{name}</strong><small>@{member.username || shared.unknownUsername}</small></div></div>;
}

export default function NicknameManagerTab({ guildId, initialMembers = [], showToast, onRefresh, onEditorDirtyChange }) {
	const { t } = useCopy();
	const copy = t.serverTabs.nicknames;
	const shared = t.serverTabs.shared;
	const [members, setMembers] = useState(initialMembers);
	const [nicknames, setNicknames] = useState({});
	const [search, setSearch] = useState('');
	const [filter, setFilter] = useState('all');
	const [sort, setSort] = useState('custom_first');
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(15);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState('');
	const [editingId, setEditingId] = useState('');
	const [draftName, setDraftName] = useState('');
	const [rowError, setRowError] = useState('');
	const [busyId, setBusyId] = useState('');
	const [copiedId, setCopiedId] = useState('');

	useEffect(() => setMembers(Array.isArray(initialMembers) ? initialMembers : []), [initialMembers]);
	useEffect(() => setPage(1), [search, filter, sort, pageSize]);

	const fetchNicknames = useCallback(async ({ quiet = false } = {}) => {
		if (!quiet) setLoading(true);
		setLoadError('');
		try {
			const response = await fetch(`/api/guilds/${guildId}/nicknames`);
			const data = await response.json().catch(() => ({}));
			if (!response.ok || !data.success) throw new Error(data.error || copy.loadError);
			setNicknames(data.nicknames || {});
			return true;
		} catch (error) {
			setLoadError(error.message || copy.loadError);
			return false;
		} finally { setLoading(false); }
	}, [copy.loadError, guildId]);
	useEffect(() => { fetchNicknames(); }, [fetchNicknames]);

	const filtered = useMemo(() => {
		const query = search.trim().toLocaleLowerCase();
		return [...members].filter(member => {
			const customName = nicknames[member.id] || '';
			const custom = hasCustomNickname(customName);
			if (filter === 'custom' && !custom) return false;
			if (filter === 'default' && custom) return false;
			if (filter === 'humans' && member.isBot) return false;
			if (filter === 'bots' && !member.isBot) return false;
			if (!query) return true;
			return [member.displayName, member.username, member.id, customName].some(value => String(value || '').toLocaleLowerCase().includes(query));
		}).sort((a, b) => {
			const customA = hasCustomNickname(nicknames[a.id]);
			const customB = hasCustomNickname(nicknames[b.id]);
			if (sort === 'custom_first' && customA !== customB) return customA ? -1 : 1;
			if (sort === 'name_desc') return (b.displayName || b.username || '').localeCompare(a.displayName || a.username || '');
			if (sort === 'id_asc') return String(a.id).localeCompare(String(b.id));
			if (sort === 'id_desc') return String(b.id).localeCompare(String(a.id));
			return (a.displayName || a.username || '').localeCompare(b.displayName || b.username || '');
		});
	}, [filter, members, nicknames, search, sort]);
	const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
	const currentPage = Math.min(page, totalPages);
	const start = (currentPage - 1) * pageSize;
	const visibleMembers = filtered.slice(start, start + pageSize);
	const customCount = members.filter(member => hasCustomNickname(nicknames[member.id])).length;
	const editingNickname = editingId ? (hasCustomNickname(nicknames[editingId]) ? nicknames[editingId] : '') : '';
	const editorDirty = Boolean(editingId && draftName.trim() !== editingNickname);
	useEffect(() => {
		onEditorDirtyChange?.('nicknames', editorDirty);
		return () => onEditorDirtyChange?.('nicknames', false);
	}, [editorDirty, onEditorDirtyChange]);

	const saveNickname = async member => {
		const trimmed = draftName.trim();
		if (!trimmed) { setRowError(copy.required); return; }
		if (trimmed.length > 100) { setRowError(copy.tooLong); return; }
		setBusyId(member.id); setRowError('');
		try {
			const response = await fetch(`/api/guilds/${guildId}/nicknames/${member.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: trimmed }) });
			const data = await response.json().catch(() => ({}));
			if (!response.ok || !data.success) throw new Error(data.error || copy.saveError);
			setNicknames(current => ({ ...current, [member.id]: trimmed }));
			showToast(copy.saveSuccess(member.displayName || member.username));
			setEditingId('');
		} catch (error) { setRowError(error.message || copy.saveError); showToast(error.message || copy.saveError, true); }
		finally { setBusyId(''); }
	};
	const resetNickname = async member => {
		setBusyId(member.id);
		try {
			const response = await fetch(`/api/guilds/${guildId}/nicknames/${member.id}`, { method: 'DELETE' });
			const data = await response.json().catch(() => ({}));
			if (!response.ok || !data.success) throw new Error(data.error || copy.resetError);
			setNicknames(current => { const next = { ...current }; delete next[member.id]; return next; });
			showToast(copy.resetSuccess(member.displayName || member.username));
		} catch (error) { showToast(error.message || copy.resetError, true); }
		finally { setBusyId(''); }
	};
	const refresh = async () => {
		setLoading(true);
		const [nicknamesOk] = await Promise.all([fetchNicknames({ quiet: true }), onRefresh?.()]);
		setLoading(false);
		if (nicknamesOk) showToast(copy.refreshSuccess); else showToast(copy.loadError, true);
	};
	const copyId = async member => {
		try { await navigator.clipboard.writeText(String(member.id)); setCopiedId(member.id); showToast(copy.copied); window.setTimeout(() => setCopiedId(''), 1800); }
		catch { showToast(copy.copyId, true); }
	};

	return (
		<TabWorkspace>
			<TabActionBar actions={<><TabStatus tone={customCount ? 'accent' : 'neutral'}>{copy.custom}: {customCount}</TabStatus><TabStatus tone="neutral">{copy.count(members.length)}</TabStatus></>}><span>{copy.description}</span></TabActionBar>
			<TabFilterBar actions={<button type="button" className="btn btn-secondary" onClick={refresh} disabled={loading}><RefreshCw size={16} aria-hidden="true" /> {loading ? shared.working : shared.refresh}</button>}>
				<div className="form-group"><label className="form-label" htmlFor="nickname-search">{copy.search}</label><input id="nickname-search" className="form-control" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={copy.searchPlaceholder} /></div>
				<div className="form-group"><label className="form-label" htmlFor="nickname-filter">{copy.filter}</label><select id="nickname-filter" className="form-control" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">{copy.all}</option><option value="custom">{copy.custom}</option><option value="default">{copy.default}</option><option value="humans">{copy.humans}</option><option value="bots">{copy.bots}</option></select></div>
				<div className="form-group"><label className="form-label" htmlFor="nickname-sort">{copy.sort}</label><select id="nickname-sort" className="form-control" value={sort} onChange={event => setSort(event.target.value)}><option value="custom_first">{copy.customFirst}</option><option value="name_asc">{copy.nameAsc}</option><option value="name_desc">{copy.nameDesc}</option><option value="id_asc">{copy.idAsc}</option><option value="id_desc">{copy.idDesc}</option></select></div>
				<div className="form-group"><label className="form-label" htmlFor="nickname-page-size">{copy.perPage}</label><select id="nickname-page-size" className="form-control" value={pageSize} onChange={event => setPageSize(Number(event.target.value))}><option value="15">15</option><option value="30">30</option></select></div>
			</TabFilterBar>
			{loadError ? <TabNotice tone="warning" title={copy.loadError} actions={<button type="button" className="btn btn-secondary btn-sm" onClick={() => fetchNicknames()}>{shared.retry}</button>}><p>{loadError}</p></TabNotice> : null}

			{visibleMembers.length ? <><TabTable label={copy.spokenName} mobileRecords><table><thead><tr><th>{copy.member}</th><th>{copy.discordName}</th><th>{copy.spokenName}</th><th>{copy.actions}</th></tr></thead><tbody>{visibleMembers.flatMap(member => {
				const customName = hasCustomNickname(nicknames[member.id]) ? nicknames[member.id] : '';
				const rows = [<tr key={member.id}><td data-label={copy.member}><MemberIdentity member={member} shared={shared} /></td><td data-label={copy.discordName}>{member.displayName || member.username || shared.unknownMember}</td><td data-label={copy.spokenName}>{customName || <span>{copy.none}</span>}</td><td data-label={copy.actions}><TabInlineActions align="start"><button type="button" className="btn btn-secondary btn-sm" onClick={() => { setEditingId(member.id); setDraftName(customName); setRowError(''); }}>{copy.edit}</button>{customName ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => resetNickname(member)} disabled={busyId === member.id}>{copy.reset}</button> : null}<button type="button" className="btn btn-secondary btn-sm" onClick={() => copyId(member)}><Clipboard size={14} aria-hidden="true" /> {copiedId === member.id ? copy.copied : copy.copyId}</button></TabInlineActions></td></tr>];
				if (editingId === member.id) rows.push(<tr key={`${member.id}-editor`}><td colSpan={4}><form onSubmit={event => { event.preventDefault(); saveNickname(member); }}><label className="form-label" htmlFor={`nickname-${member.id}`}>{copy.input}</label><input id={`nickname-${member.id}`} className="form-control" aria-describedby={rowError ? `nickname-${member.id}-error` : undefined} value={draftName} maxLength={100} onChange={event => setDraftName(event.target.value)} placeholder={copy.inputPlaceholder} autoFocus />{rowError ? <TabFieldMessage id={`nickname-${member.id}-error`} tone="error">{rowError}</TabFieldMessage> : null}<TabInlineActions><button type="button" className="btn btn-secondary" onClick={() => setEditingId('')} disabled={busyId === member.id}>{shared.cancel}</button><button type="submit" className="btn btn-primary" disabled={busyId === member.id}>{busyId === member.id ? shared.working : copy.save}</button></TabInlineActions></form></td></tr>);
				return rows;
			})}</tbody></table></TabTable><TabPagination page={currentPage} totalPages={totalPages} onPageChange={setPage} summary={shared.showing(start + 1, Math.min(start + pageSize, filtered.length), filtered.length)} /></> : <TabEmpty title={copy.emptyTitle} description={copy.emptyDescription} action={(search || filter !== 'all') ? <button type="button" className="btn btn-secondary" onClick={() => { setSearch(''); setFilter('all'); }}>{shared.clearFilters}</button> : null} />}
		</TabWorkspace>
	);
}
