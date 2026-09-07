'use client';

import CustomSelect from '../CustomSelect';
import { TabNotice, TabSection, TabStatus, TabWorkspace } from './TabWorkspace';

export default function HoneypotTab({ config, channels = [], onChange }) {
	const selectedChannelId = config.honeypot_channel_id || '';
	const selectedChannel = channels.find(channel => String(channel.id) === String(selectedChannelId));
	const channelOptions = [
		{ value: '', label: 'Disabled' },
		...channels.map(channel => ({
			value: channel.id,
			label: `# ${channel.name}`,
			subtitle: channel.parentName,
		})),
	];

	return (
		<TabWorkspace>
			<TabSection
				title="Trap channel"
				description="Choose one decoy channel. Any account that sends a message there will trigger the existing honeypot enforcement."
				meta={(
					<TabStatus tone={selectedChannelId ? 'warning' : 'neutral'}>
						{selectedChannelId ? `Active in #${selectedChannel?.name || 'selected channel'}` : 'Disabled'}
					</TabStatus>
				)}
			>
				<div className="form-group">
					<label className="form-label">Honeypot decoy channel</label>
					<CustomSelect
						type="channel"
						placeholder="Select a decoy channel"
						value={selectedChannelId}
						onChange={value => onChange('honeypot_channel_id', value || null)}
						options={channelOptions}
					/>
				</div>
			</TabSection>

			<TabNotice title="High-impact automation" tone="warning">
				<p>
					Keep this channel hidden from legitimate members. The current bot behavior permanently bans anyone who posts there and purges up to seven days of their messages.
				</p>
			</TabNotice>
		</TabWorkspace>
	);
}
