'use client';

import { useState, useEffect, useMemo } from 'react';
import CustomSelect from '../CustomSelect.js';

export default function NicknameManagerTab({ guildId, initialMembers = [], showToast, onRefresh }) {
	const [memberSearch, setMemberSearch] = useState('');
	const [memberFilter, setMemberFilter] = useState('all'); // 'all' | 'custom' | 'default' | 'humans' | 'bots'
	const [sortBy, setSortBy] = useState('custom_first'); // 'custom_first' | 'name_asc' | 'name_desc' | 'id_asc' | 'id_desc'
	const [currentPage, setCurrentPage] = useState(1);
	const [pageSize, setPageSize] = useState(15);
	const [membersList, setMembersList] = useState(initialMembers || []);
	const [nicknamesMap, setNicknamesMap] = useState({});
	const [loading, setLoading] = useState(false);
	const [copiedId, setCopiedId] = useState(null);

	// Modal State for Editing Nickname
	const [editingMember, setEditingMember] = useState(null);
	const [modalNickInput, setModalNickInput] = useState('');
	const [modalSaving, setModalSaving] = useState(false);

	// Fetch custom nicknames from API
	const fetchNicknames = async () => {
		if (!guildId) return;
		try {
			const res = await fetch(`/api/guilds/${guildId}/nicknames`);
			const data = await res.json();
			if (data && data.success && data.nicknames) {
				setNicknamesMap(data.nicknames);
			}
		} catch (err) {
			console.error('Failed to fetch nicknames:', err);
		}
	};

	useEffect(() => {
		fetchNicknames();
	}, [guildId]);

	// Sync members when initialMembers changes from parent
	useEffect(() => {
		if (Array.isArray(initialMembers)) {
			setMembersList(initialMembers);
		}
	}, [initialMembers]);

	// Reset to Page 1 when filter, search, or sort changes
	useEffect(() => {
		setCurrentPage(1);
	}, [memberSearch, memberFilter, sortBy, pageSize]);

	const copyToClipboard = (text, id, userName) => {
		navigator.clipboard.writeText(text);
		setCopiedId(id);
		if (showToast) showToast(userName ? `Copied user ID for @${userName}` : 'User ID copied to clipboard');
		setTimeout(() => setCopiedId(null), 2000);
	};

	// Open Edit Nickname Modal
	const handleOpenEditModal = (member) => {
		setEditingMember(member);
		const currentNick = nicknamesMap[member.id] || '';
		setModalNickInput(currentNick);
	};

	const handleCloseEditModal = () => {
		if (modalSaving) return;
		setEditingMember(null);
		setModalNickInput('');
	};

	// Save Custom Nickname
	const handleSaveNickname = async () => {
		if (!editingMember || !guildId) return;
		const trimmed = modalNickInput.trim();
		if (!trimmed) {
			if (showToast) showToast('Nickname cannot be empty.', true);
			return;
		}
		if (trimmed.length > 100) {
			if (showToast) showToast('Nickname must be 100 characters or less.', true);
			return;
		}

		setModalSaving(true);
		try {
			const res = await fetch(`/api/guilds/${guildId}/nicknames/${editingMember.id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ nickname: trimmed }),
			});
			const data = await res.json();
			if (data && data.success) {
				setNicknamesMap(prev => ({ ...prev, [editingMember.id]: trimmed }));
				if (showToast) showToast(`Custom nickname for @${editingMember.displayName || editingMember.username} set to "${trimmed}"!`);
				handleCloseEditModal();
			} else {
				if (showToast) showToast(data?.error || 'Failed to update nickname.', true);
			}
		} catch (err) {
			if (showToast) showToast(`Error: ${err.message}`, true);
		} finally {
			setModalSaving(false);
		}
	};

	// Reset / Clear Custom Nickname
	const handleResetNickname = async (member) => {
		if (!member || !guildId) return;
		try {
			const res = await fetch(`/api/guilds/${guildId}/nicknames/${member.id}`, {
				method: 'DELETE',
			});
			const data = await res.json();
			if (data && data.success) {
				setNicknamesMap(prev => {
					const next = { ...prev };
					delete next[member.id];
					return next;
				});
				if (showToast) showToast(`Custom nickname for @${member.displayName || member.username} reset to default.`);
			} else {
				if (showToast) showToast(data?.error || 'Failed to reset nickname.', true);
			}
		} catch (err) {
			if (showToast) showToast(`Error: ${err.message}`, true);
		}
	};

	// Refresh Handler
	const handleRefresh = async () => {
		setLoading(true);
		try {
			await Promise.all([
				fetchNicknames(),
				onRefresh ? onRefresh() : Promise.resolve(),
			]);
			if (showToast) showToast('Server nicknames and member roster refreshed!');
		} catch (e) {
			console.error(e);
		} finally {
			setLoading(false);
		}
	};

	// Filter & Sort Members
	const filteredAndSortedMembers = useMemo(() => {
		const q = memberSearch.trim().toLowerCase();
		const filtered = (membersList || []).filter(m => {
			const customNick = nicknamesMap[m.id] || '';
			const hasCustom = Boolean(customNick && customNick !== 'ใครไม่รู้');

			if (memberFilter === 'custom' && !hasCustom) return false;
			if (memberFilter === 'default' && hasCustom) return false;
			if (memberFilter === 'humans' && m.isBot) return false;
			if (memberFilter === 'bots' && !m.isBot) return false;

			if (!q) return true;

			return (
				(m.displayName || '').toLowerCase().includes(q) ||
				(m.username || '').toLowerCase().includes(q) ||
				customNick.toLowerCase().includes(q) ||
				String(m.id).includes(q)
			);
		});

		return filtered.sort((a, b) => {
			const nickA = nicknamesMap[a.id] || '';
			const nickB = nicknamesMap[b.id] || '';
			const hasNickA = Boolean(nickA && nickA !== 'ใครไม่รู้');
			const hasNickB = Boolean(nickB && nickB !== 'ใครไม่รู้');

			if (sortBy === 'custom_first') {
				if (hasNickA !== hasNickB) return hasNickA ? -1 : 1;
				return (a.displayName || a.username).localeCompare(b.displayName || b.username);
			}
			if (sortBy === 'name_asc') {
				return (a.displayName || a.username).localeCompare(b.displayName || b.username);
			}
			if (sortBy === 'name_desc') {
				return (b.displayName || b.username).localeCompare(a.displayName || a.username);
			}
			if (sortBy === 'id_asc') {
				return a.id.localeCompare(b.id);
			}
			if (sortBy === 'id_desc') {
				return b.id.localeCompare(a.id);
			}
			return 0;
		});
	}, [membersList, nicknamesMap, memberSearch, memberFilter, sortBy]);

	// Counts for category badges
	const totalCustomCount = useMemo(() => {
		return (membersList || []).filter(m => {
			const n = nicknamesMap[m.id];
			return Boolean(n && n !== 'ใครไม่รู้');
		}).length;
	}, [membersList, nicknamesMap]);

	const totalDefaultCount = (membersList || []).length - totalCustomCount;

	// Pagination Slicing
	const totalItems = filteredAndSortedMembers.length;
	const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
	const currentPageClamped = Math.min(currentPage, totalPages);
	const paginatedMembers = useMemo(() => {
		const startIndex = (currentPageClamped - 1) * pageSize;
		return filteredAndSortedMembers.slice(startIndex, startIndex + pageSize);
	}, [filteredAndSortedMembers, currentPageClamped, pageSize]);

	return (
		<div>
			{/* Top Header */}
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
				<div>
					<h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '0.25rem' }}>
						Nickname Manager
					</h3>
					<p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
						Manage custom user nicknames used by Megu Bot for TTS voice greetings, member join announcements, and chat reading.
					</p>
				</div>
				<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
					<span className="status-badge" style={{ background: 'var(--accent-soft)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)', color: 'var(--accent)' }}>
						{totalCustomCount} Custom Nicknames Active
					</span>
					<button
						onClick={handleRefresh}
						className="btn btn-secondary btn-sm"
						disabled={loading}
					>
						{loading ? 'Refreshing...' : 'Refresh'}
					</button>
				</div>
			</div>

			{/* Search, Filter & Sort Controls Bar (Matching MemberManagerTab) */}
			<div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '1.5rem', background: 'var(--surface-2)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1rem' }}>
				<div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
					<div style={{ flex: 1, minWidth: '240px' }}>
						<input
							type="text"
							className="form-control"
							placeholder="Search by username, display name, custom nickname, or user ID..."
							value={memberSearch}
							onChange={e => setMemberSearch(e.target.value)}
						/>
					</div>

					{/* Category Chips */}
					<div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
						<button
							className={`btn btn-sm ${memberFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
							onClick={() => setMemberFilter('all')}
							style={{ fontSize: '0.8rem', padding: '0.45rem 0.75rem' }}
						>
							All ({membersList.length})
						</button>
						<button
							className={`btn btn-sm ${memberFilter === 'custom' ? 'btn-primary' : 'btn-secondary'}`}
							onClick={() => setMemberFilter('custom')}
							style={{ fontSize: '0.8rem', padding: '0.45rem 0.75rem' }}
						>
							Custom Set ({totalCustomCount})
						</button>
						<button
							className={`btn btn-sm ${memberFilter === 'default' ? 'btn-primary' : 'btn-secondary'}`}
							onClick={() => setMemberFilter('default')}
							style={{ fontSize: '0.8rem', padding: '0.45rem 0.75rem' }}
						>
							Default ({totalDefaultCount})
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
									{ value: 'custom_first', label: 'Custom Nicknames First' },
									{ value: 'name_asc', label: 'Name (A → Z)' },
									{ value: 'name_desc', label: 'Name (Z → A)' },
									{ value: 'id_asc', label: 'User ID (Oldest Account)' },
									{ value: 'id_desc', label: 'User ID (Newest Account)' },
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

			{/* User Cards Grid View (Matching MemberManagerTab Layout) */}
			{loading && membersList.length === 0 ? (
				<div style={{ padding: '4rem 0', textAlign: 'center', color: 'var(--text-secondary)' }}>
					Fetching server member nicknames...
				</div>
			) : (
				<>
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
						{paginatedMembers.length === 0 ? (
							<div style={{ gridColumn: '1 / -1', padding: '3rem 2rem', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--surface-2)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
								No server members found matching your search and filter criteria.
							</div>
						) : (
							paginatedMembers.map(member => {
								const customNick = nicknamesMap[member.id] || '';
								const hasCustomNick = Boolean(customNick && customNick !== 'ใครไม่รู้');

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
											position: 'relative',
										}}
									>
										{/* Member Header */}
										<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
											<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', overflow: 'hidden' }}>
												<img
													src={member.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}
													alt={member.username}
													style={{ width: '42px', height: '42px', borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border-color)', flexShrink: 0 }}
													onError={(e) => { e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
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

										{/* Nickname Details Box */}
										<div style={{ background: 'var(--sunk)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
											<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
												<span>Bot TTS Spoken Nickname:</span>
												<span style={{ fontSize: '0.7rem', fontWeight: 700, color: hasCustomNick ? 'var(--accent)' : 'var(--muted)' }}>
													{hasCustomNick ? 'Custom' : 'Default'}
												</span>
											</div>

											<div>
												{hasCustomNick ? (
													<span
														style={{
															display: 'inline-block',
															background: 'var(--accent-soft)',
															color: 'var(--accent)',
															border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
															padding: '0.25rem 0.6rem',
															borderRadius: '6px',
															fontSize: '0.85rem',
															fontWeight: 700,
															maxWidth: '100%',
															overflow: 'hidden',
															textOverflow: 'ellipsis',
															whiteSpace: 'nowrap',
														}}
													>
														&ldquo;{customNick}&rdquo;
													</span>
												) : (
													<span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
														{member.displayName || member.username}
													</span>
												)}
											</div>
										</div>

										{/* Card Action Buttons */}
										<div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto', paddingTop: '0.25rem' }}>
											<button
												onClick={() => handleOpenEditModal(member)}
												className="btn btn-secondary btn-sm"
												style={{
													flex: 1,
													display: 'flex',
													alignItems: 'center',
													justifyContent: 'center',
													gap: '0.4rem',
													padding: '0.45rem 0.75rem',
													fontSize: '0.8rem',
													fontWeight: 600,
												}}
											>
												Edit Nickname
											</button>

											{hasCustomNick && (
												<button
													onClick={() => handleResetNickname(member)}
													className="btn btn-secondary btn-sm"
													style={{
														color: 'var(--due)',
														padding: '0.45rem 0.75rem',
														fontSize: '0.8rem',
														fontWeight: 600,
													}}
													title="Reset to default Discord name"
												>
													Reset
												</button>
											)}
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
								padding: '0.75rem 1rem',
								background: 'var(--surface-2)',
								border: '1px solid var(--border-color)',
								borderRadius: '12px',
								fontSize: '0.8rem',
								color: 'var(--muted)',
								flexWrap: 'wrap',
								gap: '0.5rem',
							}}
						>
							<div>
								Showing {(currentPageClamped - 1) * pageSize + 1} - {Math.min(currentPageClamped * pageSize, totalItems)} of {totalItems} members
							</div>
							<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
								<button
									onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
									disabled={currentPageClamped <= 1}
									className="btn btn-secondary btn-sm"
									style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
								>
									Previous
								</button>
								<span style={{ fontWeight: 600, color: 'var(--ink)' }}>
									Page {currentPageClamped} of {totalPages}
								</span>
								<button
									onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
									disabled={currentPageClamped >= totalPages}
									className="btn btn-secondary btn-sm"
									style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
								>
									Next
								</button>
							</div>
						</div>
					)}
				</>
			)}

			{/* Edit Custom Nickname Modal */}
			{editingMember && (
				<div
					style={{
						position: 'fixed',
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						background: 'rgba(0, 0, 0, 0.65)',
						backdropFilter: 'blur(4px)',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						zIndex: 1000,
						padding: '1rem',
					}}
					onClick={handleCloseEditModal}
				>
					<div
						style={{
							background: 'var(--surface)',
							border: '1px solid var(--border-color)',
							borderRadius: '16px',
							width: '100%',
							maxWidth: '460px',
							padding: '1.5rem',
							boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
							display: 'flex',
							flexDirection: 'column',
							gap: '1.25rem',
						}}
						onClick={e => e.stopPropagation()}
					>
						{/* Modal Header */}
						<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
							<h4 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
								Edit Custom TTS Nickname
							</h4>
							<button
								onClick={handleCloseEditModal}
								style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1.1rem' }}
							>
								✕
							</button>
						</div>

						{/* Member Card Preview */}
						<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--sunk)', padding: '0.85rem 1rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
							<img
								src={editingMember.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}
								alt={editingMember.username}
								style={{ width: '44px', height: '44px', borderRadius: '50%', objectFit: 'cover' }}
								onError={(e) => { e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
							/>
							<div>
								<div style={{ fontWeight: 700, color: 'var(--ink)', fontSize: '0.95rem' }}>
									{editingMember.displayName}
								</div>
								<div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
									@{editingMember.username} • ID: {editingMember.id}
								</div>
							</div>
						</div>

						{/* Nickname Input Form */}
						<div>
							<div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
								<label className="form-label" style={{ fontWeight: 700, margin: 0 }}>
									Custom Spoken Nickname
								</label>
								<span style={{ fontSize: '0.75rem', color: modalNickInput.length > 100 ? 'var(--due)' : 'var(--muted)' }}>
									{modalNickInput.length} / 100
								</span>
							</div>
							<input
								type="text"
								className="form-control"
								placeholder="e.g. พี่เมกุ, น้องน้ำ, John"
								value={modalNickInput}
								onChange={e => setModalNickInput(e.target.value)}
								maxLength={100}
								autoFocus
							/>
							<span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginTop: '0.35rem' }}>
								This nickname will be spoken by Megu Bot during voice greetings and TTS reading instead of the user&apos;s username.
							</span>
						</div>

						{/* Modal Actions */}
						<div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
							<button
								type="button"
								className="btn btn-secondary"
								onClick={handleCloseEditModal}
								disabled={modalSaving}
							>
								Cancel
							</button>
							<button
								type="button"
								className="btn btn-primary"
								onClick={handleSaveNickname}
								disabled={modalSaving || !modalNickInput.trim() || modalNickInput.length > 100}
							>
								{modalSaving ? 'Saving...' : 'Save Nickname'}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
