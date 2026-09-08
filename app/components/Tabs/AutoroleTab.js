'use client';

import { X } from 'lucide-react';
import CustomSelect from '../CustomSelect';
import { useCopy } from '../../copy';
import { TabActionBar, TabEmpty, TabResourceRow, TabSection, TabStatus, TabWorkspace } from './TabWorkspace';

function roleColor(role) {
	if (!role) return '#8A8F9E';
	if (typeof role.hexColor === 'string' && /^#[0-9a-f]{6}$/i.test(role.hexColor) && role.hexColor !== '#000000') return role.hexColor;
	if (typeof role.color === 'string' && /^#[0-9a-f]{6}$/i.test(role.color) && role.color !== '#000000') return role.color;
	const numeric = Number(role.color);
	return Number.isFinite(numeric) && numeric > 0 ? `#${numeric.toString(16).padStart(6, '0').slice(-6)}` : '#8A8F9E';
}

export default function AutoroleTab({ config, roles = [], onChange }) {
	const { t } = useCopy();
	const copy = t.serverTabs.autorole;
	const shared = t.serverTabs.shared;
	const humanRoles = Array.isArray(config.autorole_ids) ? config.autorole_ids : (config.autorole_id ? [config.autorole_id] : []);
	const botRoles = Array.isArray(config.bot_autorole_ids) ? config.bot_autorole_ids : [];
	const rolesMap = new Map(roles.map(role => [String(role.id), role]));
	const eligibleRoles = roles.filter(role => role.name !== '@everyone');

	const setHumanRoles = next => {
		onChange('autorole_ids', next);
		onChange('autorole_id', next[0] || null);
	};
	const addHuman = value => value && !humanRoles.includes(value) && setHumanRoles([...humanRoles, value]);
	const addBot = value => value && !botRoles.includes(value) && onChange('bot_autorole_ids', [...botRoles, value]);

	const renderRoles = (selectedIds, remove, emptyText) => selectedIds.length ? (
		<div>
			{selectedIds.map(id => {
				const role = rolesMap.get(String(id));
				const label = role ? `@${role.name}` : shared.unavailableRole(id);
				return (
					<TabResourceRow
						key={id}
						label={label}
						description={role ? null : String(id)}
						markerColor={roleColor(role)}
						actions={(
							<button type="button" className="btn btn-secondary btn-sm" onClick={() => remove(id)} aria-label={copy.removeRole(label)}>
								<X size={15} aria-hidden="true" /> {shared.remove}
							</button>
						)}
					/>
				);
			})}
		</div>
	) : <TabEmpty title={emptyText} />;

	return (
		<TabWorkspace>
			<TabActionBar actions={<TabStatus tone="accent">{copy.available(eligibleRoles.length)}</TabStatus>}>
				<span>{copy.scope}</span>
				<TabStatus tone={humanRoles.length + botRoles.length ? 'success' : 'neutral'}>{copy.configured(humanRoles.length + botRoles.length)}</TabStatus>
			</TabActionBar>

			<TabSection title={copy.humansTitle} description={copy.humansDescription}>
				<div className="form-group">
					<label className="form-label">{copy.humansSelect}</label>
					<CustomSelect type="role" ariaLabel={copy.humansSelect} placeholder={copy.humansPlaceholder} value="" onChange={addHuman} options={eligibleRoles.filter(role => !humanRoles.includes(role.id)).map(role => ({ value: role.id, label: `@${role.name}`, color: role.hexColor || role.color }))} />
				</div>
				{renderRoles(humanRoles, id => setHumanRoles(humanRoles.filter(roleId => roleId !== id)), copy.humansEmpty)}
			</TabSection>

			<TabSection title={copy.botsTitle} description={copy.botsDescription}>
				<div className="form-group">
					<label className="form-label">{copy.botsSelect}</label>
					<CustomSelect type="role" ariaLabel={copy.botsSelect} placeholder={copy.botsPlaceholder} value="" onChange={addBot} options={eligibleRoles.filter(role => !botRoles.includes(role.id)).map(role => ({ value: role.id, label: `@${role.name}`, color: role.hexColor || role.color }))} />
				</div>
				{renderRoles(botRoles, id => onChange('bot_autorole_ids', botRoles.filter(roleId => roleId !== id)), copy.botsEmpty)}
			</TabSection>
		</TabWorkspace>
	);
}
