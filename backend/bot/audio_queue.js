const { createAudioPlayer, createAudioResource } = require('@discordjs/voice');
const { EdgeTTS } = require('node-edge-tts');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const { BotLogs, COLOR } = require('./bot_functions.js');

const ttsInstancesMap = new Map();

function getGoogleTtsUrl(text, lang = 'th') {
	return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob`;
}

function getTtsInstance(voice) {
	if (!ttsInstancesMap.has(voice)) {
		ttsInstancesMap.set(voice, new EdgeTTS({ voice }));
	}
	return ttsInstancesMap.get(voice);
}

function QueueLog(guildName, msg) {
	const name = typeof guildName === 'string' ? guildName : 'Discord Server';
	BotLogs('TTS', `${COLOR.gold}[${name}]${COLOR.reset} ${msg}`);
}

function generateUUID() {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let uuid = '';
	for (let i = 0; i < 10; i++) {
		const randomIndex = Math.floor(Math.random() * characters.length);
		uuid += characters[randomIndex];
	}
	return uuid;
}

class AudioQueueManager extends EventEmitter {
	constructor() {
		super();
		this.queues = new Map();
		this.players = new Map();
		this.lastAddedMap = new Map();
		this.busy = new Set();
	}

	getQueue(guildId) {
		if (!this.queues.has(guildId)) {
			this.queues.set(guildId, []);
		}
		return this.queues.get(guildId);
	}

	getPlayer(guildId) {
		if (!this.players.has(guildId)) {
			const player = createAudioPlayer();

			player.on('error', error => {
				BotLogs('TTS', `${COLOR.red}Audio player error in guild ${guildId}: ${error.message}`);
			});
			this.players.set(guildId, player);
		}
		return this.players.get(guildId);
	}

	getAllQueues() {
		const list = [];
		for (const [guildId, queue] of this.queues.entries()) {
			const player = this.players.get(guildId);
			const playerState = player ? (player.state ? player.state.status : 'idle') : 'idle';
			const isBusy = this.busy.has(guildId);

			if ((!queue || queue.length === 0) && playerState === 'idle') {
				continue;
			}

			const current = (queue && queue.length > 0) ? queue[0] : null;
			const upcoming = (queue && queue.length > 1) ? queue.slice(1) : [];

			list.push({
				guildId,
				guildName: current ? current.guildName : 'Discord Server',
				playerState,
				isBusy,
				queueLength: queue ? queue.length : 0,
				currentItem: current ? {
					id: current.id,
					text: current.text,
					userName: current.options?.userName || 'System',
					engine: current.options?.engine || 'EDGE_TTS',
					voice: current.options?.voice || 'th-TH-NiwatNeural',
					lang: current.options?.lang || 'th',
				} : null,
				items: upcoming.map(item => ({
					id: item.id,
					text: item.text,
					userName: item.options?.userName || 'System',
					engine: item.options?.engine || 'EDGE_TTS',
					voice: item.options?.voice || 'th-TH-NiwatNeural',
					lang: item.options?.lang || 'th',
				})),
			});
		}
		return list;
	}

	skipCurrent(guildId) {
		const queue = this.getQueue(guildId);
		if (queue.length === 0) return false;
		const current = queue[0];
		const guildName = current?.guildName || 'Discord Server';

		current.status = 'SKIPPED';
		QueueLog(guildName, `${COLOR.yellow}⏭️ Force Skipped current audio clip: "${current ? current.text : 'Unknown'}"`);

		if (this.players.has(guildId)) {
			const player = this.players.get(guildId);
			try {
				player.stop();
			}
			catch {}
		}

		try {
			const database = require('../database/database.js');
			if (database?.updateAudioStatus) database.updateAudioStatus(current.id, 'SKIPPED').catch(() => undefined);
		}
		catch {}

		this.busy.delete(guildId);
		queue.shift();
		if (queue.length > 0) {
			this.processNext(guildId);
		}
		return true;
	}

	removeItem(guildId, itemId) {
		const queue = this.getQueue(guildId);
		const index = queue.findIndex(item => item.id === itemId);
		if (index === -1) return false;

		const targetItem = queue[index];
		const guildName = targetItem?.guildName || 'Discord Server';

		if (index === 0) {
			return this.skipCurrent(guildId);
		}

		targetItem.status = 'REMOVED';
		try {
			const database = require('../database/database.js');
			if (database?.updateAudioStatus) database.updateAudioStatus(targetItem.id, 'REMOVED').catch(() => undefined);
		}
		catch {}

		queue.splice(index, 1);
		QueueLog(guildName, `${COLOR.red}🗑️ Force Removed item #${index + 1} from queue: "${targetItem.text}"`);
		return true;
	}

	async addToQueue(guildId, guildName, connection, text, options = {}) {
		let finalGuildName = guildName;
		let finalConnection = connection;
		let finalText = text;
		let finalOptions = options || {};

		if (typeof guildName === 'object' && guildName !== null) {
			const entry = guildName;
			finalGuildName = entry.guild ? (typeof entry.guild === 'string' ? entry.guild : entry.guild.name) : 'Discord Server';
			finalConnection = entry.connection;
			finalText = entry.name || entry.text || '';
			finalOptions = {
				userName: entry.sender ? (entry.sender.username || entry.sender.tag) : (entry.userName || 'System'),
				engine: entry.type === 'AUDIO_MP3' ? 'AUDIO_MP3' : (entry.type === 'GOOGLE_TTS' ? 'GOOGLE_TTS' : (entry.engine || 'EDGE_TTS')),
				type: entry.type || 'TTS',
				file: entry.file || null,
				volume: typeof entry.volume === 'number' ? entry.volume : 0.5,
				lang: entry.lang || 'th',
				voice: entry.voice || 'th-TH-NiwatNeural',
			};
		}

		if (typeof finalText !== 'string') {
			finalText = String(finalText || '');
		}

		// Deduplication check (prevent duplicate messages within 1.5 seconds)
		const dedupKey = `${guildId}:${finalOptions.userName || ''}:${finalText}`;
		const now = Date.now();
		if (this.lastAddedMap.has(dedupKey)) {
			const lastTime = this.lastAddedMap.get(dedupKey);
			if (now - lastTime < 1500) {
				return null; // Duplicate dropped cleanly
			}
		}
		this.lastAddedMap.set(dedupKey, now);

		// Clean old dedup keys periodically
		if (this.lastAddedMap.size > 100) {
			for (const [k, v] of this.lastAddedMap.entries()) {
				if (now - v > 5000) this.lastAddedMap.delete(k);
			}
		}

		const queue = this.getQueue(guildId);
		const id = generateUUID();
		const item = {
			id,
			text: finalText,
			options: finalOptions,
			guildName: typeof finalGuildName === 'string' ? finalGuildName : 'Discord Server',
			connection: finalConnection,
		};
		queue.push(item);
		const queueLabel = finalOptions.type === 'AUDIO_MP3' ? 'Audio MP3' : 'TTS';
		QueueLog(item.guildName, `📥 Added ${queueLabel} to Queue [${finalOptions.userName || 'System'} (${finalOptions.engine || 'EDGE_TTS'}) - "${finalText}"] (Queue position: #${queue.length})`);

		try {
			const database = require('../database/database.js');
			if (database?.logAudioEvent) {
				database.logAudioEvent({
					itemId: id,
					guildId,
					guildName: item.guildName,
					userName: finalOptions.userName,
					text: finalText,
					engine: finalOptions.engine,
					voice: finalOptions.voice,
					lang: finalOptions.lang,
					status: 'ENQUEUED',
				}).catch(() => undefined);
			}
		}
		catch {}

		if (queue.length === 1) {
			this.processNext(guildId);
		}
		return id;
	}

	async processNext(guildId) {
		const queue = this.getQueue(guildId);
		if (queue.length === 0) return;
		if (this.busy.has(guildId)) return;
		this.busy.add(guildId);

		const currentItem = queue[0];
		const player = this.getPlayer(guildId);

		let finished = false;
		let safetyTimer = null;
		let audioPath = null;
		let isTempFile = false;

		const advance = (finalStatus = 'COMPLETED', errorMsg = null) => {
			if (finished) return;
			finished = true;
			if (safetyTimer) {
				clearTimeout(safetyTimer);
				safetyTimer = null;
			}
			if (isTempFile) {
				try {
					if (audioPath && fs.existsSync(audioPath)) {
						fs.unlinkSync(audioPath);
					}
				}
				catch {}
			}
			const resolvedStatus = currentItem.status || finalStatus || 'COMPLETED';
			try {
				const database = require('../database/database.js');
				if (database?.updateAudioStatus) {
					database.updateAudioStatus(currentItem.id, resolvedStatus, errorMsg).catch(() => undefined);
				}
			}
			catch {}
			this.busy.delete(guildId);
			queue.shift();
			if (queue.length > 0) {
				this.processNext(guildId);
			}
		};

		try {
			const isMp3 = currentItem.options?.type === 'AUDIO_MP3' || currentItem.options?.engine === 'AUDIO_MP3' || !!currentItem.options?.file;

			if (isMp3 && currentItem.options?.file && fs.existsSync(currentItem.options.file)) {
				audioPath = currentItem.options.file;
				isTempFile = false;
			}
			else {
				const tempDir = path.join(__dirname, '../../temp');
				if (!fs.existsSync(tempDir)) {
					fs.mkdirSync(tempDir, { recursive: true });
				}

				const filename = `tts_${Date.now()}_${currentItem.id}.mp3`;
				audioPath = path.join(tempDir, filename);
				isTempFile = true;

				const engine = currentItem.options.engine || 'EDGE_TTS';
				const lang = currentItem.options.lang || 'th';
				const voice = currentItem.options.voice || 'th-TH-NiwatNeural';

				if (engine === 'EDGE_TTS') {
					const tts = getTtsInstance(voice);
					await tts.ttsPromise(currentItem.text, audioPath);
				}
				else {
					const url = getGoogleTtsUrl(currentItem.text, lang);
					const response = await fetch(url, {
						headers: {
							'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
						},
					});
					const buffer = Buffer.from(await response.arrayBuffer());
					fs.writeFileSync(audioPath, buffer);
				}
			}

			const resource = createAudioResource(audioPath, { inlineVolume: true });
			if (currentItem.options?.volume && resource.volume) {
				resource.volume.setVolume(currentItem.options.volume);
			}

			if (currentItem.connection) {
				currentItem.connection.subscribe(player);
			}

			try {
				const database = require('../database/database.js');
				if (database?.updateAudioStatus) {
					database.updateAudioStatus(currentItem.id, 'PLAYING').catch(() => undefined);
				}
			}
			catch {}

			player.play(resource);
			const playLabel = isMp3 ? `🎵 Playing Audio MP3: "${currentItem.text}"` : `▶️ Playing TTS: "${currentItem.text}"`;
			QueueLog(currentItem.guildName, `${playLabel} [${currentItem.options.userName || 'System'}]`);

			// Safety timeout: 60s for MP3 sound, max 30s for TTS
			const estimatedMs = isMp3 ? 60000 : Math.min(Math.max(8000, (currentItem.text ? currentItem.text.length : 10) * 350), 30000);
			safetyTimer = setTimeout(() => {
				advance('COMPLETED');
			}, estimatedMs);

			// Clean up file after playback completes
			player.once('idle', () => {
				advance('COMPLETED');
			});
		}
		catch (error) {
			BotLogs('TTS', `${COLOR.red}Failed to process audio ${COLOR.gray}(${currentItem.guildName})${COLOR.red}: ${error.message}`);
			advance('ERROR', error.message);
		}
	}

	clearQueue(guildId) {
		const queue = this.getQueue(guildId);
		const guildName = queue[0]?.guildName || 'Discord Server';
		const count = queue.length;

		if (queue && queue.length > 0) {
			try {
				const database = require('../database/database.js');
				if (database?.updateAudioStatus) {
					for (const it of queue) {
						it.status = 'CLEARED';
						database.updateAudioStatus(it.id, 'CLEARED').catch(() => undefined);
					}
				}
			}
			catch {}
		}

		if (this.queues.has(guildId)) {
			this.queues.set(guildId, []);
		}
		// Or the guild stays marked busy for a clip that will never finish, and
		// nothing it queues afterwards ever plays.
		this.busy.delete(guildId);
		if (this.players.has(guildId)) {
			const player = this.players.get(guildId);
			player.stop();
		}
		if (count > 0) {
			QueueLog(guildName, `${COLOR.red}🧹 Cleared entire audio queue (${count} clips dropped).`);
		}
	}
}

const audioQueueManager = new AudioQueueManager();

function addToQueue(guildId, guildName, connection, text, options = {}) {
	if (typeof guildName === 'object' && guildName !== null) {
		const entry = guildName;
		const gName = entry.guild ? (typeof entry.guild === 'string' ? entry.guild : entry.guild.name) : 'Discord Server';
		const opt = {
			userName: entry.sender ? (entry.sender.username || entry.sender.tag) : (entry.userName || 'System'),
			engine: entry.type === 'AUDIO_MP3' ? 'AUDIO_MP3' : (entry.type === 'GOOGLE_TTS' ? 'GOOGLE_TTS' : (entry.engine || 'EDGE_TTS')),
			type: entry.type || 'TTS',
			file: entry.file || null,
			volume: typeof entry.volume === 'number' ? entry.volume : 0.5,
			lang: entry.lang || 'th',
			voice: entry.voice || 'th-TH-NiwatNeural',
		};
		return { success: true, id: audioQueueManager.addToQueue(guildId, gName, entry.connection, entry.name, opt) };
	}
	return { success: true, id: audioQueueManager.addToQueue(guildId, guildName, connection, text, options) };
}

function clearQueue(guildId) {
	return audioQueueManager.clearQueue(guildId);
}

module.exports = {
	AudioQueueManager,
	audioQueueManager,
	addToQueue,
	clearQueue,
	generateUUID,
};
