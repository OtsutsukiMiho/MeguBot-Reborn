'use strict';

const {
	VoiceConnectionStatus, getVoiceConnection, joinVoiceChannel,
} = require('@discordjs/voice');

const defaultVoice = { getVoiceConnection, joinVoiceChannel };
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

// Read-only: control never creates, moves or repairs a voice connection.
function getActiveVoiceSession(guild, voice = defaultVoice) {
	if (!guild?.id) return null;
	const channelId = guild.members?.me?.voice?.channelId;
	const channel = guild.channels?.cache?.get(channelId);
	const connection = voice.getVoiceConnection(guild.id);
	if (!channel || ![2, 13].includes(channel.type) || !connection
		|| (channel.guildId && String(channel.guildId) !== String(guild.id))
		|| connection.state?.status !== VoiceConnectionStatus.Ready
		|| String(connection.joinConfig?.channelId || '') !== String(channelId || '')
		|| (connection.joinConfig?.guildId && String(connection.joinConfig.guildId) !== String(guild.id))) return null;
	// Preserve scalar identity: Discord can move/reconfigure this same connection.
	return { guildId: String(guild.id), channelId: String(channelId), channel, connection };
}

function isSameVoiceSession(captured, current) {
	return Boolean(captured && current && current.guildId && current.channelId && current.connection
		&& captured.guildId === current.guildId && captured.channelId === current.channelId
		&& captured.connection === current.connection);
}

function getOrCreateVoiceConnection(guild, channel, options = {}) {
	if (!guild?.id || !channel?.id) throw voiceConnectionError(new Error('Guild and voice channel are required.'));
	const voice = options.voice || defaultVoice;
	let connection = voice.getVoiceConnection(guild.id);
	const wrongChannel = connection && String(connection.joinConfig?.channelId || '') !== String(channel.id);
	const destroyed = connection?.state?.status === VoiceConnectionStatus.Destroyed || connection?.state?.status === 'destroyed';
	const disconnected = connection?.state?.status === VoiceConnectionStatus.Disconnected;
	let created = false;
	if (!connection || destroyed || disconnected || wrongChannel) {
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

	// One acknowledged transition at a time per guild; coalesce only the last
	// queued target so A→B→A cannot reuse the first A and skip the final move.
	const previous = pending?.promise.catch(() => undefined) || Promise.resolve();
	const entry = { channelId, promise: null };
	entry.promise = previous.then(async () => {
		let connection, created = false;
		try {
			// Ready can persist during a channel move, and rejoin mutates joinConfig
			// before acknowledgement. Discord.js's bot voice-state cache is updated
			// by the gateway before voiceStateUpdate; use that public acknowledgement.
			if (!guild.client?.on || !guild.client?.off) throw new Error('Discord voice-state events are unavailable.');
			await new Promise((resolve, reject) => {
				let acknowledged = false, settled = false;
				const finish = error => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					guild.client.off('voiceStateUpdate', onVoiceState);
					connection?.off('stateChange', check);
					connection?.off('error', onConnectionError);
					if (error) reject(error); else resolve();
				};
				const check = () => {
					if (connection?.state?.status === VoiceConnectionStatus.Destroyed) return finish(new Error('Voice connection was destroyed.'));
					const current = getActiveVoiceSession(guild, voice);
					if (acknowledged && current?.connection === connection && current?.channelId === channelId) finish();
				};
				const onVoiceState = (_old, current) => {
					if (String(current.guild?.id) !== guildId || current.id !== guild.members?.me?.id) return;
					acknowledged = String(current.channelId || '') === channelId;
					check();
				};
				const onConnectionError = error => finish(error);
				const timer = setTimeout(() => finish(Object.assign(new Error('The operation was aborted'), {
					name: 'AbortError', code: 'ABORT_ERR',
				})), options.timeoutMs || 15000);
				guild.client.on('voiceStateUpdate', onVoiceState);
				try {
					({ connection, created } = getOrCreateVoiceConnection(guild, channel, { ...options, voice }));
					// Healthy reuse needs no new gateway event. An initiated transition
					// must receive its own acknowledgement, even for the same target.
					if (!created) acknowledged = String(guild.members.me?.voice?.channelId || '') === channelId;
					connection.on('stateChange', check);
					connection.on('error', onConnectionError);
					check();
				}
				catch (error) { finish(error); }
			});
			const current = getActiveVoiceSession(guild, voice);
			if (current?.connection !== connection || current?.channelId !== channelId) throw new Error('Voice destination changed before connection completed.');
			return connection;
		}
		catch (cause) {
			if (created && connection?.state?.status !== VoiceConnectionStatus.Destroyed) {
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
	getActiveVoiceSession,
	isSameVoiceSession,
	getOrCreateVoiceConnection,
	getReadyVoiceConnection,
	protectVoiceConnection,
	voiceConnectionError,
};
