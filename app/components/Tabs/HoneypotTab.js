'use client';

import CustomSelect from '../CustomSelect';
import { useCopy } from '../../copy';
import { TabActionBar, TabNotice, TabSection, TabSettingRow, TabStatus, TabWorkspace } from './TabWorkspace';

export default function HoneypotTab({ config, channels = [], onChange }) {
	const { t } = useCopy();
	const copy = t.serverTabs.honeypot;
	const selectedChannelId = config.honeypot_channel_id || '';
	const selectedChannel = channels.find(channel => String(channel.id) === String(selectedChannelId));
	const channelOptions = [{ value: '', label: copy.disabled }, ...channels.map(channel => ({ value: channel.id, label: `# ${channel.name}`, subtitle: channel.parentName }))];

	return (
		<TabWorkspace>
			<TabActionBar actions={<TabStatus tone={selectedChannelId ? 'warning' : 'neutral'}>{selectedChannelId ? copy.active(selectedChannel?.name || selectedChannelId) : copy.inactive}</TabStatus>}>
				<span>{copy.scope}</span>
			</TabActionBar>
			<TabSection title={copy.title} description={copy.description}>
				<TabSettingRow label={copy.label} description={copy.description}>
					<CustomSelect
						type="channel"
						ariaLabel={copy.label}
						placeholder={copy.placeholder}
						value={selectedChannelId}
						onChange={value => onChange('honeypot_channel_id', value || null)}
						options={channelOptions}
						unavailableLabel={t.serverTabs.shared.unavailableChannel(selectedChannelId)}
					/>
				</TabSettingRow>
				<TabNotice title={copy.warningTitle} tone="warning"><p>{copy.warning}</p></TabNotice>
			</TabSection>
		</TabWorkspace>
	);
}
