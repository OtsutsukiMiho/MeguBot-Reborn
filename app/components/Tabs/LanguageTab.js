'use client';

import CustomSelect from '../CustomSelect';
import { useCopy } from '../../copy';
import { TabActionBar, TabNotice, TabSection, TabSettingRow, TabStatus, TabWorkspace } from './TabWorkspace';
const { localeChoices } = require('../../../core/locales');

/**
 * The language Megu posts bills in for this server. Empty follows the
 * server's own Discord language, which the API reports as megu_lang_auto so
 * this screen can say what that currently is.
 */
export default function LanguageTab({ config, onChange }) {
	const { t } = useCopy();
	const copy = t.serverTabs.language;
	const nameOf = code => copy.names[code] || code;
	const selected = config.megu_lang || '';
	const effective = selected || config.megu_lang_auto || 'th';
	const options = [
		{ value: '', label: copy.auto(nameOf(config.megu_lang_auto || 'th')) },
		...localeChoices().map(({ code }) => ({ value: code, label: nameOf(code) })),
	];

	return (
		<TabWorkspace>
			<TabActionBar actions={<TabStatus tone={selected ? 'success' : 'neutral'}>{copy.status(nameOf(effective))}</TabStatus>}>
				<span>{copy.scope}</span>
			</TabActionBar>
			<TabSection title={copy.title} description={copy.description}>
				<TabSettingRow label={copy.label} description={copy.labelHelp}>
					<CustomSelect
						ariaLabel={copy.label}
						searchable={false}
						value={selected}
						onChange={value => onChange('megu_lang', value || '')}
						options={options}
					/>
				</TabSettingRow>
				<TabNotice title={copy.personalTitle}><p>{copy.personal}</p></TabNotice>
			</TabSection>
		</TabWorkspace>
	);
}
