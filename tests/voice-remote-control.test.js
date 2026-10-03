'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const discord = require('discord.js');
const { getActiveVoiceSession, isSameVoiceSession, voiceConnectionError } = require('../backend/bot/voice_connection');

async function main() {
	const channel = { id: 'a', type: 2, permissionsFor: () => ({ has: () => true }) };
	const guild = { id: 'g', name: 'Guild', members: { me: { voice: { channelId: 'a', channel } } }, channels: { cache: new Map([['a', channel]]) } };
	let connection = { joinConfig: { guildId: 'g', channelId: 'a' }, state: { status: 'ready' } };
	const session = value => getActiveVoiceSession(value, { getVoiceConnection: id => id === 'g' ? connection : null });
	const queued = [];
	function command(name, voiceDependency = { getActiveVoiceSession: session }) {
		const file = path.resolve('commands/utility', name + '.js'); const module = { exports: {} };
		vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports, __dirname: path.dirname(file),
			require: id => id.includes('voice_connection') ? voiceDependency
				: id.includes('audio_queue') ? { audioQueueManager: { canUseChannel: () => true }, addToQueue: (_id, entry) => { queued.push(entry); return { success: true, position: 1 }; } }
				: id.includes('bot_functions') ? { BotLogs: () => {}, COLOR: {} }
				: id === 'fs' ? { existsSync: () => true } : require(id),
		}); return module.exports;
	}
	for (const name of ['say', 'play']) for (const callerChannel of ['a', 'b', null]) {
		const replies = [], interaction = { guild, member: { voice: { channel: callerChannel ? { id: callerChannel } : null } }, user: { id: 'u' }, options: { getString: key => key === 'sound' ? 'lingangu' : key === 'text' ? 'Hello' : null }, reply: async data => replies.push(data) };
		const before = queued.length; await command(name).execute(interaction);
		assert.equal(queued.length, before + 1); assert.equal(queued.at(-1).voice_channel.id, 'a'); assert.equal(queued.at(-1).connection, connection);
	}
	for (const broken of [null, { state: { status: 'destroyed' } }, { joinConfig: { guildId: 'other', channelId: 'a' }, state: { status: 'ready' } }, { joinConfig: { channelId: 'b' }, state: { status: 'ready' } }]) {
		connection = broken; assert.equal(session(guild), null);
		for (const name of ['say', 'play']) {
			const before = queued.length, replies = []; await command(name).execute({ guild, member: {}, user: {}, options: {}, reply: async data => replies.push(data) });
			assert.equal(queued.length, before); assert.match(replies[0].content, /not connected/);
		}
	}
	connection = { joinConfig: { guildId: 'g', channelId: 'a' }, state: { status: 'ready' } };
	assert.equal(session({ ...guild, id: 'other' }), null);
	const allowedPermissions = channel.permissionsFor;
	channel.permissionsFor = () => ({ has: () => false });
	for (const name of ['say', 'play']) {
		const before = queued.length; await command(name).execute({ guild, member: {}, user: {}, options: { getString: () => 'Hello' }, reply: async () => {} });
		assert.equal(queued.length, before, 'Remote control still requires bot Connect/Speak permissions');
	}
	channel.permissionsFor = allowedPermissions;
	const queue = require('../commands/utility/queue');
	let skips = 0, clears = 0;
	const manager = { getQueue: () => [{ requestedByUserId: 'u', voiceChannelId: 'a' }], skipCurrent: () => skips++, clearQueue: () => { clears++; return 1; } };
	for (const callerChannel of ['a', 'b', null]) {
		const interaction = { guildId: 'g', guild, user: { id: 'u' }, member: { voice: { channel: callerChannel ? { id: callerChannel } : null } }, memberPermissions: { has: () => false }, reply: async () => {} };
		await queue.executeAction(interaction, 'skip', { manager, getActiveVoiceSession: session });
		await queue.executeAction({ ...interaction, user: { id: 'other' } }, 'skip', { manager, getActiveVoiceSession: session });
		await queue.executeAction(interaction, 'clear', { manager, getActiveVoiceSession: session });
		await queue.executeAction({ ...interaction, memberPermissions: { has: () => true } }, 'clear', { manager, getActiveVoiceSession: session });
	}
	assert.equal(skips, 3); assert.equal(clears, 3);
	connection.state.status = 'disconnected'; await queue.executeAction({ guildId: 'g', guild, user: { id: 'u' }, reply: async () => {} }, 'skip', { manager, getActiveVoiceSession: session }); assert.equal(skips, 3);
	connection.state.status = 'ready';
	// Execute the actual configured text-channel branch, preserving filtering/rate limits.
	const source = fs.readFileSync(require.resolve('../backend/bot/bot'), 'utf8');
	const textStart = source.indexOf('const ttsChannelId = client.ttsChannels?.get(message.guild.id);');
	const textEnd = source.indexOf('\n\tconst input = message.content.trim();', textStart);
	const vars = { tts_speaker_names_enabled: false, tts_antispam_max_messages: 1 };
	const context = { PermissionFlagsBits: discord.PermissionFlagsBits, client: { ttsChannels: new Map([['g', 'text']]) }, getActiveVoiceSession: session, isSameVoiceSession,
		database: { getGuildVar: async (_id, key) => vars[key] }, userTtsHistoryMap: new Map(), BotLogs: () => {}, COLOR: {},
		ttsVolume: () => 0.5, toBool: value => Boolean(value), setTimeout: () => {},
		require: () => ({ generateUUID: () => 'id', addToQueue: (_g, entry) => { queued.push(entry); return { success: true }; } }),
	};
	const handle = vm.runInNewContext('(async function(message){' + source.slice(textStart, textEnd) + '})', context);
	for (const callerChannel of ['a', 'b', null]) {
		const author = { id: String(callerChannel), username: 'User' };
		const msg = { guild, channel: { id: 'text' }, member: { voice: { channel: callerChannel ? { id: callerChannel } : null } }, author, content: 'Hello', react: async () => {}, reply: async () => ({ delete: async () => {} }) };
		const before = queued.length; await handle(msg); assert.equal(queued.length, before + 1); assert.equal(queued.at(-1).voice_channel.id, 'a');
		await handle(msg); assert.equal(queued.length, before + 1, 'Remote messages retain the per-guild/user rate limit');
		msg.content = '/command'; await handle(msg); assert.equal(queued.length, before + 1);
		msg.channel.id = 'other'; msg.content = 'Other'; await handle(msg); assert.equal(queued.length, before + 1);
	}
	vars.tts_antispam_enabled = false; vars.tts_max_length = 20;
	const cleanMessage = { guild, channel: { id: 'text' }, member: {}, author: { id: 'clean', username: 'Clean' }, content: 'hello https://example.test <b>long message</b>', react: async () => {} };
	await handle(cleanMessage); assert.equal(queued.at(-1).name.length, 20); assert.ok(!queued.at(-1).name.includes('https://')); assert.ok(!queued.at(-1).name.includes('<'));
	const readVar = context.database.getGuildVar;
	context.database.getGuildVar = async (...args) => { if (args[1] === 'tts_volume') connection.state.status = 'disconnected'; return readVar(...args); };
	const staleBefore = queued.length; await handle(cleanMessage); assert.equal(queued.length, staleBefore, 'Async settings cannot enqueue into a stale session');
	context.database.getGuildVar = readVar; connection.state.status = 'ready';
	// Auditor reproduction: pause settings, move the bot using the SAME connection,
	// then resume. The stale request must neither enqueue A nor retarget to B.
	const movedChannel = { ...channel, id: 'b' }; guild.channels.cache.set('b', movedChannel);
	const capturedConnection = connection, moveQueue = [];
	let releaseSettings, markPending, created = 0, moved = 0;
	const pendingSettings = new Promise(resolve => { markPending = resolve; });
	const queueRequire = context.require;
	context.require = () => ({ generateUUID: () => 'move-test', addToQueue: (_guild, entry) => { moveQueue.push(entry); return { success: true }; } });
	context.getOrCreateConnection = () => { created++; throw Error('Text TTS must not create a connection'); };
	guild.members.me.voice.setChannel = () => { moved++; throw Error('Text TTS must not move the bot'); };
	context.database.getGuildVar = async (...args) => args[1] === 'tts_volume'
		? new Promise(resolve => { releaseSettings = resolve; markPending(); }) : readVar(...args);
	const awaitingText = handle(cleanMessage); await pendingSettings;
	connection.joinConfig.channelId = 'b'; guild.members.me.voice.channelId = 'b'; guild.members.me.voice.channel = movedChannel;
	assert.equal(connection, capturedConnection, 'Move deliberately reuses the original connection object');
	releaseSettings(0.5); await awaitingText;
	assert.equal(moveQueue.length, 0, 'Same-object A→B move must reject the stale configured text-TTS request');
	assert.equal(guild.members.me.voice.channelId, 'b'); assert.equal(connection.joinConfig.channelId, 'b');
	context.database.getGuildVar = readVar; await handle(cleanMessage);
	assert.equal(moveQueue.length, 1, 'A fresh request may use the new destination');
	assert.equal(moveQueue[0].voice_channel.id, 'b'); assert.equal(moveQueue[0].connection, capturedConnection);
	assert.equal(moveQueue[0].voice_channel.id, moveQueue[0].connection.joinConfig.channelId);
	assert.equal(created, 0); assert.equal(moved, 0);
	context.require = queueRequire; guild.members.me.voice.channelId = 'a'; guild.members.me.voice.channel = channel; connection.joinConfig.channelId = 'a';
	// The authenticated dashboard IPC path must use the same session, never a stale queue or guessed destination.
	const ipcStart = source.indexOf("else if (msg.type === 'force_add_audio_queue')");
	const ipcEnd = source.indexOf("else if (msg.type === 'clear_all_audio_queues')", ipcStart);
	const responses = [], ipcQueue = [];
	const ipc = vm.runInNewContext('(async function(msg){if(false) {} ' + source.slice(ipcStart, ipcEnd) + '})', {
		client: { guilds: { cache: new Map([['g', guild]]) } }, getActiveVoiceSession: session,
		process: { send: reply => responses.push(reply) },
		require: () => ({ audioQueueManager: { getQueue: () => { throw Error('Do not infer destination from queue'); } }, addToQueue: (...args) => { ipcQueue.push(args); return { id: 'queued' }; } }),
	});
	await ipc({ type: 'force_add_audio_queue', guildId: 'g', text: 'Remote dashboard' });
	assert.equal(ipcQueue.length, 1); assert.equal(ipcQueue[0][2], connection); assert.equal(responses.at(-1).success, true);
	connection.state.status = 'destroyed'; await ipc({ type: 'force_add_audio_queue', guildId: 'g', text: 'No connection' });
	assert.equal(ipcQueue.length, 1); assert.equal(responses.at(-1).success, false); connection.state.status = 'ready';
	context.client.ttsChannels.clear(); const before = queued.length;
	await handle({ guild, channel: { id: 'text' }, content: 'disabled' }); assert.equal(queued.length, before);
	const joined = [];
	for (const callerChannel of ['a', 'b', null]) {
		const interaction = { guild, member: { voice: { channel: callerChannel ? { id: callerChannel, name: callerChannel } : null } }, deferReply: async () => {}, editReply: async () => {} };
		await command('join', {
			getReadyVoiceConnection: async (_guild, channel) => { joined.push(channel.id); return connection; },
			getActiveVoiceSession: () => ({ connection, channelId: callerChannel }),
		}).execute(interaction);
	}
	assert.deepEqual(joined, ['a', 'b'], '/join still chooses the caller destination and requires caller voice membership');
	const changedReplies = [];
	await command('join', { getReadyVoiceConnection: async () => connection, getActiveVoiceSession: session, voiceConnectionError }).execute({
		guild, member: { voice: { channel: { id: 'b', name: 'B' } } }, deferReply: async () => {}, editReply: async reply => changedReplies.push(reply),
	});
	assert.ok(changedReplies.at(-1).startsWith('❌'), '/join must revalidate its target before replying, even if the awaited helper returned');
	console.log('PASS: real say/play and text-channel remote paths, same/different/no caller voice, no implicit join, stale/wrong guild rejection, requester/manager controls and join preservation');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
