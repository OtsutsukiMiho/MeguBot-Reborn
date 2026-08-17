'use client';

import CustomSelect from '../CustomSelect';

export default function HoneypotTab({ config, channels = [], onChange }) {
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
				Security Honeypot Trap Channel
			</h3>
			<p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
				Designate a decoy channel. Any unauthorized user or raid bot sending a message inside will be automatically banned immediately.
			</p>

			<div className="form-group">
				<label className="form-label">Honeypot Decoy Channel</label>
				<CustomSelect
					type="channel"
					placeholder="Select a honeypot decoy channel..."
					value={config.honeypot_channel_id || ''}
					onChange={val => onChange('honeypot_channel_id', val || null)}
					options={channelOptions}
				/>
			</div>

			<div style={{ background: 'var(--due-soft)', border: '1px solid color-mix(in srgb, var(--due) 25%, transparent)', borderRadius: '12px', padding: '1.25rem', marginTop: '1.5rem' }}>
				<div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--due)', marginBottom: '0.5rem' }}>
					Honeypot Safety Warning
				</div>
				<p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
					Do not grant permission to legitimate members to view or send messages in the honeypot channel. Anyone sending a message in this channel will be permanently banned and their past 7 days of messages will be purged.
				</p>
			</div>
		</div>
	);
}
