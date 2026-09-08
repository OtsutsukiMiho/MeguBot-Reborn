'use client';

import CustomSelect from '../CustomSelect';
import { useCopy } from '../../copy';
import { TabActionBar, TabFieldMessage, TabInlineActions, TabSection, TabSegmented, TabSettingRow, TabSettingsList, TabStatus, TabSwitch, TabWorkspace } from './TabWorkspace';

const DEFAULT_ROOM_GREETING = 'สวัสดีชาวโลก';
const DEFAULT_JOIN_MESSAGE = '{username} เข้าดิสมา';
const DEFAULT_LEAVE_MESSAGE = '{username} ออกจากดิสแล้ว';
const MESSAGE_VARIABLES = ['{displayname}', '{username}', '{nickname}', '{tag}', '{server}'];
const VOICES = [
	{ id: 'th-TH-NiwatNeural', labelKey: 'thaiMale', lang: 'th' },
	{ id: 'th-TH-PremwadeeNeural', labelKey: 'thaiFemale', lang: 'th' },
	{ id: 'en-US-JennyNeural', labelKey: 'englishFemale', lang: 'en' },
	{ id: 'en-US-ChristopherNeural', labelKey: 'englishMale', lang: 'en' },
	{ id: 'ja-JP-NanamiNeural', labelKey: 'japaneseFemale', lang: 'ja' },
	{ id: 'ko-KR-SunHiNeural', labelKey: 'koreanFemale', lang: 'ko' },
];

export default function VoiceTtsTab({ config, channels = [], onChange }) {
	const { t } = useCopy();
	const copy = t.serverTabs.tts;
	const shared = t.serverTabs.shared;
	const isGoogle = config.tts_engine === 'GOOGLE_TTS';
	const roomGreeting = config.tts_join_greeting_text ?? DEFAULT_ROOM_GREETING;
	const joinTemplate = config.tts_vc_welcome_template ?? DEFAULT_JOIN_MESSAGE;
	const leaveTemplate = config.tts_vc_leave_template ?? DEFAULT_LEAVE_MESSAGE;
	const channelOptions = [{ value: '', label: copy.disabled }, ...channels.map(channel => ({ value: channel.id, label: `# ${channel.name}`, subtitle: channel.parentName }))];
	const voiceOptions = VOICES.map(voice => ({ value: voice.id, label: copy.voices[voice.labelKey], subtitle: voice.lang.toUpperCase() }));

	const changeVoice = value => {
		const voice = VOICES.find(option => option.id === value);
		onChange('tts_voice', value);
		if (voice) onChange('tts_lang', voice.lang);
	};
	const append = (key, current, token) => onChange(key, `${current}${current.endsWith(' ') ? '' : ' '}${token}`);
	const variableButtons = (key, current, variables = MESSAGE_VARIABLES) => (
		<TabInlineActions align="start">
			{variables.map(token => <button key={token} type="button" className="btn btn-secondary btn-sm" onClick={() => append(key, current, token)}>{token}</button>)}
		</TabInlineActions>
	);

	return (
		<TabWorkspace>
			<TabActionBar actions={<TabStatus tone={config.tts_channel_id ? 'success' : 'neutral'}>{config.tts_channel_id ? copy.active || copy.channelLabel : copy.disabled}</TabStatus>}>
				<span>{copy.scope}</span>
			</TabActionBar>

			<TabSection title={copy.destinationTitle} description={copy.destinationDescription}>
				<TabSettingRow label={copy.channelLabel}>
					<CustomSelect type="channel" ariaLabel={copy.channelLabel} placeholder={copy.channelPlaceholder} value={config.tts_channel_id || ''} onChange={value => onChange('tts_channel_id', value || null)} options={channelOptions} unavailableLabel={shared.unavailableChannel(config.tts_channel_id)} />
				</TabSettingRow>
			</TabSection>

			<TabSection title={copy.voiceTitle} description={copy.voiceDescription}>
				<TabSettingsList>
					<TabSettingRow label={copy.engine}>
						<TabSegmented label={copy.engine} value={isGoogle ? 'GOOGLE_TTS' : 'EDGE_TTS'} onChange={value => onChange('tts_engine', value)} options={[{ value: 'EDGE_TTS', label: copy.edgeEngine }, { value: 'GOOGLE_TTS', label: copy.googleEngine }]} />
					</TabSettingRow>
					{!isGoogle ? <TabSettingRow label={copy.voiceLabel}><CustomSelect ariaLabel={copy.voiceLabel} placeholder={copy.voicePlaceholder} value={config.tts_voice || 'th-TH-NiwatNeural'} onChange={changeVoice} options={voiceOptions} /></TabSettingRow> : null}
				</TabSettingsList>
			</TabSection>

			<TabSection title={copy.greetingsTitle} description={copy.greetingsDescription}>
				<TabSettingsList>
					<TabSettingRow label={copy.roomGreeting} description={copy.roomGreetingHelp} control={<TabSwitch checked={config.tts_join_greeting_enabled === true} onChange={event => onChange('tts_join_greeting_enabled', event.target.checked)} label={copy.roomGreeting} />} />
					{config.tts_join_greeting_enabled === true ? <TabSettingRow label={copy.messageLabel} stacked><input id="tts-room-greeting" className="form-control" aria-label={copy.messageLabel} value={roomGreeting} maxLength={300} onChange={event => onChange('tts_join_greeting_text', event.target.value)} placeholder={DEFAULT_ROOM_GREETING} />{variableButtons('tts_join_greeting_text', roomGreeting, ['{server}', '{channel}'])}</TabSettingRow> : null}
					<TabSettingRow label={copy.afkBringback} description={copy.afkBringbackHelp} control={<TabSwitch checked={config.tts_afk_bringback_enabled !== false} onChange={event => onChange('tts_afk_bringback_enabled', event.target.checked)} label={copy.afkBringback} />} />
					<TabSettingRow label={copy.joinAnnouncement} description={copy.joinAnnouncementHelp} control={<TabSwitch checked={config.tts_vc_welcome_enabled !== false} onChange={event => onChange('tts_vc_welcome_enabled', event.target.checked)} label={copy.joinAnnouncement} />} />
					{config.tts_vc_welcome_enabled !== false ? <TabSettingRow label={copy.messageLabel} stacked><input className="form-control" aria-label={copy.joinAnnouncement} value={joinTemplate} onChange={event => onChange('tts_vc_welcome_template', event.target.value)} placeholder={DEFAULT_JOIN_MESSAGE} />{variableButtons('tts_vc_welcome_template', joinTemplate)}</TabSettingRow> : null}
					<TabSettingRow label={copy.leaveAnnouncement} description={copy.leaveAnnouncementHelp} control={<TabSwitch checked={config.tts_vc_leave_enabled !== false} onChange={event => onChange('tts_vc_leave_enabled', event.target.checked)} label={copy.leaveAnnouncement} />} />
					{config.tts_vc_leave_enabled !== false ? <TabSettingRow label={copy.messageLabel} stacked><input className="form-control" aria-label={copy.leaveAnnouncement} value={leaveTemplate} onChange={event => onChange('tts_vc_leave_template', event.target.value)} placeholder={DEFAULT_LEAVE_MESSAGE} />{variableButtons('tts_vc_leave_template', leaveTemplate)}</TabSettingRow> : null}
				</TabSettingsList>
			</TabSection>

			<TabSection title={copy.limitsTitle} description={copy.limitsDescription}>
				<TabSettingsList>
					<TabSettingRow label={copy.antiSpam} description={copy.antiSpamHelp} control={<TabSwitch checked={config.tts_antispam_enabled !== false} onChange={event => onChange('tts_antispam_enabled', event.target.checked)} label={copy.antiSpam} />} />
					{config.tts_antispam_enabled !== false ? (
						<>
							<TabSettingRow label={copy.burst} description={copy.burstHelp}><input type="number" className="form-control" aria-label={copy.burst} min={1} max={20} value={config.tts_antispam_max_messages || 3} onChange={event => onChange('tts_antispam_max_messages', Number.parseInt(event.target.value, 10))} /></TabSettingRow>
							<TabSettingRow label={copy.cooldown} description={copy.cooldownHelp}><input type="number" className="form-control" aria-label={copy.cooldown} min={5} max={300} value={config.tts_antispam_cooldown_seconds || 30} onChange={event => onChange('tts_antispam_cooldown_seconds', Number.parseInt(event.target.value, 10))} /><TabFieldMessage>{config.tts_antispam_cooldown_seconds || 30}s</TabFieldMessage></TabSettingRow>
						</>
					) : null}
					<TabSettingRow label={copy.characters} description={copy.charactersHelp(config.tts_max_length || 200)}><input type="number" className="form-control" aria-label={copy.characters} min={10} max={500} value={config.tts_max_length || 200} onChange={event => onChange('tts_max_length', Number.parseInt(event.target.value, 10))} /></TabSettingRow>
					<TabSettingRow label={copy.ignorePrefix} description={copy.ignorePrefixHelp} control={<TabSwitch checked={config.tts_ignore_prefix !== false} onChange={event => onChange('tts_ignore_prefix', event.target.checked)} label={copy.ignorePrefix} />} />
				</TabSettingsList>
			</TabSection>
		</TabWorkspace>
	);
}
