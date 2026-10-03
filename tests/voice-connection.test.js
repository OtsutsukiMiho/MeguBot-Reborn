'use strict';

const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const discordVoice = require('@discordjs/voice');
const { VoiceConnectionStatus } = require('@discordjs/voice');
const {
	getOrCreateVoiceConnection,
	getReadyVoiceConnection,
	protectVoiceConnection,
	getActiveVoiceSession,
	isSameVoiceSession,
	voiceConnectionError,
} = require('../backend/bot/voice_connection.js');

let checks = 0;
function ok(message) {
	checks++;
	console.log(`  ok  ${message}`);
}
function flush() { return new Promise(resolve => setImmediate(resolve)); }

class MockConnection extends EventEmitter {
	constructor(channelId = 'voice-a') {
		super();
		this.joinConfig = { channelId };
		this.state = { status: VoiceConnectionStatus.Connecting };
		this.destroyCalls = 0;
	}

	destroy() {
		this.destroyCalls++;
		this.state = { status: VoiceConnectionStatus.Destroyed };
	}
}

function guild() {
	const client = new EventEmitter(), me = { id: 'test-bot', voice: { channelId: null } };
	client.user = { id: me.id };
	return { id: 'guild-a', name: 'Guild A', voiceAdapterCreator: {}, client, members: { me },
		channels: { cache: new Map(['voice-a', 'voice-b'].map(id => [id, channel(id)])) } };
}

function channel(id = 'voice-a') {
	return { id, name: `Channel ${id}`, type: 2 };
}

function joinFixture(id, status = VoiceConnectionStatus.Disconnected) {
	const client = new EventEmitter(), signals = [], replies = [];
	const me = { id: 'test-bot', voice: { channelId: status === VoiceConnectionStatus.Ready ? 'a' : null } };
	client.user = { id: me.id };
	const g = { id, name: id, client, members: { me } };
	g.channels = { cache: new Map(['a', 'b', 'c'].map(id => [id, { id, name: id, guildId: g.id, type: 2 }])) };
	let adapter;
	g.voiceAdapterCreator = methods => {
		adapter = methods;
		return { sendPayload: payload => { if (payload.d.channel_id) signals.push(payload.d.channel_id); return true; }, destroy() {} };
	};
	let connection = discordVoice.joinVoiceChannel({ guildId: g.id, channelId: 'a', adapterCreator: g.voiceAdapterCreator });
	connection.state = { ...connection.state, status, reason: discordVoice.VoiceConnectionDisconnectReason.WebSocketClose, closeCode: 4014 };
	connection.addStatePacket({ channel_id: me.voice.channelId });
	signals.length = 0;
	const file = path.resolve('commands/utility/join.js'), loaded = { exports: {} };
	vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
		module: loaded,
		require: name => name.includes('voice_connection') ? {
			getReadyVoiceConnection: (guild, target, options) => getReadyVoiceConnection(guild, target, { ...options, timeoutMs: 100 }),
			getActiveVoiceSession,
			voiceConnectionError,
		} : name.includes('bot_functions') ? { BotLogs() {}, COLOR: {} } : require(name),
	}, { filename: file });
	return {
		g, signals, replies,
		join(target) { return loaded.exports.execute({ guild: g, member: { voice: { channel: g.channels.cache.get(target) } },
			deferReply: async () => {}, editReply: async message => replies.push({ target, actual: me.voice.channelId, message }) }); },
		ack(target, ready = true) {
			const old = { guild: g, id: me.id, channelId: me.voice.channelId };
			me.voice.channelId = target;
			connection = discordVoice.getVoiceConnection(g.id);
			adapter.onVoiceStateUpdate({ guild_id: g.id, user_id: me.id, channel_id: target });
			if (ready) connection.state = { ...connection.state, status: VoiceConnectionStatus.Ready };
			client.emit('voiceStateUpdate', old, { guild: g, id: me.id, channelId: target });
		},
		connection: () => discordVoice.getVoiceConnection(g.id),
		close() { discordVoice.getVoiceConnection(g.id)?.destroy(); },
	};
}

async function main() {
	{
		const fixture = joinFixture('auditor-delayed-a-b-a');
		const initialConnection = fixture.connection();
		const timerCount = () => process.getActiveResourcesInfo().filter(type => type === 'Timeout').length;
		const initialTimers = timerCount();
		try {
			const requests = [fixture.join('a'), fixture.join('b'), fixture.join('a')];
			await flush(); assert.deepEqual(fixture.signals, ['a']);
			fixture.ack('a'); await flush();
			assert.deepEqual(fixture.signals, ['a', 'b']);
			const premature = fixture.replies.some(reply => reply.target === 'b' && reply.message.startsWith('✅'));
			// Hold B's authoritative voice-state acknowledgement until after the
			// buggy implementation would have reported every command successful.
			fixture.ack('b'); await flush();
			if (fixture.signals.length === 3) fixture.ack('a');
			await Promise.all(requests); await flush();
			assert.equal(premature, false, 'Ready A must not report success for unacknowledged B');
			assert.deepEqual(fixture.signals, ['a', 'b', 'a']);
			assert.equal(fixture.g.members.me.voice.channelId, 'a');
			assert.equal(fixture.connection().joinConfig.channelId, 'a');
			assert.equal(fixture.connection(), initialConnection, 'all transitions reuse one registry connection');
			assert.ok(fixture.replies.every(reply => !reply.message.startsWith('✅') || reply.target === reply.actual));
			assert.equal(fixture.g.client.listenerCount('voiceStateUpdate'), 0);
			assert.equal(fixture.connection().listenerCount('stateChange'), 0);
			assert.equal(timerCount(), initialTimers);
			ok('exact actual-command delayed A→B→A race acknowledges each target, settles in A and leaks no waiters/timers');
		}
		finally { fixture.close(); }
	}
	{
		const fixture = joinFixture('delayed-a-b', VoiceConnectionStatus.Ready);
		try {
			const request = fixture.join('b'); await flush();
			assert.equal(fixture.connection().state.status, VoiceConnectionStatus.Ready);
			assert.deepEqual(fixture.signals, ['b']); assert.equal(fixture.replies.length, 0);
			fixture.g.client.emit('voiceStateUpdate', {}, { guild: fixture.g, id: 'other-human', channelId: 'b' });
			await flush(); assert.equal(fixture.replies.length, 0, 'another member is not the bot acknowledgement');
			fixture.ack('b'); await request;
			assert.ok(fixture.replies[0].message.startsWith('✅')); assert.equal(fixture.replies[0].actual, 'b');
			ok('Ready A→B waits for the bot gateway acknowledgement, ignoring unrelated member updates');
		}
		finally { fixture.close(); }
	}
	{
		const fixture = joinFixture('delayed-a-b-c', VoiceConnectionStatus.Ready);
		try {
			const requests = [fixture.join('a'), fixture.join('b'), fixture.join('c')]; await flush();
			assert.deepEqual(fixture.signals, ['b']);
			assert.ok(fixture.replies.every(reply => reply.target === 'a'));
			fixture.ack('b'); await flush(); assert.deepEqual(fixture.signals, ['b', 'c']);
			assert.ok(!fixture.replies.some(reply => reply.target === 'c'));
			// An old-target update while C is pending cannot satisfy the C waiter.
			fixture.ack('b'); await flush();
			assert.ok(!fixture.replies.some(reply => reply.target === 'c'));
			fixture.ack('c'); await Promise.all(requests);
			assert.equal(fixture.g.members.me.voice.channelId, 'c');
			assert.ok(fixture.replies.every(reply => reply.target === reply.actual));
			assert.equal(fixture.g.client.listenerCount('voiceStateUpdate'), 0);
			ok('A→B→C executes in guild order; a delayed old-target update cannot satisfy C');
		}
		finally { fixture.close(); }
	}
	{
		const fixture = joinFixture('concurrent-acknowledged-a');
		try {
			const requests = [fixture.join('a'), fixture.join('a'), fixture.join('a')]; await flush();
			assert.deepEqual(fixture.signals, ['a']);
			fixture.ack('a', false); await flush();
			assert.equal(fixture.replies.length, 0, 'acknowledgement without Ready is insufficient');
			fixture.connection().state = { ...fixture.connection().state, status: VoiceConnectionStatus.Ready };
			await Promise.all(requests);
			assert.equal(fixture.replies.length, 3);
			assert.ok(fixture.replies.every(reply => reply.message.startsWith('✅') && reply.actual === 'a'));
			assert.equal(fixture.g.client.listenerCount('voiceStateUpdate'), 0);
			assert.equal(fixture.connection().listenerCount('error'), 1);
			ok('same-target callers coalesce one signal and all wait for acknowledgement AND Ready');
		}
		finally { fixture.close(); }
	}
	{
		const fixture = joinFixture('failed-then-fresh', VoiceConnectionStatus.Ready);
		try {
			const original = fixture.connection();
			await Promise.all([fixture.join('b'), fixture.join('b')]);
			assert.equal(fixture.connection(), undefined);
			assert.equal(original.state.status, VoiceConnectionStatus.Destroyed);
			assert.equal(fixture.replies.length, 2);
			assert.ok(fixture.replies.every(reply => reply.message.startsWith('❌')));
			assert.equal(fixture.g.client.listenerCount('voiceStateUpdate'), 0);
			assert.equal(original.listenerCount('stateChange'), 0);
			assert.equal(original.listenerCount('error'), 1);
			const recovery = fixture.join('a'); await flush();
			assert.deepEqual(fixture.signals, ['b', 'a']);
			fixture.ack('a'); await recovery;
			assert.ok(fixture.replies.at(-1).message.startsWith('✅'));
			assert.notEqual(fixture.connection(), original);
			ok('failed target transition fails all coalesced commands, removes waiters and permits a fresh join');
		}
		finally { fixture.close(); }
	}
	{
		const held = joinFixture('guild-held', VoiceConnectionStatus.Ready), other = joinFixture('guild-independent', VoiceConnectionStatus.Ready);
		try {
			const first = held.join('b'), second = other.join('c'); await flush();
			assert.deepEqual(held.signals, ['b']); assert.deepEqual(other.signals, ['c']);
			other.ack('c'); await second; assert.equal(held.replies.length, 0);
			held.ack('b'); await first;
			assert.equal(other.replies[0].actual, 'c'); assert.equal(held.replies[0].actual, 'b');
			ok('an unacknowledged guild transition does not block a different guild');
		}
		finally { held.close(); other.close(); }
	}
	{
		// The real driver retains a server-disconnected object in its registry.
		// An explicit /join must signal rejoin, rather than wait on that object.
		const g = { ...guild(), id: 'join-recovery-regression' }, c = channel();
		let connection, expectedChannel = c, recover = false, joinSignals = 0;
		const transitions = [], replies = [];
		g.voiceAdapterCreator = () => ({
			sendPayload: payload => {
				if (payload.d.channel_id) {
					joinSignals++;
					if (recover) queueMicrotask(() => {
						const current = discordVoice.getVoiceConnection(g.id);
						const oldChannel = g.members.me.voice.channelId;
						g.members.me.voice.channelId = payload.d.channel_id;
						current.addStatePacket({ channel_id: payload.d.channel_id });
						current.state = { ...current.state, status: VoiceConnectionStatus.Ready };
						g.client.emit('voiceStateUpdate', { guild: g, id: g.members.me.id, channelId: oldChannel },
							{ guild: g, id: g.members.me.id, channelId: payload.d.channel_id });
					});
				}
				return true;
			},
			destroy: () => {},
		});
		connection = discordVoice.joinVoiceChannel({ guildId: g.id, channelId: c.id, adapterCreator: g.voiceAdapterCreator });
		const player = discordVoice.createAudioPlayer();
		const subscription = connection.subscribe(player);
		connection.state = { ...connection.state, status: VoiceConnectionStatus.Disconnected,
			reason: discordVoice.VoiceConnectionDisconnectReason.WebSocketClose, closeCode: 4014 };
		connection.addStatePacket({ channel_id: null });
		connection.on('stateChange', (_old, next) => transitions.push(next.status));
		joinSignals = 0; recover = true;
		const file = path.resolve('commands/utility/join.js'), commandModule = { exports: {} };
		vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
			module: commandModule,
			require: id => id.includes('voice_connection') ? {
				getActiveVoiceSession, voiceConnectionError,
				getReadyVoiceConnection: (actualGuild, actualChannel, options) => {
						assert.equal(actualGuild, g); assert.equal(actualChannel, expectedChannel);
					return getReadyVoiceConnection(actualGuild, actualChannel, { ...options, timeoutMs: 30 });
				},
			} : id.includes('bot_functions') ? { BotLogs: () => {}, COLOR: {} } : require(id),
		}, { filename: file });
		const interaction = { guild: g, member: { voice: { channel: c } },
			deferReply: async () => {}, editReply: async message => replies.push(message) };
		try {
			await commandModule.exports.execute(interaction);
			assert.equal(replies.at(-1), '✅ Connected to the voice channel!');
			assert.equal(joinSignals, 1);
			assert.equal(discordVoice.getVoiceConnection(g.id), connection, 'driver safely rejoins the existing object');
			assert.equal(connection.joinConfig.channelId, c.id);
			assert.ok(transitions.includes(VoiceConnectionStatus.Signalling));
			assert.equal(connection.state.status, VoiceConnectionStatus.Ready);
			assert.equal(connection.state.subscription, subscription);
			assert.equal(connection.state.subscription.player, player);
			ok('actual /join re-signals a retained 4014-disconnected driver connection and reaches Ready');
			await commandModule.exports.execute(interaction);
			assert.equal(replies.at(-1), '✅ Connected to the voice channel!');
			assert.equal(joinSignals, 1, 'healthy same-channel /join must not rejoin');
			expectedChannel = channel('voice-b'); interaction.member.voice.channel = expectedChannel;
			await commandModule.exports.execute(interaction);
			assert.equal(replies.at(-1), '✅ Connected to the voice channel!');
			assert.equal(joinSignals, 2);
			assert.equal(discordVoice.getVoiceConnection(g.id), connection);
			assert.equal(connection.joinConfig.channelId, expectedChannel.id);
			assert.equal(connection.state.subscription, subscription);
			ok('actual /join reuses a healthy session and explicitly moves the same driver connection without losing its player');
			connection.destroy();
			assert.equal(discordVoice.getVoiceConnection(g.id), undefined);
			await commandModule.exports.execute(interaction);
			connection = discordVoice.getVoiceConnection(g.id);
			assert.equal(replies.at(-1), '✅ Connected to the voice channel!');
			assert.equal(joinSignals, 3);
			assert.equal(connection.joinConfig.channelId, expectedChannel.id);
			assert.equal(connection.state.status, VoiceConnectionStatus.Ready);
			ok('actual /join establishes a fresh session after destruction in the caller-selected channel');
		}
		finally { connection?.destroy(); player.stop(); }
	}
	{
		const g = { ...guild(), id: 'join-recovery-timeout-regression' }, c = channel();
		let joinSignals = 0;
		g.voiceAdapterCreator = () => ({ sendPayload: payload => { if (payload.d.channel_id) joinSignals++; return true; }, destroy: () => {} });
		const connection = discordVoice.joinVoiceChannel({ guildId: g.id, channelId: c.id, adapterCreator: g.voiceAdapterCreator });
		connection.state = { ...connection.state, status: VoiceConnectionStatus.Disconnected,
			reason: discordVoice.VoiceConnectionDisconnectReason.WebSocketClose, closeCode: 4014 };
		joinSignals = 0;
		try {
			await assert.rejects(getReadyVoiceConnection(g, c, { timeoutMs: 30, onError: () => {} }),
				error => error.code === 'voice_connection_failed' && error.cause?.code === 'ABORT_ERR');
			assert.equal(joinSignals, 1);
			assert.equal(connection.state.status, VoiceConnectionStatus.Destroyed);
			assert.equal(discordVoice.getVoiceConnection(g.id), undefined);
			ok('unsuccessful explicit rejoin preserves timeout cause and removes the failed retained connection');
		}
		finally { if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy(); }
	}
	{
		const a = { id: 'voice-a', type: 2, guildId: 'guild-a' }, b = { ...a, id: 'voice-b' };
		const me = { voice: { channelId: a.id } };
		const g = { ...guild(), members: { me }, channels: { cache: new Map([[a.id, a], [b.id, b]]) } };
		let connection = new MockConnection(a.id); connection.state.status = VoiceConnectionStatus.Ready;
		connection.joinConfig.guildId = g.id;
		const voice = { getVoiceConnection: () => connection };
		const capture = getActiveVoiceSession(g, voice);
		assert.equal(isSameVoiceSession(capture, getActiveVoiceSession(g, voice)), true);
		connection.joinConfig.channelId = b.id; me.voice.channelId = b.id;
		assert.equal(capture.connection, connection); assert.equal(capture.channelId, a.id);
		assert.equal(isSameVoiceSession(capture, getActiveVoiceSession(g, voice)), false);
		const fresh = getActiveVoiceSession(g, voice);
		assert.equal(isSameVoiceSession(fresh, getActiveVoiceSession(g, voice)), true);
		assert.equal(isSameVoiceSession(fresh, { ...fresh, guildId: 'other' }), false);
		for (const status of ['destroyed', 'disconnected', 'connecting']) {
			connection.state.status = status;
			assert.equal(isSameVoiceSession(fresh, getActiveVoiceSession(g, voice)), false);
		}
		connection = null; assert.equal(isSameVoiceSession(fresh, getActiveVoiceSession(g, voice)), false);
		connection = new MockConnection(b.id); connection.state.status = VoiceConnectionStatus.Ready;
		assert.equal(isSameVoiceSession(fresh, getActiveVoiceSession(g, voice)), false);
		connection.joinConfig.guildId = 'other'; assert.equal(getActiveVoiceSession(g, voice), null);
		assert.equal(isSameVoiceSession(null, fresh), false);
		assert.equal(isSameVoiceSession({}, {}), false);
		ok('session snapshots reject same-object channel moves, wrong guild, replaced/missing and unready connections');
	}
	{
		const connection = new MockConnection();
		const errors = [];
		protectVoiceConnection(connection, { guildId: 'guild-a', onError: details => errors.push(details) });
		protectVoiceConnection(connection, { channelId: 'voice-a', onError: details => errors.push(details) });
		protectVoiceConnection(connection, { channelName: 'Voice A', onError: undefined });
		assert.equal(connection.listenerCount('error'), 1);

		connection.emit('error', new Error('Cannot perform IP discovery - socket closed'));
		await flush();
		assert.equal(errors.length, 1);
		assert.equal(connection.destroyCalls, 1);

		connection.emit('error', new Error('late teardown error'));
		await flush();
		assert.equal(errors.length, 2);
		assert.equal(connection.destroyCalls, 1);
		assert.equal(connection.listenerCount('error'), 1);
		ok('one persistent listener handles discovery and late teardown errors without repeated destruction');
	}

	{
		let current = null;
		let joins = 0;
		const g = guild();
		const voice = {
			getVoiceConnection: () => current,
			joinVoiceChannel: options => {
				joins++;
				current = new MockConnection(options.channelId);
				queueMicrotask(() => {
					current.state = { status: VoiceConnectionStatus.Ready };
					g.members.me.voice.channelId = options.channelId;
					g.client.emit('voiceStateUpdate', {}, { guild: g, id: g.members.me.id, channelId: options.channelId });
				});
				return current;
			},
		};
		const first = getReadyVoiceConnection(g, channel(), { voice, onError: () => undefined });
		const second = getReadyVoiceConnection(g, channel(), { voice, onError: () => undefined });
		const [a, b] = await Promise.all([first, second]);
		assert.equal(joins, 1);
		assert.equal(a, b);
		assert.equal(a.listenerCount('error'), 1);
		ok('simultaneous joins to one channel are coalesced');
	}

	{
		const connection = new MockConnection();
		const cause = new Error('voice networking failed');
		const voice = {
			getVoiceConnection: () => null,
			joinVoiceChannel: () => { queueMicrotask(() => connection.emit('error', cause)); return connection; },
		};
		await assert.rejects(
			getReadyVoiceConnection(guild(), channel(), { voice, onError: () => undefined }),
			error => error.code === 'voice_connection_failed' && error.cause === cause,
		);
		assert.equal(connection.destroyCalls, 1);
		assert.equal(connection.listenerCount('error'), 1);
		connection.emit('error', new Error('late after timeout'));
		await flush();
		assert.equal(connection.destroyCalls, 1);
		ok('readiness failure preserves its cause and remains safe after destruction');
	}

	{
		const connection = new MockConnection();
		const voice = {
			getVoiceConnection: () => connection,
			joinVoiceChannel: () => { throw new Error('should not join'); },
		};
		const first = getOrCreateVoiceConnection(guild(), channel(), { voice, onError: () => undefined });
		const second = getOrCreateVoiceConnection(guild(), channel(), { voice, onError: () => undefined });
		assert.equal(first.created, false);
		assert.equal(second.created, false);
		assert.equal(connection.listenerCount('error'), 1);
		ok('reusing a connection does not accumulate persistent listeners');
	}

	console.log(`\n${checks} checks passed\n`);
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
