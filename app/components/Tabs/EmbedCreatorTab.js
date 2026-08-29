'use client';

import { useState } from 'react';
import CustomSelect from '../CustomSelect.js';

export default function EmbedCreatorTab({ currentGuildId, guildId, channels = [], showToast }) {
	const activeGuildId = currentGuildId || guildId;

	const [targetChannelId, setTargetChannelId] = useState('');
	
	// Author
	const [authorName, setAuthorName] = useState('');
	const [authorIconUrl, setAuthorIconUrl] = useState('');
	const [authorUrl, setAuthorUrl] = useState('');

	// Title & URL
	const [title, setTitle] = useState('');
	const [titleUrl, setTitleUrl] = useState('');

	// Body & Styling
	const [description, setDescription] = useState('');
	const [color, setColor] = useState('#5865f2');
	const [thumbnailUrl, setThumbnailUrl] = useState('');
	const [imageUrl, setImageUrl] = useState('');

	// Dynamic Fields
	const [fields, setFields] = useState([]);

	// Footer & Timestamp
	const [footerText, setFooterText] = useState('');
	const [footerIconUrl, setFooterIconUrl] = useState('');
	const [includeTimestamp, setIncludeTimestamp] = useState(false);

	const [sending, setSending] = useState(false);

	const presetColors = [
		'#5865f2', '#3ba55d', '#faa81a', '#ed4245', '#eb459e', '#9b59b6', '#00bcd4', '#1abc9c', '#3498db', '#e91e63'
	];

	const handleAddField = () => {
		if (fields.length >= 25) {
			showToast('Discord embeds support up to 25 fields maximum.', true);
			return;
		}
		setFields(prev => [...prev, { name: '', value: '', inline: false }]);
	};

	const handleUpdateField = (index, key, val) => {
		setFields(prev => {
			const copy = [...prev];
			copy[index] = { ...copy[index], [key]: val };
			return copy;
		});
	};

	const handleRemoveField = (index) => {
		setFields(prev => prev.filter((_, i) => i !== index));
	};

	const handleSendEmbed = async () => {
		if (!targetChannelId) {
			showToast('Please select a target text channel.', true);
			return;
		}

		if (!title.trim() && !description.trim() && !imageUrl.trim() && fields.length === 0 && !authorName.trim()) {
			showToast('Please enter at least a title, description, image, or field for the embed.', true);
			return;
		}

		setSending(true);
		try {
			const res = await fetch(`/api/guilds/${activeGuildId}/send-embed`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					channelId: targetChannelId,
					embed: {
						authorName: authorName.trim() || undefined,
						authorIconUrl: authorIconUrl.trim() || undefined,
						authorUrl: authorUrl.trim() || undefined,
						title: title.trim() || undefined,
						titleUrl: titleUrl.trim() || undefined,
						description: description.trim() || undefined,
						color: color || '#5865f2',
						thumbnailUrl: thumbnailUrl.trim() || undefined,
						imageUrl: imageUrl.trim() || undefined,
						fields: fields.filter(f => f.name.trim() && f.value.trim()),
						footerText: footerText.trim() || undefined,
						footerIconUrl: footerIconUrl.trim() || undefined,
						includeTimestamp: !!includeTimestamp,
					},
				}),
			});

			const data = await res.json();
			if (data.success) {
				showToast('Rich embed sent successfully to Discord channel!');
			} else {
				showToast(data.error || 'Failed to send embed.', true);
			}
		} catch (e) {
			showToast('Error dispatching embed to Discord.', true);
		} finally {
			setSending(false);
		}
	};

	const channelOptions = (channels || []).map(c => ({
		value: c.id,
		label: `# ${c.name}`,
		icon: '💬',
		subtitle: c.parentName || undefined,
	}));

	return (
		<div>
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
				<div>
					<h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '0.25rem' }}>
						Announcement & Rich Embed Creator
					</h3>
					<p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
						Design and dispatch rich Discord embeds with live preview, author info, thumbnail, custom fields, footer, and timestamp.
					</p>
				</div>
			</div>

			<div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: '1.75rem', alignItems: 'start' }}>
				{/* Form Section */}
				<div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
					
					{/* Target Channel */}
					<div className="form-group" style={{ marginBottom: 0 }}>
						<label className="form-label" style={{ fontWeight: 700 }}>Target Text Channel *</label>
						<CustomSelect
							value={targetChannelId}
							onChange={(val) => setTargetChannelId(val)}
							options={channelOptions}
							placeholder="Select Text Channel..."
							searchable={true}
						/>
					</div>

					{/* Author Section */}
					<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1rem' }}>
						<span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--ink)', display: 'block', marginBottom: '0.75rem' }}>
							Author Options (Optional)
						</span>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
							<div>
								<label style={{ fontSize: '0.78rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Author Name</label>
								<input
									type="text"
									className="form-control"
									placeholder="e.g. Megu Community Bot"
									value={authorName}
									onChange={e => setAuthorName(e.target.value)}
								/>
							</div>
							<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
								<div>
									<label style={{ fontSize: '0.78rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Author Icon URL</label>
									<input
										type="text"
										className="form-control"
										placeholder="https://.../author_icon.png"
										value={authorIconUrl}
										onChange={e => setAuthorIconUrl(e.target.value)}
									/>
								</div>
								<div>
									<label style={{ fontSize: '0.78rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Author Link URL</label>
									<input
										type="text"
										className="form-control"
										placeholder="https://example.com"
										value={authorUrl}
										onChange={e => setAuthorUrl(e.target.value)}
									/>
								</div>
							</div>
						</div>
					</div>

					{/* Title & URL */}
					<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1rem' }}>
						<span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--ink)', display: 'block', marginBottom: '0.75rem' }}>
							Title & Hyperlink
						</span>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
							<div>
								<label style={{ fontSize: '0.78rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Embed Title</label>
								<input
									type="text"
									className="form-control"
									placeholder="Server Announcement / Event Notice"
									value={title}
									onChange={e => setTitle(e.target.value)}
								/>
							</div>
							<div>
								<label style={{ fontSize: '0.78rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Title URL (Makes title clickable)</label>
								<input
									type="text"
									className="form-control"
									placeholder="https://discord.gg/..."
									value={titleUrl}
									onChange={e => setTitleUrl(e.target.value)}
								/>
							</div>
						</div>
					</div>

					{/* Description */}
					<div className="form-group" style={{ marginBottom: 0 }}>
						<label className="form-label" style={{ fontWeight: 700 }}>Embed Description / Body</label>
						<textarea
							className="form-control"
							rows={4}
							placeholder="Enter embed description content here... (Supports Markdown **bold**, *italic*, [links](https://...))"
							value={description}
							onChange={e => setDescription(e.target.value)}
						/>
					</div>

					{/* Accent Color & Thumbnail */}
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
						<div>
							<label className="form-label" style={{ fontWeight: 700 }}>Accent Color</label>
							<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
								<input
									type="color"
									value={color}
									onChange={e => setColor(e.target.value)}
									style={{ width: '38px', height: '38px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: 'none' }}
								/>
								<input
									type="text"
									className="form-control"
									style={{ flex: 1 }}
									value={color}
									onChange={e => setColor(e.target.value)}
								/>
							</div>
							<div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
								{presetColors.map(hex => (
									<button
										key={hex}
										className="color-swatch"
										style={{ backgroundColor: hex, width: '22px', height: '22px', borderRadius: '4px', border: color.toLowerCase() === hex.toLowerCase() ? '2px solid white' : 'none', cursor: 'pointer' }}
										onClick={() => setColor(hex)}
									/>
								))}
							</div>
						</div>

						<div>
							<label className="form-label" style={{ fontWeight: 700 }}>Thumbnail URL (Top-Right)</label>
							<input
								type="text"
								className="form-control"
								placeholder="https://.../logo.png"
								value={thumbnailUrl}
								onChange={e => setThumbnailUrl(e.target.value)}
							/>
						</div>
					</div>

					{/* Dynamic Embed Fields */}
					<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1rem' }}>
						<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
							<span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--ink)' }}>
								Custom Fields ({fields.length}/25)
							</span>
							<button
								type="button"
								onClick={handleAddField}
								className="btn btn-secondary btn-sm"
								style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
							>
								+ Add Field
							</button>
						</div>

						{fields.length === 0 ? (
							<div style={{ fontSize: '0.8rem', color: 'var(--muted)', fontStyle: 'italic', textAlign: 'center', padding: '0.5rem 0' }}>
								No custom fields added. Click &ldquo;+ Add Field&rdquo; to add titled columns or inline items.
							</div>
						) : (
							<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
								{fields.map((field, idx) => (
									<div
										key={idx}
										style={{
											background: 'var(--sunk)',
											border: '1px solid var(--border-color)',
											borderRadius: '8px',
											padding: '0.75rem',
											position: 'relative',
										}}
									>
										<button
											type="button"
											onClick={() => handleRemoveField(idx)}
											style={{
												position: 'absolute',
												top: '0.5rem',
												right: '0.5rem',
												background: 'none',
												border: 'none',
												color: 'var(--due)',
												cursor: 'pointer',
												fontSize: '0.85rem',
											}}
											title="Remove Field"
										>
											✕
										</button>

										<div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.75rem', marginBottom: '0.5rem' }}>
											<div>
												<label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '0.2rem' }}>
													Field Name #{idx + 1}
												</label>
												<input
													type="text"
													className="form-control"
													placeholder="e.g. Schedule / Rules / Info"
													value={field.name}
													onChange={e => handleUpdateField(idx, 'name', e.target.value)}
													style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
												/>
											</div>
											<div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '1.2rem' }}>
												<input
													type="checkbox"
													id={`field-inline-${idx}`}
													checked={field.inline}
													onChange={e => handleUpdateField(idx, 'inline', e.target.checked)}
													style={{ cursor: 'pointer' }}
												/>
												<label htmlFor={`field-inline-${idx}`} style={{ fontSize: '0.75rem', color: 'var(--ink)', cursor: 'pointer', userSelect: 'none' }}>
													Inline
												</label>
											</div>
										</div>

										<div>
											<label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '0.2rem' }}>
												Field Value
											</label>
											<textarea
												className="form-control"
												rows={2}
												placeholder="Field content / description..."
												value={field.value}
												onChange={e => handleUpdateField(idx, 'value', e.target.value)}
												style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
											/>
										</div>
									</div>
								))}
							</div>
						)}
					</div>

					{/* Main Image URL */}
					<div className="form-group" style={{ marginBottom: 0 }}>
						<label className="form-label" style={{ fontWeight: 700 }}>Main Image / Banner URL (Optional)</label>
						<input
							type="text"
							className="form-control"
							placeholder="https://example.com/event_banner.png"
							value={imageUrl}
							onChange={e => setImageUrl(e.target.value)}
						/>
					</div>

					{/* Footer & Timestamp */}
					<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1rem' }}>
						<span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--ink)', display: 'block', marginBottom: '0.75rem' }}>
							Footer & Timestamp
						</span>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
							<div>
								<label style={{ fontSize: '0.78rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Footer Text</label>
								<input
									type="text"
									className="form-control"
									placeholder="e.g. Megu Community • All rights reserved"
									value={footerText}
									onChange={e => setFooterText(e.target.value)}
								/>
							</div>
							<div>
								<label style={{ fontSize: '0.78rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Footer Icon URL</label>
								<input
									type="text"
									className="form-control"
									placeholder="https://.../small_icon.png"
									value={footerIconUrl}
									onChange={e => setFooterIconUrl(e.target.value)}
								/>
							</div>
							<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
								<input
									type="checkbox"
									id="include-timestamp"
									checked={includeTimestamp}
									onChange={e => setIncludeTimestamp(e.target.checked)}
									style={{ cursor: 'pointer' }}
								/>
								<label htmlFor="include-timestamp" style={{ fontSize: '0.82rem', color: 'var(--ink)', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}>
									Include Current Timestamp in Footer
								</label>
							</div>
						</div>
					</div>

					{/* Submit Button */}
					<button
						className="btn btn-lg"
						style={{ width: '100%', marginTop: '0.5rem', fontWeight: 700 }}
						onClick={handleSendEmbed}
						disabled={sending}
					>
						{sending ? 'Dispatching Embed to Discord...' : 'Send Embed to Discord Channel'}
					</button>
				</div>

				{/* Live Discord Embed Preview Panel */}
				<div style={{ position: 'sticky', top: '1rem' }}>
					<span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.5rem' }}>
						Live Discord Embed Preview
					</span>
					
					<div style={{ background: '#313338', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1rem', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
						<div
							style={{
								borderLeft: `4px solid ${color || '#5865f2'}`,
								background: '#2b2d31',
								borderRadius: '4px',
								padding: '0.85rem 1rem',
								color: '#dbdee1',
								fontSize: '0.875rem',
								position: 'relative',
							}}
						>
							{/* Thumbnail Image */}
							{thumbnailUrl && (
								<img
									src={thumbnailUrl}
									alt=""
									onError={e => { e.target.style.display = 'none'; }}
									style={{
										position: 'absolute',
										top: '0.85rem',
										right: '1rem',
										width: '64px',
										height: '64px',
										borderRadius: '6px',
										objectFit: 'cover',
									}}
								/>
							)}

							<div style={{ paddingRight: thumbnailUrl ? '75px' : '0' }}>
								{/* Author */}
								{authorName && (
									<div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
										{authorIconUrl && (
											<img
												src={authorIconUrl}
												alt=""
												onError={e => { e.target.style.display = 'none'; }}
												style={{ width: '20px', height: '20px', borderRadius: '50%', objectFit: 'cover' }}
											/>
										)}
										{authorUrl ? (
											<a href={authorUrl} target="_blank" rel="noreferrer" style={{ color: '#f2f3f5', fontWeight: 600, fontSize: '0.8rem', textDecoration: 'none' }}>
												{authorName}
											</a>
										) : (
											<span style={{ color: '#f2f3f5', fontWeight: 600, fontSize: '0.8rem' }}>
												{authorName}
											</span>
										)}
									</div>
								)}

								{/* Title */}
								{title && (
									<div style={{ fontWeight: 700, fontSize: '1rem', color: '#f2f3f5', marginBottom: '0.4rem' }}>
										{titleUrl ? (
											<a href={titleUrl} target="_blank" rel="noreferrer" style={{ color: '#00a8fc', textDecoration: 'underline' }}>
												{title}
											</a>
										) : (
											title
										)}
									</div>
								)}

								{/* Description */}
								{description && (
									<div style={{ fontSize: '0.875rem', color: '#dbdee1', whiteSpace: 'pre-wrap', marginBottom: '0.75rem', lineHeight: '1.4' }}>
										{description}
									</div>
								)}

								{/* Dynamic Fields */}
								{fields.filter(f => f.name.trim() || f.value.trim()).length > 0 && (
									<div
										style={{
											display: 'flex',
											flexWrap: 'wrap',
											gap: '0.75rem 1rem',
											marginTop: '0.75rem',
											marginBottom: '0.75rem',
										}}
									>
										{fields.map((f, i) => {
											if (!f.name.trim() && !f.value.trim()) return null;
											return (
												<div
													key={i}
													style={{
														flex: f.inline ? '1 1 calc(33.33% - 1rem)' : '1 1 100%',
														minWidth: f.inline ? '140px' : '100%',
													}}
												>
													<div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#f2f3f5', marginBottom: '0.15rem' }}>
														{f.name || 'Untitled Field'}
													</div>
													<div style={{ fontSize: '0.82rem', color: '#dbdee1', whiteSpace: 'pre-wrap' }}>
														{f.value || '-'}
													</div>
												</div>
											);
										})}
									</div>
								)}
							</div>

							{/* Main Image */}
							{imageUrl && (
								<div style={{ marginTop: '0.75rem' }}>
									<img
										src={imageUrl}
										alt=""
										onError={e => { e.target.style.display = 'none'; }}
										style={{ maxWidth: '100%', borderRadius: '4px', display: 'block' }}
									/>
								</div>
							)}

							{/* Footer & Timestamp */}
							{(footerText || includeTimestamp) && (
								<div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.75rem', fontSize: '0.75rem', color: '#949ba4' }}>
									{footerIconUrl && (
										<img
											src={footerIconUrl}
											alt=""
											onError={e => { e.target.style.display = 'none'; }}
											style={{ width: '18px', height: '18px', borderRadius: '50%', objectFit: 'cover' }}
										/>
									)}
									<span>{footerText}</span>
									{footerText && includeTimestamp && <span>•</span>}
									{includeTimestamp && (
										<span>Today at {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
									)}
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
