'use client';

import { useState, useEffect, useMemo } from 'react';

function getBadgeStyle(eventType) {
	switch (eventType) {
	case 'MESSAGE_DELETE':
		return { background: 'color-mix(in srgb, var(--due) var(--cat-tint), transparent)', color: 'var(--due)', border: '1px solid color-mix(in srgb, var(--due) 30%, transparent)' };
	case 'MEMBER_BAN':
	case 'MEMBER_UNBAN':
		return { background: 'color-mix(in srgb, var(--due) var(--cat-tint), transparent)', color: 'var(--due)', border: '1px solid color-mix(in srgb, var(--due) 30%, transparent)' };
	case 'MEMBER_KICK':
		return { background: 'color-mix(in srgb, var(--cat-orange) var(--cat-tint), transparent)', color: 'var(--cat-orange)', border: '1px solid color-mix(in srgb, var(--cat-orange) 30%, transparent)' };
	case 'MEMBER_TIMEOUT':
		return { background: 'color-mix(in srgb, var(--gold) var(--cat-tint), transparent)', color: 'var(--gold)', border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)' };
	case 'MEMBER_UPDATE':
		return { background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' };
	case 'ROLE_ASSIGN':
	case 'ROLE_UPDATE':
	case 'ROLE_CREATE':
	case 'ROLE_DELETE':
	case 'AUTOROLE':
	case 'AUTOROLE_ASSIGN':
		return { background: 'color-mix(in srgb, var(--cat-pink) var(--cat-tint), transparent)', color: 'var(--cat-pink)', border: '1px solid color-mix(in srgb, var(--cat-pink) 30%, transparent)' };
	case 'CHANNEL_CREATE':
	case 'CHANNEL_DELETE':
	case 'CHANNEL_UPDATE':
		return { background: 'color-mix(in srgb, var(--settled) var(--cat-tint), transparent)', color: 'var(--settled)', border: '1px solid color-mix(in srgb, var(--settled) 30%, transparent)' };
	case 'INVITE_CREATE':
	case 'INVITE_DELETE':
		return { background: 'color-mix(in srgb, var(--cat-cyan) var(--cat-tint), transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--cat-cyan) 30%, transparent)' };
	case 'WELCOME_LEAVE':
		return { background: 'color-mix(in srgb, var(--cat-cyan) var(--cat-tint), transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--cat-cyan) 30%, transparent)' };
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
					<h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '0.25rem' }}>
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
				<div style={{ background: 'var(--surface-2)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
					No audit log records found matching your filter criteria.
				</div>
			) : (
				<div style={{ background: 'var(--surface-2)', border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' }}>
					<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
						<thead>
							<tr style={{ background: 'var(--sunk)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
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
									<tr key={log.id || idx} style={{ borderBottom: '1px solid var(--sunk)' }}>
										<td style={{ padding: '0.85rem 1rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
											{formatDate(log.created_at)}
										</td>
										<td style={{ padding: '0.85rem 1rem', fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
											{log.username || log.user_name || 'System'}
										</td>
										<td style={{ padding: '0.85rem 1rem', whiteSpace: 'nowrap' }}>
											<span style={{ ...badgeStyle, padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600 }}>
												{evtType}
											</span>
										</td>
										<td style={{ padding: '0.85rem 1rem', color: 'var(--ink)', wordBreak: 'break-word' }}>
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
