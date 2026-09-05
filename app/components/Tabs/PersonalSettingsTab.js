'use client';

import { useState, useEffect } from 'react';
import CustomSelect from '../CustomSelect';
import { useCopy } from '../../copy';

export default function PersonalSettingsTab({ guildId, serverName = 'Discord Server', initialChannels = [], showToast }) {
	const { t } = useCopy();
	const copy = t.personalSettings;

	const [loading, setLoading] = useState(true);
	const [nickname, setNickname] = useState(null);
	const [nickInput, setNickInput] = useState('');
	const [nickSaving, setNickSaving] = useState(false);

	const [announceOptOut, setAnnounceOptOut] = useState(false);
	const [announceSaving, setAnnounceSaving] = useState(false);

	const [reminders, setReminders] = useState([]);
	const [channels, setChannels] = useState(initialChannels || []);
	const [deletingId, setDeletingId] = useState(null);

	// New Reminder Modal
	const [modalOpen, setModalOpen] = useState(false);
	const [modalMsg, setModalMsg] = useState('');
	const [modalTime, setModalTime] = useState('');
	const [modalChannel, setModalChannel] = useState('');
	const [modalSaving, setModalSaving] = useState(false);

	const fetchSettings = async () => {
		setLoading(true);
		try {
			const res = await fetch(`/api/guilds/${guildId}/my-settings`);
			const data = await res.json();
			if (data.success) {
				setNickname(data.nickname);
				setNickInput(data.nickname || '');
				setAnnounceOptOut(Boolean(data.announceOptOut));
				setReminders(data.reminders || []);
				if (Array.isArray(data.channels) && data.channels.length > 0) {
					setChannels(data.channels);
				}
			} else if (showToast) {
				showToast(data.error || copy.loadError, true);
			}
		} catch {
			if (showToast) showToast(copy.loadError, true);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		if (guildId) {
			fetchSettings();
		}
	}, [guildId]);

	// Update TTS Nickname
	const handleSaveNickname = async (overrideName = null) => {
		const targetName = overrideName !== null ? overrideName : nickInput.trim();
		setNickSaving(true);
		try {
			const res = await fetch(`/api/guilds/${guildId}/my-settings/nickname`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ nickname: targetName }),
			});
			const data = await res.json();
			if (data.success) {
				setNickname(data.nickname);
				setNickInput(data.nickname || '');
				if (showToast) {
					showToast(data.nickname ? copy.ttsNickSaved : copy.ttsNickResetDone);
				}
			} else if (showToast) {
				showToast(data.error || copy.saveNickError, true);
			}
		} catch {
			if (showToast) showToast(copy.saveNickError, true);
		} finally {
			setNickSaving(false);
		}
	};

	// Toggle Voice Announcement
	const handleToggleAnnounce = async () => {
		const nextVal = !announceOptOut;
		setAnnounceSaving(true);
		try {
			const res = await fetch(`/api/guilds/${guildId}/my-settings/announce`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ optOut: nextVal }),
			});
			const data = await res.json();
			if (data.success) {
				setAnnounceOptOut(data.announceOptOut);
				if (showToast) showToast(copy.announceSaved);
			} else if (showToast) {
				showToast(data.error || copy.saveAnnounceError, true);
			}
		} catch {
			if (showToast) showToast(copy.saveAnnounceError, true);
		} finally {
			setAnnounceSaving(false);
		}
	};

	// Create Reminder
	const handleCreateReminder = async (e) => {
		if (e) e.preventDefault();
		if (!modalMsg.trim()) {
			if (showToast) showToast(copy.reminderMessagePlaceholder, true);
			return;
		}
		if (!modalTime.trim()) {
			if (showToast) showToast(copy.reminderTimePlaceholder, true);
			return;
		}
		if (!modalChannel) {
			if (showToast) showToast(copy.reminderChannelSelect, true);
			return;
		}

		setModalSaving(true);
		try {
			const res = await fetch(`/api/guilds/${guildId}/my-settings/reminders`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: modalMsg.trim(),
					time: modalTime.trim(),
					channelId: modalChannel,
				}),
			});
			const data = await res.json();
			if (data.success) {
				if (showToast) showToast(copy.reminderCreated);
				setModalOpen(false);
				setModalMsg('');
				setModalTime('');
				setModalChannel('');
				fetchSettings();
			} else if (showToast) {
				showToast(data.error || copy.saveReminderError, true);
			}
		} catch {
			if (showToast) showToast(copy.saveReminderError, true);
		} finally {
			setModalSaving(false);
		}
	};

	// Delete Reminder
	const handleDeleteReminder = async (id) => {
		if (!window.confirm(copy.reminderDeleteConfirm)) return;
		setDeletingId(id);
		try {
			const res = await fetch(`/api/guilds/${guildId}/my-settings/reminders/${id}`, {
				method: 'DELETE',
			});
			const data = await res.json();
			if (data.success) {
				setReminders(prev => prev.filter(r => String(r.id) !== String(id)));
				if (showToast) showToast(copy.reminderDeleted);
			} else if (showToast) {
				showToast(data.error || copy.deleteReminderError, true);
			}
		} catch {
			if (showToast) showToast(copy.deleteReminderError, true);
		} finally {
			setDeletingId(null);
		}
	};

	const channelOptions = channels.map(c => ({
		value: c.id,
		label: `# ${c.name}`,
		icon: '#',
		subtitle: c.parentName,
	}));

	const formatReminderTime = (timeMs, recurring) => {
		if (recurring) {
			const d = new Date(timeMs + 7 * 3600 * 1000);
			const hh = String(d.getUTCHours()).padStart(2, '0');
			const mm = String(d.getUTCMinutes()).padStart(2, '0');
			return `${copy.recurringBadge}: ${hh}:${mm} ICT`;
		}
		const d = new Date(timeMs);
		const now = Date.now();
		const diffSec = Math.round((timeMs - now) / 1000);

		let relative = '';
		if (diffSec <= 0) {
			relative = copy.dueNow;
		} else if (diffSec < 60) {
			relative = copy.inSeconds(diffSec);
		} else if (diffSec < 3600) {
			relative = copy.inMinutes(Math.floor(diffSec / 60));
		} else if (diffSec < 86400) {
			relative = copy.inHoursMinutes(Math.floor(diffSec / 3600), Math.floor((diffSec % 3600) / 60));
		} else {
			relative = copy.inDays(Math.floor(diffSec / 86400));
		}

		return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${relative})`;
	};

	const timePresets = ['10m', '30m', '1h', '2h', '1d', '18:00 everyday'];

	if (loading) {
		return (
			<div style={{ padding: '3rem 0', textAlign: 'center', color: 'var(--text-secondary)' }}>
				{t.common.loading}
			</div>
		);
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
			{/* Subheader */}
			<div>
				<h3 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--ink)', marginBottom: '0.35rem' }}>
					{copy.tabTitle}
				</h3>
				<p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
					{copy.headerSubtitle}
				</p>
			</div>

			{/* 1. TTS Spoken Nickname Card */}
			<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem' }}>
				<div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
					<div>
						<h4 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '0.3rem' }}>
							{copy.ttsNickTitle}
						</h4>
						<p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
							{copy.ttsNickDesc}
						</p>
					</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
						<span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
							{copy.ttsNickCurrent}:
						</span>
						<span style={{
							fontSize: '0.85rem',
							fontWeight: 700,
							padding: '0.2rem 0.65rem',
							borderRadius: '999px',
							background: nickname ? 'var(--brand-soft, rgba(99, 102, 241, 0.15))' : 'var(--surface-sunken, rgba(255, 255, 255, 0.05))',
							color: nickname ? 'var(--brand, #818cf8)' : 'var(--text-secondary)',
							border: '1px solid var(--border-color)',
						}}>
							{nickname || copy.ttsNickDefault}
						</span>
					</div>
				</div>

				<div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
					<input
						type="text"
						value={nickInput}
						onChange={e => setNickInput(e.target.value)}
						placeholder={copy.ttsNickPlaceholder}
						maxLength={100}
						className="form-control"
						style={{ flex: '1 1 240px', maxWidth: '380px' }}
					/>
					<button
						type="button"
						onClick={() => handleSaveNickname()}
						disabled={nickSaving || (nickInput.trim() === (nickname || ''))}
						className="btn btn-primary btn-sm"
					>
						{nickSaving ? t.common.saving : copy.ttsNickSave}
					</button>
					{nickname && (
						<button
							type="button"
							onClick={() => handleSaveNickname('')}
							disabled={nickSaving}
							className="btn btn-secondary btn-sm"
						>
							{copy.ttsNickReset}
						</button>
					)}
				</div>
			</div>

			{/* 2. Voice Channel Announcement Toggle Card */}
			<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem' }}>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1.25rem', flexWrap: 'wrap' }}>
					<div style={{ flex: '1 1 300px' }}>
						<h4 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '0.3rem' }}>
							{copy.announceTitle}
						</h4>
						<p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
							{copy.announceDesc}
						</p>
					</div>

					<div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
						<span style={{
							fontSize: '0.85rem',
							fontWeight: 700,
							color: announceOptOut ? 'var(--text-secondary)' : '#10b981',
						}}>
							{announceOptOut ? copy.announceStatusMuted : copy.announceStatusActive}
						</span>
						<button
							type="button"
							onClick={handleToggleAnnounce}
							disabled={announceSaving}
							className={`btn ${announceOptOut ? 'btn-primary' : 'btn-secondary'} btn-sm`}
							style={{ minWidth: '110px' }}
						>
							{announceSaving ? '...' : (announceOptOut ? copy.announceToggleOn : copy.announceToggleOff)}
						</button>
					</div>
				</div>
			</div>

			{/* 3. Server Reminders Card */}
			<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem' }}>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
					<div>
						<h4 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '0.3rem' }}>
							{copy.remindersTitle}
						</h4>
						<p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
							{copy.remindersDesc}
						</p>
					</div>
					<button
						type="button"
						onClick={() => setModalOpen(true)}
						className="btn btn-primary btn-sm"
					>
						{copy.reminderNewBtn}
					</button>
				</div>

				{/* Reminders List */}
				{reminders.length === 0 ? (
					<div style={{ textAlign: 'center', padding: '2.5rem 1rem', background: 'var(--surface-sunken, rgba(0,0,0,0.15))', borderRadius: '12px' }}>
						<p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0 }}>
							{copy.remindersEmpty}
						</p>
					</div>
				) : (
					<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
						{reminders.map(rem => {
							const matchedChannel = channels.find(c => String(c.id) === String(rem.channelId));
							const channelLabel = matchedChannel ? `#${matchedChannel.name}` : `ID: ${rem.channelId}`;
							return (
								<div
									key={rem.id}
									style={{
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'space-between',
										gap: '1rem',
										padding: '1rem',
										background: 'var(--surface-raised, rgba(255,255,255,0.03))',
										border: '1px solid var(--border-color)',
										borderRadius: '12px',
										flexWrap: 'wrap',
									}}
								>
									<div style={{ flex: '1 1 260px' }}>
										<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
											<span style={{
												fontSize: '0.75rem',
												fontWeight: 700,
												padding: '0.15rem 0.5rem',
												borderRadius: '6px',
												background: rem.recurring ? '#8b5cf622' : '#3b82f622',
												color: rem.recurring ? '#a78bfa' : '#60a5fa',
												border: rem.recurring ? '1px solid #8b5cf644' : '1px solid #3b82f644',
											}}>
												{rem.recurring ? copy.recurringBadge : copy.oneOffBadge}
											</span>
											<span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
												{formatReminderTime(rem.reminderTime, rem.recurring)}
											</span>
											<span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
												{copy.inChannel ? copy.inChannel(channelLabel) : `in ${channelLabel}`}
											</span>
										</div>
										<p style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--ink)', margin: 0, wordBreak: 'break-word' }}>
											{rem.message}
										</p>
									</div>

									<button
										type="button"
										onClick={() => handleDeleteReminder(rem.id)}
										disabled={deletingId === rem.id}
										className="btn btn-secondary btn-sm"
										style={{ color: 'var(--due, #ef4444)', borderColor: 'var(--border-color)' }}
									>
										{deletingId === rem.id ? '...' : copy.deleteBtn}
									</button>
								</div>
							);
						})}
					</div>
				)}
			</div>

			{/* New Reminder Modal */}
			{modalOpen && (
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
					onClick={() => setModalOpen(false)}
				>
					<div
						style={{
							background: 'var(--surface)',
							border: '1px solid var(--border-color)',
							borderRadius: '16px',
							width: '100%',
							maxWidth: '480px',
							padding: '1.5rem',
							boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
							display: 'flex',
							flexDirection: 'column',
							gap: '1.25rem',
						}}
						onClick={e => e.stopPropagation()}
					>
						<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
							<h4 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
								{copy.reminderModalTitle}
							</h4>
							<button
								type="button"
								onClick={() => setModalOpen(false)}
								style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.2rem', padding: '0.25rem' }}
							>
								✕
							</button>
						</div>

						<form onSubmit={handleCreateReminder} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
							{/* Message */}
							<div className="form-group">
								<label className="form-label" style={{ marginBottom: '0.35rem' }}>
									{copy.reminderMessageLabel}
								</label>
								<input
									type="text"
									value={modalMsg}
									onChange={e => setModalMsg(e.target.value)}
									placeholder={copy.reminderMessagePlaceholder}
									maxLength={500}
									required
									className="form-control"
								/>
							</div>

							{/* Time Input with Presets */}
							<div className="form-group">
								<label className="form-label" style={{ marginBottom: '0.35rem' }}>
									{copy.reminderTimeLabel}
								</label>
								<input
									type="text"
									value={modalTime}
									onChange={e => setModalTime(e.target.value)}
									placeholder={copy.reminderTimePlaceholder}
									required
									className="form-control"
								/>
								<span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.3rem', display: 'block' }}>
									{copy.reminderTimeHint}
								</span>
								{/* Quick preset buttons */}
								<div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
									{timePresets.map(preset => (
										<button
											key={preset}
											type="button"
											onClick={() => setModalTime(preset)}
											className="btn btn-secondary btn-sm"
											style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: '6px' }}
										>
											{preset}
										</button>
									))}
								</div>
							</div>

							{/* Channel Selector */}
							<div className="form-group">
								<label className="form-label" style={{ marginBottom: '0.35rem' }}>
									{copy.reminderChannelLabel}
								</label>
								<CustomSelect
									type="channel"
									placeholder={copy.reminderChannelSelect}
									value={modalChannel}
									onChange={val => setModalChannel(val || '')}
									options={channelOptions}
								/>
								<span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.3rem', display: 'block' }}>
									{copy.reminderChannelHint}
								</span>
							</div>

							{/* Actions */}
							<div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
								<button
									type="button"
									onClick={() => setModalOpen(false)}
									className="btn btn-secondary btn-sm"
								>
									{copy.reminderCancelBtn}
								</button>
								<button
									type="submit"
									disabled={modalSaving || !modalMsg.trim() || !modalTime.trim() || !modalChannel}
									className="btn btn-primary btn-sm"
								>
									{modalSaving ? t.common.saving : copy.reminderCreateBtn}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}
		</div>
	);
}
