'use client';

import { useMemo, useState } from 'react';
import CustomSelect from '../CustomSelect';
import { useCopy } from '../../copy';
import { TabActionBar, TabConfirmDialog, TabEmpty, TabFieldGrid, TabFieldMessage, TabInlineActions, TabSection, TabSegmented, TabStatus, TabTable, TabWorkspace } from './TabWorkspace';

export default function ReactionRolesTab({ guildId, reactionRoles, roles = [], channels = [], onRefresh, showToast, draft = {}, onDraftChange }) {
	const { t } = useCopy();
	const copy = t.serverTabs.reactionRoles;
	const shared = t.serverTabs.shared;
	const [busyKey, setBusyKey] = useState('');
	const [showClearConfirm, setShowClearConfirm] = useState(false);
	const channelId = draft.channelId || '';
	const messageIdInput = draft.messageIdInput || '';
	const emoji = draft.emoji || '';
	const roleId = draft.roleId || '';
	const mode = draft.mode || 'toggle';
	const formOpen = !!draft.formOpen;
	const updateDraft = patch => onDraftChange?.({ ...draft, ...patch });
	const rolesMap = useMemo(() => new Map(roles.map(role => [String(role.id), role.name])), [roles]);

	const rows = useMemo(() => {
		const result = [];
		if (!reactionRoles || typeof reactionRoles !== 'object') return result;
		for (const [messageId, emojis] of Object.entries(reactionRoles)) {
			if (!emojis || typeof emojis !== 'object') continue;
			for (const [reaction, entry] of Object.entries(emojis)) {
				const structured = typeof entry === 'object' && entry !== null;
				const mappedRoleId = structured ? entry.roleId : entry;
				result.push({ messageId, emoji: reaction, roleId: mappedRoleId, roleName: rolesMap.get(String(mappedRoleId)), mode: structured ? (entry.mode || 'toggle') : 'toggle', enabled: structured ? entry.enabled !== false : true });
			}
		}
		return result.sort((a, b) => String(a.messageId).localeCompare(String(b.messageId)));
	}, [reactionRoles, rolesMap]);

	const request = async (payload, successMessage, failureMessage, key) => {
		setBusyKey(key);
		try {
			const response = await fetch(`/api/guilds/${guildId}/reaction-roles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
			const data = await response.json().catch(() => ({}));
			if (!response.ok || !data.success) throw new Error(data.error || failureMessage);
			showToast(successMessage);
			await onRefresh?.();
			return true;
		} catch (error) {
			showToast(error.message || failureMessage, true);
			return false;
		} finally {
			setBusyKey('');
		}
	};

	const parseMessage = () => {
		const input = messageIdInput.trim();
		const link = input.match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/i);
		if (!link) return { messageId: input, channelId, messageLink: null };
		if (String(link[1]) !== String(guildId)) throw new Error(copy.serverError);
		if (channelId && String(channelId) !== String(link[2])) throw new Error(copy.channelConflictError);
		return { messageId: link[3], channelId: link[2], messageLink: input };
	};

	const addMapping = async event => {
		event.preventDefault();
		if (!messageIdInput.trim() || !emoji.trim() || !roleId) return showToast(copy.requiredError, true);
		let target;
		try { target = parseMessage(); } catch (error) { showToast(error.message, true); return; }
		if (!target.channelId) return showToast(copy.channelError, true);
		const saved = await request({ channelId: target.channelId, messageId: target.messageId, messageLink: target.messageLink, emoji: emoji.trim(), roleId, mode }, copy.addSuccess, copy.addError, 'add');
		if (saved) onDraftChange?.({});
	};

	const parsedLink = messageIdInput.match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/i);
	const resolvedChannel = parsedLink ? channels.find(channel => String(channel.id) === String(parsedLink[2])) : null;

	return (
		<TabWorkspace>
			<TabActionBar actions={<button type="button" className="btn btn-primary btn-sm" onClick={() => updateDraft({ formOpen: !formOpen })}>{formOpen ? copy.close : copy.add}</button>}>
				<TabStatus tone={rows.length ? 'success' : 'neutral'}>{copy.count(rows.length)}</TabStatus>
				<span>{copy.existingDescription}</span>
			</TabActionBar>

			{formOpen ? (
				<TabSection title={copy.formTitle} description={copy.formDescription} tone="panel">
					<form onSubmit={addMapping}>
						<TabFieldGrid>
							<div className="form-group"><label className="form-label" htmlFor="reaction-message">{copy.message}</label><input id="reaction-message" className="form-control" value={messageIdInput} onChange={event => updateDraft({ messageIdInput: event.target.value })} placeholder={copy.messagePlaceholder} />{resolvedChannel ? <TabFieldMessage>{copy.resolvedChannel(resolvedChannel.name)}</TabFieldMessage> : null}</div>
							<div className="form-group"><label className="form-label">{copy.channel}</label><CustomSelect type="channel" ariaLabel={copy.channel} value={channelId} onChange={value => updateDraft({ channelId: value })} options={channels.map(channel => ({ value: channel.id, label: `# ${channel.name}`, subtitle: channel.parentName }))} placeholder={copy.channelPlaceholder} /></div>
							<div className="form-group"><label className="form-label" htmlFor="reaction-emoji">{copy.emoji}</label><input id="reaction-emoji" className="form-control" value={emoji} onChange={event => updateDraft({ emoji: event.target.value })} placeholder={copy.emojiPlaceholder} /></div>
							<div className="form-group"><label className="form-label">{copy.role}</label><CustomSelect type="role" ariaLabel={copy.role} value={roleId} onChange={value => updateDraft({ roleId: value })} options={roles.filter(role => role.name !== '@everyone').map(role => ({ value: role.id, label: `@${role.name}`, color: role.hexColor || role.color }))} placeholder={copy.rolePlaceholder} /></div>
						</TabFieldGrid>
						<div className="form-group"><label className="form-label">{copy.mode}</label><TabSegmented label={copy.mode} value={mode} onChange={value => updateDraft({ mode: value })} options={[{ value: 'toggle', label: copy.toggle }, { value: 'give_only', label: copy.addOnly }]} /><TabFieldMessage>{copy.effect}</TabFieldMessage></div>
						<TabInlineActions><button type="submit" className="btn btn-primary" disabled={!!busyKey}>{busyKey === 'add' ? shared.working : copy.submit}</button></TabInlineActions>
					</form>
				</TabSection>
			) : null}

			<TabSection title={copy.existingTitle} description={copy.existingDescription} actions={rows.length ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowClearConfirm(true)}>{copy.clearAll}</button> : null}>
				{rows.length ? (
					<TabTable label={copy.existingTitle}>
						<table><thead><tr><th>{copy.status}</th><th>{copy.messageId}</th><th>{copy.emoji}</th><th>{copy.role}</th><th>{copy.mode}</th><th>{copy.actions}</th></tr></thead><tbody>
							{rows.map(row => <tr key={`${row.messageId}:${row.emoji}`}><td><TabStatus tone={row.enabled ? 'success' : 'neutral'}>{row.enabled ? copy.enabled : copy.disabled}</TabStatus></td><td><code>{row.messageId}</code></td><td>{row.emoji}</td><td>{row.roleName ? `@${row.roleName}` : shared.unavailableRole(row.roleId)}</td><td>{row.mode === 'give_only' ? copy.addOnly : copy.toggle}</td><td><TabInlineActions align="start"><button type="button" className="btn btn-secondary btn-sm" disabled={!!busyKey} onClick={() => request({ action: 'toggle', messageId: row.messageId, emoji: row.emoji }, copy.updateSuccess, copy.updateError, `toggle:${row.messageId}:${row.emoji}`)}>{row.enabled ? copy.disable : copy.enable}</button><button type="button" className="btn btn-secondary btn-sm" disabled={!!busyKey} onClick={() => request({ action: 'delete', messageId: row.messageId, emoji: row.emoji }, copy.removeSuccess, copy.removeError, `remove:${row.messageId}:${row.emoji}`)}>{shared.remove}</button></TabInlineActions></td></tr>)}
						</tbody></table>
					</TabTable>
				) : <TabEmpty title={copy.emptyTitle} description={copy.emptyDescription} action={<button type="button" className="btn btn-primary" onClick={() => updateDraft({ formOpen: true })}>{copy.add}</button>} />}
			</TabSection>

			<TabConfirmDialog open={showClearConfirm} onClose={() => setShowClearConfirm(false)} onConfirm={async () => { const ok = await request({ action: 'clear_all' }, copy.clearSuccess, copy.clearError, 'clear'); if (ok) setShowClearConfirm(false); }} title={copy.clearTitle} description={copy.clearDescription} confirmLabel={copy.clearAll} cancelLabel={shared.cancel} busy={busyKey === 'clear'} />
		</TabWorkspace>
	);
}
