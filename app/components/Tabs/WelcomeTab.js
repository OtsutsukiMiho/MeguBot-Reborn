'use client';

import { useRef, useState } from 'react';
import CustomSelect from '../CustomSelect';
import { TabActionBar, TabLocalTabs, TabNotice, TabSection, TabStatus, TabWorkspace } from './TabWorkspace';
import { useCopy } from '../../copy';
import styles from './WelcomeTab.module.css';

const DEFAULT_WELCOME_EMBED = {
	title: 'Welcome to {server}!',
	description: 'Welcome {member} to our community! Please make sure to check the rules and enjoy your stay.',
	color: '#5865f2',
	thumbnailUrl: '{avatar}',
	footerText: 'Member #{membercount} • {server}',
	includeTimestamp: true,
};

const DEFAULT_LEAVE_EMBED = {
	title: 'Member departed',
	description: '**{username}** has left the server. Goodbye!',
	color: '#ed4245',
	thumbnailUrl: '{avatar}',
	footerText: '{server}',
	includeTimestamp: true,
};

const VARIABLES = ['{member}', '{username}', '{displayname}', '{nickname}', '{server}', '{membercount}'];
const PRESET_COLORS = ['#5865f2', '#3ba55d', '#faa81a', '#ed4245', '#eb459e', '#9b59b6', '#00bcd4', '#1abc9c', '#3498db'];

function exampleText(value, { serverName, memberName }) {
	return String(value || '')
		.replaceAll('{member}', `@${memberName}`)
		.replaceAll('{username}', memberName)
		.replaceAll('{displayname}', memberName)
		.replaceAll('{displayName}', memberName)
		.replaceAll('{nickname}', memberName)
		.replaceAll('{server}', serverName || 'Discord server')
		.replaceAll('{membercount}', '42')
		.replaceAll('**', '');
}

function safeColor(value, fallback) {
	return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
}

function MessagePreview({ embed, message, serverName, leaving, copy }) {
	const memberName = leaving ? copy.exampleDepartedMember : copy.exampleMember;
	const preview = value => exampleText(value, { serverName, memberName });
	const accent = safeColor(embed?.color, leaving ? '#ed4245' : '#5865f2');

	return (
		<aside className={styles.preview} aria-label={copy.previewTitle}>
			<div className={styles.previewHeader}>
				<strong>{copy.previewTitle}</strong>
				<span>{copy.previewNote}</span>
			</div>
			<div className={styles.discordPreview}>
				<div className={styles.previewAvatar} aria-hidden="true">{memberName.substring(0, 2).toUpperCase()}</div>
				<div className={styles.previewMessage}>
					<div className={styles.previewAuthor}><strong>Megu</strong><span>APP</span></div>
					{embed ? (
						<div className={styles.embedPreview} style={{ '--embed-accent': accent }}>
							{embed.thumbnailUrl ? <div className={styles.previewThumbnail} aria-hidden="true">{memberName.substring(0, 2).toUpperCase()}</div> : null}
							{embed.title ? <strong className={styles.embedTitle}>{preview(embed.title)}</strong> : null}
							{embed.description ? <p>{preview(embed.description)}</p> : null}
							{embed.imageUrl && embed.imageUrl !== '{avatar}' ? <img className={styles.previewImage} src={embed.imageUrl} alt="" onError={event => { event.currentTarget.hidden = true; }} /> : null}
							{embed.footerText || embed.includeTimestamp !== false ? (
								<small>{preview(embed.footerText)}{embed.footerText && embed.includeTimestamp !== false ? ' • ' : ''}{embed.includeTimestamp !== false ? copy.exampleTime : ''}</small>
							) : null}
						</div>
					) : <p className={styles.textPreview}>{preview(message)}</p>}
				</div>
			</div>
		</aside>
	);
}

export default function WelcomeTab({ config = {}, channels = [], onChange, serverName, dirtyKinds = {} }) {
	const { t } = useCopy();
	const copy = t.servers.welcomeEditor;
	const [messageKind, setMessageKind] = useState('welcome');
	const editorRef = useRef(null);

	const leaving = messageKind === 'leave';
	const channelKey = leaving ? 'leave_channel_id' : 'welcome_channel_id';
	const modeKey = leaving ? 'leave_mode' : 'welcome_mode';
	const messageKey = leaving ? 'leave_message_template' : 'welcome_message_template';
	const embedKey = leaving ? 'leave_embed' : 'welcome_embed';
	const defaultEmbed = leaving ? DEFAULT_LEAVE_EMBED : DEFAULT_WELCOME_EMBED;
	const mode = config[modeKey] || 'text';
	const embed = config[embedKey] || defaultEmbed;
	const embedColor = safeColor(embed.color, defaultEmbed.color);
	const message = config[messageKey] || '';
	const welcomeDirty = Boolean(dirtyKinds.welcome);
	const goodbyeDirty = Boolean(dirtyKinds.leave);
	const activeDirty = leaving ? goodbyeDirty : welcomeDirty;

	const channelOptions = [
		{ value: '', label: copy.disabledChannel },
		...channels.map(channel => ({ value: channel.id, label: `# ${channel.name}`, subtitle: channel.parentName })),
	];

	function updateEmbed(key, value) {
		onChange(embedKey, { ...embed, [key]: value });
	}

	function insertVariable(variable) {
		const fieldValue = mode === 'embed' ? (embed.description || '') : message;
		const start = editorRef.current?.selectionStart ?? fieldValue.length;
		const end = editorRef.current?.selectionEnd ?? start;
		const spacer = start > 0 && !/\s$/.test(fieldValue.slice(0, start)) ? ' ' : '';
		const nextValue = `${fieldValue.slice(0, start)}${spacer}${variable}${fieldValue.slice(end)}`;
		if (mode === 'embed') updateEmbed('description', nextValue);
		else onChange(messageKey, nextValue);
		requestAnimationFrame(() => {
			const caret = start + spacer.length + variable.length;
			editorRef.current?.focus();
			editorRef.current?.setSelectionRange(caret, caret);
		});
	}

	return (
		<TabWorkspace>
			<TabActionBar actions={(
				<>
					<TabStatus tone={welcomeDirty ? 'warning' : config.welcome_channel_id ? 'success' : 'neutral'}>{welcomeDirty ? `${copy.welcomeTab}: ${copy.unsaved}` : config.welcome_channel_id ? copy.welcomeConfigured : copy.welcomeOff}</TabStatus>
					<TabStatus tone={goodbyeDirty ? 'warning' : config.leave_channel_id ? 'success' : 'neutral'}>{goodbyeDirty ? `${copy.goodbyeTab}: ${copy.unsaved}` : config.leave_channel_id ? copy.goodbyeConfigured : copy.goodbyeOff}</TabStatus>
				</>
			)}>{copy.intro}</TabActionBar>

			<TabLocalTabs
				label={t.servers.tabs.welcome}
				value={messageKind}
				onChange={setMessageKind}
				tabs={[
					{ id: 'welcome', label: copy.welcomeTab, tabId: 'welcome-message-tab', controls: 'server-message-panel' },
					{ id: 'leave', label: copy.goodbyeTab, tabId: 'goodbye-message-tab', controls: 'server-message-panel' },
				]}
			/>

			<div id="server-message-panel" className={styles.messagePanel} role="tabpanel" aria-labelledby={leaving ? 'goodbye-message-tab' : 'welcome-message-tab'}>
			<TabSection
				title={copy.destinationTitle}
				description={leaving ? copy.destinationGoodbye : copy.destinationWelcome}
				meta={<TabStatus tone={activeDirty ? 'warning' : config[channelKey] ? 'success' : 'neutral'}>{activeDirty ? copy.unsaved : config[channelKey] ? (leaving ? copy.goodbyeConfigured : copy.welcomeConfigured) : (leaving ? copy.goodbyeOff : copy.welcomeOff)}</TabStatus>}
			>
				<div className="form-group">
					<span className="form-label">{copy.channelLabel}</span>
					<CustomSelect type="channel" ariaLabel={copy.channelLabel} unavailableLabel={copy.unavailableSelection} placeholder={copy.channelPlaceholder} value={config[channelKey] || ''} onChange={value => onChange(channelKey, value || null)} options={channelOptions} />
				</div>
				{channels.length === 0 ? <TabNotice tone="warning">{copy.noChannels}</TabNotice> : null}
			</TabSection>

			<TabSection title={copy.messageTitle} description={copy.messageDescription}>
				<fieldset className={styles.formatFieldset}>
					<legend>{copy.formatLabel}</legend>
					<div className={styles.segmentedControl}>
						<button type="button" aria-pressed={mode === 'text'} className={mode === 'text' ? styles.segmentActive : ''} onClick={() => onChange(modeKey, 'text')}>{copy.textMode}</button>
						<button type="button" aria-pressed={mode === 'embed'} className={mode === 'embed' ? styles.segmentActive : ''} onClick={() => onChange(modeKey, 'embed')}>{copy.embedMode}</button>
					</div>
				</fieldset>

				<div className={styles.editorPreviewGrid}>
					<div className={styles.editorColumn}>
						{mode === 'embed' ? (
							<>
								<div className="form-group"><label className="form-label" htmlFor={`${messageKind}-embed-title`}>{copy.titleLabel}</label><input id={`${messageKind}-embed-title`} className="form-control" value={embed.title || ''} onChange={event => updateEmbed('title', event.target.value)} /></div>
								<div className="form-group"><label className="form-label" htmlFor={`${messageKind}-embed-description`}>{copy.descriptionLabel}</label><textarea ref={editorRef} id={`${messageKind}-embed-description`} className="form-control" rows={6} value={embed.description || ''} onChange={event => updateEmbed('description', event.target.value)} /></div>
							</>
						) : (
							<div className="form-group"><label className="form-label" htmlFor={`${messageKind}-message-template`}>{copy.messageLabel}</label><textarea ref={editorRef} id={`${messageKind}-message-template`} className="form-control" rows={6} value={message} onChange={event => onChange(messageKey, event.target.value)} /></div>
						)}

						<div className={styles.variables} aria-label={copy.insertVariable}>
							<span>{copy.insertVariable}</span>
							<div>{VARIABLES.map(variable => <button type="button" key={variable} onClick={() => insertVariable(variable)}>{variable}</button>)}</div>
						</div>

						{mode === 'embed' ? (
							<details className={styles.appearanceDetails}>
								<summary>{copy.appearance}</summary>
								<div className={styles.appearanceFields}>
									<div className="form-group">
										<label className="form-label" htmlFor={`${messageKind}-embed-color`}>{copy.accentColor}</label>
										<div className={styles.colorInputRow}><input id={`${messageKind}-embed-color`} type="color" value={embedColor} onChange={event => updateEmbed('color', event.target.value)} /><input className="form-control" value={embed.color || defaultEmbed.color} onChange={event => updateEmbed('color', event.target.value)} /></div>
										<div className={styles.colorSwatches}>{PRESET_COLORS.map(color => <button type="button" key={color} style={{ '--swatch': color }} aria-label={color} aria-pressed={String(embed.color || '').toLowerCase() === color} onClick={() => updateEmbed('color', color)} />)}</div>
									</div>
									<label className="form-group"><span className="form-label">{copy.thumbnailUrl}</span><input className="form-control" value={embed.thumbnailUrl || ''} onChange={event => updateEmbed('thumbnailUrl', event.target.value)} /></label>
									<label className="form-group"><span className="form-label">{copy.bannerUrl}</span><input className="form-control" value={embed.imageUrl || ''} onChange={event => updateEmbed('imageUrl', event.target.value)} /></label>
									<label className="form-group"><span className="form-label">{copy.footerText}</span><input className="form-control" value={embed.footerText || ''} onChange={event => updateEmbed('footerText', event.target.value)} /></label>
									<label className={styles.timestampChoice}><input type="checkbox" checked={embed.includeTimestamp !== false} onChange={event => updateEmbed('includeTimestamp', event.target.checked)} /><span>{copy.includeTimestamp}</span></label>
								</div>
							</details>
						) : null}
					</div>

					<MessagePreview embed={mode === 'embed' ? embed : null} message={message} serverName={serverName} leaving={leaving} copy={copy} />
				</div>
			</TabSection>
			</div>
		</TabWorkspace>
	);
}
