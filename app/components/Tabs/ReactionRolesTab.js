'use client';

import { useState } from 'react';

export default function ReactionRolesTab({ guildId, reactionRoles, roles, channels, onRefresh, showToast }) {
	const [channelId, setChannelId] = useState('');
	const [messageIdInput, setMessageIdInput] = useState('');
	const [emoji, setEmoji] = useState('');
	const [roleId, setRoleId] = useState('');
	const [mode, setMode] = useState('toggle');
	const [saving, setSaving] = useState(false);

	const rolesMap = new Map((roles || []).map(r => [r.id, r.name]));

	const handleAddReactionRole = async () => {
		if (!messageIdInput.trim() || !emoji.trim() || !roleId) {
			showToast('Please fill in Message Link/ID, Emoji, and Assigned Role.', true);
			return;
		}

		let targetMessageId = messageIdInput.trim();
		let messageLink = null;
		if (targetMessageId.includes('discord.com/channels/')) {
			messageLink = targetMessageId;
		}

		setSaving(true);
		try {
			const res = await fetch(`/api/guilds/${guildId}/reaction-roles`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					channelId,
					messageId: targetMessageId,
					messageLink,
					emoji: emoji.trim(),
					roleId,
					mode,
				}),
			});

			const data = await res.json();
			if (data.success) {
				showToast('Reaction role saved and auto-reacted on Discord!');
				setMessageIdInput('');
				setEmoji('');
				onRefresh();
			} else {
				showToast(data.error || 'Failed to add reaction role.', true);
			}
		} catch (e) {
			showToast('Error adding reaction role.', true);
		} finally {
			setSaving(false);
		}
	};

	const handleToggleStatus = async (msgId, em) => {
		try {
			const res = await fetch(`/api/guilds/${guildId}/reaction-roles`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'toggle', messageId: msgId, emoji: em }),
			});
			const data = await res.json();
			if (data.success) {
				showToast('Reaction role status updated!');
				onRefresh();
			} else {
				showToast(data.error || 'Failed to toggle status.', true);
			}
		} catch (e) {
			showToast('Error toggling status.', true);
		}
	};

	const handleDelete = async (msgId, em) => {
		try {
			const res = await fetch(`/api/guilds/${guildId}/reaction-roles`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'delete', messageId: msgId, emoji: em }),
			});
			const data = await res.json();
			if (data.success) {
				showToast('Reaction role removed!');
				onRefresh();
			} else {
				showToast(data.error || 'Failed to remove reaction role.', true);
			}
		} catch (e) {
			showToast('Error removing reaction role.', true);
		}
	};

	const handleClearAll = async () => {
		if (!confirm('Are you sure you want to remove all reaction role mappings for this server?')) return;
		try {
			const res = await fetch(`/api/guilds/${guildId}/reaction-roles`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'clear_all' }),
			});
			const data = await res.json();
			if (data.success) {
				showToast('All reaction roles cleared!');
				onRefresh();
			} else {
				showToast(data.error || 'Failed to clear reaction roles.', true);
			}
		} catch (e) {
			showToast('Error clearing reaction roles.', true);
		}
	};

	const rows = [];
	if (reactionRoles && typeof reactionRoles === 'object') {
		for (const [msgId, emojis] of Object.entries(reactionRoles)) {
			if (!emojis || typeof emojis !== 'object') continue;
			for (const [em, entry] of Object.entries(emojis)) {
				let entryRoleId = null;
				let entryMode = 'toggle';
				let entryEnabled = true;

				if (typeof entry === 'object' && entry !== null) {
					entryRoleId = entry.roleId;
					entryMode = entry.mode || 'toggle';
					entryEnabled = entry.enabled !== false;
				} else {
					entryRoleId = entry;
				}

				rows.push({
					msgId,
					emoji: em,
					roleId: entryRoleId,
					roleName: rolesMap.get(entryRoleId) ? `@ ${rolesMap.get(entryRoleId)}` : `Role ID: ${entryRoleId}`,
					mode: entryMode,
					enabled: entryEnabled,
				});
			}
		}
	}

	return (
		<div>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
				<div>
					<h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '0.25rem' }}>
						Reaction Roles Setup
					</h3>
					<p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
						Bind emojis on Discord messages to grant or revoke server roles automatically.
					</p>
				</div>
				{rows.length > 0 && (
					<button
						onClick={handleClearAll}
						className="btn btn-secondary btn-sm"
						style={{ color: 'var(--due)', borderColor: 'color-mix(in srgb, var(--due) 30%, transparent)' }}
					>
						Clear All Mappings
					</button>
				)}
			</div>

			{/* Add Reaction Role Form Grid */}
			<div style={{ background: 'var(--surface-2)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1.25rem', marginBottom: '1.75rem' }}>
				<div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '1rem', color: 'var(--ink)' }}>
					Add New Reaction Role Mapping
				</div>

				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', alignItems: 'flex-end' }}>
					<div className="form-group" style={{ marginBottom: 0 }}>
						<label className="form-label">Channel (Optional)</label>
						<select className="form-control" style={{ height: '42px' }} value={channelId} onChange={e => setChannelId(e.target.value)}>
							<option value="">Auto-Detect Channel</option>
							{channels.map(c => (
								<option key={c.id} value={c.id}># {c.name}</option>
							))}
						</select>
					</div>

					<div className="form-group" style={{ marginBottom: 0 }}>
						<label className="form-label">Message Link / ID</label>
						<input
							type="text"
							className="form-control"
							style={{ height: '42px' }}
							placeholder="Paste Message Link or ID..."
							value={messageIdInput}
							onChange={e => setMessageIdInput(e.target.value)}
						/>
					</div>

					<div className="form-group" style={{ marginBottom: 0 }}>
						<label className="form-label">Reaction Emoji</label>
						<input
							type="text"
							className="form-control"
							style={{ height: '42px' }}
							placeholder="e.g. ⭐, 🎮, ✅"
							value={emoji}
							onChange={e => setEmoji(e.target.value)}
						/>
					</div>

					<div className="form-group" style={{ marginBottom: 0 }}>
						<label className="form-label">Assigned Role</label>
						<select className="form-control" style={{ height: '42px' }} value={roleId} onChange={e => setRoleId(e.target.value)}>
							<option value="">Select Role...</option>
							{roles.map(r => (
								<option key={r.id} value={r.id}>@ {r.name}</option>
							))}
						</select>
					</div>

					<div className="form-group" style={{ marginBottom: 0 }}>
						<label className="form-label">Reaction Mode</label>
						<select className="form-control" style={{ height: '42px' }} value={mode} onChange={e => setMode(e.target.value)}>
							<option value="toggle">Toggle (Give & Remove)</option>
							<option value="give_only">Give-Only (Add Role Only)</option>
						</select>
					</div>

					<div className="form-group" style={{ marginBottom: 0 }}>
						<button
							className="btn"
							style={{ width: '100%', height: '42px', whiteSpace: 'nowrap' }}
							onClick={handleAddReactionRole}
							disabled={saving}
						>
							{saving ? 'Saving...' : 'Add & Auto-React'}
						</button>
					</div>
				</div>
			</div>

			{/* Mappings Table */}
			<div style={{ overflowX: 'auto', background: 'var(--surface-2)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0.5rem' }}>
				<table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
					<thead>
						<tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
							<th style={{ padding: '0.75rem 1rem' }}>Status</th>
							<th style={{ padding: '0.75rem 1rem' }}>Message ID</th>
							<th style={{ padding: '0.75rem 1rem' }}>Emoji</th>
							<th style={{ padding: '0.75rem 1rem' }}>Role Assigned</th>
							<th style={{ padding: '0.75rem 1rem' }}>Mode</th>
							<th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
						</tr>
					</thead>
					<tbody>
						{rows.length === 0 ? (
							<tr>
								<td colSpan={6} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
									No reaction role mappings configured yet.
								</td>
							</tr>
						) : (
							rows.map((row, idx) => (
								<tr key={idx} style={{ borderBottom: '1px solid var(--sunk)', opacity: row.enabled ? 1 : 0.45, transition: 'opacity 0.2s ease' }}>
									<td style={{ padding: '0.85rem 1rem' }}>
										<button
											onClick={() => handleToggleStatus(row.msgId, row.emoji)}
											className={`server-status-badge ${row.enabled ? 'status-online' : 'status-offline'}`}
											style={{ cursor: 'pointer', border: 'none' }}
											title={row.enabled ? 'Click to disable' : 'Click to enable'}
										>
											{row.enabled ? <><span className="status-dot"></span> Active</> : 'Inactive'}
										</button>
									</td>
									<td style={{ padding: '0.85rem 1rem', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
										{row.msgId}
									</td>
									<td style={{ padding: '0.85rem 1rem', fontSize: '1.1rem' }}>
										{row.emoji}
									</td>
									<td style={{ padding: '0.85rem 1rem', color: 'var(--accent)', fontWeight: 600 }}>
										{row.roleName}
									</td>
									<td style={{ padding: '0.85rem 1rem' }}>
										{row.mode === 'give_only' ? (
											<span className="server-status-badge" style={{ background: 'var(--settled-soft)', color: 'var(--settled)', border: '1px solid color-mix(in srgb, var(--settled) 25%, transparent)' }}>
												Give-Only
											</span>
										) : (
											<span className="server-status-badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)' }}>
												Toggle
											</span>
										)}
									</td>
									<td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
										<button
											onClick={() => handleDelete(row.msgId, row.emoji)}
											className="btn btn-secondary btn-sm"
											style={{ color: 'var(--due)', padding: '0.25rem 0.65rem', fontSize: '0.75rem' }}
										>
											Remove
										</button>
									</td>
								</tr>
							))
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}
