'use strict';

const {
	VoiceConnectionStatus, entersState, getVoiceConnection, joinVoiceChannel,
} = require('@discordjs/voice');

const defaultVoice = { entersState, getVoiceConnection, joinVoiceChannel };

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
	return { connection, created };
}

async function getReadyVoiceConnection(guild, channel, options = {}) {
	const voice = options.voice || defaultVoice;
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
}

module.exports = { getOrCreateVoiceConnection, getReadyVoiceConnection, voiceConnectionError };
