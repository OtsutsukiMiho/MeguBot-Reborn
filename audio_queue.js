const { createAudioPlayer, createAudioResource } = require('@discordjs/voice');
const { EdgeTTS } = require('node-edge-tts');
const googleTTS = require('google-tts-api');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const { BotLogs, COLOR: COLOR } = require('./bot_functions.js');

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
	};
	return uuid;
};

const main_queue = new Map();
const players = new Map();

class QueueEmitter extends EventEmitter { }
const queueEmitter = new QueueEmitter();

function getOrCreateAudioPlayer(guildId) {
	if (!players.has(guildId)) {
		const audioPlayer = createAudioPlayer();
		audioPlayer.on('error', error => {
			BotLogs('SYSTEM', `${COLOR.red}Audio Player Error in guild ${guildId}: ${COLOR.white}${error.message}`);
		});
		const player_constructor = {
			player: audioPlayer,
			status: 'IDLE',
			yt_id: 'NONE',
		};
		players.set(guildId, player_constructor);
	};
	return players.get(guildId);
};

function serverQueue(id) {
	if (!main_queue.has(id)) {
		main_queue.set(id, []);
		queueEmitter.emit('serverAdded', id, main_queue.get(id));
	}
	return true;
};

function clearQueue(guildId, guildName) {
	const audioPlayer = getOrCreateAudioPlayer(guildId);
	if (main_queue.has(guildId)) {
		main_queue.get(guildId).length = 0;
		audioPlayer.status = 'IDLE';
		audioPlayer.player.stop();
		QueueLog(guildName || 'SYSTEM', `${COLOR.gold}No VC available. Clearing the server queue.`);
	};
};

function addToQueue(queueName, entry) {
	serverQueue(queueName);

	const queue = main_queue.get(queueName);

	let spamCount = 0;
	for (const item of queue) {
		if (item.sender.id === entry.sender.id && item.name === entry.name) {
			spamCount++;
		}
	}

	if (spamCount >= 2) {
		QueueLog(entry.guild.name, `${COLOR.gold}Spam detected! User ${COLOR.gray}[${COLOR.white}${entry.sender.tag}${COLOR.gray}] tried queuing ${entry.name} too many times.`);
		return { success: false, reason: 'SPAM' };
	}

	if (queue.length >= 20) {
		QueueLog(entry.guild.name, `${COLOR.gold}Reached queue limit! ${COLOR.gray}[${COLOR.white}total: ${queue.length}${COLOR.gray}]`);
		return { success: false, reason: 'FULL' };
	}

	queue.push(entry);
	queueEmitter.emit('entryAdded', queueName, entry);
	return { success: true };
};

async function processQueue(queueName, entry) {
	try {
		if (queueName !== entry.guild.id) return;

		const audioPlayer = getOrCreateAudioPlayer(queueName);
		audioPlayer.status = 'PLAYING';

		const queue = main_queue.get(queueName);
		const index = queue.findIndex(item => item.uuid === entry.uuid);

		let tmp_msg = `${COLOR.gold}Processing queue ${COLOR.gray}[${COLOR.white}${entry.sender.tag}(${entry.type}) - ${entry.name}${COLOR.gray}]`;

		if (queue.length >= 1) {
			tmp_msg += ` ${COLOR.gray}[${COLOR.white}${(queue.length - 1)} left${COLOR.gray}]`;
		};

		QueueLog(entry.guild.name, tmp_msg);

		if (entry.type == 'AUDIO_MP3') {
			const resource = createAudioResource(entry.file, {
				inlineVolume: true,
			});
			resource.volume?.setVolume(entry.volume || 0.5);
			audioPlayer.player.play(resource);
			entry.connection.subscribe(audioPlayer.player);

			if (index !== -1) {
				queue.splice(index, 1);
			};
		}
		else if (entry.type == 'TTS') {
			const voiceMap = {
				'th': 'th-TH-PremwadeeNeural',
				'en': 'en-US-AriaNeural',
				'ja': 'ja-JP-NanamiNeural',
			};
			const voice = entry.voice || voiceMap[entry.lang] || 'th-TH-PremwadeeNeural';

			const tempFile = `./sounds/temp_${entry.guild.id}.mp3`;
			const tts = new EdgeTTS({ voice: voice });
			await tts.ttsPromise(entry.name, tempFile);

			const resource = createAudioResource(tempFile, {
				inlineVolume: true,
			});
			resource.volume?.setVolume(0.75);
			audioPlayer.player.play(resource);
			entry.connection.subscribe(audioPlayer.player);

			if (index !== -1) {
				queue.splice(index, 1);
			}
		}
		else if (entry.type == 'GOOGLE_TTS') {
			const url = googleTTS.getAudioUrl(entry.name, {
				lang: entry.lang || 'th',
				slow: false,
				host: 'https://translate.google.com',
			});
			const tempFile = `./sounds/temp_${entry.guild.id}.mp3`;
			const res = await fetch(url);
			const buffer = Buffer.from(await res.arrayBuffer());
			fs.writeFileSync(tempFile, buffer);
			const resource = createAudioResource(tempFile, {
				inlineVolume: true,
			});
			resource.volume?.setVolume(0.75);
			audioPlayer.player.play(resource);
			entry.connection.subscribe(audioPlayer.player);

			if (index !== -1) {
				queue.splice(index, 1);
			}
		}
		else if (entry.type == 'YOUTUBE') {
			audioPlayer.yt_id = `${entry.uuid}`;
		}

	}
	catch (error) {
		BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
		BotLogs('SYSTEM', `${COLOR.red}Error Occurred: ${COLOR.white}"${error.toString().replace(/^Error: /, '')}" ${COLOR.red}from ${COLOR.white}"${path.basename(__filename)}"`);
		BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
	};
};

queueEmitter.on('entryAdded', (queueName, entry) => {
	const audioPlayer = getOrCreateAudioPlayer(queueName);
	const queueLength = main_queue.get(queueName)?.length || 0;

	QueueLog(entry.guild.name, `${COLOR.gray}[${COLOR.white}${entry.sender.tag}(${entry.type}) - ${entry.name}${COLOR.gray}] ${COLOR.gold}has been added to the queue ${COLOR.gray}[${COLOR.white}total: ${queueLength}${COLOR.gray}]`);

	if (audioPlayer.status === 'IDLE') {
		processQueue(queueName, entry);
	}
});

queueEmitter.on('serverAdded', (id) => {
	const audioPlayer = getOrCreateAudioPlayer(id);

	audioPlayer.player.on('stateChange', (oldState, newState) => {
		if (newState.status === 'idle') {
			audioPlayer.status = 'IDLE';

			if (audioPlayer.yt_id !== 'NONE') {
				const filePath = `./sounds/youtube/${audioPlayer.yt_id}.mp3`;
				if (fs.existsSync(filePath)) {
					fs.unlink(filePath, (err) => {
						if (err) console.error(`[Error] Failed to delete ${filePath}:`, err);
					});
				}
				audioPlayer.yt_id = 'NONE';
			}

			const guildQueue = main_queue.get(id);
			if (guildQueue && guildQueue.length > 0) {
				processQueue(id, guildQueue[0]);
			}
		}
		else if (newState.status === 'playing') {
			audioPlayer.status = 'PLAYING';
		}
	});
});

module.exports = {
	generateUUID,
	main_queue,
	players,
	getOrCreateAudioPlayer,
	serverQueue,
	clearQueue,
	addToQueue,
	processQueue,
};