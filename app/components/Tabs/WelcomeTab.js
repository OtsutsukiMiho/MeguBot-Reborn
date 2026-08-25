'use client';

import CustomSelect from '../CustomSelect';

const DEFAULT_WELCOME_EMBED = {
	title: 'Welcome to {server}!',
	description: 'Welcome {member} to our community! Please make sure to check the rules and enjoy your stay.',
	color: '#5865f2',
	thumbnailUrl: '{avatar}',
	footerText: 'Member #{membercount} • {server}',
	includeTimestamp: true,
};

const DEFAULT_LEAVE_EMBED = {
	title: 'Member Departed',
	description: '**{username}** has left the server. Goodbye!',
	color: '#ed4245',
	thumbnailUrl: '{avatar}',
	footerText: '{server}',
	includeTimestamp: true,
};

const PRESET_COLORS = [
	'#5865f2', '#3ba55d', '#faa81a', '#ed4245', '#eb459e', '#9b59b6', '#00bcd4', '#1abc9c', '#3498db'
];

export default function WelcomeTab({ config = {}, channels = [], onChange, serverName }) {
	const welcomeMode = config.welcome_mode || 'text';
	const welcomeEmbed = config.welcome_embed || DEFAULT_WELCOME_EMBED;

	const leaveMode = config.leave_mode || 'text';
	const leaveEmbed = config.leave_embed || DEFAULT_LEAVE_EMBED;

	const handleWelcomeEmbedChange = (key, val) => {
		const updated = { ...welcomeEmbed, [key]: val };
		onChange('welcome_embed', updated);
	};

	const handleLeaveEmbedChange = (key, val) => {
		const updated = { ...leaveEmbed, [key]: val };
		onChange('leave_embed', updated);
	};

	const channelOptions = [
		{ value: '', label: 'Disabled / None', icon: '✕' },
		...channels.map(c => ({
			value: c.id,
			label: `# ${c.name}`,
			icon: c.type === 2 ? '🔊' : '#',
			subtitle: c.parentName,
		})),
	];

	// Preview helpers
	const renderPreviewText = (text, isLeave = false) => {
		if (!text) return '';
		return text
			.replace(/\{member\}/g, `<span style="color:${isLeave ? '#ed4245' : '#5865f2'}; font-weight:600;">@${isLeave ? 'DepartedUser' : 'NewMember'}</span>`)
			.replace(/\{username\}/g, isLeave ? 'DepartedUser' : 'NewUser')
			.replace(/\{displayname\}/g, isLeave ? 'Departed User' : 'New Member')
			.replace(/\{displayName\}/g, isLeave ? 'Departed User' : 'New Member')
			.replace(/\{nickname\}/g, isLeave ? 'Departed User' : 'New Member')
			.replace(/\{server\}/g, `<strong>${serverName || 'Our Server'}</strong>`)
			.replace(/\{membercount\}/g, '42');
	};

	const appendTag = (fieldName, tag, isEmbed = false, embedSection = 'welcome') => {
		if (isEmbed) {
			if (embedSection === 'welcome') {
				const current = welcomeEmbed[fieldName] || '';
				handleWelcomeEmbedChange(fieldName, current + (current.endsWith(' ') || !current ? '' : ' ') + tag);
			} else {
				const current = leaveEmbed[fieldName] || '';
				handleLeaveEmbedChange(fieldName, current + (current.endsWith(' ') || !current ? '' : ' ') + tag);
			}
		} else {
			const current = config[fieldName] || '';
			onChange(fieldName, current + (current.endsWith(' ') || !current ? '' : ' ') + tag);
		}
	};

	return (
		<div>
			<div style={{ marginBottom: '1.5rem' }}>
				<h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '0.25rem' }}>
					Welcome & Leave System
				</h3>
				<p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
					Automatically greet new members and log departing users using standard text or rich Discord embeds.
				</p>
			</div>

			{/* ========================================================================= */}
			{/* --- SECTION 1: WELCOME SYSTEM --- */}
			{/* ========================================================================= */}
			<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1.5rem', marginBottom: '2rem' }}>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
					<h4 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
						Welcome Message Settings
					</h4>

					{/* Mode Switch */}
					<div style={{ display: 'flex', background: 'var(--sunk)', padding: '0.25rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
						<button
							type="button"
							onClick={() => onChange('welcome_mode', 'text')}
							style={{
								padding: '0.35rem 0.85rem',
								borderRadius: '6px',
								border: 'none',
								fontSize: '0.8rem',
								fontWeight: 700,
								cursor: 'pointer',
								background: welcomeMode === 'text' ? 'var(--accent)' : 'transparent',
								color: welcomeMode === 'text' ? 'white' : 'var(--muted)',
								transition: 'all 0.2s ease',
							}}
						>
							Text Message
						</button>
						<button
							type="button"
							onClick={() => onChange('welcome_mode', 'embed')}
							style={{
								padding: '0.35rem 0.85rem',
								borderRadius: '6px',
								border: 'none',
								fontSize: '0.8rem',
								fontWeight: 700,
								cursor: 'pointer',
								background: welcomeMode === 'embed' ? 'var(--accent)' : 'transparent',
								color: welcomeMode === 'embed' ? 'white' : 'var(--muted)',
								transition: 'all 0.2s ease',
							}}
						>
							Rich Embed
						</button>
					</div>
				</div>

				<div className="form-group">
					<label className="form-label" style={{ fontWeight: 700 }}>Welcome Channel</label>
					<CustomSelect
						type="channel"
						placeholder="Select a welcome channel..."
						value={config.welcome_channel_id || ''}
						onChange={val => onChange('welcome_channel_id', val || null)}
						options={channelOptions}
					/>
				</div>

				{/* Welcome: Text Mode */}
				{welcomeMode === 'text' && (
					<div>
						<div className="form-group">
							<label className="form-label" style={{ fontWeight: 700 }}>Welcome Message Template</label>
							<textarea
								className="form-control"
								rows={3}
								value={config.welcome_message_template || ''}
								onChange={e => onChange('welcome_message_template', e.target.value)}
								placeholder="Welcome {member} to {server}!"
							/>
							<div className="placeholder-tags" style={{ marginTop: '0.5rem' }}>
								{['{member}', '{username}', '{displayname}', '{nickname}', '{server}', '{membercount}'].map(tag => (
									<span key={tag} className="tag-badge" onClick={() => appendTag('welcome_message_template', tag)}>
										{tag}
									</span>
								))}
							</div>
						</div>

						{/* Live Text Preview */}
						<div style={{ marginTop: '1.25rem', background: 'var(--surface-2)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1rem' }}>
							<span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
								Live Discord Text Message Preview
							</span>
							<div
								style={{ marginTop: '0.5rem', background: '#2b2d31', padding: '0.85rem 1.1rem', borderRadius: '8px', borderLeft: '4px solid #5865f2', color: '#dbdee1', fontSize: '0.9rem' }}
								dangerouslySetInnerHTML={{ __html: renderPreviewText(config.welcome_message_template || 'Welcome {member} to {server}!') }}
							/>
						</div>
					</div>
				)}

				{/* Welcome: Embed Mode */}
				{welcomeMode === 'embed' && (
					<div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '1.5rem', alignItems: 'start', marginTop: '1rem' }}>
						{/* Embed Form Controls */}
						<div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
							<div>
								<label className="form-label" style={{ fontWeight: 700 }}>Embed Title</label>
								<input
									type="text"
									className="form-control"
									placeholder="Welcome to {server}!"
									value={welcomeEmbed.title || ''}
									onChange={e => handleWelcomeEmbedChange('title', e.target.value)}
								/>
							</div>

							<div>
								<label className="form-label" style={{ fontWeight: 700 }}>Embed Description / Body</label>
								<textarea
									className="form-control"
									rows={3}
									placeholder="Welcome {member} to our server! 🎉"
									value={welcomeEmbed.description || ''}
									onChange={e => handleWelcomeEmbedChange('description', e.target.value)}
								/>
								<div className="placeholder-tags" style={{ marginTop: '0.4rem' }}>
									{['{member}', '{username}', '{displayname}', '{nickname}', '{server}', '{membercount}'].map(tag => (
										<span key={tag} className="tag-badge" onClick={() => appendTag('description', tag, true, 'welcome')}>
											{tag}
										</span>
									))}
								</div>
							</div>

							<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
								<div>
									<label className="form-label" style={{ fontWeight: 700 }}>Accent Color</label>
									<div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
										<input
											type="color"
											value={welcomeEmbed.color || '#5865f2'}
											onChange={e => handleWelcomeEmbedChange('color', e.target.value)}
											style={{ width: '34px', height: '34px', borderRadius: '6px', border: 'none', cursor: 'pointer', background: 'none' }}
										/>
										<input
											type="text"
											className="form-control"
											style={{ flex: 1, fontSize: '0.8rem' }}
											value={welcomeEmbed.color || '#5865f2'}
											onChange={e => handleWelcomeEmbedChange('color', e.target.value)}
										/>
									</div>
									<div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
										{PRESET_COLORS.map(hex => (
											<button
												key={hex}
												type="button"
												className="color-swatch"
												style={{ backgroundColor: hex, width: '20px', height: '20px', borderRadius: '4px', border: (welcomeEmbed.color || '').toLowerCase() === hex.toLowerCase() ? '2px solid white' : 'none', cursor: 'pointer' }}
												onClick={() => handleWelcomeEmbedChange('color', hex)}
											/>
										))}
									</div>
								</div>

								<div>
									<label className="form-label" style={{ fontWeight: 700 }}>Thumbnail URL</label>
									<input
										type="text"
										className="form-control"
										placeholder="{avatar} or https://..."
										value={welcomeEmbed.thumbnailUrl || ''}
										onChange={e => handleWelcomeEmbedChange('thumbnailUrl', e.target.value)}
										style={{ fontSize: '0.8rem' }}
									/>
									<span style={{ fontSize: '0.72rem', color: 'var(--muted)', display: 'block', marginTop: '0.2rem' }}>
										Tip: Use <code style={{ color: 'var(--accent)' }}>{'{avatar}'}</code> for new member&apos;s avatar.
									</span>
								</div>
							</div>

							<div>
								<label className="form-label" style={{ fontWeight: 700 }}>Banner Image URL (Optional)</label>
								<input
									type="text"
									className="form-control"
									placeholder="https://example.com/welcome_banner.png"
									value={welcomeEmbed.imageUrl || ''}
									onChange={e => handleWelcomeEmbedChange('imageUrl', e.target.value)}
								/>
							</div>

							<div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.75rem', alignItems: 'end' }}>
								<div>
									<label className="form-label" style={{ fontWeight: 700 }}>Footer Text</label>
									<input
										type="text"
										className="form-control"
										placeholder="Member #{membercount} • {server}"
										value={welcomeEmbed.footerText || ''}
										onChange={e => handleWelcomeEmbedChange('footerText', e.target.value)}
									/>
								</div>
								<div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingBottom: '0.5rem' }}>
									<input
										type="checkbox"
										id="welcome-embed-timestamp"
										checked={welcomeEmbed.includeTimestamp !== false}
										onChange={e => handleWelcomeEmbedChange('includeTimestamp', e.target.checked)}
										style={{ cursor: 'pointer' }}
									/>
									<label htmlFor="welcome-embed-timestamp" style={{ fontSize: '0.78rem', color: 'var(--ink)', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
										Timestamp
									</label>
								</div>
							</div>
						</div>

						{/* Live Embed Preview */}
						<div>
							<span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.5rem' }}>
								Live Discord Welcome Embed Preview
							</span>
							<div style={{ background: '#313338', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.85rem' }}>
								<div
									style={{
										borderLeft: `4px solid ${welcomeEmbed.color || '#5865f2'}`,
										background: '#2b2d31',
										borderRadius: '4px',
										padding: '0.75rem 0.9rem',
										color: '#dbdee1',
										fontSize: '0.85rem',
										position: 'relative',
									}}
								>
									{/* Thumbnail Preview */}
									{welcomeEmbed.thumbnailUrl && (
										<div
											style={{
												position: 'absolute',
												top: '0.75rem',
												right: '0.9rem',
												width: '50px',
												height: '50px',
												borderRadius: '50%',
												background: '#5865f2',
												display: 'flex',
												alignItems: 'center',
												justifyContent: 'center',
												color: 'white',
												fontWeight: 700,
												fontSize: '0.8rem',
												overflow: 'hidden',
											}}
										>
											{welcomeEmbed.thumbnailUrl === '{avatar}' ? '👤' : (
												<img src={welcomeEmbed.thumbnailUrl} alt="" onError={e => { e.target.style.display = 'none'; }} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
											)}
										</div>
									)}

									<div style={{ paddingRight: welcomeEmbed.thumbnailUrl ? '60px' : 0 }}>
										{welcomeEmbed.title && (
											<div
												style={{ fontWeight: 700, fontSize: '0.95rem', color: '#f2f3f5', marginBottom: '0.35rem' }}
												dangerouslySetInnerHTML={{ __html: renderPreviewText(welcomeEmbed.title) }}
											/>
										)}
										{welcomeEmbed.description && (
											<div
												style={{ fontSize: '0.85rem', color: '#dbdee1', whiteSpace: 'pre-wrap', lineHeight: '1.4' }}
												dangerouslySetInnerHTML={{ __html: renderPreviewText(welcomeEmbed.description) }}
											/>
										)}
									</div>

									{welcomeEmbed.imageUrl && (
										<div style={{ marginTop: '0.65rem' }}>
											<img src={welcomeEmbed.imageUrl} alt="" onError={e => { e.target.style.display = 'none'; }} style={{ maxWidth: '100%', borderRadius: '4px' }} />
										</div>
									)}

									{(welcomeEmbed.footerText || welcomeEmbed.includeTimestamp !== false) && (
										<div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.65rem', fontSize: '0.72rem', color: '#949ba4' }}>
											<span dangerouslySetInnerHTML={{ __html: renderPreviewText(welcomeEmbed.footerText || '') }} />
											{welcomeEmbed.footerText && welcomeEmbed.includeTimestamp !== false && <span>•</span>}
											{welcomeEmbed.includeTimestamp !== false && <span>Today at {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
										</div>
									)}
								</div>
							</div>
						</div>
					</div>
				)}
			</div>

			{/* ========================================================================= */}
			{/* --- SECTION 2: LEAVE SYSTEM --- */}
			{/* ========================================================================= */}
			<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1.5rem' }}>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
					<h4 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
						Leave Notification Settings
					</h4>

					{/* Mode Switch */}
					<div style={{ display: 'flex', background: 'var(--sunk)', padding: '0.25rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
						<button
							type="button"
							onClick={() => onChange('leave_mode', 'text')}
							style={{
								padding: '0.35rem 0.85rem',
								borderRadius: '6px',
								border: 'none',
								fontSize: '0.8rem',
								fontWeight: 700,
								cursor: 'pointer',
								background: leaveMode === 'text' ? 'var(--accent)' : 'transparent',
								color: leaveMode === 'text' ? 'white' : 'var(--muted)',
								transition: 'all 0.2s ease',
							}}
						>
							Text Message
						</button>
						<button
							type="button"
							onClick={() => onChange('leave_mode', 'embed')}
							style={{
								padding: '0.35rem 0.85rem',
								borderRadius: '6px',
								border: 'none',
								fontSize: '0.8rem',
								fontWeight: 700,
								cursor: 'pointer',
								background: leaveMode === 'embed' ? 'var(--accent)' : 'transparent',
								color: leaveMode === 'embed' ? 'white' : 'var(--muted)',
								transition: 'all 0.2s ease',
							}}
						>
							Rich Embed
						</button>
					</div>
				</div>

				<div className="form-group">
					<label className="form-label" style={{ fontWeight: 700 }}>Leave Notification Channel</label>
					<CustomSelect
						type="channel"
						placeholder="Select a leave channel..."
						value={config.leave_channel_id || ''}
						onChange={val => onChange('leave_channel_id', val || null)}
						options={channelOptions}
					/>
				</div>

				{/* Leave: Text Mode */}
				{leaveMode === 'text' && (
					<div>
						<div className="form-group">
							<label className="form-label" style={{ fontWeight: 700 }}>Leave Message Template</label>
							<textarea
								className="form-control"
								rows={3}
								value={config.leave_message_template || ''}
								onChange={e => onChange('leave_message_template', e.target.value)}
								placeholder="{username} has left {server}."
							/>
							<div className="placeholder-tags" style={{ marginTop: '0.5rem' }}>
								{['{username}', '{displayname}', '{nickname}', '{member}', '{server}', '{membercount}'].map(tag => (
									<span key={tag} className="tag-badge" onClick={() => appendTag('leave_message_template', tag)}>
										{tag}
									</span>
								))}
							</div>
						</div>

						{/* Live Text Preview */}
						<div style={{ marginTop: '1.25rem', background: 'var(--surface-2)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1rem' }}>
							<span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
								Live Discord Leave Message Preview
							</span>
							<div
								style={{ marginTop: '0.5rem', background: '#2b2d31', padding: '0.85rem 1.1rem', borderRadius: '8px', borderLeft: '4px solid var(--due)', color: '#dbdee1', fontSize: '0.9rem' }}
								dangerouslySetInnerHTML={{ __html: renderPreviewText(config.leave_message_template || '{username} has left {server}.', true) }}
							/>
						</div>
					</div>
				)}

				{/* Leave: Embed Mode */}
				{leaveMode === 'embed' && (
					<div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '1.5rem', alignItems: 'start', marginTop: '1rem' }}>
						{/* Embed Form Controls */}
						<div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
							<div>
								<label className="form-label" style={{ fontWeight: 700 }}>Embed Title</label>
								<input
									type="text"
									className="form-control"
									placeholder="Member Departed"
									value={leaveEmbed.title || ''}
									onChange={e => handleLeaveEmbedChange('title', e.target.value)}
								/>
							</div>

							<div>
								<label className="form-label" style={{ fontWeight: 700 }}>Embed Description / Body</label>
								<textarea
									className="form-control"
									rows={3}
									placeholder="**{username}** has left {server}."
									value={leaveEmbed.description || ''}
									onChange={e => handleLeaveEmbedChange('description', e.target.value)}
								/>
								<div className="placeholder-tags" style={{ marginTop: '0.4rem' }}>
									{['{username}', '{displayname}', '{nickname}', '{server}', '{membercount}'].map(tag => (
										<span key={tag} className="tag-badge" onClick={() => appendTag('description', tag, true, 'leave')}>
											{tag}
										</span>
									))}
								</div>
							</div>

							<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
								<div>
									<label className="form-label" style={{ fontWeight: 700 }}>Accent Color</label>
									<div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
										<input
											type="color"
											value={leaveEmbed.color || '#ed4245'}
											onChange={e => handleLeaveEmbedChange('color', e.target.value)}
											style={{ width: '34px', height: '34px', borderRadius: '6px', border: 'none', cursor: 'pointer', background: 'none' }}
										/>
										<input
											type="text"
											className="form-control"
											style={{ flex: 1, fontSize: '0.8rem' }}
											value={leaveEmbed.color || '#ed4245'}
											onChange={e => handleLeaveEmbedChange('color', e.target.value)}
										/>
									</div>
									<div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
										{PRESET_COLORS.map(hex => (
											<button
												key={hex}
												type="button"
												className="color-swatch"
												style={{ backgroundColor: hex, width: '20px', height: '20px', borderRadius: '4px', border: (leaveEmbed.color || '').toLowerCase() === hex.toLowerCase() ? '2px solid white' : 'none', cursor: 'pointer' }}
												onClick={() => handleLeaveEmbedChange('color', hex)}
											/>
										))}
									</div>
								</div>

								<div>
									<label className="form-label" style={{ fontWeight: 700 }}>Thumbnail URL</label>
									<input
										type="text"
										className="form-control"
										placeholder="{avatar} or https://..."
										value={leaveEmbed.thumbnailUrl || ''}
										onChange={e => handleLeaveEmbedChange('thumbnailUrl', e.target.value)}
										style={{ fontSize: '0.8rem' }}
									/>
									<span style={{ fontSize: '0.72rem', color: 'var(--muted)', display: 'block', marginTop: '0.2rem' }}>
										Tip: Use <code style={{ color: 'var(--accent)' }}>{'{avatar}'}</code> for departing user&apos;s avatar.
									</span>
								</div>
							</div>

							<div>
								<label className="form-label" style={{ fontWeight: 700 }}>Banner Image URL (Optional)</label>
								<input
									type="text"
									className="form-control"
									placeholder="https://example.com/banner.png"
									value={leaveEmbed.imageUrl || ''}
									onChange={e => handleLeaveEmbedChange('imageUrl', e.target.value)}
								/>
							</div>

							<div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.75rem', alignItems: 'end' }}>
								<div>
									<label className="form-label" style={{ fontWeight: 700 }}>Footer Text</label>
									<input
										type="text"
										className="form-control"
										placeholder="{server}"
										value={leaveEmbed.footerText || ''}
										onChange={e => handleLeaveEmbedChange('footerText', e.target.value)}
									/>
								</div>
								<div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingBottom: '0.5rem' }}>
									<input
										type="checkbox"
										id="leave-embed-timestamp"
										checked={leaveEmbed.includeTimestamp !== false}
										onChange={e => handleLeaveEmbedChange('includeTimestamp', e.target.checked)}
										style={{ cursor: 'pointer' }}
									/>
									<label htmlFor="leave-embed-timestamp" style={{ fontSize: '0.78rem', color: 'var(--ink)', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
										Timestamp
									</label>
								</div>
							</div>
						</div>

						{/* Live Embed Preview */}
						<div>
							<span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.5rem' }}>
								Live Discord Leave Embed Preview
							</span>
							<div style={{ background: '#313338', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.85rem' }}>
								<div
									style={{
										borderLeft: `4px solid ${leaveEmbed.color || '#ed4245'}`,
										background: '#2b2d31',
										borderRadius: '4px',
										padding: '0.75rem 0.9rem',
										color: '#dbdee1',
										fontSize: '0.85rem',
										position: 'relative',
									}}
								>
									{/* Thumbnail Preview */}
									{leaveEmbed.thumbnailUrl && (
										<div
											style={{
												position: 'absolute',
												top: '0.75rem',
												right: '0.9rem',
												width: '50px',
												height: '50px',
												borderRadius: '50%',
												background: 'var(--due)',
												display: 'flex',
												alignItems: 'center',
												justifyContent: 'center',
												color: 'white',
												fontWeight: 700,
												fontSize: '0.8rem',
												overflow: 'hidden',
											}}
										>
											{leaveEmbed.thumbnailUrl === '{avatar}' ? '👤' : (
												<img src={leaveEmbed.thumbnailUrl} alt="" onError={e => { e.target.style.display = 'none'; }} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
											)}
										</div>
									)}

									<div style={{ paddingRight: leaveEmbed.thumbnailUrl ? '60px' : 0 }}>
										{leaveEmbed.title && (
											<div
												style={{ fontWeight: 700, fontSize: '0.95rem', color: '#f2f3f5', marginBottom: '0.35rem' }}
												dangerouslySetInnerHTML={{ __html: renderPreviewText(leaveEmbed.title, true) }}
											/>
										)}
										{leaveEmbed.description && (
											<div
												style={{ fontSize: '0.85rem', color: '#dbdee1', whiteSpace: 'pre-wrap', lineHeight: '1.4' }}
												dangerouslySetInnerHTML={{ __html: renderPreviewText(leaveEmbed.description, true) }}
											/>
										)}
									</div>

									{leaveEmbed.imageUrl && (
										<div style={{ marginTop: '0.65rem' }}>
											<img src={leaveEmbed.imageUrl} alt="" onError={e => { e.target.style.display = 'none'; }} style={{ maxWidth: '100%', borderRadius: '4px' }} />
										</div>
									)}

									{(leaveEmbed.footerText || leaveEmbed.includeTimestamp !== false) && (
										<div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.65rem', fontSize: '0.72rem', color: '#949ba4' }}>
											<span dangerouslySetInnerHTML={{ __html: renderPreviewText(leaveEmbed.footerText || '', true) }} />
											{leaveEmbed.footerText && leaveEmbed.includeTimestamp !== false && <span>•</span>}
											{leaveEmbed.includeTimestamp !== false && <span>Today at {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
										</div>
									)}
								</div>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
