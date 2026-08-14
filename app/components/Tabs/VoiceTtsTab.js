'use client';

import CustomSelect from '../CustomSelect';

export default function VoiceTtsTab({ config, channels = [], onChange }) {
	const voices = [
		{ id: 'th-TH-NiwatNeural', name: 'Thai Male (Niwat Neural)', lang: 'th', flag: '🇹🇭' },
		{ id: 'th-TH-PremwadeeNeural', name: 'Thai Female (Premwadee Neural)', lang: 'th', flag: '🇹🇭' },
		{ id: 'en-US-JennyNeural', name: 'English Female (Jenny Neural)', lang: 'en', flag: '🇺🇸' },
		{ id: 'en-US-ChristopherNeural', name: 'English Male (Christopher Neural)', lang: 'en', flag: '🇺🇸' },
		{ id: 'ja-JP-NanamiNeural', name: 'Japanese Female (Nanami Neural)', lang: 'ja', flag: '🇯🇵' },
		{ id: 'ko-KR-SunHiNeural', name: 'Korean Female (SunHi Neural)', lang: 'ko', flag: '🇰🇷' },
	];

	const handleVoiceChange = (vId) => {
		const selected = voices.find(v => v.id === vId);
		onChange('tts_voice', vId);
		if (selected) {
			onChange('tts_lang', selected.lang);
		}
	};

	const isGoogleTts = config.tts_engine === 'GOOGLE_TTS';

	const channelOptions = [
		{ value: '', label: 'Disabled / None', icon: '✕' },
		...channels.map(c => ({
			value: c.id,
			label: `# ${c.name}`,
			icon: c.type === 2 ? '🔊' : '#',
			subtitle: c.parentName,
		})),
	];

	const voiceOptions = voices.map(v => ({
		value: v.id,
		label: `${v.flag} ${v.name}`,
		subtitle: `Language: ${v.lang.toUpperCase()}`,
	}));

	return (
		<div>
			<h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ffffff', marginBottom: '0.25rem' }}>
				Voice Text-to-Speech Suite
			</h3>
			<p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.75rem' }}>
				Configure dedicated Voice TTS channels, speech engines, member rate limiting, AFK auto bring-back, and VC greetings.
			</p>

			{/* Channel Selector */}
			<div className="form-group" style={{ marginBottom: '1.5rem' }}>
				<label className="form-label">TTS Dedicated Text Channel</label>
				<CustomSelect
					type="channel"
					placeholder="Select a text channel for TTS..."
					value={config.tts_channel_id || ''}
					onChange={val => onChange('tts_channel_id', val || null)}
					options={channelOptions}
				/>
			</div>

			{/* Engine Selection */}
			<div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1.25rem', marginBottom: '1.5rem' }}>
				<div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.75rem', color: '#ffffff' }}>
					TTS Speech Engine
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
					<label
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '0.75rem',
							padding: '0.85rem 1rem',
							borderRadius: '8px',
							border: !isGoogleTts ? '1px solid var(--color-accent)' : '1px solid var(--border-color)',
							background: !isGoogleTts ? 'rgba(79, 70, 229, 0.1)' : 'transparent',
							cursor: 'pointer',
						}}
					>
						<input
							type="radio"
							name="tts_engine"
							checked={!isGoogleTts}
							onChange={() => onChange('tts_engine', 'EDGE_TTS')}
						/>
						<div>
							<div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#ffffff' }}>Microsoft Edge Neural TTS</div>
							<div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Ultra-natural voices (Thai, English, Japanese, etc.)</div>
						</div>
					</label>

					<label
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '0.75rem',
							padding: '0.85rem 1rem',
							borderRadius: '8px',
							border: isGoogleTts ? '1px solid var(--color-accent)' : '1px solid var(--border-color)',
							background: isGoogleTts ? 'rgba(79, 70, 229, 0.1)' : 'transparent',
							cursor: 'pointer',
						}}
					>
						<input
							type="radio"
							name="tts_engine"
							checked={isGoogleTts}
							onChange={() => onChange('tts_engine', 'GOOGLE_TTS')}
						/>
						<div>
							<div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#ffffff' }}>Google Translate TTS</div>
							<div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Standard TTS Engine</div>
						</div>
					</label>
				</div>
			</div>

			{/* Voice & Language Selection */}
			{!isGoogleTts && (
				<div className="form-group" style={{ marginBottom: '1.5rem' }}>
					<label className="form-label">Default Language & Voice Model</label>
					<CustomSelect
						placeholder="Choose a voice model..."
						value={config.tts_voice || 'th-TH-NiwatNeural'}
						onChange={val => handleVoiceChange(val)}
						options={voiceOptions}
					/>
				</div>
			)}

			{/* Anti-Spam Rate Limiter Controls */}
			<div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1.25rem', marginBottom: '1.5rem' }}>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
					<div>
						<div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#ffffff' }}>
							Anti-Spam TTS Rate Limiter
						</div>
						<div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
							Prevent sound queue abuse by throttling repeated message requests per member.
						</div>
					</div>
					<input
						type="checkbox"
						checked={config.tts_antispam_enabled !== false}
						onChange={e => onChange('tts_antispam_enabled', e.target.checked)}
						style={{ width: '18px', height: '18px' }}
					/>
				</div>

				{config.tts_antispam_enabled !== false && (
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
						<div>
							<label className="form-label" style={{ fontSize: '0.8rem' }}>
								Max Burst Messages (Trigger Limit)
							</label>
							<input
								type="number"
								className="form-control"
								min={1}
								max={20}
								value={config.tts_antispam_max_messages || 3}
								onChange={e => onChange('tts_antispam_max_messages', parseInt(e.target.value, 10))}
							/>
							<span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
								Max messages allowed within cooldown before user is temporarily muted from TTS.
							</span>
						</div>

						<div>
							<label className="form-label" style={{ fontSize: '0.8rem' }}>
								Cooldown Period (Seconds)
							</label>
							<input
								type="number"
								className="form-control"
								min={5}
								max={300}
								value={config.tts_antispam_cooldown_seconds || 30}
								onChange={e => onChange('tts_antispam_cooldown_seconds', parseInt(e.target.value, 10))}
							/>
							<span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
								Time window before a user's rate-limit queue resets.
							</span>
						</div>
					</div>
				)}
			</div>

			{/* Smart VC Automation (AFK Bringback & Join/Leave Announcements) */}
			<div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1.25rem', marginBottom: '1.5rem' }}>
				<div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '1rem', color: '#ffffff' }}>
					Voice Channel Smart Automation
				</div>

				<div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
					{/* AFK Bringback Toggle */}
					<label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
						<input
							type="checkbox"
							checked={config.tts_afk_bringback_enabled !== false}
							onChange={e => onChange('tts_afk_bringback_enabled', e.target.checked)}
							style={{ width: '18px', height: '18px', marginTop: '2px' }}
						/>
						<div>
							<div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#ffffff' }}>
								AFK Channel Auto-Reconnect (Bring-Back)
							</div>
							<div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
								When a user who was speaking moves back from the server AFK channel, MeguBot automatically follows them back into their voice channel.
							</div>
						</div>
					</label>

					{/* VC Welcome Announcement */}
					<div style={{ paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
						<label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', marginBottom: '0.75rem' }}>
							<input
								type="checkbox"
								checked={config.tts_vc_welcome_enabled !== false}
								onChange={e => onChange('tts_vc_welcome_enabled', e.target.checked)}
								style={{ width: '18px', height: '18px' }}
							/>
							<span style={{ fontWeight: 600, fontSize: '0.875rem', color: '#ffffff' }}>
								Announce User Voice Join in TTS
							</span>
						</label>

						{config.tts_vc_welcome_enabled !== false && (
							<div style={{ marginLeft: '1.75rem' }}>
								<input
									type="text"
									className="form-control"
									value={config.tts_vc_welcome_template !== undefined ? config.tts_vc_welcome_template : '{username} เข้าดิสมา'}
									onChange={e => onChange('tts_vc_welcome_template', e.target.value)}
									placeholder="{username} เข้าดิสมา"
								/>
								<div className="placeholder-tags" style={{ marginTop: '0.4rem' }}>
									<span className="tag-badge" onClick={() => onChange('tts_vc_welcome_template', (config.tts_vc_welcome_template !== undefined ? config.tts_vc_welcome_template : '{username} เข้าดิสมา') + ' {displayname}')}>
										{'{displayname}'}
									</span>
									<span className="tag-badge" onClick={() => onChange('tts_vc_welcome_template', (config.tts_vc_welcome_template !== undefined ? config.tts_vc_welcome_template : '{username} เข้าดิสมา') + ' {username}')}>
										{'{username}'}
									</span>
									<span className="tag-badge" onClick={() => onChange('tts_vc_welcome_template', (config.tts_vc_welcome_template !== undefined ? config.tts_vc_welcome_template : '{username} เข้าดิสมา') + ' {nickname}')}>
										{'{nickname}'}
									</span>
									<span className="tag-badge" onClick={() => onChange('tts_vc_welcome_template', (config.tts_vc_welcome_template !== undefined ? config.tts_vc_welcome_template : '{username} เข้าดิสมา') + ' {tag}')}>
										{'{tag}'}
									</span>
									<span className="tag-badge" onClick={() => onChange('tts_vc_welcome_template', (config.tts_vc_welcome_template !== undefined ? config.tts_vc_welcome_template : '{username} เข้าดิสมา') + ' {server}')}>
										{'{server}'}
									</span>
								</div>
								<span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
									Spoken when a member joins the voice channel.
								</span>
							</div>
						)}
					</div>

					{/* VC Leave Announcement */}
					<div style={{ paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
						<label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', marginBottom: '0.75rem' }}>
							<input
								type="checkbox"
								checked={config.tts_vc_leave_enabled !== false}
								onChange={e => onChange('tts_vc_leave_enabled', e.target.checked)}
								style={{ width: '18px', height: '18px' }}
							/>
							<span style={{ fontWeight: 600, fontSize: '0.875rem', color: '#ffffff' }}>
								Announce User Voice Leave in TTS
							</span>
						</label>

						{config.tts_vc_leave_enabled !== false && (
							<div style={{ marginLeft: '1.75rem' }}>
								<input
									type="text"
									className="form-control"
									value={config.tts_vc_leave_template !== undefined ? config.tts_vc_leave_template : '{username} ออกจากดิสแล้ว'}
									onChange={e => onChange('tts_vc_leave_template', e.target.value)}
									placeholder="{username} ออกจากดิสแล้ว"
								/>
								<div className="placeholder-tags" style={{ marginTop: '0.4rem' }}>
									<span className="tag-badge" onClick={() => onChange('tts_vc_leave_template', (config.tts_vc_leave_template !== undefined ? config.tts_vc_leave_template : '{username} ออกจากดิสแล้ว') + ' {displayname}')}>
										{'{displayname}'}
									</span>
									<span className="tag-badge" onClick={() => onChange('tts_vc_leave_template', (config.tts_vc_leave_template !== undefined ? config.tts_vc_leave_template : '{username} ออกจากดิสแล้ว') + ' {username}')}>
										{'{username}'}
									</span>
									<span className="tag-badge" onClick={() => onChange('tts_vc_leave_template', (config.tts_vc_leave_template !== undefined ? config.tts_vc_leave_template : '{username} ออกจากดิสแล้ว') + ' {nickname}')}>
										{'{nickname}'}
									</span>
									<span className="tag-badge" onClick={() => onChange('tts_vc_leave_template', (config.tts_vc_leave_template !== undefined ? config.tts_vc_leave_template : '{username} ออกจากดิสแล้ว') + ' {tag}')}>
										{'{tag}'}
									</span>
									<span className="tag-badge" onClick={() => onChange('tts_vc_leave_template', (config.tts_vc_leave_template !== undefined ? config.tts_vc_leave_template : '{username} ออกจากดิสแล้ว') + ' {server}')}>
										{'{server}'}
									</span>
								</div>
								<span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
									Spoken when a member disconnects from the voice channel.
								</span>
							</div>
						)}
					</div>
				</div>
			</div>

			{/* Max Message Length */}
			<div className="form-group">
				<label className="form-label">Max Spoken Characters per Message</label>
				<input
					type="number"
					className="form-control"
					min={10}
					max={500}
					value={config.tts_max_length || 200}
					onChange={e => onChange('tts_max_length', parseInt(e.target.value, 10))}
				/>
			</div>

			{/* Ignore Bot Prefixes */}
			<div className="form-group" style={{ marginBottom: 0 }}>
				<label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer' }}>
					<input
						type="checkbox"
						checked={config.tts_ignore_prefix !== false}
						onChange={e => onChange('tts_ignore_prefix', e.target.checked)}
						style={{ width: '18px', height: '18px' }}
					/>
					<span style={{ fontSize: '0.875rem', color: '#ffffff' }}>
						Ignore messages starting with command prefixes (e.g. !, ?, -, /, .)
					</span>
				</label>
			</div>
		</div>
	);
}
