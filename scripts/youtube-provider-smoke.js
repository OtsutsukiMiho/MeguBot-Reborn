'use strict';

const { StreamType, createAudioResource } = require('@discordjs/voice');
const { YouTubeProvider, canonicalUrl } = require('../backend/bot/youtube_provider.js');

const DEFAULT_VIDEO_ID = 'jNQXAC9IVRw';
const MINIMUM_AUDIO_BYTES = 32 * 1024;
const STREAM_TIMEOUT_MS = 30000;

function clean(value) {
	return String(value || '').replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

async function readAudioSample(stream, controller, minimumBytes = MINIMUM_AUDIO_BYTES) {
	return await new Promise((resolve, reject) => {
		let bytes = 0;
		let settled = false;
		const finish = (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			stream.removeListener('data', onData);
			stream.removeListener('end', onEnd);
			stream.removeListener('error', onError);
			if (error) reject(error);
			else resolve(bytes);
		};
		const onData = chunk => {
			bytes += chunk.length;
			if (bytes >= minimumBytes) {
				controller.abort();
				finish();
			}
		};
		const onEnd = () => bytes > 0 ? finish() : finish(new Error('provider stream ended without audio bytes'));
		const onError = error => finish(error);
		const timer = setTimeout(() => {
			controller.abort();
			finish(new Error(`provider produced fewer than ${minimumBytes} audio bytes within ${STREAM_TIMEOUT_MS}ms`));
		}, STREAM_TIMEOUT_MS);
		stream.on('data', onData);
		stream.once('end', onEnd);
		stream.once('error', onError);
	});
}

async function smoke(provider, videoId = DEFAULT_VIDEO_ID) {
	const digest = await provider.checkDigest(process.env.MEGU_YOUTUBE_YTDLP_SHA256);
	const version = await provider.checkBinary();
	const runtime = await provider.checkRuntime();
	const metadata = await provider.getVideo(videoId);
	const controller = new AbortController();
	const opened = await provider.openAudio(videoId, controller.signal);
	let resource;
	try {
		resource = createAudioResource(opened.stream, { inputType: StreamType.Arbitrary });
		const bytes = await readAudioSample(resource.playStream, controller);
		return { digest, version, runtime, metadata, bytes };
	}
	finally {
		controller.abort();
		resource?.playStream?.destroy();
		opened.dispose?.();
	}
}

async function main() {
	require('dotenv').config({ quiet: true });
	const videoId = process.argv[2] || process.env.MEGU_YOUTUBE_SMOKE_VIDEO_ID || DEFAULT_VIDEO_ID;
	const result = await smoke(new YouTubeProvider(), videoId);
	console.log(`yt-dlp ${clean(result.version)} ready (SHA-256 ${clean(result.digest).slice(0, 12)}… verified)`);
	console.log(`${clean(result.runtime.name)} ${clean(result.runtime.version)} JavaScript runtime ready`);
	console.log(`metadata ${clean(result.metadata.title)} (${result.metadata.durationSeconds}s) ${canonicalUrl(result.metadata.videoId)}`);
	console.log(`voice-ready audio stream ${result.bytes} bytes received through FFmpeg and cancelled cleanly`);
}

if (require.main === module) {
	main().catch(error => {
		console.error(`YouTube provider smoke failed: ${clean(error?.message || error)}`);
		process.exitCode = 1;
	});
}

module.exports = { DEFAULT_VIDEO_ID, MINIMUM_AUDIO_BYTES, readAudioSample, smoke };
