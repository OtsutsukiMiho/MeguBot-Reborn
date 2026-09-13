'use strict';

const { AudioPlayerStatus, StreamType, VoiceConnectionStatus, createAudioPlayer, createAudioResource } = require('@discordjs/voice');
const { EdgeTTS } = require('node-edge-tts');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { Transform } = require('node:stream');

const { BotLogs, COLOR } = require('./bot_functions.js');
const { YouTubeProvider, canonicalUrl } = require('./youtube_provider.js');

const SOURCE = Object.freeze({ TTS: 'TTS', AUDIO_MP3: 'AUDIO_MP3', YOUTUBE: 'YOUTUBE' });
const TERMINAL = new Set(['COMPLETED', 'SKIPPED', 'CLEARED', 'REMOVED', 'ERROR']);
const ttsInstancesMap = new Map();

function boundedNumber(value, fallback, min, max) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function getGoogleTtsUrl(text, lang = 'th') {
	return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob`;
}

function getTtsInstance(voice) {
	if (!ttsInstancesMap.has(voice)) ttsInstancesMap.set(voice, new EdgeTTS({ voice }));
	return ttsInstancesMap.get(voice);
}

function QueueLog(guildName, msg) {
	BotLogs('TTS', `${COLOR.gold}[${typeof guildName === 'string' ? guildName : 'Discord Server'}]${COLOR.reset} ${msg}`);
}

function generateUUID() {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let uuid = '';
	for (let i = 0; i < 10; i++) uuid += characters[Math.floor(Math.random() * characters.length)];
	return uuid;
}

function sourceFrom(options = {}) {
	if (options.source === SOURCE.YOUTUBE || options.type === SOURCE.YOUTUBE || options.engine === SOURCE.YOUTUBE) return SOURCE.YOUTUBE;
	if (options.source === SOURCE.AUDIO_MP3 || options.type === SOURCE.AUDIO_MP3 || options.engine === SOURCE.AUDIO_MP3 || options.file) return SOURCE.AUDIO_MP3;
	return SOURCE.TTS;
}

class AudioQueueManager extends EventEmitter {
	constructor(options = {}) {
		super();
		this.queues = new Map();
		this.players = new Map();
		this.active = new Map();
		this.lastAddedMap = new Map();
		this.busy = new Set();
		this.playerFactory = options.playerFactory || createAudioPlayer;
		this.resourceFactory = options.resourceFactory || createAudioResource;
		this.fetch = options.fetchImpl || globalThis.fetch;
		this.youtubeProvider = options.youtubeProvider || new YouTubeProvider();
		this.youtubeReady = options.youtubeReady === true;
		this.database = options.database;
		this.totalLimit = boundedNumber(options.totalLimit ?? process.env.MEGU_AUDIO_QUEUE_MAX_ITEMS, 100, 1, 500);
		this.youtubeGuildLimit = boundedNumber(options.youtubeGuildLimit ?? process.env.MEGU_YOUTUBE_GUILD_QUEUE_LIMIT, 20, 1, 100);
		this.youtubeUserLimit = boundedNumber(options.youtubeUserLimit ?? process.env.MEGU_YOUTUBE_USER_QUEUE_LIMIT, 3, 1, 25);
		this.youtubeDurationLimit = boundedNumber(options.youtubeDurationLimit ?? process.env.MEGU_YOUTUBE_GUILD_DURATION_SECONDS, 3600, 60, 86400);
		this.preparationTimeoutMs = boundedNumber(options.preparationTimeoutMs ?? process.env.MEGU_AUDIO_PREPARATION_TIMEOUT_MS, 30000, 10, 120000);
		this.youtubeStreamInactivityMs = boundedNumber(options.youtubeStreamInactivityMs ?? process.env.MEGU_YOUTUBE_STREAM_INACTIVITY_MS, 20000, 10, 120000);
		this.voiceDisconnectGraceMs = boundedNumber(options.voiceDisconnectGraceMs ?? process.env.MEGU_AUDIO_VOICE_DISCONNECT_GRACE_MS, 5000, 10, 30000);
	}

	getQueue(guildId) {
		if (!this.queues.has(guildId)) this.queues.set(guildId, []);
		return this.queues.get(guildId);
	}

	getPlayer(guildId) {
		if (!this.players.has(guildId)) {
			const player = this.playerFactory();
			player.on('error', error => {
				QueueLog('Discord Server', `${COLOR.red}Audio player error in guild ${guildId}: ${error.message}`);
				const execution = this.active.get(guildId);
				if (execution) this.finishActive(guildId, execution.token, 'ERROR', error.message, { stop: false });
			});
			this.players.set(guildId, player);
		}
		return this.players.get(guildId);
	}

	canUseChannel(guildId, voiceChannelId) {
		const queue = this.getQueue(guildId);
		const ownedChannel = queue.find(item => item.voiceChannelId)?.voiceChannelId || this.active.get(guildId)?.voiceChannelId || null;
		return !ownedChannel || !voiceChannelId || String(ownedChannel) === String(voiceChannelId);
	}

	getAllQueues() {
		const list = [];
		for (const [guildId, queue] of this.queues.entries()) {
			if (!queue.length && !this.active.has(guildId)) continue;
			const player = this.players.get(guildId);
			const snapshot = item => item && ({
				id: item.id, text: item.text, title: item.title, source: item.source, state: item.state,
				canonicalUrl: item.canonicalUrl || null, durationSeconds: item.durationSeconds || null,
				requestedByUserId: item.requestedByUserId || null,
				userName: item.requestedByName || item.options?.userName || 'System',
				voiceChannelId: item.voiceChannelId || null, engine: item.options?.engine || item.source,
				voice: item.options?.voice || null, lang: item.options?.lang || null,
			});
			list.push({
				guildId, guildName: queue[0]?.guildName || 'Discord Server', playerState: player?.state?.status || 'idle',
				isBusy: this.active.has(guildId), queueLength: queue.length,
				currentItem: snapshot(queue[0]), items: queue.slice(1).map(snapshot),
			});
		}
		return list;
	}

	addToQueue(guildId, guildName, connection, text, options = {}) {
		const finalText = String(text || '').trim();
		const finalOptions = options || {};
		const source = sourceFrom(finalOptions);
		const voiceChannelId = String(finalOptions.voiceChannelId || connection?.joinConfig?.channelId || '');
		const requestedByUserId = String(finalOptions.requestedByUserId || '');
		const requestedByName = String(finalOptions.requestedByName || finalOptions.userName || 'System').slice(0, 100);
		if (!finalText) return { success: false, reason: 'INVALID_SOURCE' };
		if (!this.canUseChannel(guildId, voiceChannelId)) return { success: false, reason: 'CHANNEL_CONFLICT' };

		const queue = this.getQueue(guildId);
		if (queue.length >= this.totalLimit) return { success: false, reason: 'FULL' };
		let youtubeCanonicalUrl = null;
		if (source === SOURCE.YOUTUBE) {
			try { youtubeCanonicalUrl = canonicalUrl(finalOptions.videoId); }
			catch { return { success: false, reason: 'INVALID_SOURCE' }; }
			const youtubeItems = queue.filter(item => item.source === SOURCE.YOUTUBE);
			if (youtubeItems.length >= this.youtubeGuildLimit) return { success: false, reason: 'YOUTUBE_GUILD_LIMIT' };
			if (requestedByUserId && youtubeItems.filter(item => item.requestedByUserId === requestedByUserId).length >= this.youtubeUserLimit) return { success: false, reason: 'YOUTUBE_USER_LIMIT' };
			const durationSeconds = Number(finalOptions.durationSeconds);
			if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return { success: false, reason: 'INVALID_SOURCE' };
			if (youtubeItems.reduce((sum, item) => sum + (item.durationSeconds || 0), 0) + durationSeconds > this.youtubeDurationLimit) return { success: false, reason: 'YOUTUBE_DURATION_LIMIT' };
		}

		const dedupKey = `${guildId}:${source}:${requestedByUserId || requestedByName}:${finalOptions.videoId || finalText}`;
		const now = Date.now();
		const lastTime = this.lastAddedMap.get(dedupKey);
		if (lastTime && now - lastTime < 1500) return { success: false, reason: 'DUPLICATE' };
		this.lastAddedMap.set(dedupKey, now);
		if (this.lastAddedMap.size > 100) {
			for (const [key, timestamp] of this.lastAddedMap.entries()) if (now - timestamp > 5000) this.lastAddedMap.delete(key);
		}

		const item = {
			id: generateUUID(), guildId, guildName: String(guildName || 'Discord Server'), connection,
			voiceChannelId, requestedByUserId, requestedByName, source,
			text: finalText, title: String(finalOptions.title || finalText).slice(0, 200),
			canonicalUrl: youtubeCanonicalUrl, videoId: source === SOURCE.YOUTUBE ? finalOptions.videoId : null,
			durationSeconds: Number(finalOptions.durationSeconds) || null,
			enqueuedAt: new Date().toISOString(), state: 'QUEUED', options: finalOptions,
		};
		queue.push(item);
		QueueLog(item.guildName, `📥 Added ${source} to Queue [${requestedByName} - "${item.title}"] (Queue position: #${queue.length})`);
		this.persistEnqueue(item);
		if (queue.length === 1) void this.processNext(guildId);
		return { success: true, id: item.id, position: queue.length, item };
	}

	async processNext(guildId) {
		const queue = this.getQueue(guildId);
		if (!queue.length || this.active.has(guildId) || this.busy.has(guildId)) return;
		const item = queue[0];
		const token = generateUUID();
		const execution = {
			itemId: item.id, token, voiceChannelId: item.voiceChannelId, abortController: new AbortController(),
			finishing: false, preparationTimer: null, timer: null, streamTimer: null, connectionTimer: null, onIdle: null, onPlaying: null, dispose: null,
			audioPath: null, temporary: false, sourceStream: null, monitoredStream: null, onStreamError: null, onStreamEnd: null,
			onConnectionStateChange: null,
		};
		this.active.set(guildId, execution);
		this.busy.add(guildId);
		item.state = 'PREPARING';

		try {
			const prepared = await this.prepareWithTimeout(item, execution);
			if (!this.owns(guildId, token) || execution.abortController.signal.aborted) {
				this.cleanupPrepared(prepared);
				return;
			}
			execution.dispose = prepared.dispose || null;
			execution.audioPath = prepared.audioPath || null;
			execution.temporary = prepared.temporary === true;
			const playbackInput = item.source === SOURCE.YOUTUBE
				? this.monitorYouTubeStream(guildId, token, prepared.input, execution)
				: prepared.input;
			const resource = this.resourceFactory(playbackInput, { inlineVolume: true, inputType: prepared.inputType });
			if (resource.volume && typeof item.options?.volume === 'number') resource.volume.setVolume(item.options.volume);
			const player = this.getPlayer(guildId);
			execution.onIdle = () => this.finishActive(guildId, token, 'COMPLETED', null, { stop: false });
			execution.onPlaying = () => {
				if (!this.owns(guildId, token)) return;
				item.state = 'PLAYING';
				this.persistStatus(item, 'PLAYING');
			};
			player.once(AudioPlayerStatus.Idle, execution.onIdle);
			player.once(AudioPlayerStatus.Playing, execution.onPlaying);
			if (item.connection) {
				this.monitorConnection(guildId, token, item.connection, execution);
				item.connection.subscribe(player);
			}
			const timeoutMs = this.playbackTimeout(item);
			execution.timeoutMs = timeoutMs;
			execution.timer = setTimeout(() => this.finishActive(guildId, token, 'ERROR', 'playback_timeout', { stop: true }), timeoutMs);
			if (typeof execution.timer.unref === 'function') execution.timer.unref();
			player.play(resource);
			QueueLog(item.guildName, `▶️ Playing ${item.source}: "${item.title}" [${item.requestedByName}]`);
		}
		catch (error) {
			if (!this.owns(guildId, token)) return;
			QueueLog(item.guildName, `${COLOR.red}Failed to process ${item.source}: ${error.message}`);
			this.finishActive(guildId, token, 'ERROR', error.code || error.message, { stop: true });
		}
	}

	prepareWithTimeout(item, execution) {
		const signal = execution.abortController.signal;
		return new Promise((resolve, reject) => {
			let settled = false;
			const finish = (error, prepared) => {
				if (settled) {
					if (prepared) this.cleanupPrepared(prepared);
					return;
				}
				settled = true;
				if (execution.preparationTimer) clearTimeout(execution.preparationTimer);
				execution.preparationTimer = null;
				signal.removeEventListener('abort', onAbort);
				if (error) reject(error); else resolve(prepared);
			};
			const onAbort = () => finish(Object.assign(new Error('Audio preparation cancelled.'), { code: 'audio_preparation_cancelled' }));
			if (signal.aborted) return onAbort();
			signal.addEventListener('abort', onAbort, { once: true });
			execution.preparationTimer = setTimeout(() => {
				finish(Object.assign(new Error('Audio preparation timed out.'), { code: 'audio_preparation_timeout' }));
				execution.abortController.abort();
			}, this.preparationTimeoutMs);
			if (typeof execution.preparationTimer.unref === 'function') execution.preparationTimer.unref();
			let preparation;
			try { preparation = this.prepareItem(item, signal); }
			catch (error) { finish(error); return; }
			Promise.resolve(preparation).then(prepared => finish(null, prepared), error => finish(error));
		});
	}

	cleanupPrepared(prepared) {
		try { prepared?.dispose?.(); }
		catch {
			// Provider disposal must not prevent temporary-file cleanup.
		}
		if (prepared?.temporary && prepared.audioPath) {
			try { if (fs.existsSync(prepared.audioPath)) fs.unlinkSync(prepared.audioPath); }
			catch {
				// A stale temp file is safer than stalling the queue.
			}
		}
	}

	async prepareItem(item, signal) {
		if (item.source === SOURCE.YOUTUBE) {
			const opened = await this.youtubeProvider.openAudio(item.videoId, signal);
			return { input: opened.stream, inputType: StreamType.Arbitrary, dispose: opened.dispose };
		}
		if (item.source === SOURCE.AUDIO_MP3) {
			if (!item.options?.file || !fs.existsSync(item.options.file)) throw Object.assign(new Error('Audio file was not found.'), { code: 'audio_file_missing' });
			return { input: item.options.file, inputType: StreamType.Arbitrary };
		}

		const tempDir = path.join(__dirname, '../../temp');
		if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
		const audioPath = path.join(tempDir, `tts_${Date.now()}_${item.id}.mp3`);
		const engine = item.options?.engine || 'EDGE_TTS';
		if (engine === 'EDGE_TTS') {
			await getTtsInstance(item.options?.voice || 'th-TH-NiwatNeural').ttsPromise(item.text, audioPath);
		}
		else {
			const response = await this.fetch(getGoogleTtsUrl(item.text, item.options?.lang || 'th'), {
				signal,
				headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' },
			});
			if (!response.ok) throw Object.assign(new Error(`Google TTS returned ${response.status}.`), { code: 'tts_fetch_failed' });
			fs.writeFileSync(audioPath, Buffer.from(await response.arrayBuffer()));
		}
		return { input: audioPath, inputType: StreamType.Arbitrary, audioPath, temporary: true };
	}

	playbackTimeout(item) {
		if (item.source === SOURCE.YOUTUBE) return (Math.max(1, item.durationSeconds || 1) + 45) * 1000;
		if (item.source === SOURCE.AUDIO_MP3) return boundedNumber(process.env.MEGU_AUDIO_FILE_TIMEOUT_MS, 300000, 30000, 1800000);
		return Math.min(Math.max(8000, item.text.length * 350), 30000);
	}

	monitorYouTubeStream(guildId, token, input, execution) {
		if (!input || typeof input.pipe !== 'function') return input;
		const refresh = () => {
			if (!this.owns(guildId, token)) return;
			if (execution.streamTimer) clearTimeout(execution.streamTimer);
			execution.streamTimer = setTimeout(
				() => this.finishActive(guildId, token, 'ERROR', 'stream_inactivity', { stop: true }),
				this.youtubeStreamInactivityMs,
			);
			if (typeof execution.streamTimer.unref === 'function') execution.streamTimer.unref();
		};
		const monitored = new Transform({
			transform(chunk, encoding, callback) {
				refresh();
				callback(null, chunk);
			},
		});
		execution.sourceStream = input;
		execution.monitoredStream = monitored;
		execution.onStreamError = error => this.finishActive(guildId, token, 'ERROR', error?.code || 'youtube_stream_failed', { stop: true });
		execution.onStreamEnd = () => {
			if (execution.streamTimer) clearTimeout(execution.streamTimer);
			execution.streamTimer = null;
		};
		input.once('error', execution.onStreamError);
		input.once('end', execution.onStreamEnd);
		input.pipe(monitored);
		refresh();
		return monitored;
	}

	monitorConnection(guildId, token, connection, execution) {
		if (!connection || typeof connection.on !== 'function') return;
		execution.onConnectionStateChange = (oldState, newState) => {
			const status = newState?.status;
			if (status === VoiceConnectionStatus.Ready) {
				if (execution.connectionTimer) clearTimeout(execution.connectionTimer);
				execution.connectionTimer = null;
				return;
			}
			if (status === VoiceConnectionStatus.Destroyed) {
				this.finishActive(guildId, token, 'ERROR', 'voice_connection_destroyed', { stop: true });
				return;
			}
			if (status !== VoiceConnectionStatus.Disconnected || execution.connectionTimer) return;
			execution.connectionTimer = setTimeout(() => {
				if (connection.state?.status === VoiceConnectionStatus.Disconnected) {
					this.finishActive(guildId, token, 'ERROR', 'voice_connection_lost', { stop: true });
				}
			}, this.voiceDisconnectGraceMs);
			if (typeof execution.connectionTimer.unref === 'function') execution.connectionTimer.unref();
		};
		connection.on('stateChange', execution.onConnectionStateChange);
	}

	owns(guildId, token) {
		return this.active.get(guildId)?.token === token;
	}

	finishActive(guildId, token, status, errorMessage = null, options = {}) {
		const execution = this.active.get(guildId);
		if (!execution || execution.token !== token || execution.finishing) return false;
		execution.finishing = true;
		const queue = this.getQueue(guildId);
		const item = queue[0]?.id === execution.itemId ? queue[0] : null;
		if (execution.preparationTimer) clearTimeout(execution.preparationTimer);
		if (execution.timer) clearTimeout(execution.timer);
		if (execution.streamTimer) clearTimeout(execution.streamTimer);
		if (execution.connectionTimer) clearTimeout(execution.connectionTimer);
		const player = this.players.get(guildId);
		if (player && execution.onIdle) player.removeListener(AudioPlayerStatus.Idle, execution.onIdle);
		if (player && execution.onPlaying) player.removeListener(AudioPlayerStatus.Playing, execution.onPlaying);
		if (execution.sourceStream && execution.onStreamError) execution.sourceStream.removeListener('error', execution.onStreamError);
		if (execution.sourceStream && execution.onStreamEnd) execution.sourceStream.removeListener('end', execution.onStreamEnd);
		if (item?.connection && execution.onConnectionStateChange) item.connection.removeListener('stateChange', execution.onConnectionStateChange);
		try { execution.sourceStream?.unpipe(execution.monitoredStream); }
		catch {
			// Best-effort stream cleanup.
		}
		try { execution.monitoredStream?.destroy(); }
		catch {
			// Best-effort stream cleanup.
		}
		try { execution.abortController.abort(); }
		catch {
			// The active execution may already be aborted.
		}
		this.cleanupPrepared(execution);
		if (options.stop && player) {
			try { player.stop(true); }
			catch {
				// The player may already be idle or destroyed.
			}
		}
		if (item) {
			item.state = TERMINAL.has(status) ? status : 'ERROR';
			this.persistStatus(item, item.state, errorMessage);
			queue.shift();
		}
		this.active.delete(guildId);
		this.busy.delete(guildId);
		if (options.startNext !== false && queue.length) queueMicrotask(() => void this.processNext(guildId));
		return true;
	}

	skipCurrent(guildId) {
		const queue = this.getQueue(guildId);
		if (!queue.length) return false;
		const current = queue[0];
		QueueLog(current.guildName, `${COLOR.yellow}⏭️ Skipped: "${current.title}"`);
		const execution = this.active.get(guildId);
		if (execution) return this.finishActive(guildId, execution.token, 'SKIPPED', null, { stop: true });
		current.state = 'SKIPPED';
		this.persistStatus(current, 'SKIPPED');
		queue.shift();
		if (queue.length) queueMicrotask(() => void this.processNext(guildId));
		return true;
	}

	removeItem(guildId, itemId) {
		const queue = this.getQueue(guildId);
		const index = queue.findIndex(item => item.id === itemId);
		if (index === -1) return false;
		if (index === 0) return this.skipCurrent(guildId);
		const [item] = queue.splice(index, 1);
		item.state = 'REMOVED';
		this.persistStatus(item, 'REMOVED');
		QueueLog(item.guildName, `${COLOR.red}🗑️ Removed item #${index + 1}: "${item.title}"`);
		return true;
	}

	clearQueue(guildId) {
		const queue = this.getQueue(guildId);
		const count = queue.length;
		if (!count) return 0;
		const guildName = queue[0]?.guildName || 'Discord Server';
		const execution = this.active.get(guildId);
		if (execution) this.finishActive(guildId, execution.token, 'CLEARED', null, { stop: true, startNext: false });
		for (const item of queue) {
			item.state = 'CLEARED';
			this.persistStatus(item, 'CLEARED');
		}
		queue.splice(0, queue.length);
		this.busy.delete(guildId);
		QueueLog(guildName, `${COLOR.red}🧹 Cleared entire audio queue (${count} items dropped).`);
		return count;
	}

	clearAllQueues() {
		let count = 0;
		for (const guildId of [...this.queues.keys()]) count += this.clearQueue(guildId);
		return count;
	}

	persistEnqueue(item) {
		const database = this.resolveDatabase();
		if (!database?.logAudioEvent) return;
		try {
			Promise.resolve(database.logAudioEvent({
				itemId: item.id, guildId: item.guildId, guildName: item.guildName,
				userName: item.requestedByName, text: item.text, engine: item.options?.engine || item.source,
				voice: item.options?.voice || null, lang: item.options?.lang || null, status: 'ENQUEUED',
			})).catch(() => undefined);
		}
		catch {
			// Playback must remain available when audit logging is unavailable.
		}
	}

	persistStatus(item, status, errorMessage = null) {
		const database = this.resolveDatabase();
		if (!database?.updateAudioStatus) return;
		try {
			Promise.resolve(database.updateAudioStatus(item.id, status, errorMessage)).catch(() => undefined);
		}
		catch {
			// Queue finalization must not depend on audit logging.
		}
	}

	resolveDatabase() {
		if (this.database !== undefined) return this.database;
		try { this.database = require('../database/database.js'); }
		catch { this.database = null; }
		return this.database;
	}
}

const audioQueueManager = new AudioQueueManager();

function normalizeObjectEntry(entry) {
	const type = entry.type === 'AUDIO_MP3' ? SOURCE.AUDIO_MP3 : entry.type === 'YOUTUBE' ? SOURCE.YOUTUBE : SOURCE.TTS;
	return {
		userName: entry.sender?.username || entry.sender?.tag || entry.userName || 'System',
		requestedByName: entry.sender?.username || entry.sender?.tag || entry.userName || 'System',
		requestedByUserId: entry.sender?.id || entry.requestedByUserId || '',
		voiceChannelId: entry.voice_channel?.id || entry.voiceChannelId || entry.connection?.joinConfig?.channelId || '',
		engine: type === SOURCE.TTS ? (entry.type === 'GOOGLE_TTS' ? 'GOOGLE_TTS' : entry.engine || 'EDGE_TTS') : type,
		type, source: type, file: entry.file || null, volume: typeof entry.volume === 'number' ? entry.volume : 0.5,
		lang: entry.lang || 'th', voice: entry.voice || 'th-TH-NiwatNeural',
		videoId: entry.videoId || null, canonicalUrl: entry.canonicalUrl || null,
		durationSeconds: entry.durationSeconds || null, title: entry.title || entry.name || entry.text || '',
	};
}

function addToQueue(guildId, guildName, connection, text, options = {}) {
	if (typeof guildName === 'object' && guildName !== null) {
		const entry = guildName;
		const name = entry.guild ? (typeof entry.guild === 'string' ? entry.guild : entry.guild.name) : 'Discord Server';
		return audioQueueManager.addToQueue(guildId, name, entry.connection, entry.name || entry.text || '', normalizeObjectEntry(entry));
	}
	return audioQueueManager.addToQueue(guildId, guildName, connection, text, options);
}

function clearQueue(guildId) { return audioQueueManager.clearQueue(guildId); }

module.exports = { AudioQueueManager, SOURCE, audioQueueManager, addToQueue, clearQueue, generateUUID };
