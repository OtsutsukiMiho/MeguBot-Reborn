'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
	Activity,
	AlertTriangle,
	Archive,
	Bot,
	ChevronLeft,
	ChevronRight,
	Clock3,
	Database,
	Download,
	Gauge,
	HardDrive,
	ListFilter,
	MemoryStick,
	Pause,
	Play,
	Radio,
	RefreshCw,
	Search,
	Server,
	ShieldAlert,
	ShieldCheck,
	SquareTerminal,
	Trash2,
	Volume2,
	Wrench,
} from 'lucide-react';
import Toast from '../components/Toast.js';
import styles from './developer.module.css';

const REFRESH_INTERVAL_MS = 15_000;
const ALL_CATEGORIES = ['System', 'Bot', 'Web', 'TTS', 'AutoMod', 'Database'];
const AUDIT_PAGE_SIZE = 12;

const AUDIT_FILTER_OPTIONS = [
	{ value: 'ALL', label: 'All event types' },
	{ value: 'WELCOME_LEAVE', label: 'Welcome & leave' },
	{ value: 'AUTOROLE', label: 'AutoRoles' },
	{ value: 'VOICE_TTS', label: 'Voice TTS suite' },
	{ value: 'HONEYPOT', label: 'Honeypot trap' },
	{ value: 'AUTOMOD', label: 'Auto-moderation' },
	{ value: 'REACTION_ROLE', label: 'Reaction roles' },
	{ value: 'COMMAND_EXEC', label: 'Slash commands' },
];

function formatUptime(seconds) {
	if (!seconds) return '0s';
	const days = Math.floor(seconds / 86_400);
	const hours = Math.floor((seconds % 86_400) / 3_600);
	const minutes = Math.floor((seconds % 3_600) / 60);
	return [days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`].filter(Boolean).join(' ') || '<1m';
}

function formatDate(value, options = {}) {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value);
	return new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: options.seconds ? '2-digit' : undefined,
	}).format(date);
}

function logSeverity(message = '') {
	if (/error|failed|blocked|fatal/i.test(message)) return 'error';
	if (/warn|rate limit|cooldown|retry/i.test(message)) return 'warning';
	if (/ready|online|success|connected|completed/i.test(message)) return 'success';
	return 'normal';
}

function getCategoryColor(category = 'System') {
	switch (category.toUpperCase()) {
	case 'BOT': return 'var(--cat-pink)';
	case 'WEB': return 'var(--accent)';
	case 'TTS': return 'var(--gold)';
	case 'AUTOMOD': return 'var(--due)';
	case 'DATABASE': return 'var(--settled)';
	default: return 'var(--muted)';
	}
}

function getAuditBadgeStyle(eventType = '') {
	if (eventType.startsWith('AUTOMOD')) return { '--badge-color': 'var(--due)' };
	if (eventType.startsWith('REACTION_ROLE')) return { '--badge-color': 'var(--settled)' };
	if (eventType.startsWith('AUTOROLE')) return { '--badge-color': 'var(--cat-pink)' };
	if (eventType === 'VOICE_TTS') return { '--badge-color': 'var(--gold)' };
	if (eventType === 'HONEYPOT') return { '--badge-color': 'var(--cat-purple)' };
	if (eventType === 'COMMAND_EXEC') return { '--badge-color': 'var(--cat-violet)' };
	return { '--badge-color': 'var(--cat-neutral)' };
}

async function fetchJson(url, init) {
	const response = await fetch(url, { credentials: 'same-origin', ...init });
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
	return data;
}

export default function DeveloperPage() {
	const [isDev, setIsDev] = useState(null);
	const [accessError, setAccessError] = useState('');
	const [stats, setStats] = useState(null);
	const [logs, setLogs] = useState([]);
	const [audioQueues, setAudioQueues] = useState([]);
	const [healthEvents, setHealthEvents] = useState([]);
	const [auditLogs, setAuditLogs] = useState([]);
	const [auditSearch, setAuditSearch] = useState('');
	const [debouncedAuditSearch, setDebouncedAuditSearch] = useState('');
	const [auditFilter, setAuditFilter] = useState('ALL');
	const [auditPage, setAuditPage] = useState(1);
	const [activeCategories, setActiveCategories] = useState(ALL_CATEGORIES);
	const [logFilter, setLogFilter] = useState('');
	const [autoScroll, setAutoScroll] = useState(true);
	const [autoRefresh, setAutoRefresh] = useState(true);
	const [terminalHeight, setTerminalHeight] = useState('520px');
	const [refreshing, setRefreshing] = useState(false);
	const [liveError, setLiveError] = useState('');
	const [lastUpdated, setLastUpdated] = useState(null);
	const [actionLoading, setActionLoading] = useState('');
	const [toastMsg, setToastMsg] = useState('');
	const [toastError, setToastError] = useState(false);
	const logTerminalRef = useRef(null);
	const refreshInFlight = useRef(false);

	const showToast = useCallback((message, isError = false) => {
		setToastMsg(message);
		setToastError(isError);
		window.setTimeout(() => setToastMsg(''), 4000);
	}, []);

	const refreshLive = useCallback(async ({ quiet = false } = {}) => {
		if (refreshInFlight.current) return;
		refreshInFlight.current = true;
		if (!quiet) setRefreshing(true);
		try {
			const results = await Promise.allSettled([
				fetchJson('/api/developer/stats'),
				fetchJson('/api/developer/logs'),
				fetchJson('/api/developer/audio-queues'),
			]);
			let updated = false;
			if (results[0].status === 'fulfilled' && results[0].value.success) {
				setStats(results[0].value);
				updated = true;
			}
			if (results[1].status === 'fulfilled' && results[1].value.success) {
				setLogs(Array.isArray(results[1].value.logs) ? results[1].value.logs : []);
				updated = true;
			}
			if (results[2].status === 'fulfilled' && results[2].value.success) {
				setAudioQueues(Array.isArray(results[2].value.queues) ? results[2].value.queues : []);
				updated = true;
			}
			if (!updated) throw new Error('Live telemetry is temporarily unavailable.');
			setLiveError(results.some(result => result.status === 'rejected') ? 'Some telemetry sources did not answer.' : '');
			setLastUpdated(new Date());
		}
		catch (error) {
			setLiveError(error.message);
		}
		finally {
			refreshInFlight.current = false;
			setRefreshing(false);
		}
	}, []);

	const fetchAuditLogs = useCallback(async () => {
		try {
			const query = new URLSearchParams({
				limit: '100',
				filter: auditFilter,
				search: debouncedAuditSearch,
			});
			const data = await fetchJson(`/api/developer/audit-logs?${query}`);
			setAuditLogs(Array.isArray(data.logs) ? data.logs : []);
		}
		catch (error) {
			showToast(error.message, true);
		}
	}, [auditFilter, debouncedAuditSearch, showToast]);

	const fetchHealthEvents = useCallback(async () => {
		try {
			const data = await fetchJson('/api/developer/health-events?limit=40');
			setHealthEvents(Array.isArray(data.events) ? data.events : []);
		}
		catch (error) {
			showToast(error.message, true);
		}
	}, [showToast]);

	useEffect(() => {
		let active = true;
		fetchJson('/api/developer/check')
			.then(data => { if (active) setIsDev(Boolean(data.isDeveloper)); })
			.catch(error => {
				if (!active) return;
				setAccessError(error.message);
				setIsDev(false);
			});
		return () => { active = false; };
	}, []);

	useEffect(() => {
		const timer = window.setTimeout(() => setDebouncedAuditSearch(auditSearch.trim()), 400);
		return () => window.clearTimeout(timer);
	}, [auditSearch]);

	useEffect(() => {
		if (!isDev) return;
		refreshLive();
		fetchHealthEvents();
	}, [isDev, refreshLive, fetchHealthEvents]);

	useEffect(() => {
		if (!isDev) return;
		fetchAuditLogs();
	}, [isDev, fetchAuditLogs]);

	// This timer reads process memory, Discord.js's in-memory cache, and local
	// database state through IPC. It never calls Discord. It also pauses in a
	// hidden tab so an abandoned console does not become pointless background
	// traffic of any kind.
	useEffect(() => {
		if (!isDev || !autoRefresh) return;
		const interval = window.setInterval(() => {
			if (document.visibilityState === 'visible') refreshLive({ quiet: true });
		}, REFRESH_INTERVAL_MS);
		return () => window.clearInterval(interval);
	}, [isDev, autoRefresh, refreshLive]);

	useEffect(() => {
		if (autoScroll && logTerminalRef.current) {
			logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight;
		}
	}, [logs, autoScroll]);

	const filteredLogs = useMemo(() => {
		const query = logFilter.trim().toLowerCase();
		return logs.filter(log => {
			const category = (log.category || 'System').toUpperCase();
			if (!activeCategories.some(item => item.toUpperCase() === category)) return false;
			if (!query) return true;
			return [log.message, log.host, log.category].some(value => String(value || '').toLowerCase().includes(query));
		});
	}, [logs, activeCategories, logFilter]);

	const logSummary = useMemo(() => ({
		errors: logs.filter(log => logSeverity(log.message) === 'error').length,
		warnings: logs.filter(log => logSeverity(log.message) === 'warning').length,
	}), [logs]);

	const rateSignals = useMemo(() => logs.filter(log => (
		/discord rate limit|discord invalid requests|cloudflare|cooldown|blocked from accessing/i.test(log.message || '')
	)), [logs]);

	const totalQueued = audioQueues.reduce((sum, queue) => sum + (Number(queue.queueLength) || 0), 0);
	const totalAuditPages = Math.max(1, Math.ceil(auditLogs.length / AUDIT_PAGE_SIZE));
	const currentAuditPage = Math.min(auditPage, totalAuditPages);
	const paginatedAuditLogs = auditLogs.slice(
		(currentAuditPage - 1) * AUDIT_PAGE_SIZE,
		currentAuditPage * AUDIT_PAGE_SIZE,
	);
	const isBlocked = Boolean(stats?.discordBlock?.isBlocked);
	const botOnline = stats?.bot?.status === 'online';
	const systemState = isBlocked ? 'Cooldown active' : botOnline ? 'All systems nominal' : 'Bot needs attention';

	function toggleCategory(category) {
		if (category === 'ALL') {
			setActiveCategories(activeCategories.length === ALL_CATEGORIES.length ? [] : ALL_CATEGORIES);
			return;
		}
		setActiveCategories(current => current.includes(category)
			? current.filter(item => item !== category)
			: [...current, category]);
	}

	async function refreshAll() {
		await Promise.all([refreshLive(), fetchAuditLogs(), fetchHealthEvents()]);
	}

	async function handleAction(action, confirmation) {
		if (confirmation && !window.confirm(confirmation)) return;
		setActionLoading(action);
		try {
			const data = await fetchJson('/api/developer/action', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action }),
			});
			showToast(data.message || 'Action completed.');
			await refreshLive();
		}
		catch (error) {
			showToast(error.message, true);
		}
		finally {
			setActionLoading('');
		}
	}

	async function purgeAuditLogs() {
		if (!window.confirm('Permanently purge audit logs older than seven days? This cannot be undone.')) return;
		setActionLoading('purge_audit');
		try {
			const data = await fetchJson('/api/developer/audit-logs/purge', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ days: 7 }),
			});
			showToast(data.message || 'Expired audit logs purged.');
			await fetchAuditLogs();
		}
		catch (error) {
			showToast(error.message, true);
		}
		finally {
			setActionLoading('');
		}
	}

	function exportLogs() {
		const content = filteredLogs.map(log => `[${log.timestamp || ''}] [${log.category || 'System'}] ${log.message || ''}`).join('\n');
		const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
		const href = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = href;
		anchor.download = `megu-system-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
		anchor.click();
		URL.revokeObjectURL(href);
		showToast(`Exported ${filteredLogs.length} visible log entries.`);
	}

	if (isDev === null) {
		return (
			<div className={styles.accessState} aria-live="polite">
				<span className={styles.accessMark}><ShieldCheck size={28} /></span>
				<h1>Verifying developer access</h1>
				<p>Checking this session against the developer registry…</p>
			</div>
		);
	}

	if (!isDev) {
		return (
			<div className={styles.accessState}>
				<span className={`${styles.accessMark} ${styles.denied}`}><ShieldAlert size={28} /></span>
				<p className={styles.eyebrow}>Restricted surface</p>
				<h1>Developer access required</h1>
				<p>{accessError || 'This console requires a Discord account registered as a Megu developer.'}</p>
				<div className={styles.accessActions}>
					<a href="/api/auth/login" className="btn btn-primary">Sign in with Discord</a>
					<Link href="/servers" className="btn btn-secondary">Return to servers</Link>
				</div>
			</div>
		);
	}

	return (
		<div className={styles.developerPage}>
			{toastMsg && <Toast message={toastMsg} isError={toastError} onClose={() => setToastMsg('')} />}

			<header className={styles.pageHeader}>
				<div>
					<p className={styles.eyebrow}>Developer operations</p>
					<div className={styles.titleRow}>
						<h1>System console</h1>
						<span className={`${styles.stateBadge} ${isBlocked || !botOnline ? styles.attention : ''}`}>
							<span />{systemState}
						</span>
					</div>
					<p className={styles.lede}>Observe Megu’s runtime, diagnose incidents, and perform guarded maintenance from one place.</p>
				</div>
				<div className={styles.headerActions}>
					<button type="button" className={styles.autoRefresh} aria-pressed={autoRefresh} onClick={() => setAutoRefresh(value => !value)}>
						{autoRefresh ? <Pause size={15} /> : <Play size={15} />}
						{autoRefresh ? `Pause ${REFRESH_INTERVAL_MS / 1000}s refresh` : 'Resume auto-refresh'}
					</button>
					<button type="button" className="btn btn-primary" onClick={refreshAll} disabled={refreshing}>
						<RefreshCw size={16} className={refreshing ? styles.spinning : ''} />
						{refreshing ? 'Refreshing' : 'Refresh now'}
					</button>
				</div>
			</header>

			<div className={styles.safetyNote}>
				<ShieldCheck size={16} />
				<span><strong>Rate-limit safe telemetry.</strong> Refreshes read local process memory, bot caches, IPC, and the database. This console never probes Discord.</span>
				<span className={styles.lastUpdated}>{liveError || (lastUpdated ? `Updated ${formatDate(lastUpdated, { seconds: true })}` : 'Waiting for telemetry')}</span>
			</div>

			{isBlocked && (
				<section className={styles.blockBanner} aria-labelledby="discord-cooldown-title">
					<AlertTriangle size={24} />
					<div>
						<h2 id="discord-cooldown-title">Discord IP cooldown is active</h2>
						<p>All Discord calls and bot restarts must stay paused. Retrying can extend the block; wait approximately {Math.max(1, Math.ceil((stats?.discordBlock?.retryAfterSeconds || 0) / 60))} more minutes.</p>
					</div>
				</section>
			)}

			<section className={styles.healthStrip} aria-label="Service health">
				<div className={styles.serviceState}><span className={styles.okDot} /><div><small>Web API</small><strong>Online</strong></div></div>
				<div className={styles.serviceState}><span className={botOnline ? styles.okDot : styles.badDot} /><div><small>Discord bot</small><strong>{botOnline ? 'Online' : 'Offline'}</strong></div></div>
				<div className={styles.serviceState}><span className={styles.infoDot} /><div><small>Database</small><strong>{stats?.services?.dbStatus === 'postgresql' ? 'PostgreSQL' : 'Local JSON'}</strong></div></div>
				<div className={styles.runtimeMeta}>Node {stats?.system?.nodeVersion || '—'} · {stats?.system?.platform || '—'}</div>
			</section>

			<dl className={styles.metrics}>
				<div><dt><MemoryStick size={16} />Memory RSS</dt><dd>{stats?.system?.ramUsedMB || 0}<small>MB</small></dd><p>Heap {stats?.system?.heapUsedMB || 0} / {stats?.system?.heapTotalMB || 0} MB</p></div>
				<div><dt><Gauge size={16} />Gateway latency</dt><dd>{stats?.bot?.pingMs || 0}<small>ms</small></dd><p>{botOnline ? 'From the active gateway cache' : 'No active gateway session'}</p></div>
				<div><dt><Server size={16} />Cached fleet</dt><dd>{stats?.bot?.guildCount || 0}<small>servers</small></dd><p>{stats?.bot?.userCount || 0} cached users</p></div>
				<div><dt><Clock3 size={16} />Web uptime</dt><dd className={styles.uptimeValue}>{formatUptime(stats?.system?.uptimeSeconds)}</dd><p>Bot ready {formatDate(stats?.bot?.readyTimestamp)}</p></div>
			</dl>

			<div className={styles.workspaceGrid}>
				<section className={styles.logConsole} aria-labelledby="live-logs-title">
					<div className={styles.panelHeader}>
						<div>
							<p className={styles.sectionLabel}><Radio size={14} />Live buffer</p>
							<h2 id="live-logs-title">System logs</h2>
						</div>
						<div className={styles.headerCounts}>
							<span>{filteredLogs.length} shown</span>
							<span className={styles.warningText}>{logSummary.warnings} warnings</span>
							<span className={styles.errorText}>{logSummary.errors} errors</span>
						</div>
					</div>

					<div className={styles.logTools}>
						<label className={styles.searchBox}><Search size={15} /><input value={logFilter} onChange={event => setLogFilter(event.target.value)} placeholder="Filter message, host, category…" /></label>
						<button type="button" className="btn btn-secondary btn-sm" onClick={exportLogs} disabled={filteredLogs.length === 0}><Download size={15} />Export visible</button>
					</div>

					<div className={styles.categoryBar} aria-label="Log category filters">
						<button type="button" aria-pressed={activeCategories.length === ALL_CATEGORIES.length} onClick={() => toggleCategory('ALL')}>All</button>
						{ALL_CATEGORIES.map(category => (
							<button key={category} type="button" aria-pressed={activeCategories.includes(category)} onClick={() => toggleCategory(category)} style={{ '--category-color': getCategoryColor(category) }}>
								<span />{category}
							</button>
						))}
					</div>

					<div className={styles.terminalTopbar}>
						<span><SquareTerminal size={14} />runtime.log</span>
						<div>
							{['360px', '520px', '720px'].map(height => <button type="button" key={height} aria-pressed={terminalHeight === height} onClick={() => setTerminalHeight(height)}>{height.replace('px', '')}</button>)}
							<label><input type="checkbox" checked={autoScroll} onChange={event => setAutoScroll(event.target.checked)} /> Follow</label>
						</div>
					</div>
					<div ref={logTerminalRef} className={styles.terminal} style={{ height: terminalHeight }} aria-live={autoScroll ? 'polite' : 'off'}>
						{filteredLogs.length === 0
							? <p className={styles.emptyTerminal}>No logs match the current filters.</p>
							: filteredLogs.map((log, index) => {
								const category = log.category || 'System';
								return (
									<div className={styles.logLine} data-severity={logSeverity(log.message)} key={`${log.timestamp || 'log'}-${index}`} style={{ '--category-color': getCategoryColor(category) }}>
										<time>{log.timestamp || '—'}</time><strong>[{category}]</strong><span>{log.message}</span>
									</div>
								);
							})}
					</div>
				</section>

				<aside className={styles.sideColumn}>
					<section className={`${styles.sidePanel} ${isBlocked ? styles.dangerPanel : ''}`}>
						<div className={styles.sideTitle}><ShieldCheck size={18} /><h2>Discord safety</h2></div>
						<div className={styles.guardState}>
							<span className={isBlocked ? styles.badDot : styles.okDot} />
							<div><strong>{isBlocked ? 'Circuit open' : 'Circuit closed'}</strong><small>{isBlocked ? `Until ${formatDate(stats?.discordBlock?.blockedUntil)}` : 'Requests are permitted'}</small></div>
						</div>
						<dl className={styles.safetyStats}>
							<div><dt>Signals in buffer</dt><dd>{rateSignals.length}</dd></div>
							<div><dt>Local stop threshold</dt><dd>{stats?.discordBlock?.invalidRequestStopThreshold || 100} / 10m</dd></div>
						</dl>
						{rateSignals[rateSignals.length - 1] && <p className={styles.lastSignal}>{rateSignals[rateSignals.length - 1].message}</p>}
						<p className={styles.panelNote}>No health-check button is provided by design: probing Discord during a block would renew the incident.</p>
					</section>

					<section className={styles.sidePanel}>
						<div className={styles.sideTitle}><Volume2 size={18} /><h2>Audio queues</h2><span>{totalQueued}</span></div>
						{audioQueues.length === 0
							? <div className={styles.compactEmpty}>No active playback or queued clips.</div>
							: <div className={styles.queueList}>{audioQueues.map(queue => (
								<div className={styles.queueItem} key={queue.guildId}>
									<div><strong>{queue.guildName}</strong><span>{queue.playerState} · {queue.queueLength} clip{queue.queueLength === 1 ? '' : 's'}</span></div>
									<p>{queue.currentItem?.text || 'Preparing playback…'}</p>
								</div>
							))}</div>}
						<p className={styles.panelNote}>Queue status comes from bot memory over IPC and makes no Discord request.</p>
					</section>

					<details className={styles.sidePanel}>
						<summary><Server size={18} />Cached servers <span>{stats?.bot?.guilds?.length || 0}</span></summary>
						<div className={styles.guildList}>
							{(stats?.bot?.guilds || []).slice(0, 12).map(guild => <div key={guild.id}><strong>{guild.name}</strong><span>{guild.memberCount || 0} members</span></div>)}
							{(stats?.bot?.guilds || []).length === 0 && <div className={styles.compactEmpty}>No guilds in the current cache.</div>}
						</div>
					</details>
				</aside>
			</div>

			<section className={styles.auditSection} aria-labelledby="audit-title">
				<div className={styles.sectionHeader}>
					<div><p className={styles.sectionLabel}><Archive size={14} />Database history</p><h2 id="audit-title">Global audit stream</h2><p>Moderator and administrator activity across every connected server.</p></div>
					<div className={styles.auditActions}><button type="button" className="btn btn-secondary btn-sm" onClick={fetchAuditLogs}><RefreshCw size={15} />Refresh audit</button></div>
				</div>
				<div className={styles.auditTools}>
					<label className={styles.searchBox}><Search size={15} /><input value={auditSearch} onChange={event => { setAuditSearch(event.target.value); setAuditPage(1); }} placeholder="Search server name or ID…" /></label>
					<label className={styles.auditSelect}><ListFilter size={15} /><select value={auditFilter} onChange={event => { setAuditFilter(event.target.value); setAuditPage(1); }} aria-label="Filter audit event type">{AUDIT_FILTER_OPTIONS.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
				</div>
				{auditLogs.length === 0
					? <div className={styles.auditEmpty}>No audit events match these filters.</div>
					: <div className={styles.tableWrap}><table><thead><tr><th>Timestamp</th><th>Server</th><th>Actor</th><th>Event</th><th>Details</th></tr></thead><tbody>
						{paginatedAuditLogs.map((log, index) => {
							const eventType = log.event_type || log.action_type || 'GENERAL';
							return <tr key={log.id || index}><td><time>{formatDate(log.created_at)}</time></td><td><strong>{log.guild_name || log.guild_id || 'Unknown server'}</strong><small>{log.guild_id || ''}</small></td><td>{log.username || log.user_name || 'System'}</td><td><span className={styles.auditBadge} style={getAuditBadgeStyle(eventType)}>{eventType}</span></td><td>{log.details || '—'}{log.instance && <small className={styles.instance}>instance {log.instance}</small>}</td></tr>;
						})}
					</tbody></table></div>}
				{auditLogs.length > 0 && <div className={styles.pagination}><span>Showing {(currentAuditPage - 1) * AUDIT_PAGE_SIZE + 1}–{Math.min(currentAuditPage * AUDIT_PAGE_SIZE, auditLogs.length)} of {auditLogs.length}</span><div><button type="button" onClick={() => setAuditPage(page => Math.max(1, page - 1))} disabled={currentAuditPage === 1}><ChevronLeft size={15} />Previous</button><span>{currentAuditPage} / {totalAuditPages}</span><button type="button" onClick={() => setAuditPage(page => Math.min(totalAuditPages, page + 1))} disabled={currentAuditPage === totalAuditPages}>Next<ChevronRight size={15} /></button></div></div>}
			</section>

			<div className={styles.bottomGrid}>
				<section className={styles.healthHistory} aria-labelledby="health-history-title">
					<div className={styles.sectionHeader}><div><p className={styles.sectionLabel}><Activity size={14} />Durable incidents</p><h2 id="health-history-title">Process history</h2><p>Boots, exits, blocks, and circuit trips that survive a restart.</p></div><button type="button" className="btn btn-secondary btn-sm" onClick={fetchHealthEvents}><RefreshCw size={15} />Refresh</button></div>
				{healthEvents.length === 0 ? <div className={styles.compactEmpty}>No durable process events are available.</div> : <ol className={styles.timeline}>{healthEvents.slice(0, 12).map(event => <li key={event.id}><span data-kind={event.kind} /><div><strong>{event.kind.replaceAll('_', ' ')}</strong><p>{event.service || 'System'}{event.instance ? ` · ${event.instance}` : ''}</p>{event.detail && <small>{event.detail}</small>}</div><time>{formatDate(event.created_at)}</time></li>)}</ol>}
			</section>

				<section className={styles.maintenance} aria-labelledby="maintenance-title">
					<div className={styles.sectionHeader}><div><p className={styles.sectionLabel}><Wrench size={14} />Guarded controls</p><h2 id="maintenance-title">Maintenance</h2><p>Every action is explicit and written to the system log.</p></div></div>
					<div className={styles.actionList}>
						<div><span className={styles.actionIcon}><Database size={18} /></span><div><strong>Reload bot caches</strong><p>Refresh settings from the database without reconnecting to Discord.</p></div><button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(actionLoading)} onClick={() => handleAction('reload_cache')}>{actionLoading === 'reload_cache' ? 'Running…' : 'Reload'}</button></div>
						<div><span className={styles.actionIcon}><Volume2 size={18} /></span><div><strong>Clear every audio queue</strong><p>Stops local players and drops pending clips.</p></div><button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(actionLoading)} onClick={() => handleAction('clear_queues', 'Clear every active audio queue? Pending clips will be dropped.')}>{actionLoading === 'clear_queues' ? 'Clearing…' : 'Clear queues'}</button></div>
						<div className={styles.dangerAction}><span className={styles.actionIcon}><Bot size={18} /></span><div><strong>Restart bot process</strong><p>{isBlocked ? 'Disabled until the Discord cooldown ends.' : 'Triggers a clean supervisor-managed restart.'}</p></div><button type="button" className="btn btn-danger btn-sm" disabled={Boolean(actionLoading) || isBlocked} onClick={() => handleAction('restart_bot', 'Restart the Discord bot process now? This creates a new gateway IDENTIFY.')}>{actionLoading === 'restart_bot' ? 'Restarting…' : 'Restart bot'}</button></div>
						<div className={styles.dangerAction}><span className={styles.actionIcon}><Trash2 size={18} /></span><div><strong>Purge expired audit rows</strong><p>Permanently removes audit history older than seven days.</p></div><button type="button" className="btn btn-danger btn-sm" disabled={Boolean(actionLoading)} onClick={purgeAuditLogs}>{actionLoading === 'purge_audit' ? 'Purging…' : 'Purge expired'}</button></div>
					</div>
					{isBlocked && <details className={styles.recoveryControl}><summary><AlertTriangle size={16} />Emergency cooldown recovery</summary><p>Only reset the guard after confirming Discord is reachable from outside this service. This action does not test Discord for you.</p><button type="button" className="btn btn-danger btn-sm" disabled={Boolean(actionLoading)} onClick={() => handleAction('clear_discord_block', 'Clear the durable Discord cooldown now? This does not verify recovery. A premature reset can extend the IP block.')}>{actionLoading === 'clear_discord_block' ? 'Resetting…' : 'Reset cooldown guard'}</button></details>}
				</section>
			</div>

			<footer className={styles.consoleFooter}><HardDrive size={14} />Live logs are an in-memory rolling buffer. Process history and audit events are durable database records.</footer>
		</div>
	);
}
