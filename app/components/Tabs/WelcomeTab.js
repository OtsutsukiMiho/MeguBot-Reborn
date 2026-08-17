'use client';

import CustomSelect from '../CustomSelect';

export default function WelcomeTab({ config, channels = [], onChange, serverName }) {
	const welcomeText = config.welcome_message_template || 'Welcome {member} to {server}!';
	const renderedWelcomePreview = welcomeText
		.replace(/\{member\}/g, '<span style="color:#5865f2; font-weight:600;">@NewMember</span>')
		.replace(/\{server\}/g, `<strong>${serverName || 'Our Server'}</strong>`)
		.replace(/\{username\}/g, 'NewUser');

	const leaveText = config.leave_message_template || '{username} has left {server}.';
	const renderedLeavePreview = leaveText
		.replace(/\{member\}/g, '<span style="color:var(--due); font-weight:600;">@DepartedUser</span>')
		.replace(/\{username\}/g, 'DepartedUser')
		.replace(/\{server\}/g, `<strong>${serverName || 'Our Server'}</strong>`);

	const channelOptions = [
		{ value: '', label: 'Disabled / None', icon: '✕' },
		...channels.map(c => ({
			value: c.id,
			label: `# ${c.name}`,
			icon: c.type === 2 ? '🔊' : '#',
			subtitle: c.parentName,
		})),
	];

	return (
		<div>
			<h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '0.25rem' }}>
				Welcome & Leave
			</h3>
			<p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
				Automatically greet new members and log departing users.
			</p>

			<div className="form-group">
				<label className="form-label">Welcome Channel</label>
				<CustomSelect
					type="channel"
					placeholder="Select a welcome channel..."
					value={config.welcome_channel_id || ''}
					onChange={val => onChange('welcome_channel_id', val || null)}
					options={channelOptions}
				/>
			</div>

			<div className="form-group">
				<label className="form-label">Welcome Message Template</label>
				<textarea
					className="form-control"
					value={config.welcome_message_template || ''}
					onChange={e => onChange('welcome_message_template', e.target.value)}
					placeholder="Welcome {member} to {server}!"
				/>
				<div className="placeholder-tags">
					<span className="tag-badge" onClick={() => onChange('welcome_message_template', (config.welcome_message_template || '') + ' {member}')}>
						{'{member}'}
					</span>
					<span className="tag-badge" onClick={() => onChange('welcome_message_template', (config.welcome_message_template || '') + ' {displayname}')}>
						{'{displayname}'}
					</span>
					<span className="tag-badge" onClick={() => onChange('welcome_message_template', (config.welcome_message_template || '') + ' {username}')}>
						{'{username}'}
					</span>
					<span className="tag-badge" onClick={() => onChange('welcome_message_template', (config.welcome_message_template || '') + ' {nickname}')}>
						{'{nickname}'}
					</span>
					<span className="tag-badge" onClick={() => onChange('welcome_message_template', (config.welcome_message_template || '') + ' {server}')}>
						{'{server}'}
					</span>
				</div>
			</div>

			{/* Live Welcome Message Preview */}
			<div style={{ marginTop: '1.5rem', background: 'var(--surface-2)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1.25rem' }}>
				<span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
					Live Discord Welcome Message Preview
				</span>
				<div
					style={{ marginTop: '0.75rem', background: '#2b2d31', padding: '0.85rem 1.1rem', borderRadius: '8px', borderLeft: '4px solid #5865f2', color: '#dbdee1', fontSize: '0.9rem' }}
					dangerouslySetInnerHTML={{ __html: renderedWelcomePreview }}
				/>
			</div>

			<hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '2rem 0' }} />

			<div className="form-group">
				<label className="form-label">Leave Notification Channel</label>
				<CustomSelect
					type="channel"
					placeholder="Select a leave channel..."
					value={config.leave_channel_id || ''}
					onChange={val => onChange('leave_channel_id', val || null)}
					options={channelOptions}
				/>
			</div>

			<div className="form-group">
				<label className="form-label">Leave Message Template</label>
				<textarea
					className="form-control"
					value={config.leave_message_template || ''}
					onChange={e => onChange('leave_message_template', e.target.value)}
					placeholder="{username} has left {server}."
				/>
				<div className="placeholder-tags">
					<span className="tag-badge" onClick={() => onChange('leave_message_template', (config.leave_message_template || '') + ' {displayname}')}>
						{'{displayname}'}
					</span>
					<span className="tag-badge" onClick={() => onChange('leave_message_template', (config.leave_message_template || '') + ' {username}')}>
						{'{username}'}
					</span>
					<span className="tag-badge" onClick={() => onChange('leave_message_template', (config.leave_message_template || '') + ' {nickname}')}>
						{'{nickname}'}
					</span>
					<span className="tag-badge" onClick={() => onChange('leave_message_template', (config.leave_message_template || '') + ' {member}')}>
						{'{member}'}
					</span>
					<span className="tag-badge" onClick={() => onChange('leave_message_template', (config.leave_message_template || '') + ' {server}')}>
						{'{server}'}
					</span>
				</div>
			</div>

			{/* Live Leave Message Preview */}
			<div style={{ marginTop: '1.5rem', background: 'var(--surface-2)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1.25rem' }}>
				<span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
					Live Discord Leave Message Preview
				</span>
				<div
					style={{ marginTop: '0.75rem', background: '#2b2d31', padding: '0.85rem 1.1rem', borderRadius: '8px', borderLeft: '4px solid var(--due)', color: '#dbdee1', fontSize: '0.9rem' }}
					dangerouslySetInnerHTML={{ __html: renderedLeavePreview }}
				/>
			</div>
		</div>
	);
}
