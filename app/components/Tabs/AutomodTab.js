'use client';

import { useEffect, useRef, useState } from 'react';
import CustomSelect from '../CustomSelect';
import { useCopy } from '../../copy';
import { TabActionBar, TabFieldMessage, TabNotice, TabSection, TabSettingRow, TabSettingsList, TabStatus, TabSwitch, TabWorkspace } from './TabWorkspace';

export default function AutomodTab({ automod, onChange }) {
	const { t } = useCopy();
	const copy = t.serverTabs.automod;
	const normalizedBadwords = Array.isArray(automod.badwords_list) ? automod.badwords_list.join(', ') : (automod.badwords_list || '');
	const [badwordsText, setBadwordsText] = useState(normalizedBadwords);
	const editingBadwords = useRef(false);
	const rules = [
		['antispam_enabled', copy.spam, copy.spamHelp],
		['antiinvite_enabled', copy.invite, copy.inviteHelp],
		['badwords_enabled', copy.words, copy.wordsHelp],
		['mention_spam_enabled', copy.mentions, copy.mentionsHelp],
	];
	const activeRuleCount = rules.filter(([key]) => automod[key]).length;

	useEffect(() => {
		if (!editingBadwords.current) setBadwordsText(normalizedBadwords);
	}, [normalizedBadwords]);

	const updateBadwords = value => {
		setBadwordsText(value);
		onChange('badwords_list', value.split(',').map(item => item.trim()).filter(Boolean));
	};

	return (
		<TabWorkspace>
			<TabActionBar actions={<TabStatus tone={activeRuleCount ? 'success' : 'neutral'}>{copy.enabled(activeRuleCount)}</TabStatus>}>
				<span>{copy.scope}</span>
			</TabActionBar>

			<TabSection title={copy.rulesTitle} description={copy.rulesDescription}>
				<TabSettingsList>
					{rules.map(([key, label, description]) => (
						<TabSettingRow key={key} label={label} description={description} control={<TabSwitch checked={!!automod[key]} onChange={event => onChange(key, event.target.checked)} label={label} />} />
					))}
					{automod.badwords_enabled ? (
						<TabSettingRow label={copy.blockList} description={copy.blockListHelp} stacked>
							<textarea
								id="automod-blocked-words"
								className="form-control"
								aria-label={copy.blockList}
								value={badwordsText}
								onFocus={() => { editingBadwords.current = true; }}
								onBlur={() => { editingBadwords.current = false; setBadwordsText(Array.isArray(automod.badwords_list) ? automod.badwords_list.join(', ') : (automod.badwords_list || '')); }}
								onChange={event => updateBadwords(event.target.value)}
								placeholder={copy.blockListPlaceholder}
								aria-describedby="automod-blocked-words-help"
							/>
							<TabFieldMessage id="automod-blocked-words-help">{copy.blockListHelp}</TabFieldMessage>
						</TabSettingRow>
					) : null}
				</TabSettingsList>
			</TabSection>

			<TabSection title={copy.responseTitle} description={copy.responseDescription}>
				<TabSettingRow label={copy.responseLabel}>
					<CustomSelect
						ariaLabel={copy.responseLabel}
						value={automod.action || 'delete'}
						onChange={value => onChange('action', value)}
						options={[
							{ value: 'delete', label: copy.deleteMessage },
							{ value: 'warn', label: copy.warnMember },
							{ value: 'kick', label: copy.kickMember },
							{ value: 'ban', label: copy.banMember },
						]}
						searchable={false}
					/>
				</TabSettingRow>
				{['kick', 'ban'].includes(automod.action) ? <TabNotice tone="warning" title={copy.responseLabel}><p>{copy.consequence}</p></TabNotice> : null}
			</TabSection>
		</TabWorkspace>
	);
}
