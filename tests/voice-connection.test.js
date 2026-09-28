'use strict';

const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { VoiceConnectionStatus } = require('@discordjs/voice');
const {
	getOrCreateVoiceConnection,
	getReadyVoiceConnection,
	protectVoiceConnection,
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
	return { id: 'guild-a', name: 'Guild A', voiceAdapterCreator: {} };
}

function channel(id = 'voice-a') {
	return { id, name: `Channel ${id}` };
}

async function main() {
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
		const voice = {
			getVoiceConnection: () => current,
			joinVoiceChannel: options => {
				joins++;
				current = new MockConnection(options.channelId);
				return current;
			},
			entersState: async connection => {
				await flush();
				connection.state = { status: VoiceConnectionStatus.Ready };
				return connection;
			},
		};
		const first = getReadyVoiceConnection(guild(), channel(), { voice, onError: () => undefined });
		const second = getReadyVoiceConnection(guild(), channel(), { voice, onError: () => undefined });
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
			joinVoiceChannel: () => connection,
			entersState: async () => { throw cause; },
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
