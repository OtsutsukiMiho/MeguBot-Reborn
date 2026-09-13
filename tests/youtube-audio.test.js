'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { PermissionFlagsBits } = require('discord.js');
const { YouTubeProvider, normalizeVideo, parseInput } = require('../backend/bot/youtube_provider.js');
const { executeYouTube, _test: youtubeTest } = require('../commands/utility/yt.js');
const queueCommand = require('../commands/utility/queue.js');
const skipCommand = require('../commands/utility/skip.js');
const stopCommand = require('../commands/utility/stop.js');
const { DEPLOYMENT_CONFIG_ERROR, resolveDeploymentTarget } = require('../scripts/command-deployment-target.js');
const { PREFLIGHT_CONFIG_ERROR, runPreflight, validatePilotConfig } = require('../scripts/youtube-pilot-preflight.js');

let checks = 0;
function ok(message) { checks++; console.log(`  ok  ${message}`); }

function expectCode(callback, code) {
	assert.throws(callback, error => error.code === code, `expected ${code}`);
}

function fakeChild(payload) {
	const child = new EventEmitter();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.killed = false;
	child.kill = () => { child.killed = true; return true; };
	process.nextTick(() => {
		child.emit('spawn');
		if (payload !== undefined) child.stdout.end(JSON.stringify(payload));
		child.stderr.end();
		if (payload !== undefined) child.emit('close', 0);
	});
	return child;
}

function fakeVersionChild(version) {
	const child = fakeChild();
	process.nextTick(() => {
		child.stdout.end(`${version}\n`);
		child.stderr.end();
		child.emit('close', 0);
	});
	return child;
}

function interactionBase(query = 'https://youtu.be/dQw4w9WgXcQ', suffix = 'a') {
	const edits = [];
	const channel = { id: 'voice-a', permissionsFor: () => ({ has: () => true }) };
	const interaction = {
		locale: 'en-US', guildId: `guild-${suffix}`, channelId: 'text', deferred: false, replied: false,
		guild: { id: `guild-${suffix}`, name: 'Guild', voiceAdapterCreator: {}, members: { me: { id: 'bot' } } },
		member: { displayName: 'Requester', voice: { channel } }, user: { id: `user-${suffix}`, username: 'requester' },
		options: { getString: () => query }, inGuild: () => true,
		async deferReply() { this.deferred = true; },
		async reply(payload) { this.replied = true; edits.push(payload); return payload; },
		async editReply(payload) { edits.push(payload); return payload; },
	};
	return { channel, edits, interaction };
}

async function main() {
	{
		const previousEnabled = process.env.MEGU_YOUTUBE_ENABLED;
		const previousGuilds = process.env.MEGU_YOUTUBE_GUILD_IDS;
		try {
			delete process.env.MEGU_YOUTUBE_ENABLED;
			delete process.env.MEGU_YOUTUBE_GUILD_IDS;
			assert.equal(youtubeTest.featureEnabled('guild'), false);
			process.env.MEGU_YOUTUBE_ENABLED = '1';
			process.env.MEGU_YOUTUBE_GUILD_IDS = 'pilot-a, pilot-b';
			assert.equal(youtubeTest.featureEnabled('pilot-b'), true);
			assert.equal(youtubeTest.featureEnabled('other'), false);
		}
		finally {
			if (previousEnabled === undefined) delete process.env.MEGU_YOUTUBE_ENABLED;
			else process.env.MEGU_YOUTUBE_ENABLED = previousEnabled;
			if (previousGuilds === undefined) delete process.env.MEGU_YOUTUBE_GUILD_IDS;
			else process.env.MEGU_YOUTUBE_GUILD_IDS = previousGuilds;
		}
		ok('the feature flag is fail-closed and supports a pilot guild allowlist');
	}

	{
		const previousEnabled = process.env.MEGU_YOUTUBE_ENABLED;
		const previousGuilds = process.env.MEGU_YOUTUBE_GUILD_IDS;
		try {
			process.env.MEGU_YOUTUBE_ENABLED = '1';
			delete process.env.MEGU_YOUTUBE_GUILD_IDS;
			const { edits, interaction } = interactionBase('dependency gate', 'dependency-gate');
			const manager = { youtubeReady: false };
			await executeYouTube(interaction, { manager, provider: {} });
			assert.match(edits.at(-1).content, /dependencies are not ready/);
			assert.equal(interaction.deferred, false);
		}
		finally {
			if (previousEnabled === undefined) delete process.env.MEGU_YOUTUBE_ENABLED;
			else process.env.MEGU_YOUTUBE_ENABLED = previousEnabled;
			if (previousGuilds === undefined) delete process.env.MEGU_YOUTUBE_GUILD_IDS;
			else process.env.MEGU_YOUTUBE_GUILD_IDS = previousGuilds;
		}
		ok('/yt remains unavailable when startup dependency diagnostics did not pass');
	}

	{
		for (const link of [
			'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			'https://youtu.be/dQw4w9WgXcQ?t=30',
			'https://www.youtube.com/shorts/dQw4w9WgXcQ',
			'https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=abc',
		]) assert.deepEqual(parseInput(link), { kind: 'video', videoId: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
		assert.deepEqual(parseInput('เพลง ทดสอบ mixed search'), { kind: 'search', query: 'เพลง ทดสอบ mixed search' });
		assert.deepEqual(parseInput('english search words'), { kind: 'search', query: 'english search words' });
		expectCode(() => parseInput('https://example.com/watch?v=dQw4w9WgXcQ'), 'youtube_invalid_url');
		expectCode(() => parseInput('example.com/watch?v=dQw4w9WgXcQ'), 'youtube_invalid_url');
		expectCode(() => parseInput('ftp://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'youtube_invalid_url');
		expectCode(() => parseInput('javascript:alert(1)'), 'youtube_invalid_url');
		expectCode(() => parseInput('https://www.youtube.com/playlist?list=PL123'), 'youtube_playlist_unsupported');
		expectCode(() => parseInput('x'.repeat(201)), 'youtube_search_too_long');
		expectCode(() => parseInput(`https://youtu.be/dQw4w9WgXcQ?value=${'x'.repeat(2050)}`), 'youtube_input_too_long');
		ok('YouTube links are canonicalized and unsupported URLs cannot reach the extractor');
	}

	{
		const video = normalizeVideo({ id: 'dQw4w9WgXcQ', title: '  A   title ', uploader: 'Channel', duration: 899 });
		assert.equal(video.title, 'A title');
		assert.equal(video.durationSeconds, 899);
		expectCode(() => normalizeVideo({ id: 'dQw4w9WgXcQ', title: 'live', duration: 10, is_live: true }), 'youtube_live_unsupported');
		expectCode(() => normalizeVideo({ id: 'dQw4w9WgXcQ', title: 'long', duration: 901 }), 'youtube_too_long');
		expectCode(() => normalizeVideo({ id: 'dQw4w9WgXcQ', title: 'unknown' }), 'youtube_duration_unknown');
		expectCode(() => normalizeVideo({ id: 'dQw4w9WgXcQ', title: 'restricted', duration: 60, age_limit: 18 }), 'youtube_unavailable');
		expectCode(() => normalizeVideo({ id: 'dQw4w9WgXcQ', title: 'private', duration: 60, availability: 'private' }), 'youtube_unavailable');
		ok('metadata rejects live, unknown-duration, and over-limit videos');
	}

	{
		const calls = [];
		const provider = new YouTubeProvider({ spawnImpl: (file, args, options) => { calls.push({ file, args, options }); return fakeChild({ id: 'dQw4w9WgXcQ', title: 'Track', channel: 'Channel', duration: 180 }); }, executable: 'yt-dlp-test' });
		const video = await provider.getVideo('dQw4w9WgXcQ');
		assert.equal(video.title, 'Track');
		assert.equal(calls[0].file, 'yt-dlp-test');
		assert.equal(calls[0].options.shell, false);
		assert.ok(calls[0].args.includes('--ignore-config'));
		assert.ok(calls[0].args.includes('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
		ok('the provider uses an argument array, ignores ambient config, and returns bounded metadata');
	}

	{
		const calls = [];
		const entries = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee', 'fffffffffff']
			.map((id, index) => ({ id, title: `Result ${index + 1}`, channel: 'Channel', duration: 60 + index }));
		const provider = new YouTubeProvider({ spawnImpl: (file, args) => { calls.push({ file, args }); return fakeChild({ entries }); }, executable: 'yt-dlp-test' });
		const results = await provider.search('เพลงทดสอบ');
		assert.equal(results.length, 5);
		assert.equal(calls[0].args.includes('--flat-playlist'), true);
		assert.equal(calls[0].args.at(-1), 'ytsearch5:เพลงทดสอบ');
		ok('search requests only five flat metadata results before full selection resolution');
	}

	{
		const calls = [];
		const provider = new YouTubeProvider({ spawnImpl: (file, args, options) => { calls.push({ file, args, options }); return fakeVersionChild('2026.08.19'); }, executable: 'yt-dlp-test' });
		assert.equal(await provider.checkBinary(), '2026.08.19');
		assert.deepEqual(calls[0].args, ['--version']);
		assert.equal(calls[0].options.shell, false);
		ok('startup diagnostics check the configured executable without making a YouTube request');
	}

	{
		const previousRuntime = process.env.YT_DLP_JS_RUNTIME;
		const calls = [];
		try {
			process.env.YT_DLP_JS_RUNTIME = 'node:C:\\Program Files\\nodejs\\node.exe';
			const provider = new YouTubeProvider({ spawnImpl: (file, args, options) => { calls.push({ file, args, options }); return fakeVersionChild('v24.14.0'); } });
			const runtime = await provider.checkRuntime();
			assert.deepEqual(runtime, { name: 'node', version: 'v24.14.0' });
			assert.equal(calls[0].file, 'C:\\Program Files\\nodejs\\node.exe');
			assert.deepEqual(calls[0].args, ['--version']);
			process.env.YT_DLP_JS_RUNTIME = 'node';
			await assert.rejects(provider.checkRuntime(), error => error.code === 'youtube_runtime_missing');
			process.env.YT_DLP_JS_RUNTIME = 'node:C:\\Program Files\\nodejs\\node.exe';
			const outdated = new YouTubeProvider({ spawnImpl: () => fakeVersionChild('v20.19.0') });
			await assert.rejects(outdated.checkRuntime(), error => error.code === 'youtube_runtime_unsupported');
		}
		finally {
			if (previousRuntime === undefined) delete process.env.YT_DLP_JS_RUNTIME;
			else process.env.YT_DLP_JS_RUNTIME = previousRuntime;
		}
		ok('startup diagnostics verify the explicitly configured JavaScript runtime');
	}

	{
		let child;
		const provider = new YouTubeProvider({ spawnImpl: () => { child = fakeChild(); return child; }, executable: 'yt-dlp-test' });
		const controller = new AbortController();
		const opened = await provider.openAudio('dQw4w9WgXcQ', controller.signal);
		assert.equal(opened.stream, child.stdout);
		controller.abort();
		assert.equal(child.killed, true);
		ok('cancelling preparation terminates the owned extractor process');
	}

	{
		let child;
		const provider = new YouTubeProvider({ spawnImpl: () => { child = fakeChild(); return child; }, executable: 'yt-dlp-test' });
		const controller = new AbortController();
		const pending = provider.getVideo('dQw4w9WgXcQ', controller.signal);
		controller.abort();
		await assert.rejects(pending, error => error.code === 'youtube_cancelled');
		assert.equal(child.killed, true);
		ok('cancelling metadata work terminates the extractor and returns a stable error code');
	}

	{
		let child;
		const provider = new YouTubeProvider({ spawnImpl: () => { child = fakeChild(); return child; }, executable: 'yt-dlp-test' });
		provider.timeoutMs = 10;
		const keepAlive = setTimeout(() => undefined, 100);
		try {
			await assert.rejects(provider.getVideo('dQw4w9WgXcQ'), error => error.code === 'youtube_timeout');
			assert.equal(child.killed, true);
		}
		finally {
			clearTimeout(keepAlive);
		}
		ok('metadata timeout terminates the extractor and returns a stable error code');
	}

	{
		const { edits, interaction } = interactionBase();
		let queued;
		const manager = {
			canUseChannel: () => true,
			addToQueue(...args) { queued = args; return { success: true, id: 'item', position: 1 }; },
		};
		const provider = { getVideo: async () => ({ videoId: 'dQw4w9WgXcQ', title: 'A *safe* track', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', durationSeconds: 120 }) };
		const connection = { joinConfig: { channelId: 'voice-a' }, subscribe() {} };
		await executeYouTube(interaction, { enabled: true, manager, provider, voice: { getVoiceConnection: () => null, joinVoiceChannel: () => connection, entersState: async () => connection } });
		assert.equal(interaction.deferred, true);
		assert.equal(queued[4].source, 'YOUTUBE');
		assert.equal(queued[4].requestedByUserId, 'user-a');
		assert.match(edits.at(-1).content, /Preparing to play now/);
		assert.deepEqual(edits.at(-1).allowedMentions, { parse: [] });
		ok('/yt link rechecks voice state and queues one sanitized YouTube item');
	}

	{
		const { edits, interaction } = interactionBase('https://youtu.be/dQw4w9WgXcQ', 'voice-ready-failure');
		let destroyed = 0;
		const connection = { joinConfig: { channelId: 'voice-a' }, destroy() { destroyed++; } };
		const manager = { canUseChannel: () => true, addToQueue: () => assert.fail('a failed voice connection must not enqueue') };
		const provider = { getVideo: async () => ({ videoId: 'dQw4w9WgXcQ', title: 'Track', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', durationSeconds: 60 }) };
		await executeYouTube(interaction, {
			enabled: true, manager, provider,
			voice: { getVoiceConnection: () => null, joinVoiceChannel: () => connection, entersState: async () => { throw new Error('voice timeout'); } },
		});
		assert.equal(destroyed, 1);
		assert.match(edits.at(-1).content, /ready voice connection/);
		ok('/yt destroys a newly created connection that cannot become ready');
	}

	{
		const { edits, interaction } = interactionBase('ค้นหาเพลง', 'b');
		let rejectedImpostor = 0;
		const selected = { customId: '', user: interaction.user, guildId: 'guild-b', member: interaction.member, values: ['dQw4w9WgXcQ'], async update(payload) { edits.push(payload); } };
		const message = { async awaitMessageComponent({ filter }) {
			selected.customId = edits.at(-1).components[0].components[0].data.custom_id;
			const impostor = { ...selected, user: { id: 'someone-else' }, reply: async () => { rejectedImpostor++; } };
			assert.equal(filter(impostor), false);
			assert.equal(filter(selected), true);
			assert.equal(filter({ ...selected }), false);
			return selected;
		} };
		interaction.editReply = async payload => { edits.push(payload); return payload.components?.length ? message : payload; };
		let queued = 0;
		const manager = { canUseChannel: () => true, addToQueue: () => { queued++; return { success: true, id: 'item', position: 2 }; } };
		const result = { videoId: 'dQw4w9WgXcQ', title: 'ผลลัพธ์', channel: 'ช่อง', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', durationSeconds: 90 };
		const provider = { search: async () => [result], getVideo: async () => result };
		const connection = { joinConfig: { channelId: 'voice-a' }, subscribe() {} };
		await executeYouTube(interaction, { enabled: true, manager, provider, voice: { getVoiceConnection: () => connection, joinVoiceChannel: () => connection, entersState: async () => connection } });
		assert.equal(queued, 1);
		assert.equal(rejectedImpostor, 1);
		assert.equal(edits.some(edit => edit.components?.length === 2), true);
		assert.match(edits.at(-1).content, /1 item ahead/);
		ok('/yt search accepts exactly one explicit requester-bound selection before enqueue');
	}

	{
		const { edits, interaction } = interactionBase('nothing here', 'c');
		const manager = { canUseChannel: () => true, addToQueue: () => assert.fail('an empty search must not enqueue') };
		const provider = { search: async () => [] };
		await executeYouTube(interaction, { enabled: true, manager, provider });
		assert.match(edits.at(-1).content, /No playable results/);
		ok('/yt reports an empty search without joining voice or mutating the queue');
	}

	{
		const { edits, interaction } = interactionBase('expiring search', 'expiry');
		const message = { async awaitMessageComponent() { throw new Error('collector expired'); } };
		interaction.editReply = async payload => {
			edits.push(payload);
			return payload.components?.length ? message : payload;
		};
		const result = { videoId: 'dQw4w9WgXcQ', title: 'Result', channel: 'Channel', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', durationSeconds: 90 };
		const manager = { canUseChannel: () => true, addToQueue: () => assert.fail('an expired selection must not enqueue') };
		const provider = { search: async () => [result] };
		await executeYouTube(interaction, { enabled: true, manager, provider });
		assert.match(edits.at(-1).content, /expired/);
		ok('/yt expires an unanswered search without selecting the first result');
	}

	{
		const { edits, interaction } = interactionBase('cancel search', 'cancel');
		const result = { videoId: 'dQw4w9WgXcQ', title: 'Result', channel: 'Channel', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', durationSeconds: 90 };
		const selected = {
			customId: '', user: interaction.user, guildId: interaction.guildId, member: interaction.member,
			async update(payload) { edits.push(payload); },
		};
		const message = {
			async awaitMessageComponent({ filter }) {
				selected.customId = edits.at(-1).components[1].components[0].data.custom_id;
				assert.equal(filter(selected), true);
				return selected;
			},
		};
		interaction.editReply = async payload => {
			edits.push(payload);
			return payload.components?.length ? message : payload;
		};
		const manager = { canUseChannel: () => true, addToQueue: () => assert.fail('a cancelled search must not enqueue') };
		const provider = { search: async () => [result], getVideo: async () => assert.fail('a cancelled search must not resolve a selection') };
		await executeYouTube(interaction, { enabled: true, manager, provider });
		assert.match(edits.at(-1).content, /cancelled/);
		assert.deepEqual(edits.at(-1).components, []);
		ok('/yt Cancel ends a search without resolving or enqueueing a video');
	}

	{
		const { edits, interaction } = interactionBase('voice change', 'voice-change');
		const result = { videoId: 'dQw4w9WgXcQ', title: 'Result', channel: 'Channel', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', durationSeconds: 90 };
		const selected = {
			customId: '', user: interaction.user, guildId: interaction.guildId,
			member: { voice: { channel: { id: 'voice-b' } } }, values: [result.videoId],
			async update(payload) { edits.push(payload); },
		};
		const message = {
			async awaitMessageComponent({ filter }) {
				selected.customId = edits.at(-1).components[0].components[0].data.custom_id;
				assert.equal(filter(selected), true);
				return selected;
			},
		};
		interaction.editReply = async payload => {
			edits.push(payload);
			return payload.components?.length ? message : payload;
		};
		const manager = { canUseChannel: () => true, addToQueue: () => assert.fail('a moved requester must not enqueue') };
		const provider = { search: async () => [result], getVideo: async () => assert.fail('a moved requester must not resolve the selection') };
		await executeYouTube(interaction, { enabled: true, manager, provider });
		assert.match(edits.at(-1).content, /stay in the same voice channel/);
		ok('/yt rejects a search selection after the requester changes voice channel');
	}

	{
		const { edits, interaction, channel } = interactionBase('permission check', 'd');
		channel.permissionsFor = () => ({ has: () => false });
		const manager = { canUseChannel: () => true };
		await executeYouTube(interaction, { enabled: true, manager, provider: {} });
		assert.match(edits.at(-1).content, /cannot connect/);
		ok('/yt rejects missing voice permissions before provider work');
	}

	{
		const manager = { canUseChannel: () => true };
		const guildOnly = interactionBase('guild only', 'guild-only');
		guildOnly.interaction.inGuild = () => false;
		await executeYouTube(guildOnly.interaction, { enabled: true, manager, provider: {} });
		assert.match(guildOnly.edits.at(-1).content, /Discord server/);
		assert.equal(guildOnly.interaction.deferred, false);

		const noVoice = interactionBase('no voice', 'no-voice');
		noVoice.interaction.member.voice.channel = null;
		await executeYouTube(noVoice.interaction, { enabled: true, manager, provider: {} });
		assert.match(noVoice.edits.at(-1).content, /Join a voice channel/);

		const noSpeak = interactionBase('no speak', 'no-speak');
		noSpeak.channel.permissionsFor = () => ({ has: permission => permission === PermissionFlagsBits.Connect });
		await executeYouTube(noSpeak.interaction, { enabled: true, manager, provider: {} });
		assert.match(noSpeak.edits.at(-1).content, /cannot speak/);
		ok('/yt rejects DMs, missing voice membership, and missing Speak permission independently');
	}

	{
		const { edits, interaction } = interactionBase('other room', 'other-room');
		const manager = { canUseChannel: () => false };
		const provider = { search: async () => assert.fail('a channel conflict must reject before provider work') };
		await executeYouTube(interaction, { enabled: true, manager, provider });
		assert.match(edits.at(-1).content, /another voice channel/);
		ok('/yt rejects another-channel requests before provider work');
	}

	{
		const previousConcurrency = process.env.MEGU_YOUTUBE_PROVIDER_CONCURRENCY;
		let release;
		try {
			process.env.MEGU_YOUTUBE_PROVIDER_CONCURRENCY = '1';
			const first = youtubeTest.providerWork(() => new Promise(resolve => { release = resolve; }));
			await assert.rejects(youtubeTest.providerWork(async () => 'second'), error => error.code === 'youtube_provider_busy');
			release('first');
			assert.equal(await first, 'first');
			assert.equal(youtubeTest.takeCooldown('cooldown-guild', 'cooldown-user', 100000), true);
			assert.equal(youtubeTest.takeCooldown('cooldown-guild', 'cooldown-user', 100001), false);
		}
		finally {
			if (previousConcurrency === undefined) delete process.env.MEGU_YOUTUBE_PROVIDER_CONCURRENCY;
			else process.env.MEGU_YOUTUBE_PROVIDER_CONCURRENCY = previousConcurrency;
		}
		ok('provider concurrency and requester cooldown reject excess work before extraction');
	}

	{
		const command = require('../commands/utility/yt.js').data.toJSON();
		assert.equal(command.name, 'yt');
		assert.equal(command.options[0].name, 'query');
		assert.equal(command.options[0].required, true);
		assert.equal(command.options[0].max_length, 2048);
		ok('the deployable slash command exposes one required bounded query');
	}

	{
		const routes = {
			applicationCommands: clientId => `global:${clientId}`,
			applicationGuildCommands: (clientId, guildId) => `guild:${clientId}:${guildId}`,
		};
		assert.deepEqual(resolveDeploymentTarget({ args: [], env: {}, routes, clientId: 'client' }), {
			kind: 'global', label: 'globally', route: 'global:client',
		});
		assert.deepEqual(resolveDeploymentTarget({ args: ['--guild'], env: { MEGU_DISCORD_TEST_GUILD_ID: '123456789012345678' }, routes, clientId: 'client' }), {
			kind: 'guild', guildId: '123456789012345678', label: 'to test guild 123456789012345678', route: 'guild:client:123456789012345678',
		});
		assert.throws(
			() => resolveDeploymentTarget({ args: ['--guild'], env: {}, routes, clientId: 'client' }),
			error => error.code === DEPLOYMENT_CONFIG_ERROR && /valid Discord guild/i.test(error.message),
		);
		assert.throws(
			() => resolveDeploymentTarget({ args: ['--guld'], env: {}, routes, clientId: 'client' }),
			error => error.code === DEPLOYMENT_CONFIG_ERROR && /unknown command deployment arguments/i.test(error.message),
		);
		ok('guild command deployment is explicit and fails closed without a valid test guild');
	}

	{
		const env = {
			MEGU_YOUTUBE_ENABLED: '1',
			MEGU_DISCORD_TEST_GUILD_ID: '123456789012345678',
			MEGU_YOUTUBE_GUILD_IDS: '123456789012345678',
			MEGU_YOUTUBE_YTDLP_SHA256: 'a'.repeat(64),
			YT_DLP_PATH: 'C:\\tools\\yt-dlp\\yt-dlp.exe',
		};
		assert.equal(validatePilotConfig(env).guildId, env.MEGU_DISCORD_TEST_GUILD_ID);
		assert.throws(() => validatePilotConfig({ ...env, MEGU_DISCORD_TEST_MODE: '1' }), error => error.code === PREFLIGHT_CONFIG_ERROR);
		assert.throws(() => validatePilotConfig({ ...env, MEGU_YOUTUBE_GUILD_IDS: '' }), error => error.code === PREFLIGHT_CONFIG_ERROR);
		assert.throws(() => validatePilotConfig({ ...env, MEGU_YOUTUBE_GUILD_IDS: `${env.MEGU_DISCORD_TEST_GUILD_ID},987654321098765432` }), error => error.code === PREFLIGHT_CONFIG_ERROR);
		assert.throws(() => validatePilotConfig({ ...env, YT_DLP_PATH: 'yt-dlp' }), error => error.code === PREFLIGHT_CONFIG_ERROR);
		assert.throws(() => validatePilotConfig({ ...env, MEGU_YOUTUBE_YTDLP_SHA256: 'unverified' }), error => error.code === PREFLIGHT_CONFIG_ERROR);
		ok('pilot preflight permits exactly one guild and requires pinned absolute dependencies');
	}

	{
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'megu-youtube-preflight-'));
		const executable = path.join(directory, 'yt-dlp-test.exe');
		const ffmpegPath = path.join(directory, 'ffmpeg-test.exe');
		try {
			fs.writeFileSync(executable, 'pinned yt-dlp fixture');
			fs.writeFileSync(ffmpegPath, 'ffmpeg fixture');
			const expectedSha256 = crypto.createHash('sha256').update('pinned yt-dlp fixture').digest('hex');
			const result = await runPreflight({
				env: {
					MEGU_YOUTUBE_ENABLED: '1', MEGU_DISCORD_TEST_GUILD_ID: '123456789012345678',
					MEGU_YOUTUBE_GUILD_IDS: '123456789012345678', MEGU_YOUTUBE_YTDLP_SHA256: expectedSha256,
					YT_DLP_PATH: executable,
				},
				ffmpegPath,
				provider: { checkBinary: async () => '2026.08.19', checkRuntime: async () => ({ name: 'node', version: 'v24.14.0' }) },
			});
			assert.equal(result.actualSha256, expectedSha256);
			assert.equal(result.guildId, '123456789012345678');
			assert.equal(result.version, '2026.08.19');
			const provider = new YouTubeProvider({ executable });
			assert.equal(await provider.checkDigest(expectedSha256), expectedSha256);
			await assert.rejects(provider.checkDigest('b'.repeat(64)), error => error.code === 'youtube_provider_digest_mismatch');
		}
		finally {
			if (fs.existsSync(executable)) fs.unlinkSync(executable);
			if (fs.existsSync(ffmpegPath)) fs.unlinkSync(ffmpegPath);
			if (fs.existsSync(directory)) fs.rmdirSync(directory);
		}
		ok('pilot preflight verifies the pinned file and every local playback dependency');
	}

	{
		const queue = [{
			id: 'one', title: 'Track title', source: 'YOUTUBE', requestedByUserId: 'owner', requestedByName: 'Owner name',
			voiceChannelId: 'voice-a', state: 'PREPARING', durationSeconds: 125,
		}];
		const replies = [];
		const interaction = {
			locale: 'en-US', guildId: 'guild', guild: { id: 'guild', name: 'Guild' },
			options: { getSubcommand: () => 'view' }, async reply(payload) { replies.push(payload); },
		};
		await queueCommand.execute(interaction, { manager: { getQueue: () => queue } });
		const embed = replies[0].embeds[0].toJSON();
		assert.match(embed.fields[0].value, /Track title/);
		assert.match(embed.fields[0].value, /YOUTUBE · 2:05 · Owner name/);
		assert.match(embed.fields[0].value, /Preparing/);
		assert.deepEqual(replies[0].allowedMentions, { parse: [] });
		ok('/queue view renders YouTube title, source, duration, requester, and lifecycle state');
	}

	{
		const queue = [{ id: 'one', title: 'Track', source: 'YOUTUBE', requestedByUserId: 'owner', requestedByName: 'Owner', voiceChannelId: 'voice-a', state: 'PLAYING', durationSeconds: 120 }];
		let skipped = 0;
		let cleared = 0;
		const manager = { getQueue: () => queue, skipCurrent: () => { skipped++; }, clearQueue: () => { cleared++; return queue.length; } };
		const replies = [];
		const interaction = {
			locale: 'en-US', guildId: 'guild', guild: { id: 'guild', name: 'Guild' }, user: { id: 'other' }, member: { voice: { channel: { id: 'voice-a' } } },
			memberPermissions: { has: permission => permission === PermissionFlagsBits.ManageGuild ? false : false },
			options: { getSubcommand: () => 'skip' }, async reply(payload) { replies.push(payload); },
		};
		await queueCommand.execute(interaction, { manager });
		assert.equal(skipped, 0);
		assert.match(replies[0].content, /Only the current requester/);
		interaction.user.id = 'owner';
		await queueCommand.execute(interaction, { manager });
		assert.equal(skipped, 1);
		interaction.options.getSubcommand = () => 'clear';
		interaction.user.id = 'other';
		await queueCommand.execute(interaction, { manager });
		assert.match(replies.at(-1).content, /Manage Server/);
		interaction.options.getSubcommand = () => 'skip';
		interaction.memberPermissions.has = permission => permission === PermissionFlagsBits.ManageGuild;
		await queueCommand.execute(interaction, { manager });
		assert.equal(skipped, 2);
		interaction.options.getSubcommand = () => 'clear';
		await queueCommand.execute(interaction, { manager });
		assert.equal(cleared, 1);
		ok('queue controls enforce requester/channel ownership and allow server managers');
	}

	{
		const queue = [{ id: 'one', title: 'Track', source: 'YOUTUBE', requestedByUserId: 'owner', voiceChannelId: 'voice-a' }];
		let skipped = 0;
		let cleared = 0;
		const manager = {
			getQueue: () => queue,
			skipCurrent: () => { skipped++; },
			clearQueue: () => { cleared++; },
		};
		const replies = [];
		const interaction = {
			locale: 'en-US', guildId: 'guild', guild: { id: 'guild' }, user: { id: 'other' },
			member: { voice: { channel: { id: 'voice-a' } } },
			memberPermissions: { has: () => false },
			async reply(payload) { replies.push(payload); },
		};
		await skipCommand.execute(interaction, { manager });
		await stopCommand.execute(interaction, { manager });
		assert.equal(skipped, 0);
		assert.equal(cleared, 0);
		assert.match(replies[0].content, /Only the current requester/);
		assert.match(replies[1].content, /Manage Server/);
		interaction.memberPermissions.has = permission => permission === PermissionFlagsBits.ManageGuild;
		await stopCommand.execute(interaction, { manager });
		assert.equal(cleared, 1);
		ok('legacy skip and stop commands cannot bypass the shared queue authorization policy');
	}

	console.log(`\n  ${checks} checks passed`);
}

main().catch(error => { console.error(`\n  FAILED  ${error.stack || error.message}`); process.exitCode = 1; });
