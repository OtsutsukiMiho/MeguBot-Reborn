'use client';

import CustomSelect from '../CustomSelect.js';
import { TabChoice, TabFieldGrid, TabSection, TabStatus, TabWorkspace } from './TabWorkspace';

export default function AutomodTab({ automod, onChange }) {
	const badwordsText = Array.isArray(automod.badwords_list)
		? automod.badwords_list.join(', ')
		: (automod.badwords_list || '');
	const activeRuleCount = [
		automod.antispam_enabled,
		automod.antiinvite_enabled,
		automod.badwords_enabled,
		automod.mention_spam_enabled,
	].filter(Boolean).length;

	return (
		<TabWorkspace>
			<TabSection
				title="Violation response"
				description="Choose what Megu should do after a message matches any enabled protection rule."
				meta={<TabStatus tone={activeRuleCount ? 'success' : 'neutral'}>{activeRuleCount} of 4 rules active</TabStatus>}
			>
				<div className="form-group">
					<label className="form-label">Action after a violation</label>
					<CustomSelect
						value={automod.action || 'delete'}
						onChange={value => onChange('action', value)}
						options={[
							{ value: 'delete', label: 'Delete message only', subtitle: 'Remove the matching message immediately' },
							{ value: 'warn', label: 'Delete and warn', subtitle: 'Remove the message and warn the member' },
							{ value: 'kick', label: 'Kick member', subtitle: 'Remove the member from this server' },
							{ value: 'ban', label: 'Ban member', subtitle: 'Permanently ban the member' },
						]}
						searchable={false}
					/>
				</div>
			</TabSection>

			<TabSection
				title="Protection rules"
				description="Enable only the checks this community needs. Changes are saved with the server settings."
			>
				<TabFieldGrid>
					<TabChoice
						checked={!!automod.antispam_enabled}
						onChange={event => onChange('antispam_enabled', event.target.checked)}
						label="Rapid message spam"
						description="Detect repeated messages sent in a short period."
					/>
					<TabChoice
						checked={!!automod.antiinvite_enabled}
						onChange={event => onChange('antiinvite_enabled', event.target.checked)}
						label="Unauthorized invites"
						description="Block discord.gg invitation links."
					/>
					<TabChoice
						checked={!!automod.badwords_enabled}
						onChange={event => onChange('badwords_enabled', event.target.checked)}
						label="Blocked words and phrases"
						description="Match messages against your custom block list."
					/>
					<TabChoice
						checked={!!automod.mention_spam_enabled}
						onChange={event => onChange('mention_spam_enabled', event.target.checked)}
						label="Mass mentions"
						description="Block messages that mention more than five members."
					/>
				</TabFieldGrid>
			</TabSection>

			{automod.badwords_enabled ? (
				<TabSection
					title="Block list"
					description="Separate entries with commas. Matching is handled by the existing moderation rules."
				>
					<div className="form-group">
						<label className="form-label" htmlFor="automod-blocked-words">Words or phrases</label>
						<textarea
							id="automod-blocked-words"
							className="form-control"
							value={badwordsText}
							onChange={event => onChange('badwords_list', event.target.value.split(',').map(value => value.trim()).filter(Boolean))}
							placeholder="blocked phrase, another phrase"
						/>
					</div>
				</TabSection>
			) : null}
		</TabWorkspace>
	);
}
