'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import Toast from '../components/Toast.js';
import CustomSelect from '../components/CustomSelect.js';

function formatUptime(seconds) {
	if (!seconds) return '0s';
	const d = Math.floor(seconds / (3600 * 24));
	const h = Math.floor((seconds % (3600 * 24)) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	return `${d > 0 ? `${d}d ` : ''}${h > 0 ? `${h}h ` : ''}${m > 0 ? `${m}m ` : ''}${s}s`;
}

function getCategoryColor(category) {
	switch (category) {
	case 'System': return 'var(--muted)';
	case 'Bot': return 'var(--cat-pink)';
	case 'Web': return 'var(--accent)';
	case 'Tts':
	case 'TTS': return 'var(--gold)';
	case 'AutoMod': return 'var(--due)';
	case 'Database': return 'var(--settled)';
	default: return 'var(--accent)';
	}
}

function getAuditBadgeStyle(eventType) {
	switch (eventType) {
	case 'WELCOME_LEAVE':
		return { background: 'color-mix(in srgb, var(--cat-cyan) var(--cat-tint), transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--cat-cyan) 30%, transparent)' };
	case 'AUTOROLE':
	case 'AUTOROLE_ASSIGN':
		return { background: 'color-mix(in srgb, var(--cat-pink) var(--cat-tint), transparent)', color: 'var(--cat-pink)', border: '1px solid color-mix(in srgb, var(--cat-pink) 30%, transparent)' };
	case 'VOICE_TTS':
		return { background: 'color-mix(in srgb, var(--gold) var(--cat-tint), transparent)', color: 'var(--gold)', border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)' };
	case 'HONEYPOT':
		return { background: 'color-mix(in srgb, var(--cat-purple) var(--cat-tint), transparent)', color: 'var(--cat-purple)', border: '1px solid color-mix(in srgb, var(--cat-purple) 30%, transparent)' };
	case 'AUTOMOD':
	case 'AUTOMOD_CONFIG':
	case 'AUTOMOD_TRIGGER':
		return { background: 'color-mix(in srgb, var(--due) var(--cat-tint), transparent)', color: 'var(--due)', border: '1px solid color-mix(in srgb, var(--due) 30%, transparent)' };
	case 'REACTION_ROLE':
	case 'REACTION_ROLE_CONFIG':
	case 'REACTION_ROLE_ASSIGN':
		return { background: 'color-mix(in srgb, var(--settled) var(--cat-tint), transparent)', color: 'var(--settled)', border: '1px solid color-mix(in srgb, var(--settled) 30%, transparent)' };
	case 'COMMAND_EXEC':
		return { background: 'color-mix(in srgb, var(--cat-violet) var(--cat-tint), transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--cat-violet) 30%, transparent)' };
	default:
		return { background: 'color-mix(in srgb, var(--cat-neutral) var(--cat-tint), transparent)', color: 'var(--muted)', border: '1px solid color-mix(in srgb, var(--cat-neutral) 30%, transparent)' };
	}
}

const ALL_CATEGORIES = ['System', 'Bot', 'Web', 'TTS', 'AutoMod', 'Database'];

const AUDIT_FILTER_OPTIONS = [
	{ value: 'ALL', label: 'All Event Types' },
	{ value: 'WELCOME_LEAVE', label: 'Welcome & Leave' },
	{ value: 'AUTOROLE', label: 'AutoRoles' },
	{ value: 'VOICE_TTS', label: 'Voice TTS Suite' },
	{ value: 'HONEYPOT', label: 'Honeypot Trap' },
	{ value: 'AUTOMOD', label: 'Auto-Moderation' },
	{ value: 'REACTION_ROLE', label: 'Reaction Roles' },
	{ value: 'COMMAND_EXEC', label: 'Slash Commands' },
];

export default function DeveloperPage() {
	const [isDev, setIsDev] = useState(null);
	const [stats, setStats] = useState(null);
	const [logs, setLogs] = useState([]);

	const [auditLogs, setAuditLogs] = useState([]);
	const [auditSearch, setAuditSearch] = useState('');
	const [auditFilter, setAuditFilter] = useState('ALL');
	const [auditPage, setAuditPage] = useState(1);
	const auditPageSize = 10;

	const [activeCategories, setActiveCategories] = useState(ALL_CATEGORIES);
	const [logFilter, setLogFilter] = useState('');
	const [autoScroll, setAutoScroll] = useState(true);
	const [terminalHeight, setTerminalHeight] = useState('560px');
	const [actionLoading, setActionLoading] = useState(false);
	const [toastMsg, setToastMsg] = useState('');
	const [toastError, setToastError] = useState(false);

	const logTerminalRef = useRef(null);

	// Paginated Audit Logs
	const totalAuditPages = Math.max(1, Math.ceil(auditLogs.length / auditPageSize));
	const currentAuditPage = Math.min(auditPage, totalAuditPages);
	const paginatedAuditLogs = useMemo(() => {
		const start = (currentAuditPage - 1) * auditPageSize;
		return auditLogs.slice(start, start + auditPageSize);
	}, [auditLogs, currentAuditPage, auditPageSize]);

	const showToast = (msg, isErr = false) => {
		setToastMsg(msg);
		setToastError(isErr);
		setTimeout(() => setToastMsg(''), 4000);
	};

	const fetchDevData = async () => {
		try {
			const checkRes = await fetch('/api/developer/check');
			const checkData = await checkRes.json();
			if (!checkData.isDeveloper) {
				setIsDev(false);
				return;
			}
			setIsDev(true);

			const [statsRes, logsRes] = await Promise.all([
				fetch('/api/developer/stats'),
				fetch('/api/developer/logs'),
			]);

			if (statsRes.ok) {
				const statsData = await statsRes.json();
				if (statsData.success) setStats(statsData);
			}

			if (logsRes.ok) {
				const logsData = await logsRes.json();
				if (logsData.success && Array.isArray(logsData.logs)) {
					setLogs(logsData.logs);
				}
			}
		}
		catch {
			setIsDev(false);
		}
	};

	const fetchAuditLogs = async () => {
		try {
			const res = await fetch(`/api/developer/audit-logs?limit=100&filter=${auditFilter}&search=${encodeURIComponent(auditSearch)}`);
			if (res.ok) {
				const data = await res.json();
				if (data.success && Array.isArray(data.logs)) {
					setAuditLogs(data.logs);
				}
			}
		}
		catch {}
	};

	useEffect(() => {
		fetchDevData();
		fetchAuditLogs();
		const interval = setInterval(() => {
			fetchDevData();
			fetchAuditLogs();
		}, 3000);
		return () => clearInterval(interval);
	}, [auditFilter, auditSearch]);

	useEffect(() => {
		if (autoScroll && logTerminalRef.current) {
			logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight;
		}
	}, [logs, autoScroll]);

	const toggleCategory = (cat) => {
		if (cat === 'ALL') {
			if (activeCategories.length === ALL_CATEGORIES.length) {
				setActiveCategories([]);
			}
			else {
				setActiveCategories([...ALL_CATEGORIES]);
			}
			return;
		}

		if (activeCategories.includes(cat)) {
			setActiveCategories(activeCategories.filter(c => c !== cat));
		}
		else {
			setActiveCategories([...activeCategories, cat]);
		}
	};

	const handleAction = async (actionType) => {
		setActionLoading(true);
		try {
			const res = await fetch('/api/developer/action', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: actionType }),
			});
			const data = await res.json();
			if (data.success) {
				showToast(data.message || 'Action executed successfully!');
				fetchDevData();
			}
			else {
				showToast(data.error || 'Action failed.', true);
			}
		}
		catch {
			showToast('Network error executing developer action.', true);
		}
		finally {
			setActionLoading(false);
		}
	};

	const purgeAuditLogs = async () => {
		if (!confirm('Are you sure you want to permanently purge audit logs older than 7 days?')) return;
		setActionLoading(true);
		try {
			const res = await fetch('/api/developer/audit-logs/purge', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ days: 7 }),
			});
			const data = await res.json();
			if (data.success) {
				showToast(data.message || 'Audit logs purged.');
				fetchAuditLogs();
			}
			else {
				showToast(data.error || 'Purge failed.', true);
			}
		}
		catch {
			showToast('Network error purging audit logs.', true);
		}
		finally {
			setActionLoading(false);
		}
	};

	if (isDev === null) {
		return (
			<div className="container" style={{ padding: '4rem 1.5rem', textAlign: 'center' }}>
				<div style={{ fontSize: '1.2rem', color: 'var(--muted)' }}>
					Verifying Developer Access Credentials...
				</div>
			</div>
		);
	}

	if (isDev === false) {
		return (
			<div className="container" style={{ padding: '4rem 1.5rem', textAlign: 'center' }}>
				<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '20px', padding: '3rem', maxWidth: '540px', margin: '0 auto' }}>
					<div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔐</div>
					<h2 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--ink)', marginBottom: '0.75rem' }}>
						Developer Access Required
					</h2>
					<p style={{ color: 'var(--muted)', fontSize: '0.95rem', lineHeight: '1.6', marginBottom: '2rem' }}>
						This command center requires a registered Developer Discord account.
					</p>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'center' }}>
						<a href="/api/auth/login" className="btn btn-discord" style={{ width: '100%', maxWidth: '280px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem' }}>
							Sign in with Discord
						</a>
						<Link href="/servers" className="btn btn-ghost btn-sm" style={{ marginTop: '0.5rem' }}>
							Return to Servers
						</Link>
					</div>
				</div>
			</div>
		);
	}

	const filteredLogs = logs.filter(log => {
		const cat = (log.category || 'System').toUpperCase();
		const matchesCat = activeCategories.some(ac => ac.toUpperCase() === cat);
		if (!matchesCat) return false;
		if (logFilter.trim()) {
			const q = logFilter.toLowerCase();
			return (log.message || '').toLowerCase().includes(q) || (log.host || '').toLowerCase().includes(q);
		}
		return true;
	});

	const pingMs = stats?.bot?.pingMs || 0;
	const pingColor = pingMs < 100 ? 'var(--settled)' : pingMs < 250 ? 'var(--gold)' : 'var(--due)';

	return (
		<div className="container" style={{ padding: '2rem 1rem', maxWidth: '1280px' }}>
			{toastMsg && <Toast message={toastMsg} isError={toastError} onClose={() => setToastMsg('')} />}

			{/* Page Header with Action Buttons */}
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
				<div>
					<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
						<h1 style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--ink)', margin: 0 }}>
							Developer Command Center
						</h1>
						<span style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 800 }}>
							SYSTEM ROOT
						</span>
					</div>
					<p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
						Real-time system telemetry, unified live logs, audio queue studio, and global audit inspection.
					</p>
				</div>

				<div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
					{stats?.discordBlock?.isBlocked && (
						<button
							onClick={() => handleAction('clear_discord_block')}
							disabled={actionLoading}
							className="btn btn-secondary btn-sm"
							style={{ color: 'var(--gold)', borderColor: 'var(--gold)', background: 'color-mix(in srgb, var(--gold) 15%, transparent)' }}
							title="Manually clear the Discord rate-limit cooldown guard."
						>
							Reset Discord Block Guard
						</button>
					)}
					<button
						onClick={() => handleAction('reload_cache')}
						disabled={actionLoading}
						className="btn btn-secondary btn-sm"
						title="Reload bot caches across all modules."
					>
						Reload Cache
					</button>
					<button
						onClick={() => handleAction('clear_queues')}
						disabled={actionLoading}
						className="btn btn-secondary btn-sm"
						title="Clear and flush all active audio queues."
					>
						Clear Queues
					</button>
					<button
						onClick={() => handleAction('restart_bot')}
						disabled={actionLoading}
						className="btn btn-secondary btn-sm"
						style={{ color: 'var(--due)', borderColor: 'color-mix(in srgb, var(--due) 40%, transparent)' }}
						title="Trigger clean restart of the Discord Bot process."
					>
						Restart Bot
					</button>
					<button
						onClick={fetchDevData}
						className="btn btn-primary btn-sm"
					>
						Refresh
					</button>
				</div>
			</div>

			{/* Telemetry Metric Cards */}
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
				{/* RAM Usage */}
				<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '1.25rem' }}>
					<div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
						Memory (RSS / Heap)
					</div>
					<div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--ink)' }}>
						{stats?.system?.ramUsedMB || 0} <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>MB RSS</span>
					</div>
					<div style={{ fontSize: '0.8rem', color: 'var(--accent)', marginTop: '0.3rem' }}>
						Heap: {stats?.system?.heapUsedMB || 0} / {stats?.system?.heapTotalMB || 0} MB
					</div>
				</div>

				{/* Discord Gateway Ping */}
				<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '1.25rem' }}>
					<div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
						Gateway Latency
					</div>
					<div style={{ fontSize: '1.6rem', fontWeight: 800, color: pingColor }}>
						{stats?.bot?.pingMs || 0} <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>ms</span>
					</div>
					<div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
						Bot Status: <strong style={{ color: stats?.bot?.status === 'online' ? 'var(--settled)' : 'var(--due)' }}>{stats?.bot?.status || 'offline'}</strong>
					</div>
				</div>

				{/* Discord Rate-Limit Status */}
				<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '1.25rem' }}>
					<div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
						Discord Rate-Limit
					</div>
					<div style={{ fontSize: '1.3rem', fontWeight: 800, color: stats?.discordBlock?.isBlocked ? 'var(--due)' : 'var(--settled)' }}>
						{stats?.discordBlock?.isBlocked ? 'Cooldown' : 'Operational'}
					</div>
					<div style={{ fontSize: '0.8rem', color: stats?.discordBlock?.isBlocked ? 'var(--due)' : 'var(--text-secondary)', marginTop: '0.3rem' }}>
						{stats?.discordBlock?.isBlocked
							? `${Math.max(1, Math.ceil(stats.discordBlock.retryAfterSeconds / 60))}m wait remaining`
							: '0 rate-limit holds'}
					</div>
				</div>

				{/* Guilds & Cached Users */}
				<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '1.25rem' }}>
					<div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
						Active Guilds & Members
					</div>
					<div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--ink)' }}>
						{stats?.bot?.guildCount || 0} <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Servers</span>
					</div>
					<div style={{ fontSize: '0.8rem', color: 'var(--settled)', marginTop: '0.3rem' }}>
						{stats?.bot?.userCount || 0} Total Cached Users
					</div>
				</div>

				{/* Voice Connections & Uptime */}
				<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '1.25rem' }}>
					<div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
						Active Voice & Uptime
					</div>
					<div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--accent)' }}>
						{stats?.bot?.voiceConnections || 0} <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>VC Players</span>
					</div>
					<div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
						Uptime: {formatUptime(stats?.system?.uptimeSeconds)}
					</div>
				</div>
			</div>

			{/* Service Status Row */}
			<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '1.25rem', marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
					<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
						<span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--settled)' }} />
						<span style={{ fontSize: '0.85rem', color: 'var(--ink)' }}>Express REST API</span>
					</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
						<span style={{ width: '10px', height: '10px', borderRadius: '50%', background: stats?.bot?.status === 'online' ? 'var(--settled)' : 'var(--due)' }} />
						<span style={{ fontSize: '0.85rem', color: 'var(--ink)' }}>Discord Bot Process</span>
					</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
						<span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--accent)' }} />
						<span style={{ fontSize: '0.85rem', color: 'var(--ink)' }}>Database Engine: <strong>{stats?.services?.dbStatus === 'postgresql' ? 'PostgreSQL' : 'Local JSON Store'}</strong></span>
					</div>
				</div>

				<div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
					Node.js {stats?.system?.nodeVersion} ({stats?.system?.platform})
				</div>
			</div>

			{/* 1. Real-Time Live Log Stream Terminal */}
			<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '16px', overflow: 'hidden', marginBottom: '2rem' }}>
				{/* Terminal Header & Category Controls */}
				<div style={{ background: 'var(--surface)', padding: '0.85rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
					<div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
						<span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--ink)', marginRight: '0.5rem' }}>
							Live System Logs
						</span>
						<button
							onClick={() => toggleCategory('ALL')}
							style={{
								background: activeCategories.length === ALL_CATEGORIES.length ? 'var(--accent-soft)' : 'transparent',
								border: activeCategories.length === ALL_CATEGORIES.length ? '1px solid var(--accent)' : '1px solid var(--border-color)',
								color: activeCategories.length === ALL_CATEGORIES.length ? 'var(--ink)' : 'var(--muted)',
								padding: '0.2rem 0.65rem',
								borderRadius: '6px',
								fontSize: '0.75rem',
								fontWeight: 700,
								cursor: 'pointer',
							}}
						>
							{activeCategories.length === ALL_CATEGORIES.length ? 'All' : 'Select All'}
						</button>
						{ALL_CATEGORIES.map(cat => {
							const isActive = activeCategories.includes(cat);
							const catColor = getCategoryColor(cat);
							return (
								<button
									key={cat}
									onClick={() => toggleCategory(cat)}
									style={{
										background: isActive ? `${catColor}22` : 'transparent',
										border: isActive ? `1px solid ${catColor}` : '1px solid var(--border-color)',
										color: isActive ? 'var(--ink)' : 'var(--muted)',
										padding: '0.2rem 0.6rem',
										borderRadius: '6px',
										fontSize: '0.75rem',
										fontWeight: 600,
										cursor: 'pointer',
										display: 'inline-flex',
										alignItems: 'center',
										gap: '0.3rem',
									}}
								>
									<span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isActive ? catColor : 'var(--faint)' }} />
									{cat}
								</button>
							);
						})}
					</div>

					<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
						{/* Height Selector Buttons */}
						<div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: 'var(--sunk)', padding: '0.15rem 0.3rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
							<span style={{ fontSize: '0.7rem', color: 'var(--muted)', padding: '0 0.25rem' }}>Height:</span>
							{['360px', '560px', '800px'].map(h => (
								<button
									key={h}
									onClick={() => setTerminalHeight(h)}
									style={{
										background: terminalHeight === h ? 'var(--accent)' : 'transparent',
										color: terminalHeight === h ? '#fff' : 'var(--muted)',
										border: 'none',
										borderRadius: '4px',
										padding: '0.15rem 0.45rem',
										fontSize: '0.7rem',
										fontWeight: 700,
										cursor: 'pointer',
									}}
								>
									{h.replace('px', '')}
								</button>
							))}
						</div>

						<input
							type="text"
							placeholder="Filter logs..."
							value={logFilter}
							onChange={e => setLogFilter(e.target.value)}
							style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', color: 'var(--ink)', padding: '0.35rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem', outline: 'none' }}
						/>

						<label style={{ fontSize: '0.8rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
							<input
								type="checkbox"
								checked={autoScroll}
								onChange={e => setAutoScroll(e.target.checked)}
							/>
							Auto-Scroll
						</label>
					</div>
				</div>

				{/* Terminal Content Box */}
				<div
					ref={logTerminalRef}
					style={{
						height: terminalHeight,
						overflowY: 'auto',
						padding: '1.25rem',
						fontFamily: 'Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
						fontSize: '0.85rem',
						lineHeight: '1.6',
						background: '#0d1117',
						color: '#c9d1d9',
						transition: 'height 0.2s ease',
					}}
				>
					{filteredLogs.length === 0 ? (
						<div style={{ color: '#6e7681', fontStyle: 'italic' }}>
							No system logs match active category selection...
						</div>
					) : (
						filteredLogs.map((log, i) => {
							const catLabel = log.category || 'System';
							const catColor = getCategoryColor(catLabel);
							return (
								<div key={i} style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.25rem', alignItems: 'baseline' }}>
									<span style={{ color: '#6e7681', flexShrink: 0 }}>[{log.timestamp}]</span>
									<span style={{ color: catColor, fontWeight: 600, flexShrink: 0, minWidth: '75px' }}>
										[{catLabel}]
									</span>
									<span style={{ color: log.message.includes('Error') ? '#f85149' : log.message.includes('Warning') ? '#d29922' : log.message.includes('TTS') || log.message.includes('Playing') ? '#e3b341' : '#c9d1d9' }}>
										{log.message}
									</span>
								</div>
							);
						})
					)}
				</div>
			</div>

			{/* 3. Global Audit Stream Section */}
			<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem' }}>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
					<div>
						<h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--ink)', margin: 0 }}>
							Global Mod/Admin Audit Stream
						</h3>
						<p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
							Monitor all moderator and administrator actions across every Discord server (Auto-pruned after 7 days).
						</p>
					</div>

					<div style={{ display: 'flex', gap: '0.75rem' }}>
						<button
							onClick={purgeAuditLogs}
							disabled={actionLoading}
							className="btn btn-secondary btn-sm"
							style={{ color: 'var(--due)', borderColor: 'color-mix(in srgb, var(--due) 40%, transparent)' }}
						>
							Purge Expired Logs (&gt;7 Days)
						</button>
						<button onClick={fetchAuditLogs} className="btn btn-secondary btn-sm">
							Refresh Audit
						</button>
					</div>
				</div>

				{/* Audit Controls Bar with CustomSelect */}
				<div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
					<div style={{ flex: 1, minWidth: '220px' }}>
						<input
							type="text"
							placeholder="Search by Guild Name or Server ID..."
							value={auditSearch}
							onChange={e => {
								setAuditSearch(e.target.value);
								setAuditPage(1);
							}}
							style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border-color)', color: 'var(--ink)', padding: '0.5rem 0.85rem', borderRadius: '8px', fontSize: '0.85rem', outline: 'none' }}
						/>
					</div>

					<div style={{ width: '250px' }}>
						<CustomSelect
							value={auditFilter}
							onChange={(val) => {
								setAuditFilter(val);
								setAuditPage(1);
							}}
							options={AUDIT_FILTER_OPTIONS}
							placeholder="Filter event types..."
							searchable={false}
						/>
					</div>
				</div>

				{/* Audit Table */}
				{auditLogs.length === 0 ? (
					<div style={{ background: 'var(--surface)', borderRadius: '12px', padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
						No audit events recorded for the selected search parameters.
					</div>
				) : (
					<div style={{ background: 'var(--surface)', borderRadius: '12px', overflow: 'hidden' }}>
						<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
							<thead>
								<tr style={{ background: 'var(--sunk)', borderBottom: '1px solid var(--border-color)', color: 'var(--muted)' }}>
									<th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Timestamp</th>
									<th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Server Name</th>
									<th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Actor</th>
									<th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Event Type</th>
									<th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Action Details</th>
								</tr>
							</thead>
							<tbody>
								{paginatedAuditLogs.map((log, idx) => {
									const evtType = log.event_type || log.action_type || 'GENERAL';
									const badgeStyle = getAuditBadgeStyle(evtType);
									const dateStr = log.created_at ? new Date(log.created_at).toLocaleString() : '';
									return (
										<tr key={log.id || idx} style={{ borderBottom: '1px solid var(--line)' }}>
											<td style={{ padding: '0.75rem 1rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
												{dateStr}
											</td>
											<td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
												{log.guild_name || log.guild_id || 'Unknown Server'}
											</td>
											<td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
												{log.username || log.user_name || 'System'}
											</td>
											<td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
												<span style={{ ...badgeStyle, padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600 }}>
													{evtType}
												</span>
											</td>
											<td style={{ padding: '0.75rem 1rem', color: 'var(--muted)' }}>
												{log.details || '-'}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>

						{/* Audit Logs Pagination Bar */}
						<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'var(--sunk)', borderTop: '1px solid var(--border-color)', fontSize: '0.8rem', color: 'var(--muted)', flexWrap: 'wrap', gap: '0.5rem' }}>
							<div>
								Showing {(currentAuditPage - 1) * auditPageSize + 1} - {Math.min(currentAuditPage * auditPageSize, auditLogs.length)} of {auditLogs.length} entries
							</div>
							<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
								<button
									onClick={() => setAuditPage(p => Math.max(1, p - 1))}
									disabled={currentAuditPage <= 1}
									className="btn btn-secondary btn-sm"
									style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
								>
									Previous
								</button>
								<span style={{ fontWeight: 600, color: 'var(--ink)' }}>
									Page {currentAuditPage} of {totalAuditPages}
								</span>
								<button
									onClick={() => setAuditPage(p => Math.min(totalAuditPages, p + 1))}
									disabled={currentAuditPage >= totalAuditPages}
									className="btn btn-secondary btn-sm"
									style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
								>
									Next
								</button>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
