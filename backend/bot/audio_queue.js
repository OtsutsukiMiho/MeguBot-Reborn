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
	try {
		const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
		if (config.logs && config.logs.audio_queue_logs) {
			BotLogs(guildName, msg);
		}
	}
	catch {
		BotLogs(guildName, msg);
	}
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
			player.on('stateChange', (oldState, newState) => {
				if (newState.status === 'idle' && oldState.status !== 'idle') {
					this.processNext(guildId);
				}
			});
			player.on('error', error => {
				BotLogs('SYSTEM', `${COLOR.red}Audio player error in guild ${guildId}: ${error.message}`);
				this.processNext(guildId);
			});
			this.players.set(guildId, player);
		}
		return this.players.get(guildId);
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
				userName: entry.sender ? entry.sender.username : (entry.userName || 'System'),
				engine: entry.type === 'TTS' ? 'EDGE_TTS' : (entry.type === 'GOOGLE_TTS' ? 'GOOGLE_TTS' : (entry.engine || 'EDGE_TTS')),
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
		QueueLog(item.guildName, `New TTS Added to Queue [${finalOptions.userName || 'System'}(${finalOptions.engine || 'EDGE_TTS'}) - ${finalText}]`);

		if (queue.length === 1) {
			this.processNext(guildId);
		}
		return id;
	}

	async processNext(guildId) {
		const queue = this.getQueue(guildId);
		if (queue.length === 0) return;

		const currentItem = queue[0];
		const player = this.getPlayer(guildId);

		try {
			let audioPath = null;
			const tempDir = path.join(__dirname, '../../temp');
			if (!fs.existsSync(tempDir)) {
				fs.mkdirSync(tempDir, { recursive: true });
			}

			const filename = `tts_${Date.now()}_${currentItem.id}.mp3`;
			audioPath = path.join(tempDir, filename);

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

			const resource = createAudioResource(audioPath);
			currentItem.connection.subscribe(player);
			player.play(resource);

			// Clean up file after playback
			player.once('idle', () => {
				try {
					if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
				}
				catch {}
				queue.shift();
				if (queue.length > 0) {
					this.processNext(guildId);
				}
			});
		}
		catch (error) {
			BotLogs('TTS', `${COLOR.red}Failed to process TTS ${COLOR.gray}(${currentItem.guildName})${COLOR.red}: ${error.message}`);
			queue.shift();
			if (queue.length > 0) {
				this.processNext(guildId);
			}
		}
	}

	clearQueue(guildId) {
		if (this.queues.has(guildId)) {
			this.queues.set(guildId, []);
		}
		if (this.players.has(guildId)) {
			const player = this.players.get(guildId);
			player.stop();
		}
	}
}

const audioQueueManager = new AudioQueueManager();

function addToQueue(guildId, guildName, connection, text, options = {}) {
	if (typeof guildName === 'object' && guildName !== null) {
		const entry = guildName;
		const gName = entry.guild ? (typeof entry.guild === 'string' ? entry.guild : entry.guild.name) : 'Discord Server';
		const opt = {
			userName: entry.sender ? entry.sender.username : (entry.userName || 'System'),
			engine: entry.type === 'TTS' ? 'EDGE_TTS' : (entry.type === 'GOOGLE_TTS' ? 'GOOGLE_TTS' : (entry.engine || 'EDGE_TTS')),
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
	audioQueueManager,
	addToQueue,
	clearQueue,
	generateUUID,
};
