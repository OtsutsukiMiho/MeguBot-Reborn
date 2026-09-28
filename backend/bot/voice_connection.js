'use strict';

const {
	VoiceConnectionStatus, entersState, getVoiceConnection, joinVoiceChannel,
} = require('@discordjs/voice');

const defaultVoice = { entersState, getVoiceConnection, joinVoiceChannel };
const connectionMetadata = new WeakMap();
const pendingByGuild = new Map();

function normalizeError(error) {
	return String(error?.stack || error?.message || error || 'Unknown voice connection error').replace(/[\r\n]+/g, ' ').slice(0, 600);
}

function defaultErrorLogger(details) {
	console.error(`[Voice] ${details.guildName || details.guildId || 'unknown guild'} / ${details.channelName || details.channelId || 'unknown channel'}: ${normalizeError(details.error)}`);
}

/**
 * A VoiceConnection is an EventEmitter of its own. discord.js Client error
 * handlers do not receive these errors, and an unhandled one terminates Node.
 * Keep this listener for the entire lifetime of the connection, including
 * teardown: UDP discovery can reject after destroy() has already started.
 */
function protectVoiceConnection(connection, context = {}) {
	if (!connection || typeof connection.on !== 'function') return connection;
	const definedContext = Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined));
	const existing = connectionMetadata.get(connection);
	if (existing) {
		existing.context = { ...existing.context, ...definedContext };
		return connection;
	}

	const metadata = { context: definedContext, destroying: false };
	const onError = (error) => {
		const details = { ...metadata.context, error, status: connection.state?.status || 'unknown' };
		try {
			(metadata.context.onError || defaultErrorLogger)(details);
		}
		catch (logError) {
			console.error(`[Voice] Error logger failed: ${normalizeError(logError)}`);
		}

		if (metadata.context.destroyOnError === false || metadata.destroying) return;
		metadata.destroying = true;
		queueMicrotask(() => {
			try {
				if (connection.state?.status !== VoiceConnectionStatus.Destroyed && connection.state?.status !== 'destroyed') {
					connection.destroy();
				}
			}
			catch (destroyError) {
				try { (metadata.context.onError || defaultErrorLogger)({ ...details, error: destroyError, phase: 'destroy' }); }
				catch {
					// Error reporting must never recreate the process-level crash.
				}
			}
		});
	};

	metadata.onError = onError;
	connectionMetadata.set(connection, metadata);
	connection.on('error', onError);
	return connection;
}

function voiceConnectionError(cause) {
	return Object.assign(new Error('Discord voice connection did not become ready.'), {
		code: 'voice_connection_failed',
		cause,
	});
}

function getOrCreateVoiceConnection(guild, channel, options = {}) {
	if (!guild?.id || !channel?.id) throw voiceConnectionError(new Error('Guild and voice channel are required.'));
	const voice = options.voice || defaultVoice;
	let connection = voice.getVoiceConnection(guild.id);
	const wrongChannel = connection && String(connection.joinConfig?.channelId || '') !== String(channel.id);
	const destroyed = connection?.state?.status === VoiceConnectionStatus.Destroyed || connection?.state?.status === 'destroyed';
	let created = false;
	if (!connection || destroyed || wrongChannel) {
		connection = voice.joinVoiceChannel({
			channelId: channel.id,
			guildId: guild.id,
			adapterCreator: guild.voiceAdapterCreator,
			selfDeaf: options.selfDeaf !== false,
		});
		created = true;
	}
	protectVoiceConnection(connection, {
		guildId: guild.id,
		guildName: guild.name,
		channelId: channel.id,
		channelName: channel.name,
		onError: options.onError,
		destroyOnError: options.destroyOnError,
	});
	return { connection, created };
}

async function getReadyVoiceConnection(guild, channel, options = {}) {
	const voice = options.voice || defaultVoice;
	const guildId = String(guild?.id || '');
	const channelId = String(channel?.id || '');
	const pending = pendingByGuild.get(guildId);
	if (pending?.channelId === channelId) return pending.promise;

	const previous = pending?.promise.catch(() => undefined) || Promise.resolve();
	const entry = { channelId, promise: null };
	entry.promise = previous.then(async () => {
		const { connection, created } = getOrCreateVoiceConnection(guild, channel, { ...options, voice });
		try {
			await voice.entersState(connection, VoiceConnectionStatus.Ready, options.timeoutMs || 15000);
			return connection;
		}
		catch (cause) {
			if (created) {
				try { connection.destroy(); }
				catch {
					// The failed connection may already have destroyed itself.
				}
			}
			throw voiceConnectionError(cause);
		}
	}).finally(() => {
		if (pendingByGuild.get(guildId) === entry) pendingByGuild.delete(guildId);
	});
	pendingByGuild.set(guildId, entry);
	return entry.promise;
}

module.exports = {
	getOrCreateVoiceConnection,
	getReadyVoiceConnection,
	protectVoiceConnection,
	voiceConnectionError,
};
