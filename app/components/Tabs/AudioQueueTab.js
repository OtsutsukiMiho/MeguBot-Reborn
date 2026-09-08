'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Volume2 } from 'lucide-react';
import { useCopy } from '../../copy';
import CustomSelect from '../CustomSelect.js';
import {
	TabActionBar,
	TabConfirmDialog,
	TabDialog,
	TabEmpty,
	TabFieldMessage,
	TabFilterBar,
	TabInlineActions,
	TabLocalTabs,
	TabNotice,
	TabPagination,
	TabSection,
	TabSkeleton,
	TabStatus,
	TabTable,
	TabWorkspace,
} from './TabWorkspace';
import styles from './AudioQueueTab.module.css';

const SOUND_PRESETS = ['ball_megu', 'lingangu', 'megatron', 'megu_racist', 'momoi', 'phone', 'smort', 'viktor', 'wolf', 'spinning_cat'];

const TTS_VOICES = [
	{ value: 'th-TH-NiwatNeural', name: 'Niwat', gender: 'male', language: 'thai' },
	{ value: 'th-TH-PremwadeeNeural', name: 'Premwadee', gender: 'female', language: 'thai' },
	{ value: 'en-US-GuyNeural', name: 'Guy', gender: 'male', language: 'english' },
	{ value: 'en-US-JennyNeural', name: 'Jenny', gender: 'female', language: 'english' },
	{ value: 'ja-JP-NanamiNeural', name: 'Nanami', gender: 'female', language: 'japanese' },
];

const INITIAL_DRAFT = {
	text: '',
	engine: 'EDGE_TTS',
	voice: 'th-TH-NiwatNeural',
	sound: 'ball_megu',
	senderName: '',
};

function formatEngine(engine, voice, copy) {
	if (engine === 'AUDIO_MP3') return copy.soundType;
	if (engine === 'EDGE_TTS') return voice?.split('-')?.[2]?.replace('Neural', '') || copy.neuralVoice;
	if (engine === 'GOOGLE_TTS') return copy.googleVoice;
	return engine || copy.unknownType;
}

function statusTone(status) {
	if (status === 'PLAYING') return 'warning';
	if (status === 'COMPLETED') return 'success';
	if (status === 'ENQUEUED') return 'accent';
	if (status === 'ERROR' || status === 'REMOVED') return 'danger';
	return 'neutral';
}

async function readResponse(response) {
	return response.json().catch(() => ({}));
}

export default function AudioQueueTab({ guildId, showToast, draft = {}, onDraftChange }) {
	const { t, fmt } = useCopy();
	const copy = t.serverTabs.audio;
	const shared = t.serverTabs.shared;
	const soundOptions = SOUND_PRESETS.map(value => ({ value, label: copy.soundNames[value], subtitle: `sounds/${value}.mp3` }));
	const ttsVoiceOptions = TTS_VOICES.map(voice => ({ value: voice.value, label: copy.voiceOption(voice.name, copy.genders[voice.gender], copy.languages[voice.language]), subtitle: copy.edgeVoice }));
	const ttsEngineOptions = [{ value: 'EDGE_TTS', label: 'Microsoft Edge Neural TTS', subtitle: copy.edgeVoice }, { value: 'GOOGLE_TTS', label: 'Google Standard TTS', subtitle: copy.fallbackVoice }];
	const values = { ...INITIAL_DRAFT, ...draft };
	const updateDraft = patch => onDraftChange?.({ ...values, ...patch, _submitted: false });

	const [view, setView] = useState('queue');
	const [queueData, setQueueData] = useState(null);
	const [audioLogs, setAudioLogs] = useState([]);
	const [queueLoading, setQueueLoading] = useState(true);
	const [historyLoading, setHistoryLoading] = useState(true);
	const [queueError, setQueueError] = useState('');
	const [historyError, setHistoryError] = useState('');
	const [audioStatusFilter, setAudioStatusFilter] = useState('ALL');
	const [audioSearch, setAudioSearch] = useState('');
	const [audioPage, setAudioPage] = useState(1);
	const [showTtsDialog, setShowTtsDialog] = useState(false);
	const [showSoundDialog, setShowSoundDialog] = useState(false);
	const [showClearConfirm, setShowClearConfirm] = useState(false);
	const [actionLoading, setActionLoading] = useState('');
	const [editorError, setEditorError] = useState('');
	const audioPageSize = 10;

	const fetchQueue = useCallback(async () => {
		try {
			const response = await fetch(`/api/guilds/${guildId}/audio-queue`);
			const data = await readResponse(response);
			if (!response.ok || !data.success || !data.queue) throw new Error(data.error || copy.queueLoadError);
			setQueueData(data.queue);
			setQueueError('');
		} catch (error) {
			setQueueError(error.message || copy.queueLoadError);
		} finally {
			setQueueLoading(false);
		}
	}, [copy.queueLoadError, guildId]);

	const fetchAudioLogs = useCallback(async () => {
		try {
			const response = await fetch(`/api/guilds/${guildId}/audio-logs?limit=100&status=${audioStatusFilter}&search=${encodeURIComponent(audioSearch)}`);
			const data = await readResponse(response);
			if (!response.ok || !data.success || !Array.isArray(data.logs)) throw new Error(data.error || copy.historyLoadError);
			setAudioLogs(data.logs);
			setHistoryError('');
		} catch (error) {
			setHistoryError(error.message || copy.historyLoadError);
		} finally {
			setHistoryLoading(false);
		}
	}, [audioSearch, audioStatusFilter, copy.historyLoadError, guildId]);

	useEffect(() => {
		setQueueLoading(true);
		setHistoryLoading(true);
		fetchQueue();
		fetchAudioLogs();
		const interval = setInterval(() => {
			fetchQueue();
			fetchAudioLogs();
		}, 3000);
		return () => clearInterval(interval);
	}, [fetchAudioLogs, fetchQueue]);

	useEffect(() => setAudioPage(1), [audioSearch, audioStatusFilter]);

	const performQueueAction = async (action, body, successMessage, failureMessage) => {
		setActionLoading(action);
		try {
			const response = await fetch(`/api/guilds/${guildId}/audio-queue/${action}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				...(body ? { body: JSON.stringify(body) } : {}),
			});
			const data = await readResponse(response);
			if (!response.ok || !data.success) throw new Error(data.error || failureMessage);
			showToast(data.message || successMessage);
			await Promise.all([fetchQueue(), fetchAudioLogs()]);
			return true;
		} catch (error) {
			showToast(error.message || failureMessage, true);
			return false;
		} finally {
			setActionLoading('');
		}
	};

	const handleClear = async () => {
		const success = await performQueueAction('clear', null, copy.clearSuccess, copy.clearError);
		if (success) setShowClearConfirm(false);
	};

	const handleInjectTts = async event => {
		event.preventDefault();
		if (!values.text.trim()) {
			setEditorError(copy.textRequired);
			return;
		}
		setEditorError('');
		setActionLoading('inject-tts');
		try {
			const response = await fetch(`/api/guilds/${guildId}/audio-queue/inject`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: values.text.trim(), userName: values.senderName.trim() || 'Dashboard Admin', engine: values.engine, voice: values.engine === 'EDGE_TTS' ? values.voice : undefined }),
			});
			const data = await readResponse(response);
			if (!response.ok || !data.success) throw new Error(data.error || copy.addTtsError);
			showToast(data.message || copy.addTtsSuccess);
			onDraftChange?.({ ...values, text: '', _submitted: true });
			setShowTtsDialog(false);
			await Promise.all([fetchQueue(), fetchAudioLogs()]);
		} catch (error) {
			setEditorError(error.message || copy.addTtsError);
		} finally {
			setActionLoading('');
		}
	};

	const handleInjectSound = async event => {
		event.preventDefault();
		if (!values.sound) {
			setEditorError(copy.soundRequired);
			return;
		}
		setEditorError('');
		setActionLoading('inject-sound');
		try {
			const response = await fetch(`/api/guilds/${guildId}/audio-queue/inject`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sound: values.sound, userName: values.senderName.trim() || 'Dashboard Admin' }),
			});
			const data = await readResponse(response);
			if (!response.ok || !data.success) throw new Error(data.error || copy.addSoundError);
			showToast(data.message || copy.addSoundSuccess);
			onDraftChange?.({ ...values, _submitted: true });
			setShowSoundDialog(false);
			await Promise.all([fetchQueue(), fetchAudioLogs()]);
		} catch (error) {
			setEditorError(error.message || copy.addSoundError);
		} finally {
			setActionLoading('');
		}
	};

	const current = queueData?.currentItem;
	const items = Array.isArray(queueData?.items) ? queueData.items : [];
	const isPlaying = queueData?.playerState === 'playing' || queueData?.isBusy;
	const destination = queueData?.voiceChannelName || queueData?.channelName || '';
	const totalAudioPages = Math.max(1, Math.ceil(audioLogs.length / audioPageSize));
	const currentAudioPage = Math.min(audioPage, totalAudioPages);
	const start = (currentAudioPage - 1) * audioPageSize;
	const paginatedAudioLogs = useMemo(() => audioLogs.slice(start, start + audioPageSize), [audioLogs, start]);
	const statusOptions = [{ value: 'ALL', label: copy.all }, ...['PLAYING', 'COMPLETED', 'ENQUEUED', 'SKIPPED', 'REMOVED', 'ERROR', 'CLEARED'].map(value => ({ value, label: copy.statuses[value] }))];
	const tabs = [
		{ id: 'queue', label: copy.queueTab, meta: copy.waiting(items.length), tabId: 'audio-queue-tab', controls: 'audio-queue-panel' },
		{ id: 'history', label: copy.historyTab, meta: copy.events(audioLogs.length), tabId: 'audio-history-tab', controls: 'audio-history-panel' },
	];

	return (
		<TabWorkspace>
			<TabActionBar actions={<button type="button" className="btn btn-secondary" onClick={() => Promise.all([fetchQueue(), fetchAudioLogs()])} disabled={queueLoading || historyLoading}><RefreshCw size={16} aria-hidden="true" /> {shared.refresh}</button>}>
				<TabStatus tone={isPlaying ? 'warning' : 'neutral'}>{isPlaying ? copy.playing : copy.idleStatus}</TabStatus>
				<span>{destination ? copy.destination(destination) : copy.destinationUnknown}</span>
			</TabActionBar>

			<TabLocalTabs tabs={tabs} value={view} onChange={setView} label={copy.tabsLabel} />

			{view === 'queue' ? (
				<div id="audio-queue-panel" role="tabpanel" aria-labelledby="audio-queue-tab" className={styles.panel}>
					{queueError ? <TabNotice tone="warning" title={copy.queueLoadError} actions={<button type="button" className="btn btn-secondary btn-sm" onClick={fetchQueue}>{shared.retry}</button>}>{queueData ? copy.stale : queueError}</TabNotice> : null}
					{queueLoading && !queueData ? <TabSkeleton rows={5} label={copy.queueLoading} /> : <>
						<TabSection title={copy.nowPlaying} description={copy.nowPlayingDescription} actions={current ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => performQueueAction('skip', null, copy.skipSuccess, copy.skipError)} disabled={Boolean(actionLoading)}>{actionLoading === 'skip' ? shared.working : copy.skip}</button> : null}>
							{current ? <div className={styles.nowPlaying}><span className={styles.playingIcon} aria-hidden="true"><Volume2 size={19} /></span><div><strong>{current.text || copy.untitledAudio}</strong><span>{copy.requestedBy(current.userName || copy.system)} · {formatEngine(current.engine, current.voice, copy)}</span></div></div> : <TabEmpty title={copy.idle} description={copy.idleDescription} />}
						</TabSection>
						<TabSection title={copy.upcoming} description={copy.upcomingDescription} meta={<TabStatus tone={items.length ? 'accent' : 'neutral'}>{copy.waiting(items.length)}</TabStatus>} actions={items.length ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowClearConfirm(true)} disabled={Boolean(actionLoading)}>{copy.clear}</button> : null}>
							{items.length ? <ol className={styles.queueList}>{items.map((item, index) => <li key={item.id || `${item.text}-${index}`}><span className={styles.position}>{index + 1}</span><div><strong>{item.text || copy.untitledAudio}</strong><span>{copy.requestedBy(item.userName || copy.system)} · {formatEngine(item.engine, item.voice, copy)}</span></div><button type="button" className="btn btn-ghost btn-sm" onClick={() => performQueueAction('remove', { itemId: item.id }, copy.removeSuccess, copy.removeError)} disabled={Boolean(actionLoading)}>{shared.remove}</button></li>)}</ol> : <TabEmpty title={copy.emptyQueue} description={copy.emptyQueueDescription} />}
						</TabSection>
						<TabSection title={copy.addTitle} description={copy.addDescription} meta={<span className={styles.scope}>{copy.immediate}</span>}><TabInlineActions align="start"><button type="button" className="btn btn-primary" onClick={() => { setEditorError(''); setShowTtsDialog(true); }}>{copy.addTts}</button><button type="button" className="btn btn-secondary" onClick={() => { setEditorError(''); setShowSoundDialog(true); }}>{copy.addSound}</button></TabInlineActions></TabSection>
					</>}
				</div>
			) : (
				<div id="audio-history-panel" role="tabpanel" aria-labelledby="audio-history-tab" className={styles.panel}>
					<TabFilterBar actions={<button type="button" className="btn btn-secondary" onClick={fetchAudioLogs} disabled={historyLoading}><RefreshCw size={16} aria-hidden="true" /> {historyLoading ? shared.working : shared.refresh}</button>}>
						<div className="form-group"><label className="form-label" htmlFor="audio-history-search">{copy.search}</label><input id="audio-history-search" className="form-control" type="search" value={audioSearch} onChange={event => setAudioSearch(event.target.value)} placeholder={copy.searchPlaceholder} /></div>
						<div className="form-group"><label className="form-label">{copy.status}</label><CustomSelect ariaLabel={copy.status} value={audioStatusFilter} onChange={setAudioStatusFilter} options={statusOptions} searchable={false} /></div>
					</TabFilterBar>
					{historyError ? <TabNotice tone="warning" title={copy.historyLoadError} actions={<button type="button" className="btn btn-secondary btn-sm" onClick={fetchAudioLogs}>{shared.retry}</button>}>{audioLogs.length ? copy.stale : historyError}</TabNotice> : null}
					{historyLoading && !audioLogs.length ? <TabSkeleton rows={7} label={copy.historyLoading} /> : paginatedAudioLogs.length ? <><TabTable label={copy.historyTitle}><table><thead><tr><th>{copy.timestamp}</th><th>{copy.speaker}</th><th>{copy.status}</th><th>{copy.type}</th><th>{copy.content}</th></tr></thead><tbody>{paginatedAudioLogs.map((log, index) => <tr key={log.id || `${log.created_at}-${index}`}><td><time dateTime={log.created_at}>{fmt.when(log.created_at)}</time></td><td>{log.user_name || copy.system}</td><td><TabStatus tone={statusTone(log.status)}>{copy.statuses[log.status] || log.status}</TabStatus></td><td>{formatEngine(log.engine, log.voice, copy)}</td><td><span className={styles.logContent}>{log.text || copy.untitledAudio}</span>{log.error_message ? <TabFieldMessage tone="error">{log.error_message}</TabFieldMessage> : null}</td></tr>)}</tbody></table></TabTable><TabPagination page={currentAudioPage} totalPages={totalAudioPages} onPageChange={setAudioPage} summary={shared.showing(start + 1, Math.min(start + audioPageSize, audioLogs.length), audioLogs.length)} previousLabel={shared.previous} nextLabel={shared.next} /></> : <TabEmpty title={copy.noHistory} description={copy.noHistoryDescription} action={(audioSearch || audioStatusFilter !== 'ALL') ? <button type="button" className="btn btn-secondary" onClick={() => { setAudioSearch(''); setAudioStatusFilter('ALL'); }}>{shared.clearFilters}</button> : null} />}
				</div>
			)}

			<TabConfirmDialog open={showClearConfirm} onClose={() => setShowClearConfirm(false)} onConfirm={handleClear} title={copy.clearTitle} description={copy.clearDescription} confirmLabel={copy.clear} cancelLabel={shared.cancel} busy={actionLoading === 'clear'} busyLabel={shared.working} impactMessage={copy.immediate} />

			<TabDialog open={showTtsDialog} onClose={actionLoading ? undefined : () => setShowTtsDialog(false)} title={copy.ttsDialogTitle} description={destination ? copy.destination(destination) : copy.destinationUnknown} closeLabel={shared.closeDialog} footer={<><button type="button" className="btn btn-secondary" onClick={() => setShowTtsDialog(false)} disabled={Boolean(actionLoading)}>{shared.cancel}</button><button type="submit" form="audio-tts-form" className="btn btn-primary" disabled={Boolean(actionLoading)}>{actionLoading === 'inject-tts' ? shared.working : copy.enqueueTts}</button></>}>
				<form id="audio-tts-form" className={styles.form} onSubmit={handleInjectTts}>
					<div className="form-group"><label className="form-label" htmlFor="audio-tts-text">{copy.spokenText}</label><textarea id="audio-tts-text" className="form-control" rows="4" value={values.text} onChange={event => updateDraft({ text: event.target.value })} placeholder={copy.spokenTextPlaceholder} aria-describedby={editorError ? 'audio-tts-error' : undefined} /></div>
					<div className="form-group"><label className="form-label">{copy.engine}</label><CustomSelect ariaLabel={copy.engine} value={values.engine} onChange={engine => updateDraft({ engine })} options={ttsEngineOptions} searchable={false} /></div>
					{values.engine === 'EDGE_TTS' ? <div className="form-group"><label className="form-label">{copy.voice}</label><CustomSelect ariaLabel={copy.voice} value={values.voice} onChange={voice => updateDraft({ voice })} options={ttsVoiceOptions} searchable /></div> : null}
					<div className="form-group"><label className="form-label" htmlFor="audio-tts-sender">{copy.sender}</label><input id="audio-tts-sender" className="form-control" value={values.senderName} onChange={event => updateDraft({ senderName: event.target.value })} placeholder={copy.senderPlaceholder} /></div>
					{editorError ? <TabFieldMessage id="audio-tts-error" tone="error">{editorError}</TabFieldMessage> : null}<TabFieldMessage>{copy.immediate}</TabFieldMessage>
				</form>
			</TabDialog>

			<TabDialog open={showSoundDialog} onClose={actionLoading ? undefined : () => setShowSoundDialog(false)} title={copy.soundDialogTitle} description={destination ? copy.destination(destination) : copy.destinationUnknown} closeLabel={shared.closeDialog} footer={<><button type="button" className="btn btn-secondary" onClick={() => setShowSoundDialog(false)} disabled={Boolean(actionLoading)}>{shared.cancel}</button><button type="submit" form="audio-sound-form" className="btn btn-primary" disabled={Boolean(actionLoading)}>{actionLoading === 'inject-sound' ? shared.working : copy.enqueueSound}</button></>}>
				<form id="audio-sound-form" className={styles.form} onSubmit={handleInjectSound}>
					<div className="form-group"><label className="form-label">{copy.soundPreset}</label><CustomSelect ariaLabel={copy.soundPreset} ariaDescribedBy={editorError ? 'audio-sound-error' : undefined} value={values.sound} onChange={sound => updateDraft({ sound })} options={soundOptions} searchable /></div>
					<div className="form-group"><label className="form-label" htmlFor="audio-sound-sender">{copy.sender}</label><input id="audio-sound-sender" className="form-control" value={values.senderName} onChange={event => updateDraft({ senderName: event.target.value })} placeholder={copy.senderPlaceholder} /></div>
					{editorError ? <TabFieldMessage id="audio-sound-error" tone="error">{editorError}</TabFieldMessage> : null}<TabFieldMessage>{copy.immediate}</TabFieldMessage>
				</form>
			</TabDialog>
		</TabWorkspace>
	);
}
