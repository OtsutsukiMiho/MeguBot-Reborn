'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Toast from '../components/Toast.js';

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
	case 'Tts': return 'var(--gold)';
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

const ALL_CATEGORIES = ['System', 'Bot', 'Web', 'Tts', 'AutoMod', 'Database'];

export default function DeveloperPage() {
	const [isDev, setIsDev] = useState(null);
	const [stats, setStats] = useState(null);
	const [logs, setLogs] = useState([]);
	const [auditLogs, setAuditLogs] = useState([]);
	const [auditSearch, setAuditSearch] = useState('');
	const [auditFilter, setAuditFilter] = useState('ALL');
	const [activeCategories, setActiveCategories] = useState(ALL_CATEGORIES);
	const [logFilter, setLogFilter] = useState('');
	const [autoScroll, setAutoScroll] = useState(true);
	const [actionLoading, setActionLoading] = useState(false);
	const [toastMsg, setToastMsg] = useState('');
	const [toastError, setToastError] = useState(false);

	const logTerminalRef = useRef(null);

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

	const triggerAction = async (actionName, label) => {
		setActionLoading(true);
		try {
			const res = await fetch('/api/developer/action', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: actionName }),
			});
			const data = await res.json();
			if (data.success) {
				showToast(`${label}: ${data.message}`);
				fetchDevData();
			}
			else {
				showToast(`Error: ${data.error || 'Failed action.'}`, true);
			}
		}
		catch (err) {
			showToast(`Connection Error: ${err.message}`, true);
		}
		finally {
			setActionLoading(false);
		}
	};

	const purgeAuditLogs = async () => {
		if (!confirm('Are you sure you want to purge audit logs older than 7 days?')) return;
		setActionLoading(true);
		try {
			const res = await fetch('/api/developer/audit-logs/purge', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ days: 7 }),
			});
			const data = await res.json();
			if (data.success) {
				showToast(`${data.message}`);
				fetchAuditLogs();
			}
			else {
				showToast(`Error: ${data.error || 'Purge failed.'}`, true);
			}
		}
		catch (err) {
			showToast(`Connection Error: ${err.message}`, true);
		}
		finally {
			setActionLoading(false);
		}
	};

	if (isDev === null) {
		return (
			<div style={{ textAlign: 'center', padding: '3rem 0' }}>
				<div className="status-badge" style={{ display: 'inline-flex', padding: '0.75rem 1.5rem' }}>
					⏳ Validating Developer Credentials...
				</div>
			</div>
		);
	}

	if (isDev === false) {
		return (
			<div style={{ maxWidth: '600px', margin: '2rem auto' }}>
				<div style={{ background: 'var(--due-soft)', border: '1px solid color-mix(in srgb, var(--due) 30%, transparent)', borderRadius: '16px', padding: '2.5rem', textAlign: 'center' }}>
					<div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔒</div>
					<h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--due)', marginBottom: '0.5rem' }}>
						Access Restricted
					</h2>
					<p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
						The Developer Portal is reserved strictly for the authorized Megux Corp development team.
					</p>
					<Link href="/servers" className="btn btn-primary">
						Return to Server Dashboard
					</Link>
				</div>
			</div>
		);
	}

	const filteredLogs = logs.filter(l => {
		const cat = l.category || 'System';
		if (!activeCategories.includes(cat)) {
			return false;
		}
		if (!logFilter) return true;
		const query = logFilter.toLowerCase();
		return (l.message || '').toLowerCase().includes(query) || (l.host || '').toLowerCase().includes(query);
	});

	const pingColor = (stats?.bot?.pingMs || 0) < 100 ? 'var(--settled)' : (stats?.bot?.pingMs || 0) < 250 ? 'var(--gold)' : 'var(--due)';

	return (
		<div>
			<Toast message={toastMsg} isError={toastError} />

			{/* Header Banner */}
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
				<div>
					<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
						<h1 style={{ fontSize: '2rem', fontWeight: 800 }}>Developer Command Center</h1>
						<span className="status-badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}>
							Developer Portal
						</span>
					</div>
					<p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
						Real-time system telemetry, bot performance stats, live terminal logging & global audit stream.
					</p>
				</div>

				<div style={{ display: 'flex', gap: '0.75rem' }}>
					<button
						onClick={() => triggerAction('reload_cache', 'Reload Bot Cache')}
						disabled={actionLoading}
						className="btn btn-secondary btn-sm"
					>
						Reload Cache
					</button>
					<button
						onClick={() => triggerAction('clear_queues', 'Clear Audio Queues')}
						disabled={actionLoading}
						className="btn btn-secondary btn-sm"
					>
						Clear Queues
					</button>
					<button
						onClick={() => triggerAction('restart_bot', 'Restart Bot Process')}
						disabled={actionLoading}
						className="btn btn-primary btn-sm"
						style={{ background: 'linear-gradient(135deg, var(--due), var(--due))', border: 'none' }}
					>
						Restart Bot
					</button>
				</div>
			</div>

			{/* Performance Metrics Cards Grid */}
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
				{/* RAM & Heap */}
				<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '1.25rem' }}>
					<div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
						Memory Usage
					</div>
					<div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--ink)' }}>
						{stats?.system?.ramUsedMB || 0} <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>MB RSS</span>
					</div>
					<div style={{ fontSize: '0.8rem', color: 'var(--accent)', marginTop: '0.3rem' }}>
						Heap Used: {stats?.system?.heapUsedMB || 0} / {stats?.system?.heapTotalMB || 0} MB
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

			{/* Real-Time Live Log Stream Terminal */}
			<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '16px', overflow: 'hidden', marginBottom: '2rem' }}>
				{/* Terminal Header & Multi-Select Category Bar */}
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
							{activeCategories.length === ALL_CATEGORIES.length ? '✓ All' : 'Select All'}
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

					<div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
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

				{/* Terminal Content */}
				<div
					ref={logTerminalRef}
					style={{
						height: '360px',
						overflowY: 'auto',
						padding: '1.25rem',
						fontFamily: 'Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
						fontSize: '0.85rem',
						lineHeight: '1.6',
						// Deliberately dark in both themes. This is a terminal, and a
						// terminal that inverts with the page stops looking like one —
						// the ANSI-ish level colours below are calibrated for this ground.
						background: '#0d1117',
						color: '#c9d1d9',
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
									<span style={{ color: log.message.includes('Error') ? '#f85149' : log.message.includes('Warning') ? '#d29922' : '#c9d1d9' }}>
										{log.message}
									</span>
								</div>
							);
						})
					)}
				</div>
			</div>

			{/* Global Audit Stream Section */}
			<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem' }}>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
					<div>
						<h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--ink)' }}>
							📜 Global Mod/Admin Audit Stream
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
							🧹 Purge Expired Logs (&gt;7 Days)
						</button>
						<button onClick={fetchAuditLogs} className="btn btn-secondary btn-sm">
							🔄 Refresh Audit
						</button>
					</div>
				</div>

				{/* Audit Controls Bar */}
				<div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
					<div style={{ flex: 1, minWidth: '220px' }}>
						<input
							type="text"
							placeholder="Search by Guild Name or Server ID..."
							value={auditSearch}
							onChange={e => setAuditSearch(e.target.value)}
							style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border-color)', color: 'var(--ink)', padding: '0.5rem 0.85rem', borderRadius: '8px', fontSize: '0.85rem', outline: 'none' }}
						/>
					</div>

					<div style={{ width: '220px' }}>
						<select
							value={auditFilter}
							onChange={e => setAuditFilter(e.target.value)}
							style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border-color)', color: 'var(--ink)', padding: '0.5rem 0.85rem', borderRadius: '8px', fontSize: '0.85rem', outline: 'none' }}
						>
							<option value="ALL">All Event Types</option>
							<option value="WELCOME_LEAVE">👋 Welcome & Leave</option>
							<option value="AUTOROLE">🎖️ AutoRoles</option>
							<option value="VOICE_TTS">🗣️ Voice TTS Suite</option>
							<option value="HONEYPOT">🍯 Honeypot Trap</option>
							<option value="AUTOMOD">🛡️ Auto-Moderation</option>
							<option value="REACTION_ROLE">⚡ Reaction Roles</option>
							<option value="COMMAND_EXEC">🤖 Slash Commands</option>
						</select>
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
								{auditLogs.map((log, idx) => {
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
					</div>
				)}
			</div>
		</div>
	);
}
