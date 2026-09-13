'use strict';

const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { VoiceConnectionStatus } = require('@discordjs/voice');
const { AudioQueueManager, SOURCE } = require('../backend/bot/audio_queue.js');

let checks = 0;
function ok(message) { checks++; console.log(`  ok  ${message}`); }
function flush() { return new Promise(resolve => setImmediate(resolve)); }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

class MockPlayer extends EventEmitter {
	constructor() { super(); this.state = { status: 'idle' }; this.played = []; this.stops = 0; }
	play(resource) { this.played.push(resource); this.state = { status: 'playing' }; this.emit('playing'); }
	stop() { this.stops++; this.state = { status: 'idle' }; this.emit('idle'); return true; }
}

function manager(options = {}) {
	const player = new MockPlayer();
	const instance = new AudioQueueManager({
		playerFactory: () => player,
		resourceFactory: input => ({ input, volume: { setVolume() {} } }),
		database: null,
		youtubeProvider: { openAudio: async () => ({ stream: new PassThrough(), dispose() {} }) },
		...options,
	});
	instance.prepareItem = options.prepareItem || (async item => ({ input: item.title }));
	return { instance, player };
}

function enqueue(instance, title, options = {}) {
	return instance.addToQueue('guild', 'Guild', { joinConfig: { channelId: options.voiceChannelId || 'voice-a' }, subscribe() {} }, title, {
		type: SOURCE.TTS, source: SOURCE.TTS, userName: 'Tester', requestedByName: 'Tester', requestedByUserId: 'user-a', voiceChannelId: 'voice-a',
		...options,
	});
}

async function main() {
	{
		const { instance } = manager();
		const player = instance.getPlayer('guild');
		assert.equal(player.listenerCount('stateChange'), 0);
		player.emit('stateChange', { status: 'playing' }, { status: 'idle' });
		assert.equal(instance.getQueue('guild').length, 0);
		ok('stateChange cannot advance or duplicate playback');
	}

	{
		const { instance } = manager();
		let release;
		instance.prepareItem = () => new Promise(resolve => { release = resolve; });
		const first = enqueue(instance, 'one');
		const second = enqueue(instance, 'two');
		assert.equal(first.success, true);
		assert.equal(typeof first.id, 'string');
		assert.equal(first.position, 1);
		assert.equal(second.position, 2);
		assert.equal(first.id instanceof Promise, false);
		instance.clearQueue('guild');
		release({ input: 'late' });
		await flush();
		ok('enqueue returns a real ID and position synchronously');
	}

	{
		const { instance, player } = manager();
		enqueue(instance, 'one');
		enqueue(instance, 'two', { requestedByUserId: 'user-b' });
		await flush();
		assert.deepEqual(player.played.map(item => item.input), ['one']);
		player.emit('idle');
		await flush();
		assert.deepEqual(player.played.map(item => item.input), ['one', 'two']);
		player.emit('idle');
		assert.equal(instance.getQueue('guild').length, 0);
		ok('idle advances FIFO exactly once across source-compatible items');
	}

	{
		const { instance, player } = manager();
		enqueue(instance, 'playing');
		enqueue(instance, 'next', { requestedByUserId: 'user-b' });
		await flush();
		assert.equal(instance.skipCurrent('guild'), true);
		await flush();
		assert.deepEqual(player.played.map(item => item.input), ['playing', 'next']);
		assert.equal(instance.getQueue('guild')[0].title, 'next');
		instance.clearQueue('guild');
		ok('skip during playback stops one owned item and advances exactly once');
	}

	{
		const { instance, player } = manager();
		enqueue(instance, 'playing');
		enqueue(instance, 'must not start', { requestedByUserId: 'user-b' });
		await flush();
		assert.equal(instance.clearQueue('guild'), 2);
		await flush();
		assert.deepEqual(player.played.map(item => item.input), ['playing']);
		assert.equal(instance.getQueue('guild').length, 0);
		assert.equal(instance.active.has('guild'), false);
		ok('clear during playback stops the owner and cannot start a waiting item');
	}

	{

		const { instance, player } = manager();
		enqueue(instance, 'speech');
		enqueue(instance, 'video', { source: SOURCE.YOUTUBE, type: SOURCE.YOUTUBE, engine: SOURCE.YOUTUBE, videoId: 'dQw4w9WgXcQ', durationSeconds: 60, requestedByUserId: 'user-b' });
		enqueue(instance, 'sound', { source: SOURCE.AUDIO_MP3, type: SOURCE.AUDIO_MP3, engine: SOURCE.AUDIO_MP3, file: 'mock.mp3', requestedByUserId: 'user-c' });
		await flush();
		player.emit('idle');
		await flush();
		player.emit('idle');
		await flush();
		assert.deepEqual(player.played.map(item => item.input), ['speech', 'video', 'sound']);
		instance.clearQueue('guild');
		ok('TTS, YouTube, and local sounds retain one shared FIFO order');
	}

	{
		const { instance, player } = manager();
		let releaseFirst;
		let disposed = 0;
		instance.prepareItem = item => item.title === 'slow'
			? new Promise(resolve => { releaseFirst = resolve; })
			: Promise.resolve({ input: item.title });
		enqueue(instance, 'slow');
		enqueue(instance, 'next', { requestedByUserId: 'user-b' });
		await flush();
		assert.equal(instance.skipCurrent('guild'), true);
		await flush();
		assert.deepEqual(player.played.map(item => item.input), ['next']);
		releaseFirst({ input: 'late', dispose() { disposed++; } });
		await flush();
		assert.equal(instance.getQueue('guild')[0].title, 'next');
		assert.equal(disposed, 1);
		ok('late preparation after skip cannot remove or play the next item');
	}

	{
		const { instance } = manager();
		const audioPath = path.join(os.tmpdir(), `megu-audio-queue-${process.pid}-${Date.now()}.mp3`);
		let release;
		try {
			fs.writeFileSync(audioPath, 'temporary audio');
			instance.prepareItem = () => new Promise(resolve => { release = resolve; });
			enqueue(instance, 'late temporary file');
			await flush();
			instance.clearQueue('guild');
			release({ input: audioPath, inputType: 'arbitrary', audioPath, temporary: true });
			await flush();
			assert.equal(fs.existsSync(audioPath), false);
		}
		finally {
			if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
		}
		ok('late TTS preparation after cancellation removes its temporary audio file');
	}

	{
		const { instance, player } = manager();
		let releaseOld;
		instance.prepareItem = item => item.title === 'old'
			? new Promise(resolve => { releaseOld = resolve; })
			: Promise.resolve({ input: item.title });
		enqueue(instance, 'old');
		await flush();
		assert.equal(instance.clearQueue('guild'), 1);
		enqueue(instance, 'fresh', { requestedByUserId: 'user-b' });
		await flush();
		releaseOld({ input: 'old-late' });
		await flush();
		assert.deepEqual(player.played.map(item => item.input), ['fresh']);
		assert.equal(instance.getQueue('guild')[0].title, 'fresh');
		ok('clear aborts ownership and a new enqueue starts safely');
	}

	{
		const { instance, player } = manager();
		enqueue(instance, 'broken');
		enqueue(instance, 'survivor', { requestedByUserId: 'user-b' });
		await flush();
		player.emit('error', new Error('resource failed'));
		await flush();
		assert.deepEqual(player.played.map(item => item.input), ['broken', 'survivor']);
		assert.equal(instance.getQueue('guild')[0].title, 'survivor');
		ok('player errors finalize one item and preserve the item behind it');
	}

	{
		const { instance, player } = manager({
			prepareItem: item => item.title === 'provider failure'
				? Promise.reject(Object.assign(new Error('extractor failed'), { code: 'youtube_provider_failed' }))
				: Promise.resolve({ input: item.title }),
		});
		enqueue(instance, 'provider failure', { source: SOURCE.YOUTUBE, type: SOURCE.YOUTUBE, videoId: 'dQw4w9WgXcQ', durationSeconds: 60 });
		enqueue(instance, 'survivor', { requestedByUserId: 'user-b' });
		await flush();
		await flush();
		assert.deepEqual(player.played.map(item => item.input), ['survivor']);
		assert.equal(instance.getQueue('guild')[0].title, 'survivor');
		ok('provider preparation failure finalizes the item and advances the shared queue');
	}

	{
		let release;
		let preparationSignal;
		let disposed = 0;
		const { instance, player } = manager({
			preparationTimeoutMs: 20,
			prepareItem: (item, signal) => {
				if (item.title !== 'hung preparation') return Promise.resolve({ input: item.title });
				preparationSignal = signal;
				return new Promise(resolve => { release = resolve; });
			},
		});
		enqueue(instance, 'hung preparation', { source: SOURCE.YOUTUBE, type: SOURCE.YOUTUBE, videoId: 'dQw4w9WgXcQ', durationSeconds: 60 });
		enqueue(instance, 'survivor', { requestedByUserId: 'user-b' });
		await wait(50);
		assert.deepEqual(player.played.map(item => item.input), ['survivor']);
		assert.equal(instance.getQueue('guild')[0].title, 'survivor');
		assert.equal(preparationSignal.aborted, true);
		release({ input: 'late', dispose() { disposed++; } });
		await flush();
		assert.equal(disposed, 1);
		instance.clearQueue('guild');
		ok('preparation timeout aborts a hung provider, cleans late output, and advances the queue');
	}

	{
		const { instance } = manager();
		enqueue(instance, 'long video', { source: SOURCE.YOUTUBE, type: SOURCE.YOUTUBE, engine: SOURCE.YOUTUBE, videoId: 'dQw4w9WgXcQ', durationSeconds: 120 });
		await flush();
		assert.equal(instance.active.get('guild').timeoutMs, 165000);
		instance.clearQueue('guild');
		ok('YouTube watchdog uses validated duration instead of the old 60-second sound limit');
	}

	{
		const stream = new PassThrough();
		const { instance, player } = manager({
			youtubeStreamInactivityMs: 20,
			prepareItem: async () => ({ input: stream, dispose() { stream.destroy(); } }),
		});
		enqueue(instance, 'stalled video', { source: SOURCE.YOUTUBE, type: SOURCE.YOUTUBE, engine: SOURCE.YOUTUBE, videoId: 'dQw4w9WgXcQ', durationSeconds: 120 });
		await wait(50);
		assert.equal(instance.getQueue('guild').length, 0);
		assert.equal(player.stops, 1);
		ok('a stalled YouTube stream is finalized and stopped without waiting for the full track watchdog');
	}

	{
		const connection = new EventEmitter();
		connection.joinConfig = { channelId: 'voice-a' };
		connection.subscribe = () => undefined;
		connection.state = { status: VoiceConnectionStatus.Ready };
		const { instance, player } = manager();
		instance.addToQueue('guild', 'Guild', connection, 'voice-owned', {
			type: SOURCE.TTS, source: SOURCE.TTS, requestedByName: 'Tester', requestedByUserId: 'user-a', voiceChannelId: 'voice-a',
		});
		await flush();
		connection.state = { status: VoiceConnectionStatus.Destroyed };
		connection.emit('stateChange', { status: VoiceConnectionStatus.Ready }, connection.state);
		assert.equal(instance.getQueue('guild').length, 0);
		assert.equal(player.stops, 1);
		assert.equal(connection.listenerCount('stateChange'), 0);
		ok('destroying the owned voice connection finalizes playback and detaches its listener');
	}

	{
		const connection = new EventEmitter();
		connection.joinConfig = { channelId: 'voice-a' };
		connection.subscribe = () => undefined;
		connection.state = { status: VoiceConnectionStatus.Ready };
		const { instance, player } = manager({ voiceDisconnectGraceMs: 20 });
		instance.addToQueue('guild', 'Guild', connection, 'connection lost', {
			type: SOURCE.TTS, source: SOURCE.TTS, requestedByName: 'Tester', requestedByUserId: 'user-a', voiceChannelId: 'voice-a',
		});
		await flush();
		connection.state = { status: VoiceConnectionStatus.Disconnected };
		connection.emit('stateChange', { status: VoiceConnectionStatus.Ready }, connection.state);
		await wait(40);
		assert.equal(instance.getQueue('guild').length, 0);
		assert.equal(player.stops, 1);
		assert.equal(connection.listenerCount('stateChange'), 0);
		ok('a voice connection that stays disconnected past its grace period finalizes playback');
	}

	{
		const connection = new EventEmitter();
		connection.joinConfig = { channelId: 'voice-a' };
		connection.subscribe = () => undefined;
		connection.state = { status: VoiceConnectionStatus.Ready };
		const { instance, player } = manager({ voiceDisconnectGraceMs: 30 });
		instance.addToQueue('guild', 'Guild', connection, 'connection recovered', {
			type: SOURCE.TTS, source: SOURCE.TTS, requestedByName: 'Tester', requestedByUserId: 'user-a', voiceChannelId: 'voice-a',
		});
		await flush();
		connection.state = { status: VoiceConnectionStatus.Disconnected };
		connection.emit('stateChange', { status: VoiceConnectionStatus.Ready }, connection.state);
		connection.state = { status: VoiceConnectionStatus.Ready };
		connection.emit('stateChange', { status: VoiceConnectionStatus.Disconnected }, connection.state);
		await wait(50);
		assert.equal(instance.getQueue('guild').length, 1);
		assert.equal(player.stops, 0);
		instance.clearQueue('guild');
		ok('a voice connection that recovers inside its grace period keeps playing');
	}

	{
		let release;
		const { instance } = manager({ youtubeUserLimit: 2, youtubeGuildLimit: 3, youtubeDurationLimit: 180, prepareItem: () => new Promise(resolve => { release = resolve; }) });
		const yt = (title, id, user = 'user-a', seconds = 60) => enqueue(instance, title, { source: SOURCE.YOUTUBE, type: SOURCE.YOUTUBE, engine: SOURCE.YOUTUBE, videoId: id, durationSeconds: seconds, requestedByUserId: user });
		assert.equal(yt('invalid', 'bad!').reason, 'INVALID_SOURCE');
		assert.equal(yt('a', 'aaaaaaaaaaa').success, true);
		assert.equal(yt('b', 'bbbbbbbbbbb').success, true);
		assert.equal(yt('c', 'ccccccccccc').reason, 'YOUTUBE_USER_LIMIT');
		assert.equal(yt('c', 'ccccccccccc', 'user-b', 61).reason, 'YOUTUBE_DURATION_LIMIT');
		assert.equal(enqueue(instance, 'wrong room', { voiceChannelId: 'voice-b', requestedByUserId: 'user-c' }).reason, 'CHANNEL_CONFLICT');
		instance.clearQueue('guild');
		release?.({ input: 'cancelled' });
		ok('per-user, duration, and one-channel queue limits are atomic');
	}

	{
		let release;
		const { instance } = manager({ totalLimit: 2, prepareItem: () => new Promise(resolve => { release = resolve; }) });
		assert.equal(enqueue(instance, 'one').success, true);
		assert.equal(enqueue(instance, 'two', { requestedByUserId: 'user-b' }).success, true);
		assert.equal(enqueue(instance, 'three', { requestedByUserId: 'user-c' }).reason, 'FULL');
		instance.clearQueue('guild');
		release?.({ input: 'cancelled' });
		ok('the complete shared queue cap rejects overflow atomically');
	}

	{
		let release;
		const { instance } = manager({ youtubeGuildLimit: 2, youtubeUserLimit: 3, youtubeDurationLimit: 1000, prepareItem: () => new Promise(resolve => { release = resolve; }) });
		const yt = (title, id, user) => enqueue(instance, title, { source: SOURCE.YOUTUBE, type: SOURCE.YOUTUBE, videoId: id, durationSeconds: 60, requestedByUserId: user });
		assert.equal(yt('one', 'aaaaaaaaaaa', 'user-a').success, true);
		assert.equal(yt('two', 'bbbbbbbbbbb', 'user-b').success, true);
		assert.equal(yt('three', 'ccccccccccc', 'user-c').reason, 'YOUTUBE_GUILD_LIMIT');
		instance.clearQueue('guild');
		release?.({ input: 'cancelled' });
		ok('the per-guild YouTube cap applies across different requesters');
	}

	{
		let release;
		const { instance } = manager({ prepareItem: () => new Promise(resolve => { release = resolve; }) });
		assert.equal(enqueue(instance, 'same request').success, true);
		assert.equal(enqueue(instance, 'same request').reason, 'DUPLICATE');
		instance.clearQueue('guild');
		release?.({ input: 'cancelled' });
		ok('duplicate enqueue attempts are rejected before queue mutation');
	}

	{
		const { instance } = manager();
		enqueue(instance, 'metadata', { source: SOURCE.YOUTUBE, type: SOURCE.YOUTUBE, engine: SOURCE.YOUTUBE, videoId: 'dQw4w9WgXcQ', canonicalUrl: 'https://evil.example/watch', durationSeconds: 90 });
		const item = instance.getAllQueues()[0].currentItem;
		assert.equal(item.source, 'YOUTUBE');
		assert.equal(item.durationSeconds, 90);
		assert.equal(item.canonicalUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
		assert.equal('connection' in item, false);
		assert.equal('options' in item, false);
		instance.clearQueue('guild');
		ok('IPC snapshots expose useful YouTube metadata without runtime handles');
	}

	{
		const database = {
			logAudioEvent() { throw new Error('logging offline'); },
			updateAudioStatus() { return Promise.reject(new Error('logging offline')); },
		};
		const { instance, player } = manager({ database });
		assert.equal(enqueue(instance, 'plays anyway').success, true);
		await flush();
		player.emit('idle');
		await flush();
		assert.equal(instance.getQueue('guild').length, 0);
		ok('database logging failure cannot stall enqueue, playback, or finalization');
	}

	{
		const { instance } = manager({ playerFactory: () => new MockPlayer() });
		enqueue(instance, 'guild-a item');
		instance.addToQueue('guild-b', 'Other Guild', { joinConfig: { channelId: 'voice-b' }, subscribe() {} }, 'guild-b item', {
			type: SOURCE.TTS, source: SOURCE.TTS, requestedByName: 'Tester', requestedByUserId: 'user-b', voiceChannelId: 'voice-b',
		});
		await flush();
		assert.equal(instance.clearAllQueues(), 2);
		assert.equal(instance.getQueue('guild').length, 0);
		assert.equal(instance.getQueue('guild-b').length, 0);
		assert.equal(instance.active.size, 0);
		ok('shutdown cleanup clears every guild queue and active execution');
	}

	console.log(`\n  ${checks} checks passed`);
}

main().catch(error => { console.error(`\n  FAILED  ${error.stack || error.message}`); process.exitCode = 1; });
