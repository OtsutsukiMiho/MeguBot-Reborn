'use client';

import { useEffect, useState } from 'react';
import { ImageOff, Plus, Trash2 } from 'lucide-react';
import CustomSelect from '../CustomSelect';
import { useCopy } from '../../copy';
import { TabActionBar, TabDisclosure, TabFieldMessage, TabInlineActions, TabRecord, TabRecordList, TabSection, TabSettingRow, TabSettingsList, TabSplitLayout, TabStatus, TabSwitch, TabWorkspace } from './TabWorkspace';
import styles from './EmbedCreatorTab.module.css';
const { requestServerAction } = require('../../../core/server-dashboard-request');

const DEFAULT_COLOR = '#5865f2';

function safeColor(value) {
	return /^#[0-9a-f]{6}$/i.test(value || '') ? value : DEFAULT_COLOR;
}

function PreviewImage({ src, className = '', fallbackLabel }) {
	const [failed, setFailed] = useState(false);
	useEffect(() => setFailed(false), [src]);
	if (!src) return null;
	return failed
		? <span className={`${styles.imageFallback} ${className}`.trim()} role="img" aria-label={fallbackLabel}><ImageOff size={18} aria-hidden="true" /></span>
		: <img className={className} src={src} alt="" onError={() => setFailed(true)} />;
}

export default function EmbedCreatorTab({ currentGuildId, guildId, activeGuilds = [], channels = [], showToast, draft = {}, onDraftChange }) {
	const { t } = useCopy();
	const copy = t.serverTabs.embeds;
	const shared = t.serverTabs.shared;
	const activeGuildId = currentGuildId || guildId;
	const value = (key, fallback = '') => draft[key] ?? fallback;
	const fields = Array.isArray(draft.fields) ? draft.fields : [];
	const updateDraft = patch => onDraftChange?.({ ...draft, ...patch, _submitted: false });
	const [sending, setSending] = useState(false);
	const [error, setError] = useState('');
	const serverName = activeGuilds.find(guild => String(guild.id) === String(activeGuildId))?.name || activeGuildId;
	const selectedChannel = channels.find(channel => String(channel.id) === String(value('targetChannelId')));
	const channelOptions = channels.map(channel => ({ value: channel.id, label: `# ${channel.name}`, subtitle: channel.parentName }));

	const addField = () => {
		if (fields.length >= 25) { setError(copy.fieldLimit); showToast(copy.fieldLimit, true); return; }
		updateDraft({ fields: [...fields, { name: '', value: '', inline: false }] });
	};
	const updateField = (index, key, nextValue) => updateDraft({ fields: fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, [key]: nextValue } : field) });
	const removeField = index => updateDraft({ fields: fields.filter((_, fieldIndex) => fieldIndex !== index) });

	const sendEmbed = async event => {
		event.preventDefault(); setError('');
		if (!value('targetChannelId')) { setError(copy.destinationError); return; }
		const partialField = fields.some(field => Boolean(field.name.trim()) !== Boolean(field.value.trim()));
		if (partialField) { setError(copy.incompleteFields); return; }
		const completeFields = fields.filter(field => field.name.trim() && field.value.trim());
		if (![value('title'), value('description'), value('imageUrl'), value('authorName')].some(item => item.trim()) && !completeFields.length) { setError(copy.contentError); return; }
		const totalCharacters = [value('title'), value('description'), value('authorName'), value('footerText'), ...completeFields.flatMap(field => [field.name, field.value])].reduce((total, item) => total + String(item || '').length, 0);
		if (totalCharacters > 6000) { setError(copy.totalLimit); return; }
		setSending(true);
		try {
			const result = await requestServerAction(fetch, `/api/guilds/${activeGuildId}/send-embed`, {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId: value('targetChannelId'), embed: {
					authorName: value('authorName').trim() || undefined, authorIconUrl: value('authorIconUrl').trim() || undefined, authorUrl: value('authorUrl').trim() || undefined,
					title: value('title').trim() || undefined, titleUrl: value('titleUrl').trim() || undefined, description: value('description').trim() || undefined,
					color: safeColor(value('color', DEFAULT_COLOR)), thumbnailUrl: value('thumbnailUrl').trim() || undefined, imageUrl: value('imageUrl').trim() || undefined,
					fields: completeFields, footerText: value('footerText').trim() || undefined, footerIconUrl: value('footerIconUrl').trim() || undefined, includeTimestamp: !!value('includeTimestamp', false),
				} }),
			}, { failure: copy.sendError, deliveryUnknown: copy.deliveryUnknown });
			if (!result.ok) {
				setError(result.error);
				showToast(result.error, true);
				return;
			}
			showToast(copy.sendSuccess);
			onDraftChange?.({ ...draft, _submitted: true });
		} finally { setSending(false); }
	};

	const hasPreview = [value('authorName'), value('title'), value('description'), value('imageUrl'), value('footerText')].some(Boolean) || fields.some(field => field.name || field.value);
	const preview = (
		<div className={styles.previewShell}>
			<div className={styles.previewHeader}>{copy.preview}<p>{copy.previewHelp}</p></div>
			<div className={styles.embed} style={{ '--embed-color': safeColor(value('color', DEFAULT_COLOR)) }}>
				{!hasPreview ? <p className={styles.empty}>{copy.emptyPreview}</p> : null}
				{value('authorName') ? <div className={styles.author}><PreviewImage src={value('authorIconUrl')} className={styles.previewIcon} fallbackLabel={copy.imageUnavailable} /> <span>{value('authorName')}</span></div> : null}
				{value('title') ? <h4 className={styles.title}>{value('title')}</h4> : null}
				{value('description') ? <p className={styles.description}>{value('description')}</p> : null}
				<PreviewImage src={value('thumbnailUrl')} className={styles.thumbnail} fallbackLabel={copy.imageUnavailable} />
				{fields.some(field => field.name || field.value) ? <div className={styles.fields}>{fields.map((field, index) => (field.name || field.value) ? <div key={index} className={`${styles.field} ${field.inline ? styles.fieldInline : ''}`}><strong>{field.name || copy.untitledField}</strong><p>{field.value || '—'}</p></div> : null)}</div> : null}
				<PreviewImage src={value('imageUrl')} className={styles.mainImage} fallbackLabel={copy.imageUnavailable} />
				{value('footerText') || value('includeTimestamp', false) ? <div className={styles.footer}><PreviewImage src={value('footerIconUrl')} className={styles.previewIcon} fallbackLabel={copy.imageUnavailable} /><span>{value('footerText')}</span>{value('footerText') && value('includeTimestamp', false) ? <span>·</span> : null}{value('includeTimestamp', false) ? <time>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time> : null}</div> : null}
			</div>
		</div>
	);

	const editor = (
		<form onSubmit={sendEmbed} aria-describedby={error ? 'embed-send-error' : undefined}>
			<TabSection title={copy.coreTitle} description={copy.coreDescription}>
				<TabSettingsList>
					<TabSettingRow label={copy.title} stacked><input className="form-control" aria-label={copy.title} maxLength={256} value={value('title')} onChange={event => updateDraft({ title: event.target.value })} placeholder={copy.titlePlaceholder} /></TabSettingRow>
					<TabSettingRow label={copy.description} stacked><textarea className="form-control" aria-label={copy.description} maxLength={4096} value={value('description')} onChange={event => updateDraft({ description: event.target.value })} placeholder={copy.descriptionPlaceholder} /></TabSettingRow>
				</TabSettingsList>
			</TabSection>

			<TabSection title={copy.fields} actions={<button type="button" className="btn btn-secondary btn-sm" onClick={addField} disabled={fields.length >= 25}><Plus size={15} aria-hidden="true" /> {copy.addField}</button>}>
				{fields.length ? <TabRecordList>{fields.map((field, index) => <TabRecord key={index}><div className={styles.fieldEditor}><strong>{copy.fieldLabel(index + 1)}</strong><div className={styles.fieldGrid}><div className="form-group"><label className="form-label" htmlFor={`embed-field-name-${index}`}>{copy.fieldName}</label><input id={`embed-field-name-${index}`} className="form-control" maxLength={256} value={field.name} onChange={event => updateField(index, 'name', event.target.value)} /></div><div className="form-group"><label className="form-label" htmlFor={`embed-field-value-${index}`}>{copy.fieldValue}</label><textarea id={`embed-field-value-${index}`} className="form-control" maxLength={1024} value={field.value} onChange={event => updateField(index, 'value', event.target.value)} /></div></div><TabInlineActions align="between"><label><input type="checkbox" checked={field.inline} onChange={event => updateField(index, 'inline', event.target.checked)} /> {copy.inline}</label><button type="button" className="btn btn-secondary btn-sm" onClick={() => removeField(index)}><Trash2 size={14} aria-hidden="true" /> {copy.removeField}</button></TabInlineActions></div></TabRecord>)}</TabRecordList> : <TabFieldMessage>{copy.fieldLimit}</TabFieldMessage>}
			</TabSection>

			<TabDisclosure summary={copy.appearance} description={copy.appearanceHelp}>
				<TabSettingsList>
					<TabSettingRow label={copy.authorName}><input className="form-control" aria-label={copy.authorName} maxLength={256} value={value('authorName')} onChange={event => updateDraft({ authorName: event.target.value })} /></TabSettingRow>
					<TabSettingRow label={copy.authorIcon}><input className="form-control" aria-label={copy.authorIcon} type="url" value={value('authorIconUrl')} onChange={event => updateDraft({ authorIconUrl: event.target.value })} /></TabSettingRow>
					<TabSettingRow label={copy.authorUrl}><input className="form-control" aria-label={copy.authorUrl} type="url" value={value('authorUrl')} onChange={event => updateDraft({ authorUrl: event.target.value })} /></TabSettingRow>
					<TabSettingRow label={copy.titleUrl}><input className="form-control" aria-label={copy.titleUrl} type="url" value={value('titleUrl')} onChange={event => updateDraft({ titleUrl: event.target.value })} /></TabSettingRow>
					<TabSettingRow label={copy.color}><input type="color" aria-label={copy.color} value={safeColor(value('color', DEFAULT_COLOR))} onChange={event => updateDraft({ color: event.target.value })} /></TabSettingRow>
					<TabSettingRow label={copy.thumbnail}><input className="form-control" aria-label={copy.thumbnail} type="url" value={value('thumbnailUrl')} onChange={event => updateDraft({ thumbnailUrl: event.target.value })} /></TabSettingRow>
					<TabSettingRow label={copy.image}><input className="form-control" aria-label={copy.image} type="url" value={value('imageUrl')} onChange={event => updateDraft({ imageUrl: event.target.value })} /></TabSettingRow>
					<TabSettingRow label={copy.footer}><input className="form-control" aria-label={copy.footer} maxLength={2048} value={value('footerText')} onChange={event => updateDraft({ footerText: event.target.value })} /></TabSettingRow>
					<TabSettingRow label={copy.footerIcon}><input className="form-control" aria-label={copy.footerIcon} type="url" value={value('footerIconUrl')} onChange={event => updateDraft({ footerIconUrl: event.target.value })} /></TabSettingRow>
					<TabSettingRow label={copy.timestamp} control={<TabSwitch checked={!!value('includeTimestamp', false)} onChange={event => updateDraft({ includeTimestamp: event.target.checked })} label={copy.timestamp} />} />
				</TabSettingsList>
			</TabDisclosure>

			<TabSection title={copy.destinationTitle} description={copy.destinationDescription}>
				<TabSettingsList><TabSettingRow label={copy.server}><TabStatus tone="accent">{serverName}</TabStatus></TabSettingRow><TabSettingRow label={copy.channel}><CustomSelect type="channel" ariaLabel={copy.channel} value={value('targetChannelId')} onChange={targetChannelId => updateDraft({ targetChannelId })} options={channelOptions} placeholder={copy.channelPlaceholder} /></TabSettingRow></TabSettingsList>
				{error ? <TabFieldMessage id="embed-send-error" tone="error">{error}</TabFieldMessage> : null}
				<TabInlineActions><button type="submit" className="btn btn-primary" disabled={sending}>{sending ? copy.sending : copy.send}{selectedChannel ? ` · #${selectedChannel.name}` : ''}</button></TabInlineActions>
			</TabSection>
		</form>
	);

	return <TabWorkspace><TabActionBar actions={<TabStatus tone={selectedChannel ? 'success' : 'neutral'}>{selectedChannel ? `#${selectedChannel.name}` : copy.channelPlaceholder}</TabStatus>}><span>{copy.scope}</span></TabActionBar><TabSplitLayout editor={editor} preview={preview} /></TabWorkspace>;
}
