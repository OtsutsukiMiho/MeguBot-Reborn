'use client';

import { useState } from 'react';
import ColorPicker from '../ColorPicker';

export default function RoleManagerTab({ roles, guildId, showToast, onRefresh }) {
	const [searchQuery, setSearchQuery] = useState('');
	const [copiedId, setCopiedId] = useState(null);

	// Create Role Modal state
	const [showCreateModal, setShowCreateModal] = useState(false);
	const [newRoleName, setNewRoleName] = useState('');
	const [newRoleColor, setNewRoleColor] = useState('#6366f1');
	const [newRoleHoist, setNewRoleHoist] = useState(false);
	const [newRoleMentionable, setNewRoleMentionable] = useState(false);
	const [createLoading, setCreateLoading] = useState(false);

	// Edit Role Modal state
	const [editingRole, setEditingRole] = useState(null);
	const [editName, setEditName] = useState('');
	const [editColor, setEditColor] = useState('#6366f1');
	const [editHoist, setEditHoist] = useState(false);
	const [editMentionable, setEditMentionable] = useState(false);
	const [editLoading, setEditLoading] = useState(false);

	const allRoles = Array.isArray(roles) ? roles : [];

	const presetColors = [
		// Literal hex on purpose: these are values sent to Discord as the role
		// colour, not styling for this page. A CSS variable here reaches the API.
		'#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#06b6d4', '#9ca3af'
	];

	const filteredRoles = allRoles.filter(r => {
		if (!searchQuery) return true;
		const q = searchQuery.toLowerCase();
		return r.name.toLowerCase().includes(q) || String(r.id).includes(q);
	});

	const copyToClipboard = (text, id, roleName) => {
		navigator.clipboard.writeText(text);
		setCopiedId(id);
		if (showToast) showToast(roleName ? `Copied role ID for @${roleName}` : 'Role ID copied to clipboard');
		setTimeout(() => setCopiedId(null), 2000);
	};

	const getRoleColorHex = (colorVal) => {
		// Literal hex: feeds ColorPicker and color-mix, and reaches Discord on save.
		if (!colorVal || colorVal === 0 || colorVal === '#000000') return '#8A8F9E';
		if (typeof colorVal === 'string' && colorVal.startsWith('#')) return colorVal;
		return '#' + Number(colorVal).toString(16).padStart(6, '0');
	};

	// --- CREATE ROLE ---
	const handleCreateRole = async (e) => {
		e?.preventDefault();
		if (!newRoleName.trim()) {
			showToast('Please specify a role name.', true);
			return;
		}

		setCreateLoading(true);
		try {
			const res = await fetch(`/api/guilds/${guildId}/roles/create`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: newRoleName.trim(),
					color: newRoleColor,
					hoist: newRoleHoist,
					mentionable: newRoleMentionable,
				}),
			});

			const data = await res.json();
			if (data.success) {
				showToast(`Role @${newRoleName} created successfully!`);
				setShowCreateModal(false);
				setNewRoleName('');
				setNewRoleColor('#6366f1');
				setNewRoleHoist(false);
				setNewRoleMentionable(false);
				if (onRefresh) onRefresh();
			} else {
				showToast(data.error || 'Failed to create role.', true);
			}
		} catch (err) {
			showToast(`Error: ${err.message}`, true);
		} finally {
			setCreateLoading(false);
		}
	};

	// --- OPEN EDIT MODAL ---
	const openEditModal = (role) => {
		setEditingRole(role);
		setEditName(role.name);
		setEditColor(getRoleColorHex(role.hexColor || role.color));
		setEditHoist(!!role.hoist);
		setEditMentionable(!!role.mentionable);
	};

	// --- SAVE EDIT ROLE ---
	const handleSaveEditRole = async (e) => {
		e?.preventDefault();
		if (!editingRole) return;

		setEditLoading(true);
		try {
			const res = await fetch(`/api/guilds/${guildId}/roles/${editingRole.id}/update`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: editName.trim(),
					color: editColor,
					hoist: editHoist,
					mentionable: editMentionable,
				}),
			});

			const data = await res.json();
			if (data.success) {
				showToast(`Role @${editName} updated successfully!`);
				setEditingRole(null);
				if (onRefresh) onRefresh();
			} else {
				showToast(data.error || 'Failed to update role.', true);
			}
		} catch (err) {
			showToast(`Error: ${err.message}`, true);
		} finally {
			setEditLoading(false);
		}
	};

	// --- DELETE ROLE ---
	const handleDeleteRole = async (role) => {
		if (!confirm(`Are you sure you want to permanently delete role @${role.name}? This action cannot be undone.`)) return;

		try {
			const res = await fetch(`/api/guilds/${guildId}/roles/${role.id}/delete`, {
				method: 'POST',
			});

			const data = await res.json();
			if (data.success) {
				showToast(`Role @${role.name} deleted successfully!`);
				if (onRefresh) onRefresh();
			} else {
				showToast(data.error || 'Failed to delete role.', true);
			}
		} catch (err) {
			showToast(`Error: ${err.message}`, true);
		}
	};

	return (
		<div>
			{/* Top Header */}
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
				<div>
					<h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '0.25rem' }}>
						Role Manager
					</h3>
					<p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
						Create, edit, and organize server roles with custom hex colors, hoists, and permissions.
					</p>
				</div>
				<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
					<span className="status-badge" style={{ background: 'var(--accent-soft)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)', color: 'var(--accent)' }}>
						{allRoles.length} Server Roles
					</span>
				</div>
			</div>

			{/* Role Search & Create Action Bar */}
			<div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
				<div style={{ flex: 1, minWidth: '240px' }}>
					<input
						type="text"
						className="form-control"
						placeholder="Search roles by name or role ID..."
						value={searchQuery}
						onChange={e => setSearchQuery(e.target.value)}
					/>
				</div>
				<button
					className="btn btn-sm"
					onClick={() => setShowCreateModal(true)}
					style={{ background: 'var(--color-accent)', whiteSpace: 'nowrap', padding: '0.65rem 1.25rem' }}
				>
					Create Role
				</button>
			</div>

			{/* Roles Table */}
			<div style={{ background: 'var(--surface-2)', border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden', marginBottom: '1.5rem' }}>
				<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
					<thead>
						<tr style={{ background: 'var(--sunk)', borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
							<th style={{ padding: '0.85rem 1rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Role</th>
							<th style={{ padding: '0.85rem 1rem', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Role ID</th>
							<th style={{ padding: '0.85rem 1rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Flags</th>
							<th style={{ padding: '0.85rem 1rem', fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'right', whiteSpace: 'nowrap' }}>Actions</th>
						</tr>
					</thead>
					<tbody>
						{filteredRoles.length === 0 ? (
							<tr>
								<td colSpan="4" style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
									No roles found matching your search.
								</td>
							</tr>
						) : (
							filteredRoles.map(role => {
								const hex = getRoleColorHex(role.hexColor || role.color);
								const isEveryone = role.name === '@everyone';
								const isManaged = !!role.managed;
								return (
									<tr
										key={role.id}
										style={{ borderBottom: '1px solid var(--sunk)', transition: 'background 0.15s ease' }}
									>
										<td style={{ padding: '0.85rem 1rem' }}>
											<div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
												<span style={{ width: '10px', height: '10px', borderRadius: '50%', background: hex, flexShrink: 0 }}></span>
												<span style={{ fontWeight: 600, color: 'var(--ink)' }}>
													{role.name}
												</span>
												{isEveryone && (
													<span style={{ fontSize: '0.7rem', background: 'var(--sunk)', padding: '0.1rem 0.4rem', borderRadius: '4px', color: 'var(--text-muted)' }}>
														Default
													</span>
												)}
												{isManaged && (
													<span style={{ fontSize: '0.7rem', background: 'rgba(251, 191, 36, 0.1)', color: 'var(--gold)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
														Managed
													</span>
												)}
											</div>
										</td>
										<td style={{ padding: '0.85rem 1rem', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
											{role.id}
										</td>
										<td style={{ padding: '0.85rem 1rem' }}>
											<div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
												{role.hoist && (
													<span style={{ fontSize: '0.7rem', background: 'var(--accent-soft)', color: 'var(--accent)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
														Hoisted
													</span>
												)}
												{role.mentionable && (
													<span style={{ fontSize: '0.7rem', background: 'var(--settled-soft)', color: 'var(--settled)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
														Mentionable
													</span>
												)}
											</div>
										</td>
										<td style={{ padding: '0.85rem 1rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
											<div style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'nowrap' }}>
												<button
													onClick={() => copyToClipboard(role.id, role.id, role.name)}
													className="btn btn-secondary btn-sm"
													style={{
														fontSize: '0.75rem',
														padding: '0.25rem 0.65rem',
														whiteSpace: 'nowrap',
														color: copiedId === role.id ? 'var(--settled)' : undefined,
														borderColor: copiedId === role.id ? 'rgba(52, 211, 153, 0.4)' : undefined,
													}}
												>
													{copiedId === role.id ? 'Copied!' : 'Copy ID'}
												</button>
												{!isEveryone && !isManaged && (
													<>
														<button
															onClick={() => openEditModal(role)}
															className="btn btn-secondary btn-sm"
															style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem', whiteSpace: 'nowrap' }}
														>
															Edit
														</button>
														<button
															onClick={() => handleDeleteRole(role)}
															className="btn btn-secondary btn-sm"
															style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem', color: 'var(--due)', whiteSpace: 'nowrap' }}
														>
															Delete
														</button>
													</>
												)}
											</div>
										</td>
									</tr>
								);
							})
						)}
					</tbody>
				</table>
			</div>

			{/* ================= MODAL: CREATE ROLE ================= */}
			{showCreateModal && (
				<div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(6px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
					<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '16px', maxWidth: '480px', width: '100%', padding: '1.75rem', boxShadow: '0 20px 40px rgba(22, 24, 31, .24)' }}>
						<h4 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '1rem' }}>
							Create New Server Role
						</h4>

						<form onSubmit={handleCreateRole}>
							<div className="form-group">
								<label className="form-label">Role Name</label>
								<input
									type="text"
									className="form-control"
									placeholder="e.g. VIP Member, Moderator"
									value={newRoleName}
									onChange={e => setNewRoleName(e.target.value)}
									required
									autoFocus
								/>
							</div>

							<div className="form-group">
								<ColorPicker
									color={newRoleColor}
									onChange={setNewRoleColor}
									roleName={newRoleName || 'New Role'}
									label="Role Color Studio"
								/>
							</div>

							<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
								<label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer' }}>
									<input
										type="checkbox"
										checked={newRoleHoist}
										onChange={e => setNewRoleHoist(e.target.checked)}
										style={{ width: '16px', height: '16px' }}
									/>
									<span style={{ fontSize: '0.875rem', color: 'var(--ink)' }}>Display role members separately in sidebar (Hoist)</span>
								</label>

								<label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer' }}>
									<input
										type="checkbox"
										checked={newRoleMentionable}
										onChange={e => setNewRoleMentionable(e.target.checked)}
										style={{ width: '16px', height: '16px' }}
									/>
									<span style={{ fontSize: '0.875rem', color: 'var(--ink)' }}>Allow anyone to @mention this role</span>
								</label>
							</div>

							<div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
								<button
									type="button"
									className="btn btn-secondary btn-sm"
									onClick={() => setShowCreateModal(false)}
									disabled={createLoading}
								>
									Cancel
								</button>
								<button
									type="submit"
									className="btn btn-sm"
									disabled={createLoading}
								>
									{createLoading ? 'Creating...' : 'Create Role'}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{/* ================= MODAL: EDIT ROLE ================= */}
			{editingRole && (
				<div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(6px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
					<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '16px', maxWidth: '480px', width: '100%', padding: '1.75rem', boxShadow: '0 20px 40px rgba(22, 24, 31, .24)' }}>
						<h4 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '1rem' }}>
							Edit Role: @{editingRole.name}
						</h4>

						<form onSubmit={handleSaveEditRole}>
							<div className="form-group">
								<label className="form-label">Role Name</label>
								<input
									type="text"
									className="form-control"
									value={editName}
									onChange={e => setEditName(e.target.value)}
									required
								/>
							</div>

							<div className="form-group">
								<ColorPicker
									color={editColor}
									onChange={setEditColor}
									roleName={editName || editingRole.name}
									label="Role Color Studio"
								/>
							</div>

							<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
								<label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer' }}>
									<input
										type="checkbox"
										checked={editHoist}
										onChange={e => setEditHoist(e.target.checked)}
										style={{ width: '16px', height: '16px' }}
									/>
									<span style={{ fontSize: '0.875rem', color: 'var(--ink)' }}>Display role members separately in sidebar (Hoist)</span>
								</label>

								<label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer' }}>
									<input
										type="checkbox"
										checked={editMentionable}
										onChange={e => setEditMentionable(e.target.checked)}
										style={{ width: '16px', height: '16px' }}
									/>
									<span style={{ fontSize: '0.875rem', color: 'var(--ink)' }}>Allow anyone to @mention this role</span>
								</label>
							</div>

							<div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
								<button
									type="button"
									className="btn btn-secondary btn-sm"
									onClick={() => setEditingRole(null)}
									disabled={editLoading}
								>
									Cancel
								</button>
								<button
									type="submit"
									className="btn btn-sm"
									disabled={editLoading}
								>
									{editLoading ? 'Saving...' : 'Save Changes'}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}
		</div>
	);
}
