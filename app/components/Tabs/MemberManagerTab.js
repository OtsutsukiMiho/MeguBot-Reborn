'use client';

import { useState, useEffect, useMemo } from 'react';
import CustomSelect from '../CustomSelect.js';

export default function MemberManagerTab({ guildId, roles, initialMembers = [], showToast, onRefresh }) {
	const [memberSearch, setMemberSearch] = useState('');
	const [memberFilter, setMemberFilter] = useState('all'); // 'all' | 'humans' | 'bots'
	const [sortBy, setSortBy] = useState('name_asc'); // 'name_asc' | 'name_desc' | 'id_asc' | 'id_desc' | 'roles_desc'
	const [currentPage, setCurrentPage] = useState(1);
	const [pageSize, setPageSize] = useState(15);
	const [membersList, setMembersList] = useState(initialMembers || []);
	const [membersLoading, setMembersLoading] = useState(false);
	const [copiedId, setCopiedId] = useState(null);
	const [expandedMemberRoles, setExpandedMemberRoles] = useState(new Set());

	// Modal State for Batch Role Editing
	const [editingMember, setEditingMember] = useState(null);
	const [modalRoleSearch, setModalRoleSearch] = useState('');
	const [selectedRoleIds, setSelectedRoleIds] = useState(new Set());
	const [modalSaving, setModalSaving] = useState(false);

	// Sync members whenever initialMembers updates from parent dashboard
	useEffect(() => {
		if (Array.isArray(initialMembers)) {
			setMembersList(initialMembers);
		}
	}, [initialMembers]);

	// Reset to Page 1 when filter, search, or sort changes
	useEffect(() => {
		setCurrentPage(1);
	}, [memberSearch, memberFilter, sortBy, pageSize]);

	const allRoles = Array.isArray(roles) ? roles : [];
	const rolesMap = new Map(allRoles.map(r => [r.id, r]));

	// Always a literal hex. Callers build tints from it with color-mix, and a
	// role with no colour set is extremely common, so the fallback cannot be a
	// CSS variable — it has to be mixable like any other role colour.
	const getRoleColorHex = (colorVal) => {
		if (!colorVal || colorVal === 0 || colorVal === '#000000') return '#8A8F9E';
		if (typeof colorVal === 'string' && colorVal.startsWith('#')) return colorVal;
		return '#' + Number(colorVal).toString(16).padStart(6, '0');
	};

	const copyToClipboard = (text, id, userName) => {
		navigator.clipboard.writeText(text);
		setCopiedId(id);
		if (showToast) showToast(userName ? `Copied user ID for @${userName}` : 'User ID copied to clipboard');
		setTimeout(() => setCopiedId(null), 2000);
	};

	const toggleExpandRoles = (memberId) => {
		setExpandedMemberRoles(prev => {
			const next = new Set(prev);
			if (next.has(memberId)) next.delete(memberId);
			else next.add(memberId);
			return next;
		});
	};

	// Open Batch Role Editor Modal
	const handleOpenRoleModal = (member) => {
		setEditingMember(member);
		setSelectedRoleIds(new Set(member.roles || []));
		setModalRoleSearch('');
	};

	const handleCloseRoleModal = () => {
		if (modalSaving) return;
		setEditingMember(null);
		setSelectedRoleIds(new Set());
		setModalRoleSearch('');
	};

	const handleToggleRoleSelection = (roleId) => {
		setSelectedRoleIds(prev => {
			const next = new Set(prev);
			if (next.has(roleId)) {
				next.delete(roleId);
			} else {
				next.add(roleId);
			}
			return next;
		});
	};

	// Save Batch Role Changes
	const handleSaveMemberRoles = async () => {
		if (!editingMember || !guildId) return;
		setModalSaving(true);
		try {
			const finalRolesArray = Array.from(selectedRoleIds);
			const res = await fetch(`/api/guilds/${guildId}/members/${editingMember.id}/roles`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ roleIds: finalRolesArray }),
			});

			const rawText = await res.text();
			let data;
			try {
				data = JSON.parse(rawText);
			} catch {
				throw new Error('Server returned an unexpected non-JSON response. Please ensure the backend server has been restarted.');
			}

			if (data && data.success) {
				showToast(`Roles updated for @${editingMember.displayName || editingMember.username}!`);
				// Update local member roles state immediately
				setMembersList(prev => prev.map(m => {
					if (m.id === editingMember.id) {
						return { ...m, roles: data.roles || finalRolesArray };
					}
					return m;
				}));
				handleCloseRoleModal();
			} else {
				showToast(data?.error || 'Failed to update member roles.', true);
			}
		} catch (err) {
			showToast(`Error: ${err.message}`, true);
		} finally {
			setModalSaving(false);
		}
	};

	// Manual Refresh Button Handler
	const handleRefresh = async () => {
		if (onRefresh) {
			setMembersLoading(true);
			try {
				await onRefresh();
				showToast('Server member roster refreshed!');
			} catch (e) {
				console.error(e);
			} finally {
				setMembersLoading(false);
			}
		}
	};

	// Instant in-memory search & sort for members
	const filteredAndSortedMembers = useMemo(() => {
		const q = memberSearch.trim().toLowerCase();
		const filtered = (membersList || []).filter(m => {
			if (memberFilter === 'humans' && m.isBot) return false;
			if (memberFilter === 'bots' && !m.isBot) return false;

			if (!q) return true;
			return (
				(m.displayName && m.displayName.toLowerCase().includes(q)) ||
				(m.username && m.username.toLowerCase().includes(q)) ||
				(m.id && String(m.id).includes(q))
			);
		});

		// Sort logic
		return filtered.sort((a, b) => {
			if (sortBy === 'name_asc') {
				return (a.displayName || a.username || '').localeCompare(b.displayName || b.username || '', undefined, { sensitivity: 'base' });
			}
			if (sortBy === 'name_desc') {
				return (b.displayName || b.username || '').localeCompare(a.displayName || a.username || '', undefined, { sensitivity: 'base' });
			}
			if (sortBy === 'id_asc') {
				try {
					return BigInt(a.id || 0) < BigInt(b.id || 0) ? -1 : 1;
				} catch {
					return String(a.id).localeCompare(String(b.id));
				}
			}
			if (sortBy === 'id_desc') {
				try {
					return BigInt(b.id || 0) < BigInt(a.id || 0) ? -1 : 1;
				} catch {
					return String(b.id).localeCompare(String(a.id));
				}
			}
			if (sortBy === 'roles_desc') {
				return (b.roles?.length || 0) - (a.roles?.length || 0);
			}
			return 0;
		});
	}, [membersList, memberSearch, memberFilter, sortBy]);

	// Pagination slice
	const totalItems = filteredAndSortedMembers.length;
	const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
	const safeCurrentPage = Math.min(currentPage, totalPages);
	const startIndex = (safeCurrentPage - 1) * pageSize;
	const endIndex = Math.min(startIndex + pageSize, totalItems);
	const paginatedMembers = filteredAndSortedMembers.slice(startIndex, endIndex);

	// Filter manageable roles in the modal
	const modalFilteredRoles = useMemo(() => {
		const q = modalRoleSearch.trim().toLowerCase();
		return allRoles.filter(r => {
			if (r.name === '@everyone' || r.managed) return false;
			if (!q) return true;
			return r.name.toLowerCase().includes(q) || String(r.id).includes(q);
		});
	}, [allRoles, modalRoleSearch]);

	return (
		<div>
			{/* Top Header */}
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
				<div>
					<h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '0.25rem' }}>
						Member Manager
					</h3>
					<p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
						Explore server members, manage assigned roles, and search user accounts with instant client-side filtering and sorting.
					</p>
				</div>
				<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
					<span className="status-badge" style={{ background: 'var(--accent-soft)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)', color: 'var(--accent)' }}>
						{membersList.length} Server Members
					</span>
					{onRefresh && (
						<button
							onClick={handleRefresh}
							className="btn btn-secondary btn-sm"
							disabled={membersLoading}
						>
							{membersLoading ? 'Refreshing...' : 'Refresh'}
						</button>
					)}
				</div>
			</div>

			{/* Search, Filter & Sort Controls Bar */}
			<div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '1.5rem', background: 'var(--surface-2)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1rem' }}>
				<div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
					<div style={{ flex: 1, minWidth: '240px' }}>
						<input
							type="text"
							className="form-control"
							placeholder="Search by username, nickname, or user ID..."
							value={memberSearch}
							onChange={e => setMemberSearch(e.target.value)}
						/>
					</div>

					{/* Category Chips */}
					<div style={{ display: 'flex', gap: '0.4rem' }}>
						<button
							className={`btn btn-sm ${memberFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
							onClick={() => setMemberFilter('all')}
							style={{ fontSize: '0.8rem', padding: '0.45rem 0.75rem' }}
						>
							All ({membersList.length})
						</button>
						<button
							className={`btn btn-sm ${memberFilter === 'humans' ? 'btn-primary' : 'btn-secondary'}`}
							onClick={() => setMemberFilter('humans')}
							style={{ fontSize: '0.8rem', padding: '0.45rem 0.75rem' }}
						>
							Humans ({membersList.filter(m => !m.isBot).length})
						</button>
						<button
							className={`btn btn-sm ${memberFilter === 'bots' ? 'btn-primary' : 'btn-secondary'}`}
							onClick={() => setMemberFilter('bots')}
							style={{ fontSize: '0.8rem', padding: '0.45rem 0.75rem' }}
						>
							Bots ({membersList.filter(m => m.isBot).length})
						</button>
					</div>
				</div>

				{/* Sort & Items Per Page Row */}
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--sunk)' }}>
					<div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
						<span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
							Sort By:
						</span>
						<div style={{ width: '220px' }}>
							<CustomSelect
								value={sortBy}
								onChange={(val) => setSortBy(val)}
								options={[
									{ value: 'name_asc', label: 'Name (A → Z)', icon: '🔤' },
									{ value: 'name_desc', label: 'Name (Z → A)', icon: '🔤' },
									{ value: 'id_asc', label: 'User ID (Oldest Account)', icon: '⌛' },
									{ value: 'id_desc', label: 'User ID (Newest Account)', icon: '⚡' },
									{ value: 'roles_desc', label: 'Most Assigned Roles', icon: '🎖️' },
								]}
								searchable={false}
							/>
						</div>
					</div>

					<div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
						<span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
							Per Page:
						</span>
						<div style={{ width: '140px' }}>
							<CustomSelect
								value={pageSize}
								onChange={(val) => setPageSize(Number(val))}
								options={[
									{ value: 15, label: '15 members' },
									{ value: 30, label: '30 members' },
								]}
								searchable={false}
							/>
						</div>
					</div>
				</div>
			</div>

			{/* Members Grid View */}
			{membersLoading && membersList.length === 0 ? (
				<div style={{ padding: '4rem 0', textAlign: 'center', color: 'var(--text-secondary)' }}>
					Fetching server members...
				</div>
			) : (
				<>
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
						{paginatedMembers.length === 0 ? (
							<div style={{ gridColumn: '1 / -1', padding: '3rem 2rem', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--surface-2)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
								No server members found matching your search and filter criteria.
							</div>
						) : (
							paginatedMembers.map(member => {
								const isExpanded = expandedMemberRoles.has(member.id);
								const visibleRoles = isExpanded ? member.roles : member.roles.slice(0, 3);
								const hiddenCount = member.roles.length - visibleRoles.length;

								return (
									<div
										key={member.id}
										style={{
											background: 'var(--surface-2)',
											border: '1px solid var(--border-color)',
											borderRadius: '12px',
											padding: '1.25rem',
											display: 'flex',
											flexDirection: 'column',
											gap: '0.85rem',
										}}
									>
										{/* Member Header */}
										<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
											<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', overflow: 'hidden' }}>
												<img
													src={member.avatar}
													alt={member.username}
													style={{ width: '42px', height: '42px', borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border-color)', flexShrink: 0 }}
												/>
												<div style={{ overflow: 'hidden' }}>
													<div style={{ fontWeight: 700, color: 'var(--ink)', fontSize: '0.95rem', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
														{member.displayName}
													</div>
													<div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
														@{member.username} {member.isBot ? '(Bot)' : ''}
													</div>
												</div>
											</div>

											<button
												onClick={() => copyToClipboard(member.id, member.id, member.username)}
												className="btn btn-secondary btn-sm"
												style={{
													fontSize: '0.72rem',
													padding: '0.2rem 0.55rem',
													whiteSpace: 'nowrap',
													flexShrink: 0,
													color: copiedId === member.id ? 'var(--settled)' : undefined,
													borderColor: copiedId === member.id ? 'rgba(52, 211, 153, 0.4)' : undefined,
												}}
											>
												{copiedId === member.id ? 'Copied!' : 'Copy ID'}
											</button>
										</div>

										{/* Member Assigned Roles Badges */}
										<div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', minHeight: '28px', alignItems: 'center' }}>
											{member.roles.length === 0 ? (
												<span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
													No assigned roles
												</span>
											) : (
												<>
													{visibleRoles.map(rId => {
														const r = rolesMap.get(rId);
														const hex = getRoleColorHex(r && (r.hexColor || r.color));
														return (
															<span
																key={rId}
																className="tag-badge"
																style={{
																	display: 'inline-flex',
																	alignItems: 'center',
																	gap: '0.35rem',
																	background: `color-mix(in srgb, ${hex} 14%, transparent)`,
																	border: `1px solid color-mix(in srgb, ${hex} 40%, transparent)`,
																	padding: '0.2rem 0.5rem',
																	borderRadius: '4px',
																	fontSize: '0.75rem',
																}}
															>
																{/* The dot carries the role's colour; the name does not. A role
																    colour is chosen to look right on Discord's dark chrome, so as
																    text on this panel it can land anywhere — Discord green on white
																    measures about 1.6:1. The hue still identifies the role, and the
																    name stays readable in either theme. */}
																<span style={{ width: '6px', height: '6px', borderRadius: '50%', background: hex, flex: 'none' }}></span>
																<span style={{ color: 'var(--ink)', fontWeight: 600 }}>{r ? r.name : rId}</span>
															</span>
														);
													})}

													{hiddenCount > 0 && (
														<button
															type="button"
															onClick={() => toggleExpandRoles(member.id)}
															title="View all roles"
															style={{
																background: 'var(--sunk)',
																border: '1px solid var(--border-color)',
																color: 'var(--text-secondary)',
																borderRadius: '4px',
																fontSize: '0.72rem',
																padding: '0.15rem 0.45rem',
																cursor: 'pointer',
																fontWeight: 600,
																transition: 'all 0.15s ease',
															}}
															onMouseEnter={e => e.currentTarget.style.color = 'var(--ink)'}
															onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
														>
															+{hiddenCount} more
														</button>
													)}

													{isExpanded && member.roles.length > 3 && (
														<button
															type="button"
															onClick={() => toggleExpandRoles(member.id)}
															style={{
																background: 'none',
																border: 'none',
																color: 'var(--text-muted)',
																fontSize: '0.72rem',
																cursor: 'pointer',
																textDecoration: 'underline',
																padding: '0.15rem 0.3rem',
															}}
														>
															Show less
														</button>
													)}
												</>
											)}
										</div>

										{/* Edit Roles Action Button */}
										<div style={{ marginTop: 'auto', paddingTop: '0.25rem' }}>
											<button
												onClick={() => handleOpenRoleModal(member)}
												className="btn btn-secondary btn-sm"
												style={{
													width: '100%',
													display: 'flex',
													alignItems: 'center',
													justifyContent: 'center',
													gap: '0.5rem',
													padding: '0.45rem 0.75rem',
													fontSize: '0.8rem',
													fontWeight: 600,
												}}
											>
												<span>Edit Roles</span>
												<span
													style={{
														fontSize: '0.7rem',
														background: 'var(--sunk)',
														padding: '0.1rem 0.4rem',
														borderRadius: '10px',
														color: 'var(--text-secondary)',
													}}
												>
													{member.roles.length}
												</span>
											</button>
										</div>
									</div>
								);
							})
						)}
					</div>

					{/* Pagination Footer */}
					{totalItems > 0 && (
						<div
							style={{
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'space-between',
								flexWrap: 'wrap',
								gap: '1rem',
								padding: '1rem 1.25rem',
								background: 'var(--surface-2)',
								border: '1px solid var(--border-color)',
								borderRadius: '12px',
								marginBottom: '1.5rem',
							}}
						>
							<div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
								Showing <strong style={{ color: 'var(--ink)' }}>{startIndex + 1}</strong> - <strong style={{ color: 'var(--ink)' }}>{endIndex}</strong> of <strong style={{ color: 'var(--ink)' }}>{totalItems}</strong> members
							</div>

							<div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
								<button
									className="btn btn-secondary btn-sm"
									onClick={() => setCurrentPage(1)}
									disabled={safeCurrentPage === 1}
									style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
								>
									« First
								</button>
								<button
									className="btn btn-secondary btn-sm"
									onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
									disabled={safeCurrentPage === 1}
									style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
								>
									‹ Prev
								</button>

								{/* Page Numbers */}
								<div style={{ display: 'flex', gap: '0.25rem', margin: '0 0.25rem' }}>
									{Array.from({ length: totalPages }, (_, i) => i + 1)
										.filter(p => p === 1 || p === totalPages || Math.abs(p - safeCurrentPage) <= 2)
										.map((p, idx, arr) => {
											const prevPage = arr[idx - 1];
											const showEllipsis = prevPage && p - prevPage > 1;
											return (
												<div key={p} style={{ display: 'flex', alignItems: 'center' }}>
													{showEllipsis && (
														<span style={{ padding: '0 0.35rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>...</span>
													)}
													<button
														className={`btn btn-sm ${p === safeCurrentPage ? 'btn-primary' : 'btn-secondary'}`}
														onClick={() => setCurrentPage(p)}
														style={{
															padding: '0.35rem 0.65rem',
															fontSize: '0.8rem',
															minWidth: '32px',
															fontWeight: p === safeCurrentPage ? 700 : 500,
														}}
													>
														{p}
													</button>
												</div>
											);
										})}
								</div>

								<button
									className="btn btn-secondary btn-sm"
									onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
									disabled={safeCurrentPage === totalPages}
									style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
								>
									Next ›
								</button>
								<button
									className="btn btn-secondary btn-sm"
									onClick={() => setCurrentPage(totalPages)}
									disabled={safeCurrentPage === totalPages}
									style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
								>
									Last »
								</button>
							</div>
						</div>
					)}
				</>
			)}

			{/* ================= MODAL: EDIT MEMBER ROLES ================= */}
			{editingMember && (
				<div
					style={{
						position: 'fixed',
						inset: 0,
						background: 'rgba(0, 0, 0, 0.75)',
						backdropFilter: 'blur(6px)',
						zIndex: 1000,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						padding: '1rem',
					}}
					onClick={handleCloseRoleModal}
				>
					<div
						style={{
							background: 'var(--surface)',
							border: '1px solid var(--border-color)',
							borderRadius: '16px',
							maxWidth: '520px',
							width: '100%',
							padding: '1.75rem',
							boxShadow: '0 20px 40px rgba(22, 24, 31, .24)',
							display: 'flex',
							flexDirection: 'column',
							maxHeight: '85vh',
						}}
						onClick={e => e.stopPropagation()}
					>
						{/* Modal Header */}
						<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
							<div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
								<img
									src={editingMember.avatar}
									alt=""
									style={{ width: '44px', height: '44px', borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border-color)' }}
								/>
								<div>
									<h4 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '0.15rem' }}>
										Edit Roles
									</h4>
									<div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
										@{editingMember.displayName} ({editingMember.username})
									</div>
								</div>
							</div>
							<button
								onClick={handleCloseRoleModal}
								disabled={modalSaving}
								style={{
									background: 'none',
									border: 'none',
									color: 'var(--text-muted)',
									fontSize: '1.2rem',
									cursor: 'pointer',
									padding: '0.25rem 0.5rem',
									borderRadius: '6px',
								}}
							>
								✕
							</button>
						</div>

						{/* Role Search & Quick Toggles */}
						<div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
							<input
								type="text"
								placeholder="Filter server roles..."
								value={modalRoleSearch}
								onChange={e => setModalRoleSearch(e.target.value)}
								className="form-control"
								style={{ fontSize: '0.85rem' }}
								autoFocus
							/>
							<button
								type="button"
								onClick={() => setSelectedRoleIds(new Set())}
								className="btn btn-secondary btn-sm"
								style={{ fontSize: '0.75rem', whiteSpace: 'nowrap', padding: '0.4rem 0.65rem' }}
							>
								Clear All
							</button>
						</div>

						{/* Roles Selection List */}
						<div
							style={{
								flex: 1,
								overflowY: 'auto',
								display: 'flex',
								flexDirection: 'column',
								gap: '0.4rem',
								padding: '0.35rem',
								background: 'rgba(0, 0, 0, 0.25)',
								borderRadius: '8px',
								border: '1px solid var(--border-color)',
								marginBottom: '1.25rem',
								minHeight: '220px',
								maxHeight: '340px',
							}}
						>
							{modalFilteredRoles.length === 0 ? (
								<div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
									No roles found matching "{modalRoleSearch}".
								</div>
							) : (
								modalFilteredRoles.map(role => {
									const isSelected = selectedRoleIds.has(role.id);
									const hex = getRoleColorHex(role.hexColor || role.color);

									return (
										<div
											key={role.id}
											onClick={() => handleToggleRoleSelection(role.id)}
											style={{
												display: 'flex',
												alignItems: 'center',
												justifyContent: 'space-between',
												gap: '0.75rem',
												padding: '0.6rem 0.85rem',
												borderRadius: '6px',
												cursor: 'pointer',
												background: isSelected ? `color-mix(in srgb, ${hex} 18%, transparent)` : 'var(--surface-2)',
												border: isSelected ? `1px solid color-mix(in srgb, ${hex} 60%, transparent)` : '1px solid transparent',
												transition: 'all 0.12s ease',
											}}
											onMouseEnter={e => {
												if (!isSelected) e.currentTarget.style.background = 'var(--sunk)';
											}}
											onMouseLeave={e => {
												if (!isSelected) e.currentTarget.style.background = 'var(--surface-2)';
											}}
										>
											<div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
												<span
													style={{
														width: '10px',
														height: '10px',
														borderRadius: '50%',
														background: hex,
														boxShadow: `0 0 6px color-mix(in srgb, ${hex} 50%, transparent)`,
														flexShrink: 0,
													}}
												/>
												<span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--ink)' }}>
													@{role.name}
												</span>
											</div>

											<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
												<input
													type="checkbox"
													checked={isSelected}
													onChange={() => {}}
													style={{
														width: '16px',
														height: '16px',
														accentColor: 'var(--color-accent)',
														cursor: 'pointer',
													}}
												/>
											</div>
										</div>
									);
								})
							)}
						</div>

						{/* Modal Footer */}
						<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
							<span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
								{selectedRoleIds.size} {selectedRoleIds.size === 1 ? 'role' : 'roles'} selected
							</span>
							<div style={{ display: 'flex', gap: '0.65rem' }}>
								<button
									type="button"
									className="btn btn-secondary btn-sm"
									onClick={handleCloseRoleModal}
									disabled={modalSaving}
								>
									Cancel
								</button>
								<button
									type="button"
									className="btn btn-sm"
									onClick={handleSaveMemberRoles}
									disabled={modalSaving}
								>
									{modalSaving ? 'Saving Roles...' : 'Save Roles'}
								</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
