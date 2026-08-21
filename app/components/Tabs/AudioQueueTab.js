'use client';

import { useState, useEffect, useMemo } from 'react';
import CustomSelect from '../CustomSelect.js';

const SOUND_PRESETS = [
	{ value: 'ball_megu', label: 'เรียกไอบอล (Megu)', subtitle: 'sounds/ball_megu.mp3' },
	{ value: 'lingangu', label: 'Lin Gan Gu', subtitle: 'sounds/lingangu.mp3' },
	{ value: 'megatron', label: 'Megatron', subtitle: 'sounds/megatron.mp3' },
	{ value: 'megu_racist', label: 'Megu Racist', subtitle: 'sounds/megu_racist.mp3' },
	{ value: 'momoi', label: 'Momoi Racist', subtitle: 'sounds/momoi.mp3' },
	{ value: 'phone', label: 'Your Phone Is Ringing', subtitle: 'sounds/phone.mp3' },
	{ value: 'smort', label: '9999 IQ', subtitle: 'sounds/smort.mp3' },
	{ value: 'viktor', label: 'Viktor', subtitle: 'sounds/viktor.mp3' },
	{ value: 'wolf', label: 'Wolf', subtitle: 'sounds/wolf.mp3' },
	{ value: 'spinning_cat', label: 'OIIA OIIA (Spinning Cat)', subtitle: 'sounds/spinning_cat.mp3' },
];

const TTS_VOICE_OPTIONS = [
	{ value: 'th-TH-NiwatNeural', label: 'Niwat (Male, Thai)', subtitle: 'Edge Neural Engine' },
	{ value: 'th-TH-PremwadeeNeural', label: 'Premwadee (Female, Thai)', subtitle: 'Edge Neural Engine' },
	{ value: 'en-US-GuyNeural', label: 'Guy (Male, English)', subtitle: 'Edge Neural Engine' },
	{ value: 'en-US-JennyNeural', label: 'Jenny (Female, English)', subtitle: 'Edge Neural Engine' },
	{ value: 'ja-JP-NanamiNeural', label: 'Nanami (Female, Japanese)', subtitle: 'Edge Neural Engine' },
];

const TTS_ENGINE_OPTIONS = [
	{ value: 'EDGE_TTS', label: 'Microsoft Edge Neural TTS', subtitle: 'Ultra High Quality (Recommended)' },
	{ value: 'GOOGLE_TTS', label: 'Google Standard TTS', subtitle: 'Fast Fallback Engine' },
];

const AUDIO_STATUS_OPTIONS = [
	{ value: 'ALL', label: 'All Audio Statuses' },
	{ value: 'PLAYING', label: 'Currently Playing' },
	{ value: 'COMPLETED', label: 'Completed Playback' },
	{ value: 'ENQUEUED', label: 'Queued (Incoming)' },
	{ value: 'SKIPPED', label: 'Force Skipped' },
	{ value: 'REMOVED', label: 'Force Removed' },
	{ value: 'ERROR', label: 'Playback Error' },
	{ value: 'CLEARED', label: 'Queue Cleared' },
];

function getAudioStatusBadgeStyle(status) {
	switch (status) {
	case 'PLAYING':
		return { background: 'color-mix(in srgb, var(--gold) var(--cat-tint), transparent)', color: 'var(--gold)', border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)' };
	case 'COMPLETED':
		return { background: 'color-mix(in srgb, var(--settled) var(--cat-tint), transparent)', color: 'var(--settled)', border: '1px solid color-mix(in srgb, var(--settled) 30%, transparent)' };
	case 'ENQUEUED':
		return { background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' };
	case 'SKIPPED':
		return { background: 'color-mix(in srgb, var(--cat-orange) var(--cat-tint), transparent)', color: 'var(--cat-orange)', border: '1px solid color-mix(in srgb, var(--cat-orange) 30%, transparent)' };
	case 'REMOVED':
	case 'ERROR':
		return { background: 'color-mix(in srgb, var(--due) var(--cat-tint), transparent)', color: 'var(--due)', border: '1px solid color-mix(in srgb, var(--due) 30%, transparent)' };
	case 'CLEARED':
	default:
		return { background: 'color-mix(in srgb, var(--cat-neutral) var(--cat-tint), transparent)', color: 'var(--muted)', border: '1px solid color-mix(in srgb, var(--cat-neutral) 30%, transparent)' };
	}
}

function formatTimestamp(isoStr) {
	if (!isoStr) return '-';
	try {
		const d = new Date(isoStr);
		return isNaN(d.getTime()) ? isoStr : d.toLocaleString();
	}
	catch {
		return isoStr;
	}
}

export default function AudioQueueTab({ guildId, showToast }) {
	const [queueData, setQueueData] = useState(null);
	const [audioLogs, setAudioLogs] = useState([]);
	const [audioStatusFilter, setAudioStatusFilter] = useState('ALL');
	const [audioSearch, setAudioSearch] = useState('');
	const [audioPage, setAudioPage] = useState(1);
	const audioPageSize = 10;

	// Modal States
	const [showTtsModal, setShowTtsModal] = useState(false);
	const [showSoundModal, setShowSoundModal] = useState(false);
	const [injectText, setInjectText] = useState('');
	const [injectEngine, setInjectEngine] = useState('EDGE_TTS');
	const [injectVoice, setInjectVoice] = useState('th-TH-NiwatNeural');
	const [selectedSound, setSelectedSound] = useState('ball_megu');
	const [senderName, setSenderName] = useState('');
	const [actionLoading, setActionLoading] = useState(false);

	const fetchQueue = async () => {
		try {
			const res = await fetch(`/api/guilds/${guildId}/audio-queue`);
			if (res.ok) {
				const data = await res.json();
				if (data.success) {
					setQueueData(data.queue);
				}
			}
		}
		catch {}
	};

	const fetchAudioLogs = async () => {
		try {
			const res = await fetch(`/api/guilds/${guildId}/audio-logs?limit=100&status=${audioStatusFilter}&search=${encodeURIComponent(audioSearch)}`);
			if (res.ok) {
				const data = await res.json();
				if (data.success && Array.isArray(data.logs)) {
					setAudioLogs(data.logs);
				}
			}
		}
		catch {}
	};

	useEffect(() => {
		fetchQueue();
		fetchAudioLogs();
		const interval = setInterval(() => {
			fetchQueue();
			fetchAudioLogs();
		}, 3000);
		return () => clearInterval(interval);
	}, [guildId, audioStatusFilter, audioSearch]);

	// Paginated Audio Logs
	const totalAudioPages = Math.max(1, Math.ceil(audioLogs.length / audioPageSize));
	const currentAudioPage = Math.min(audioPage, totalAudioPages);
	const paginatedAudioLogs = useMemo(() => {
		const start = (currentAudioPage - 1) * audioPageSize;
		return audioLogs.slice(start, start + audioPageSize);
	}, [audioLogs, currentAudioPage, audioPageSize]);

	const handleSkip = async () => {
		try {
			const res = await fetch(`/api/guilds/${guildId}/audio-queue/skip`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
			});
			const data = await res.json();
			if (data.success) {
				showToast(data.message || 'Track skipped successfully.');
				fetchQueue();
				fetchAudioLogs();
			}
			else {
				showToast(data.error || 'Failed to skip track.', true);
			}
		}
		catch {
			showToast('Network error while skipping track.', true);
		}
	};

	const handleRemoveItem = async (itemId) => {
		try {
			const res = await fetch(`/api/guilds/${guildId}/audio-queue/remove`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ itemId }),
			});
			const data = await res.json();
			if (data.success) {
				showToast(data.message || 'Item removed from queue.');
				fetchQueue();
				fetchAudioLogs();
			}
			else {
				showToast(data.error || 'Failed to remove queue item.', true);
			}
		}
		catch {
			showToast('Network error while removing queue item.', true);
		}
	};

	const handleClearQueue = async () => {
		if (!confirm('Are you sure you want to clear the entire audio queue for this server?')) return;
		try {
			const res = await fetch(`/api/guilds/${guildId}/audio-queue/clear`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
			});
			const data = await res.json();
			if (data.success) {
				showToast(data.message || 'Server audio queue cleared.');
				fetchQueue();
				fetchAudioLogs();
			}
			else {
				showToast(data.error || 'Failed to clear queue.', true);
			}
		}
		catch {
			showToast('Network error while clearing queue.', true);
		}
	};

	const handleInjectTts = async (e) => {
		e.preventDefault();
		if (!injectText.trim()) {
			showToast('Please provide text message to speak.', true);
			return;
		}

		setActionLoading(true);
		try {
			const res = await fetch(`/api/guilds/${guildId}/audio-queue/inject`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					text: injectText.trim(),
					userName: senderName || 'Dashboard Admin',
					engine: injectEngine,
					voice: injectEngine === 'EDGE_TTS' ? injectVoice : undefined,
				}),
			});
			const data = await res.json();
			if (data.success) {
				showToast('TTS clip queued successfully.');
				setShowTtsModal(false);
				setInjectText('');
				fetchQueue();
				fetchAudioLogs();
			}
			else {
				showToast(data.error || 'Failed to inject TTS.', true);
			}
		}
		catch {
			showToast('Network error injecting TTS.', true);
		}
		finally {
			setActionLoading(false);
		}
	};

	const handleInjectSound = async (e) => {
		e.preventDefault();
		if (!selectedSound) {
			showToast('Please select a sound to play.', true);
			return;
		}

		setActionLoading(true);
		try {
			const res = await fetch(`/api/guilds/${guildId}/audio-queue/inject`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sound: selectedSound,
					userName: senderName || 'Dashboard Admin',
				}),
			});
			const data = await res.json();
			if (data.success) {
				showToast(`Sound "${selectedSound}" queued successfully.`);
				setShowSoundModal(false);
				fetchQueue();
				fetchAudioLogs();
			}
			else {
				showToast(data.error || 'Failed to play sound.', true);
			}
		}
		catch {
			showToast('Network error playing sound.', true);
		}
		finally {
			setActionLoading(false);
		}
	};

	const isPlaying = queueData?.playerState === 'playing' || queueData?.isBusy;
	const current = queueData?.currentItem;
	const items = queueData?.items || [];

	return (
		<div>
			{/* Tab Header */}
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
				<div>
					<div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
						<h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--ink)', margin: 0 }}>
							Audio Queue Studio
						</h3>
						<span
							style={{
								padding: '0.15rem 0.6rem',
								borderRadius: '6px',
								fontSize: '0.75rem',
								fontWeight: 800,
								background: isPlaying ? 'color-mix(in srgb, var(--gold) 15%, transparent)' : 'color-mix(in srgb, var(--muted) 15%, transparent)',
								color: isPlaying ? 'var(--gold)' : 'var(--muted)',
								border: `1px solid ${isPlaying ? 'var(--gold)' : 'var(--border-color)'}`,
							}}
						>
							{isPlaying ? 'PLAYING' : 'IDLE'}
						</span>
					</div>
					<p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
						Manage live voice playback, play MP3 sound presets, inject custom TTS, and inspect audio history.
					</p>
				</div>

				<div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
					<button
						onClick={() => setShowSoundModal(true)}
						className="btn btn-secondary btn-sm"
						style={{ color: 'var(--accent)', borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)' }}
					>
						Play Sound MP3
					</button>
					<button
						onClick={() => setShowTtsModal(true)}
						className="btn btn-secondary btn-sm"
						style={{ color: 'var(--gold)', borderColor: 'color-mix(in srgb, var(--gold) 40%, transparent)' }}
					>
						Inject TTS
					</button>
					<button
						onClick={handleClearQueue}
						className="btn btn-secondary btn-sm"
						style={{ color: 'var(--due)', borderColor: 'color-mix(in srgb, var(--due) 40%, transparent)' }}
					>
						Clear Queue
					</button>
					<button
						onClick={() => {
							fetchQueue();
							fetchAudioLogs();
						}}
						className="btn btn-primary btn-sm"
					>
						Refresh
					</button>
				</div>
			</div>

			{/* Active Queue Display */}
			<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '1.25rem', marginBottom: '2rem' }}>
				{/* Now Playing Banner */}
				{current ? (
					<div
						style={{
							background: 'color-mix(in srgb, var(--gold) 8%, transparent)',
							border: '1px solid color-mix(in srgb, var(--gold) 35%, transparent)',
							borderRadius: '12px',
							padding: '1rem 1.25rem',
							marginBottom: '1.25rem',
						}}
					>
						<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
							<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
								<span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
									Now Playing
								</span>
								<span style={{ background: 'var(--surface)', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 700 }}>
									{current.engine === 'AUDIO_MP3' ? 'SOUND MP3' : current.engine}
								</span>
							</div>

							<button
								onClick={handleSkip}
								className="btn btn-secondary btn-sm"
								style={{ color: 'var(--gold)', borderColor: 'var(--gold)', padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
							>
								Force Skip
							</button>
						</div>

						<div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '0.4rem', wordBreak: 'break-word' }}>
							&ldquo;{current.text}&rdquo;
						</div>

						<div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
							Requested by <strong style={{ color: 'var(--accent)' }}>{current.userName}</strong>
							{current.engine !== 'AUDIO_MP3' && (
								<span> • Voice: {current.voice}</span>
							)}
						</div>
					</div>
				) : (
					<div style={{ background: 'var(--sunk)', border: '1px dashed var(--border-color)', borderRadius: '10px', padding: '1.75rem', textAlign: 'center', color: 'var(--muted)', marginBottom: '1.25rem' }}>
						<div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: '0.25rem' }}>Voice Player is Idle</div>
						<div style={{ fontSize: '0.85rem' }}>No audio is currently playing in this server voice channel.</div>
					</div>
				)}

				{/* Up Next List */}
				<div>
					<div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.6rem' }}>
						Up Next ({items.length} queued)
					</div>

					{items.length === 0 ? (
						<div style={{ fontSize: '0.85rem', color: 'var(--muted)', fontStyle: 'italic', padding: '0.5rem 0' }}>
							No upcoming clips waiting in queue.
						</div>
					) : (
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
							{items.map((item, idx) => (
								<div
									key={item.id || idx}
									style={{
										background: 'var(--sunk)',
										border: '1px solid var(--border-color)',
										borderRadius: '8px',
										padding: '0.65rem 1rem',
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'space-between',
										gap: '0.75rem',
									}}
								>
									<div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', minWidth: 0 }}>
										<span style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--accent)', flexShrink: 0 }}>
											#{idx + 1}
										</span>
										<div style={{ minWidth: 0 }}>
											<div style={{ fontSize: '0.9rem', color: 'var(--ink)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
												{item.text}
											</div>
											<div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
												by {item.userName} ({item.engine === 'AUDIO_MP3' ? 'SOUND MP3' : item.engine})
											</div>
										</div>
									</div>

									<button
										onClick={() => handleRemoveItem(item.id)}
										className="btn btn-ghost btn-sm"
										style={{ color: 'var(--due)', padding: '0.2rem 0.5rem', flexShrink: 0, fontSize: '0.75rem' }}
									>
										Remove
									</button>
								</div>
							))}
						</div>
					)}
				</div>
			</div>

			{/* Server Audio Playback History & Logs */}
			<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '1.25rem' }}>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
					<div>
						<h4 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--ink)', margin: 0 }}>
							Server Audio Playback History
						</h4>
						<p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
							Complete audit trail of all sound clips and TTS messages played in this server.
						</p>
					</div>

					<button onClick={fetchAudioLogs} className="btn btn-secondary btn-sm">
						Refresh History
					</button>
				</div>

				{/* Filters Bar */}
				<div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
					<div style={{ flex: 1, minWidth: '220px' }}>
						<input
							type="text"
							placeholder="Search history by speaker or spoken text..."
							value={audioSearch}
							onChange={e => {
								setAudioSearch(e.target.value);
								setAudioPage(1);
							}}
							style={{ width: '100%', background: 'var(--sunk)', border: '1px solid var(--border-color)', color: 'var(--ink)', padding: '0.5rem 0.85rem', borderRadius: '8px', fontSize: '0.85rem', outline: 'none' }}
						/>
					</div>

					<div style={{ width: '220px' }}>
						<CustomSelect
							value={audioStatusFilter}
							onChange={(val) => {
								setAudioStatusFilter(val);
								setAudioPage(1);
							}}
							options={AUDIO_STATUS_OPTIONS}
							searchable={false}
						/>
					</div>
				</div>

				{/* Audio Logs Table */}
				{audioLogs.length === 0 ? (
					<div style={{ background: 'var(--surface-2)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
						No playback events found matching current criteria.
					</div>
				) : (
					<div style={{ background: 'var(--surface-2)', border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' }}>
						<div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
							<table style={{ width: '100%', minWidth: '780px', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
								<thead>
									<tr style={{ background: 'var(--sunk)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
										<th style={{ padding: '0.85rem 1rem', fontWeight: 600, width: '180px', whiteSpace: 'nowrap' }}>Timestamp</th>
										<th style={{ padding: '0.85rem 1rem', fontWeight: 600, width: '150px', whiteSpace: 'nowrap' }}>Speaker</th>
										<th style={{ padding: '0.85rem 1rem', fontWeight: 600, width: '130px', whiteSpace: 'nowrap' }}>Status</th>
										<th style={{ padding: '0.85rem 1rem', fontWeight: 600, width: '160px', whiteSpace: 'nowrap' }}>Engine / Type</th>
										<th style={{ padding: '0.85rem 1rem', fontWeight: 600, minWidth: '220px' }}>Sound / Spoken Content</th>
									</tr>
								</thead>
								<tbody>
									{paginatedAudioLogs.map((log, idx) => {
										const statusBadge = getAudioStatusBadgeStyle(log.status);
										const timeStr = formatTimestamp(log.created_at);
										return (
											<tr key={log.id || idx} style={{ borderBottom: '1px solid var(--sunk)' }}>
												<td style={{ padding: '0.85rem 1rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
													{timeStr}
												</td>
												<td style={{ padding: '0.85rem 1rem', fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
													{log.user_name || 'System'}
												</td>
												<td style={{ padding: '0.85rem 1rem', whiteSpace: 'nowrap' }}>
													<span style={{ ...statusBadge, padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600 }}>
														{log.status}
													</span>
												</td>
												<td style={{ padding: '0.85rem 1rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
													{log.engine === 'AUDIO_MP3' ? 'SOUND MP3' : log.engine === 'EDGE_TTS' ? `${log.voice?.split('-')?.[2]?.replace('Neural', '') || 'Neural'}` : 'Google Standard'}
												</td>
												<td style={{ padding: '0.85rem 1rem', color: 'var(--ink)', wordBreak: 'break-word' }}>
													&ldquo;{log.text}&rdquo;
													{log.error_message && (
														<span style={{ color: 'var(--due)', marginLeft: '0.5rem', fontSize: '0.75rem' }}>
															({log.error_message})
														</span>
													)}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>

						{/* 10-Item Pagination Bar */}
						<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'var(--surface)', borderTop: '1px solid var(--border-color)', fontSize: '0.8rem', color: 'var(--muted)', flexWrap: 'wrap', gap: '0.5rem' }}>
							<div>
								Showing {(currentAudioPage - 1) * audioPageSize + 1} - {Math.min(currentAudioPage * audioPageSize, audioLogs.length)} of {audioLogs.length} entries
							</div>
							<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
								<button
									onClick={() => setAudioPage(p => Math.max(1, p - 1))}
									disabled={currentAudioPage <= 1}
									className="btn btn-secondary btn-sm"
									style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
								>
									Previous
								</button>
								<span style={{ fontWeight: 600, color: 'var(--ink)' }}>
									Page {currentAudioPage} of {totalAudioPages}
								</span>
								<button
									onClick={() => setAudioPage(p => Math.min(totalAudioPages, p + 1))}
									disabled={currentAudioPage >= totalAudioPages}
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

			{/* Modal: Inject TTS */}
			{showTtsModal && (
				<div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}>
					<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.75rem', width: '100%', maxWidth: '480px' }}>
						<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
							<h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--ink)', margin: 0 }}>
								Inject TTS into Voice Channel
							</h3>
							<button onClick={() => setShowTtsModal(false)} className="btn btn-ghost btn-sm" style={{ color: 'var(--muted)' }}>✕</button>
						</div>

						<form onSubmit={handleInjectTts} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
							<div>
								<label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--ink)', marginBottom: '0.35rem' }}>
									Spoken Text Message
								</label>
								<textarea
									rows={3}
									placeholder="Type message to speak in voice channel..."
									value={injectText}
									onChange={e => setInjectText(e.target.value)}
									required
									style={{ width: '100%', background: 'var(--sunk)', border: '1px solid var(--border-color)', color: 'var(--ink)', padding: '0.5rem 0.85rem', borderRadius: '8px', fontSize: '0.85rem', outline: 'none', resize: 'vertical' }}
								/>
							</div>

							<div>
								<label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--ink)', marginBottom: '0.35rem' }}>
									TTS Engine
								</label>
								<CustomSelect
									value={injectEngine}
									onChange={val => setInjectEngine(val)}
									options={TTS_ENGINE_OPTIONS}
									searchable={false}
								/>
							</div>

							{injectEngine === 'EDGE_TTS' && (
								<div>
									<label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--ink)', marginBottom: '0.35rem' }}>
										Voice Model
									</label>
									<CustomSelect
										value={injectVoice}
										onChange={val => setInjectVoice(val)}
										options={TTS_VOICE_OPTIONS}
										searchable={false}
									/>
								</div>
							)}

							<div>
								<label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--ink)', marginBottom: '0.35rem' }}>
									Sender Display Name (Optional)
								</label>
								<input
									type="text"
									placeholder="Dashboard Admin"
									value={senderName}
									onChange={e => setSenderName(e.target.value)}
									style={{ width: '100%', background: 'var(--sunk)', border: '1px solid var(--border-color)', color: 'var(--ink)', padding: '0.5rem 0.85rem', borderRadius: '8px', fontSize: '0.85rem', outline: 'none' }}
								/>
							</div>

							<div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
								<button type="button" onClick={() => setShowTtsModal(false)} className="btn btn-secondary btn-sm">Cancel</button>
								<button type="submit" disabled={actionLoading} className="btn btn-primary btn-sm">Enqueue TTS</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{/* Modal: Play Preset Sound */}
			{showSoundModal && (
				<div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}>
					<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.75rem', width: '100%', maxWidth: '480px' }}>
						<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
							<h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--ink)', margin: 0 }}>
								Play MP3 Sound Preset
							</h3>
							<button onClick={() => setShowSoundModal(false)} className="btn btn-ghost btn-sm" style={{ color: 'var(--muted)' }}>✕</button>
						</div>

						<form onSubmit={handleInjectSound} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
							<div>
								<label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--ink)', marginBottom: '0.35rem' }}>
									Select Sound Preset
								</label>
								<CustomSelect
									value={selectedSound}
									onChange={val => setSelectedSound(val)}
									options={SOUND_PRESETS}
									searchable={true}
								/>
							</div>

							<div>
								<label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--ink)', marginBottom: '0.35rem' }}>
									Sender Display Name (Optional)
								</label>
								<input
									type="text"
									placeholder="Dashboard Admin"
									value={senderName}
									onChange={e => setSenderName(e.target.value)}
									style={{ width: '100%', background: 'var(--sunk)', border: '1px solid var(--border-color)', color: 'var(--ink)', padding: '0.5rem 0.85rem', borderRadius: '8px', fontSize: '0.85rem', outline: 'none' }}
								/>
							</div>

							<div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
								<button type="button" onClick={() => setShowSoundModal(false)} className="btn btn-secondary btn-sm">Cancel</button>
								<button type="submit" disabled={actionLoading} className="btn btn-primary btn-sm">Play Sound</button>
							</div>
						</form>
					</div>
				</div>
			)}
		</div>
	);
}
