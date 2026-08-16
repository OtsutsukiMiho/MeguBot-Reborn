'use client';

import { useState } from 'react';

export default function EmbedCreatorTab({ currentGuildId, activeGuilds, channels, showToast }) {
	const [targetGuildId, setTargetGuildId] = useState(currentGuildId);
	const [targetChannelId, setTargetChannelId] = useState('');
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [color, setColor] = useState('#6366f1');
	const [imageUrl, setImageUrl] = useState('');
	const [footerText, setFooterText] = useState('');
	const [sending, setSending] = useState(false);

	const presetColors = [
		// Literal hex on purpose: these are values sent to Discord as the embed
		// colour, not styling for this page. A CSS variable here reaches the API.
		'#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#06b6d4'
	];

	const handleSendEmbed = async () => {
		if (!targetChannelId) {
			showToast('Please select a target text channel.', true);
			return;
		}

		setSending(true);
		try {
			const res = await fetch(`/api/guilds/${targetGuildId}/send-embed`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					channelId: targetChannelId,
					embed: {
						title,
						description,
						color,
						imageUrl,
						footerText,
					},
				}),
			});

			const data = await res.json();
			if (data.success) {
				showToast('Embed sent successfully to Discord channel!');
			} else {
				showToast(data.error || 'Failed to send embed.', true);
			}
		} catch (e) {
			showToast('Error dispatching embed to Discord.', true);
		} finally {
			setSending(false);
		}
	};

	return (
		<div>
			<h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '0.25rem' }}>
				Announcement & Embed Creator
			</h3>
			<p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
				Design formatted embedded messages with custom hex colors, images, and live previews.
			</p>

			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
				{/* Form Section */}
				<div>
					<div className="form-group">
						<label className="form-label">Target Server</label>
						<select
							className="form-control"
							value={targetGuildId}
							onChange={e => setTargetGuildId(e.target.value)}
						>
							{activeGuilds.map(g => (
								<option key={g.id} value={g.id}>{g.name}</option>
							))}
						</select>
					</div>

					<div className="form-group">
						<label className="form-label">Target Text Channel</label>
						<select
							className="form-control"
							value={targetChannelId}
							onChange={e => setTargetChannelId(e.target.value)}
						>
							<option value="">Select Channel...</option>
							{channels.map(c => (
								<option key={c.id} value={c.id}># {c.name}</option>
							))}
						</select>
					</div>

					<div className="form-group">
						<label className="form-label">Embed Title</label>
						<input
							type="text"
							className="form-control"
							placeholder="Server Announcement"
							value={title}
							onChange={e => setTitle(e.target.value)}
						/>
					</div>

					<div className="form-group">
						<label className="form-label">Embed Description / Body</label>
						<textarea
							className="form-control"
							placeholder="Enter embed text body here..."
							value={description}
							onChange={e => setDescription(e.target.value)}
						/>
					</div>

					<div className="form-group">
						<label className="form-label">Accent Color (Hex / Swatches)</label>
						<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
							<input
								type="color"
								value={color}
								onChange={e => setColor(e.target.value)}
								style={{ width: '42px', height: '42px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: 'none' }}
							/>
							<input
								type="text"
								className="form-control"
								style={{ width: '120px' }}
								value={color}
								onChange={e => setColor(e.target.value)}
							/>
						</div>
						<div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
							{presetColors.map(hex => (
								<button
									key={hex}
									className="color-swatch"
									style={{ backgroundColor: hex }}
									onClick={() => setColor(hex)}
								/>
							))}
						</div>
					</div>

					<div className="form-group">
						<label className="form-label">Image URL (Optional)</label>
						<input
							type="text"
							className="form-control"
							placeholder="https://example.com/banner.png"
							value={imageUrl}
							onChange={e => setImageUrl(e.target.value)}
						/>
					</div>

					<div className="form-group">
						<label className="form-label">Footer Text (Optional)</label>
						<input
							type="text"
							className="form-control"
							placeholder="Megu Corp Announcements"
							value={footerText}
							onChange={e => setFooterText(e.target.value)}
						/>
					</div>

					<button
						className="btn btn-lg"
						style={{ width: '100%' }}
						onClick={handleSendEmbed}
						disabled={sending}
					>
						{sending ? 'Sending...' : 'Send Embed to Channel'}
					</button>
				</div>

				{/* Live Discord Embed Preview Panel */}
				<div>
					<span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.5rem' }}>
						Live Discord Embed Preview
					</span>
					<div style={{ background: '#313338', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1rem' }}>
						<div style={{ borderLeft: `4px solid ${color}`, background: '#2b2d31', borderRadius: '4px', padding: '0.75rem 1rem' }}>
							<div style={{ fontWeight: 700, fontSize: '1rem', color: 'white', marginBottom: '0.35rem' }}>
								{title || 'Server Announcement'}
							</div>
							<div style={{ fontSize: '0.875rem', color: '#dbdee1', whiteSpace: 'pre-wrap' }}>
								{description || 'Enter embed text body here...'}
							</div>
							{imageUrl && (
								<img src={imageUrl} alt="" style={{ maxWidth: '100%', borderRadius: '4px', marginTop: '0.5rem' }} />
							)}
							{footerText && (
								<div style={{ fontSize: '0.75rem', color: '#949ba4', marginTop: '0.5rem' }}>
									{footerText}
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
