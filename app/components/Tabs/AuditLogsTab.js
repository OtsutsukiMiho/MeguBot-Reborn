'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useCopy } from '../../copy';
import { TabActionBar, TabEmpty, TabFilterBar, TabNotice, TabPagination, TabSkeleton, TabStatus, TabTable, TabWorkspace } from './TabWorkspace';

function eventTone(type) {
	if (/BAN|KICK|DELETE|AUTOMOD_TRIGGER/.test(type)) return 'danger';
	if (/TIMEOUT|HONEYPOT/.test(type)) return 'warning';
	if (/CREATE|ASSIGN|WELCOME|VOICE|REACTION/.test(type)) return 'success';
	return 'accent';
}

export default function AuditLogsTab({ guildId }) {
	const { t, fmt } = useCopy();
	const copy = t.serverTabs.audit;
	const shared = t.serverTabs.shared;
	const [logs, setLogs] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [filter, setFilter] = useState('ALL');
	const [search, setSearch] = useState('');
	const [page, setPage] = useState(1);
	const pageSize = 10;

	const fetchLogs = useCallback(async () => {
		setLoading(true); setError('');
		try {
			const response = await fetch(`/api/guilds/${guildId}/audit-logs?limit=150&filter=${encodeURIComponent(filter)}`);
			const data = await response.json().catch(() => ({}));
			if (!response.ok || !data.success || !Array.isArray(data.logs)) throw new Error(data.error || copy.loadError);
			setLogs(data.logs);
		} catch (requestError) { setError(requestError.message || copy.loadError); }
		finally { setLoading(false); }
	}, [copy.loadError, filter, guildId]);
	useEffect(() => { fetchLogs(); }, [fetchLogs]);
	useEffect(() => setPage(1), [filter, search]);

	const filteredLogs = useMemo(() => {
		const query = search.trim().toLocaleLowerCase();
		return logs.filter(log => !query || [log.username, log.user_name, log.details, log.event_type, log.action_type].some(value => String(value || '').toLocaleLowerCase().includes(query)));
	}, [logs, search]);
	const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
	const currentPage = Math.min(page, totalPages);
	const start = (currentPage - 1) * pageSize;
	const visibleLogs = filteredLogs.slice(start, start + pageSize);
	const filterOptions = [{ value: 'ALL', label: copy.all }, ...Object.entries(copy.eventTypes).map(([value, label]) => ({ value, label }))];

	return (
		<TabWorkspace>
			<TabActionBar actions={<TabStatus tone={filteredLogs.length ? 'accent' : 'neutral'}>{copy.count(filteredLogs.length)}</TabStatus>}><span>{copy.description}</span></TabActionBar>
			<TabFilterBar actions={<button type="button" className="btn btn-secondary" onClick={fetchLogs} disabled={loading}><RefreshCw size={16} aria-hidden="true" /> {loading ? shared.working : shared.refresh}</button>}>
				<div className="form-group"><label className="form-label" htmlFor="audit-search">{copy.search}</label><input id="audit-search" className="form-control" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={copy.searchPlaceholder} /></div>
				<div className="form-group"><label className="form-label">{copy.type}</label><select className="form-control" value={filter} onChange={event => setFilter(event.target.value)} aria-label={copy.type}>{filterOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
			</TabFilterBar>
			{error ? <TabNotice tone="warning" title={copy.loadError} actions={<button type="button" className="btn btn-secondary btn-sm" onClick={fetchLogs}>{shared.retry}</button>}><p>{error}</p></TabNotice> : null}
			{loading && !logs.length ? <TabSkeleton rows={7} label={copy.description} /> : visibleLogs.length ? <><TabTable label={copy.description}><table><thead><tr><th>{copy.time}</th><th>{copy.actor}</th><th>{copy.action}</th><th>{copy.details}</th></tr></thead><tbody>{visibleLogs.map((log, index) => {
				const type = log.event_type || log.action_type || 'GENERAL';
				return <tr key={log.id || `${type}-${index}`}><td><time dateTime={log.created_at}>{fmt.when(log.created_at)}</time></td><td>{log.username || log.user_name || copy.system}</td><td><TabStatus tone={eventTone(type)}>{copy.eventTypes[type] || type}</TabStatus></td><td><details><summary>{log.details || '—'}</summary><code>{type}</code></details></td></tr>;
			})}</tbody></table></TabTable><TabPagination page={currentPage} totalPages={totalPages} onPageChange={setPage} summary={shared.showing(start + 1, Math.min(start + pageSize, filteredLogs.length), filteredLogs.length)} /></> : <TabEmpty title={copy.emptyTitle} description={copy.emptyDescription} action={(search || filter !== 'ALL') ? <button type="button" className="btn btn-secondary" onClick={() => { setSearch(''); setFilter('ALL'); }}>{shared.clearFilters}</button> : null} />}
		</TabWorkspace>
	);
}
