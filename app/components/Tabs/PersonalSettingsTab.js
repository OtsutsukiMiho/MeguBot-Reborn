'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BellPlus, Trash2 } from 'lucide-react';
import CustomSelect from '../CustomSelect';
import { useCopy } from '../../copy';
import { TabActionBar, TabConfirmDialog, TabDialog, TabEmpty, TabFieldMessage, TabInlineActions, TabNotice, TabRecord, TabRecordList, TabSection, TabSettingRow, TabSettingsList, TabSkeleton, TabStatus, TabSwitch, TabWorkspace } from './TabWorkspace';

const TIME_PRESETS = ['10m', '30m', '1h', '2h', '1d', '18:00 everyday'];

export default function PersonalSettingsTab({ guildId, serverName, initialChannels = [], showToast, onEditorDirtyChange }) {
	const { t, fmt } = useCopy();
	const copy = t.personalSettings;
	const shared = t.serverTabs.shared;
	const copyRef = useRef(copy);
	copyRef.current = copy;
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState('');
	const [nickname, setNickname] = useState(null);
	const [nickInput, setNickInput] = useState('');
	const [nickSaving, setNickSaving] = useState(false);
	const [nickError, setNickError] = useState('');
	const [announceOptOut, setAnnounceOptOut] = useState(false);
	const [announceSaving, setAnnounceSaving] = useState(false);
	const [announceError, setAnnounceError] = useState('');
	const [reminders, setReminders] = useState([]);
	const [channels, setChannels] = useState(initialChannels);
	const [pendingDeleteId, setPendingDeleteId] = useState(null);
	const [deletingId, setDeletingId] = useState(null);
	const [reminderOpen, setReminderOpen] = useState(false);
	const [reminderDraft, setReminderDraft] = useState({ message: '', time: '', channelId: '' });
	const [reminderSaving, setReminderSaving] = useState(false);
	const [reminderError, setReminderError] = useState('');
	const editorDirty = nickInput.trim() !== (nickname || '') || Object.values(reminderDraft).some(value => String(value || '').trim());
	useEffect(() => {
		onEditorDirtyChange?.('personal', Boolean(editorDirty));
		return () => onEditorDirtyChange?.('personal', false);
	}, [editorDirty, onEditorDirtyChange]);

	const fetchSettings = useCallback(async ({ quiet = false } = {}) => {
		if (!quiet) setLoading(true);
		setLoadError('');
		try {
			const response = await fetch(`/api/guilds/${guildId}/my-settings`);
			const data = await response.json().catch(() => ({}));
			if (!response.ok || !data.success) throw new Error(data.error || copyRef.current.loadError);
			setNickname(data.nickname); if (!quiet) setNickInput(data.nickname || ''); setAnnounceOptOut(Boolean(data.announceOptOut)); setReminders(data.reminders || []);
			if (Array.isArray(data.channels) && data.channels.length) setChannels(data.channels);
		} catch (error) { setLoadError(error.message || copyRef.current.loadError); }
		finally { setLoading(false); }
	}, [guildId]);
	useEffect(() => { fetchSettings(); }, [fetchSettings]);
	useEffect(() => setChannels(initialChannels || []), [initialChannels]);

	const saveNickname = async override => {
		const target = override !== undefined ? override : nickInput.trim();
		setNickSaving(true); setNickError('');
		try {
			const response = await fetch(`/api/guilds/${guildId}/my-settings/nickname`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: target }) });
			const data = await response.json().catch(() => ({}));
			if (!response.ok || !data.success) throw new Error(data.error || copy.saveNickError);
			setNickname(data.nickname); setNickInput(data.nickname || ''); showToast(data.nickname ? copy.ttsNickSaved : copy.ttsNickResetDone);
		} catch (error) { setNickError(error.message || copy.saveNickError); showToast(error.message || copy.saveNickError, true); }
		finally { setNickSaving(false); }
	};
	const toggleAnnouncement = async () => {
		const nextOptOut = !announceOptOut;
		setAnnounceSaving(true); setAnnounceError('');
		try {
			const response = await fetch(`/api/guilds/${guildId}/my-settings/announce`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optOut: nextOptOut }) });
			const data = await response.json().catch(() => ({}));
			if (!response.ok || !data.success) throw new Error(data.error || copy.saveAnnounceError);
			setAnnounceOptOut(Boolean(data.announceOptOut)); showToast(copy.announceSaved);
		} catch (error) { setAnnounceError(error.message || copy.saveAnnounceError); showToast(error.message || copy.saveAnnounceError, true); }
		finally { setAnnounceSaving(false); }
	};
	const createReminder = async event => {
		event.preventDefault();
		if (!reminderDraft.message.trim() || !reminderDraft.time.trim() || !reminderDraft.channelId) { setReminderError(copy.saveReminderError); return; }
		setReminderSaving(true); setReminderError('');
		try {
			const response = await fetch(`/api/guilds/${guildId}/my-settings/reminders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reminderDraft) });
			const data = await response.json().catch(() => ({}));
			if (!response.ok || !data.success) throw new Error(data.error || copy.saveReminderError);
			showToast(copy.reminderCreated); setReminderOpen(false); setReminderDraft({ message: '', time: '', channelId: '' }); await fetchSettings({ quiet: true });
		} catch (error) { setReminderError(error.message || copy.saveReminderError); showToast(error.message || copy.saveReminderError, true); }
		finally { setReminderSaving(false); }
	};
	const deleteReminder = async () => {
		if (!pendingDeleteId) return;
		setDeletingId(pendingDeleteId);
		try {
			const response = await fetch(`/api/guilds/${guildId}/my-settings/reminders/${pendingDeleteId}`, { method: 'DELETE' });
			const data = await response.json().catch(() => ({}));
			if (!response.ok || !data.success) throw new Error(data.error || copy.deleteReminderError);
			setReminders(current => current.filter(reminder => String(reminder.id) !== String(pendingDeleteId))); showToast(copy.reminderDeleted); setPendingDeleteId(null);
		} catch (error) { showToast(error.message || copy.deleteReminderError, true); }
		finally { setDeletingId(null); }
	};

	const formatReminder = reminder => {
		if (reminder.recurring) {
			const date = new Date(Number(reminder.reminderTime) + 7 * 3600 * 1000);
			return `${copy.recurringBadge}: ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')} ICT`;
		}
		return fmt.when(reminder.reminderTime);
	};
	const channelOptions = channels.map(channel => ({ value: channel.id, label: `# ${channel.name}`, subtitle: channel.parentName }));
	const channelName = id => {
		const channel = channels.find(item => String(item.id) === String(id));
		return channel ? `#${channel.name}` : shared.unavailableChannel(id);
	};

	if (loading && !nickname && !reminders.length) return <TabWorkspace><TabSkeleton rows={5} label={t.common.loading} /></TabWorkspace>;

	return (
		<TabWorkspace>
			<TabActionBar actions={<TabStatus tone="accent">{serverName || t.servers.fallbackServerName}</TabStatus>}><span>{copy.personalScope}</span></TabActionBar>
			{loadError ? <TabNotice tone="warning" title={copy.loadError} actions={<button type="button" className="btn btn-secondary btn-sm" onClick={() => fetchSettings()}>{shared.retry}</button>}><p>{loadError}</p></TabNotice> : null}

			<TabSection title={copy.ttsNickTitle} description={copy.ttsNickDesc} meta={<TabStatus tone={nickname ? 'success' : 'neutral'}>{nickname || copy.ttsNickDefault}</TabStatus>}>
				<TabSettingRow label={copy.ttsNickCurrent}>
					<input className="form-control" aria-label={copy.ttsNickCurrent} aria-describedby={nickError ? 'personal-nickname-error' : undefined} value={nickInput} onChange={event => setNickInput(event.target.value)} placeholder={copy.ttsNickPlaceholder} />
					{nickError ? <TabFieldMessage id="personal-nickname-error" tone="error">{nickError}</TabFieldMessage> : null}
					<TabInlineActions><button type="button" className="btn btn-secondary" onClick={() => saveNickname('')} disabled={nickSaving || !nickname}>{copy.ttsNickReset}</button><button type="button" className="btn btn-primary" onClick={() => saveNickname()} disabled={nickSaving || nickInput.trim() === (nickname || '')}>{nickSaving ? shared.working : copy.ttsNickSave}</button></TabInlineActions>
				</TabSettingRow>
			</TabSection>

			<TabSection title={copy.announceTitle} description={copy.announceDesc}>
				<TabSettingsList><TabSettingRow label={announceOptOut ? copy.announceToggleOff : copy.announceToggleOn} description={announceOptOut ? copy.announceStatusMuted : copy.announceStatusActive} control={<TabSwitch checked={!announceOptOut} onChange={toggleAnnouncement} label={copy.announceToggleOn} disabled={announceSaving} />} /></TabSettingsList>
				{announceError ? <TabFieldMessage tone="error">{announceError}</TabFieldMessage> : null}
			</TabSection>

			<TabSection title={copy.remindersTitle} description={copy.remindersDesc} actions={<button type="button" className="btn btn-primary" onClick={() => { setReminderOpen(true); setReminderError(''); }}><BellPlus size={16} aria-hidden="true" /> {copy.reminderNewBtn}</button>}>
				<TabFieldMessage>{copy.reminderTimezoneHint}</TabFieldMessage>
				{reminders.length ? <TabRecordList>{reminders.map(reminder => <TabRecord key={reminder.id}><strong>{reminder.message}</strong><span>{formatReminder(reminder)}</span><span>{copy.inChannel(channelName(reminder.channelId))}</span><TabInlineActions><button type="button" className="btn btn-secondary btn-sm" onClick={() => setPendingDeleteId(reminder.id)} disabled={deletingId === reminder.id}><Trash2 size={14} aria-hidden="true" /> {copy.deleteBtn}</button></TabInlineActions></TabRecord>)}</TabRecordList> : <TabEmpty title={copy.remindersEmpty} action={<button type="button" className="btn btn-primary" onClick={() => setReminderOpen(true)}>{copy.reminderNewBtn}</button>} />}
			</TabSection>

			<TabDialog open={reminderOpen} onClose={reminderSaving ? undefined : () => setReminderOpen(false)} title={copy.reminderModalTitle} description={copy.reminderTimezoneHint} footer={<><button type="button" className="btn btn-secondary" onClick={() => setReminderOpen(false)} disabled={reminderSaving}>{copy.reminderCancelBtn}</button><button type="submit" form="personal-reminder-form" className="btn btn-primary" disabled={reminderSaving}>{reminderSaving ? shared.working : copy.reminderCreateBtn}</button></>}>
				<form id="personal-reminder-form" onSubmit={createReminder} aria-describedby={reminderError ? 'personal-reminder-error' : undefined}>
					<TabSettingsList>
						<TabSettingRow label={copy.reminderMessageLabel} stacked><input className="form-control" aria-label={copy.reminderMessageLabel} value={reminderDraft.message} maxLength={500} onChange={event => setReminderDraft(current => ({ ...current, message: event.target.value }))} placeholder={copy.reminderMessagePlaceholder} /></TabSettingRow>
						<TabSettingRow label={copy.reminderTimeLabel} description={copy.reminderTimeHint} stacked><input className="form-control" aria-label={copy.reminderTimeLabel} value={reminderDraft.time} onChange={event => setReminderDraft(current => ({ ...current, time: event.target.value }))} placeholder={copy.reminderTimePlaceholder} /><TabInlineActions align="start">{TIME_PRESETS.map(value => <button key={value} type="button" className="btn btn-secondary btn-sm" onClick={() => setReminderDraft(current => ({ ...current, time: value }))}>{value}</button>)}</TabInlineActions></TabSettingRow>
						<TabSettingRow label={copy.reminderChannelLabel} description={copy.reminderChannelHint} stacked><CustomSelect type="channel" ariaLabel={copy.reminderChannelLabel} value={reminderDraft.channelId} onChange={channelId => setReminderDraft(current => ({ ...current, channelId }))} placeholder={copy.reminderChannelSelect} options={channelOptions} /></TabSettingRow>
					</TabSettingsList>
					{reminderError ? <TabFieldMessage id="personal-reminder-error" tone="error">{reminderError}</TabFieldMessage> : null}
				</form>
			</TabDialog>
			<TabConfirmDialog open={!!pendingDeleteId} onClose={() => setPendingDeleteId(null)} onConfirm={deleteReminder} title={copy.reminderDeleteConfirm} description={copy.reminderDeleteConfirm} confirmLabel={copy.deleteBtn} cancelLabel={copy.reminderCancelBtn} busy={!!deletingId} />
		</TabWorkspace>
	);
}
