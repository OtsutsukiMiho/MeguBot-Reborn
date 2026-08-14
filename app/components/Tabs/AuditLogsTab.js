'use client';

import { useState, useEffect, useMemo } from 'react';

function getBadgeStyle(eventType) {
	switch (eventType) {
	case 'MESSAGE_DELETE':
		return { background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)' };
	case 'MEMBER_BAN':
	case 'MEMBER_UNBAN':
		return { background: 'rgba(220, 38, 38, 0.2)', color: '#ef4444', border: '1px solid rgba(220, 38, 38, 0.4)' };
	case 'MEMBER_KICK':
		return { background: 'rgba(249, 115, 22, 0.15)', color: '#fb923c', border: '1px solid rgba(249, 115, 22, 0.3)' };
	case 'MEMBER_TIMEOUT':
		return { background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.3)' };
	case 'MEMBER_UPDATE':
		return { background: 'rgba(99, 102, 241, 0.15)', color: '#a5b4fc', border: '1px solid rgba(99, 102, 241, 0.3)' };
	case 'ROLE_ASSIGN':
	case 'ROLE_UPDATE':
	case 'ROLE_CREATE':
	case 'ROLE_DELETE':
	case 'AUTOROLE':
	case 'AUTOROLE_ASSIGN':
		return { background: 'rgba(236, 72, 153, 0.15)', color: '#f472b6', border: '1px solid rgba(236, 72, 153, 0.3)' };
	case 'CHANNEL_CREATE':
	case 'CHANNEL_DELETE':
	case 'CHANNEL_UPDATE':
		return { background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' };
	case 'INVITE_CREATE':
	case 'INVITE_DELETE':
		return { background: 'rgba(14, 165, 233, 0.15)', color: '#38bdf8', border: '1px solid rgba(14, 165, 233, 0.3)' };
	case 'WELCOME_LEAVE':
		return { background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.25)' };
	case 'VOICE_TTS':
		return { background: 'rgba(251, 191, 36, 0.1)', color: '#fbbf24', border: '1px solid rgba(251, 191, 36, 0.25)' };
	case 'HONEYPOT':
		return { background: 'rgba(192, 132, 252, 0.1)', color: '#c084fc', border: '1px solid rgba(192, 132, 252, 0.25)' };
	case 'AUTOMOD':
	case 'AUTOMOD_CONFIG':
	case 'AUTOMOD_TRIGGER':
		return { background: 'rgba(248, 113, 113, 0.1)', color: '#f87171', border: '1px solid rgba(248, 113, 113, 0.25)' };
	case 'REACTION_ROLE':
	case 'REACTION_ROLE_CONFIG':
	case 'REACTION_ROLE_ASSIGN':
		return { background: 'rgba(52, 211, 153, 0.1)', color: '#34d399', border: '1px solid rgba(52, 211, 153, 0.25)' };
	case 'COMMAND_EXEC':
		return { background: 'rgba(129, 140, 248, 0.1)', color: '#818cf8', border: '1px solid rgba(129, 140, 248, 0.25)' };
	default:
		return { background: 'rgba(156, 163, 175, 0.1)', color: '#d1d5db', border: '1px solid rgba(156, 163, 175, 0.25)' };
	}
}

function formatDate(isoStr) {
	if (!isoStr) return '';
	try {
		const d = new Date(isoStr);
		return d.toLocaleString();
	}
	catch {
		return isoStr;
	}
}

export default function AuditLogsTab({ guildId }) {
	const [logs, setLogs] = useState([]);
	const [loading, setLoading] = useState(true);
	const [filter, setFilter] = useState('ALL');
	const [search, setSearch] = useState('');

	const fetchLogs = () => {
		setLoading(true);
		fetch(`/api/guilds/${guildId}/audit-logs?limit=150&filter=${filter}`)
			.then(res => res.json())
			.then(data => {
				if (data.success && Array.isArray(data.logs)) {
					setLogs(data.logs);
				}
			})
			.catch(() => {})
			.finally(() => setLoading(false));
	};

	useEffect(() => {
		fetchLogs();
	}, [guildId, filter]);

	const filteredLogs = useMemo(() => {
		return logs.filter(l => {
			if (!search) return true;
			const query = search.toLowerCase();
			const u = (l.username || l.user_name || '').toLowerCase();
			const d = (l.details || '').toLowerCase();
			const t = (l.event_type || l.action_type || '').toLowerCase();
			return u.includes(query) || d.includes(query) || t.includes(query);
		});
	}, [logs, search]);

	return (
		<div>
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
				<div>
					<h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ffffff', marginBottom: '0.25rem' }}>
						Server Audit Log History
					</h3>
					<p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
						Real-time Discord native server audit history (deleted messages, kicks, bans, timeouts, channel/role edits, invites, and web changes).
					</p>
				</div>

				<button onClick={fetchLogs} className="btn btn-secondary btn-sm">
					Refresh Logs
				</button>
			</div>

			{/* Filters Bar */}
			<div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
				<div style={{ flex: 1, minWidth: '200px' }}>
					<input
						type="text"
						className="form-control"
						placeholder="Search by actor, action details, or event type..."
						value={search}
						onChange={e => setSearch(e.target.value)}
					/>
				</div>

				<div style={{ width: '250px' }}>
					<select className="form-control" value={filter} onChange={e => setFilter(e.target.value)}>
						<option value="ALL">All Server Event Types</option>
						<option value="MESSAGE_DELETE">Messages Deleted & Purged</option>
						<option value="MEMBER_BAN">Bans & Unbans</option>
						<option value="MEMBER_KICK">Member Kicks</option>
						<option value="MEMBER_TIMEOUT">Timeouts (Mute)</option>
						<option value="MEMBER_UPDATE">Member & Nickname Changes</option>
						<option value="ROLE_ASSIGN">Role Assignments (Discord & Web)</option>
						<option value="ROLE_UPDATE">Role Created / Edited / Deleted</option>
						<option value="CHANNEL_UPDATE">Channel Created / Edited / Deleted</option>
						<option value="INVITE_CREATE">Invites Created / Deleted</option>
						<option value="AUTOMOD">Auto-Moderation Triggers</option>
						<option value="WELCOME_LEAVE">Welcome & Member Leaves</option>
						<option value="VOICE_TTS">Voice TTS Suite</option>
						<option value="HONEYPOT">Honeypot Trap</option>
						<option value="REACTION_ROLE">Reaction Roles</option>
					</select>
				</div>
			</div>

			{/* Audit Log Table */}
			{loading ? (
				<div style={{ padding: '3rem 0', textAlign: 'center', color: 'var(--text-secondary)' }}>
					Loading audit log events...
				</div>
			) : filteredLogs.length === 0 ? (
				<div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
					No audit log records found matching your filter criteria.
				</div>
			) : (
				<div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' }}>
					<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
						<thead>
							<tr style={{ background: 'rgba(255, 255, 255, 0.03)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
								<th style={{ padding: '0.85rem 1rem', fontWeight: 600, width: '170px' }}>Timestamp</th>
								<th style={{ padding: '0.85rem 1rem', fontWeight: 600, width: '160px' }}>Actor</th>
								<th style={{ padding: '0.85rem 1rem', fontWeight: 600, width: '150px' }}>Event Category</th>
								<th style={{ padding: '0.85rem 1rem', fontWeight: 600 }}>Action Details</th>
							</tr>
						</thead>
						<tbody>
							{filteredLogs.map((log, idx) => {
								const evtType = log.event_type || log.action_type || 'GENERAL';
								const badgeStyle = getBadgeStyle(evtType);
								return (
									<tr key={log.id || idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
										<td style={{ padding: '0.85rem 1rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
											{formatDate(log.created_at)}
										</td>
										<td style={{ padding: '0.85rem 1rem', fontWeight: 600, color: '#ffffff', whiteSpace: 'nowrap' }}>
											{log.username || log.user_name || 'System'}
										</td>
										<td style={{ padding: '0.85rem 1rem', whiteSpace: 'nowrap' }}>
											<span style={{ ...badgeStyle, padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600 }}>
												{evtType}
											</span>
										</td>
										<td style={{ padding: '0.85rem 1rem', color: '#e2e8f0', wordBreak: 'break-word' }}>
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
	);
}
