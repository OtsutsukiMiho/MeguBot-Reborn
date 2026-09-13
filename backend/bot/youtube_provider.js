'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
	'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
	'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);
const MAX_SEARCH_LENGTH = 200;
const MAX_URL_LENGTH = 2048;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

function boundedNumber(value, fallback, min, max) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function providerError(code, message, cause) {
	const error = new Error(message || code);
	error.code = code;
	if (cause) error.cause = cause;
	return error;
}

async function sha256File(filePath) {
	const hash = crypto.createHash('sha256');
	await new Promise((resolve, reject) => {
		const stream = fs.createReadStream(filePath);
		stream.on('error', reject);
		stream.on('data', chunk => hash.update(chunk));
		stream.on('end', resolve);
	});
	return hash.digest('hex');
}

function canonicalUrl(videoId) {
	if (!VIDEO_ID.test(String(videoId || ''))) throw providerError('youtube_invalid_video', 'Invalid YouTube video ID.');
	return `https://www.youtube.com/watch?v=${videoId}`;
}

function parseInput(value) {
	const input = String(value || '').trim();
	if (!input) throw providerError('youtube_query_required', 'A YouTube link or search is required.');
	if (input.length > MAX_URL_LENGTH) throw providerError('youtube_input_too_long', 'The YouTube input is too long.');

	const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(input);
	const looksLikeDomain = /^(?:www\.)?[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+(?:[/:?#]|$)/i.test(input);
	const looksLikeUrl = hasScheme || looksLikeDomain;
	if (!looksLikeUrl) {
		if (input.length > MAX_SEARCH_LENGTH) throw providerError('youtube_search_too_long', 'The YouTube search is too long.');
		return { kind: 'search', query: input };
	}

	let url;
	try { url = new URL(hasScheme ? input : `https://${input}`); }
	catch (error) { throw providerError('youtube_invalid_url', 'The YouTube link is invalid.', error); }
	if (url.protocol !== 'https:' || url.username || url.password || url.port || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
		throw providerError('youtube_invalid_url', 'Only HTTPS YouTube video links are supported.');
	}

	const host = url.hostname.toLowerCase();
	let videoId = '';
	if (host === 'youtu.be' || host === 'www.youtu.be') {
		videoId = url.pathname.split('/').filter(Boolean)[0] || '';
	}
	else if (url.pathname === '/watch') {
		videoId = url.searchParams.get('v') || '';
	}
	else {
		const parts = url.pathname.split('/').filter(Boolean);
		if (['shorts', 'live', 'embed'].includes(parts[0])) videoId = parts[1] || '';
	}
	if (!videoId && url.pathname === '/playlist') throw providerError('youtube_playlist_unsupported', 'Playlist-only links are not supported.');
	if (!VIDEO_ID.test(videoId)) throw providerError('youtube_invalid_video', 'The link does not contain a supported YouTube video.');
	return { kind: 'video', videoId, url: canonicalUrl(videoId) };
}

function normalizeVideo(info, maxDurationSeconds = 900) {
	const videoId = String(info?.id || info?.url || '').trim();
	if (!VIDEO_ID.test(videoId)) throw providerError('youtube_invalid_video', 'YouTube did not return a valid video ID.');
	const durationSeconds = Number(info?.duration);
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw providerError('youtube_duration_unknown', 'This video has no usable duration.');
	if (durationSeconds > maxDurationSeconds) throw providerError('youtube_too_long', 'This video is longer than the configured limit.');
	if (info?.is_live || ['is_live', 'is_upcoming', 'post_live'].includes(info?.live_status)) {
		throw providerError('youtube_live_unsupported', 'Live and upcoming videos are not supported.');
	}
	if (info?.availability && !['public', 'unlisted'].includes(info.availability)) {
		throw providerError('youtube_unavailable', 'This video is not publicly playable.');
	}
	if (Number(info?.age_limit) > 0) {
		throw providerError('youtube_unavailable', 'Age-restricted videos are not supported.');
	}
	return {
		videoId,
		title: String(info?.title || 'YouTube video').replace(/\s+/g, ' ').trim().slice(0, 200),
		channel: String(info?.channel || info?.uploader || 'YouTube').replace(/\s+/g, ' ').trim().slice(0, 100),
		durationSeconds: Math.round(durationSeconds),
		url: canonicalUrl(videoId),
	};
}

function executableArgs() {
	const args = ['--ignore-config', '--no-warnings', '--no-call-home', '--extractor-retries', '2', '--socket-timeout', '10'];
	const runtime = String(process.env.YT_DLP_JS_RUNTIME || '').trim();
	if (runtime) args.push('--js-runtimes', runtime);
	return args;
}

function terminate(child) {
	if (!child || child.killed) return;
	try { child.kill('SIGKILL'); }
	catch {
		// The process may already have exited.
	}
}

class YouTubeProvider {
	constructor(options = {}) {
		this.spawn = options.spawnImpl || spawn;
		this.executable = options.executable || process.env.YT_DLP_PATH || 'yt-dlp';
		this.timeoutMs = boundedNumber(options.timeoutMs ?? process.env.MEGU_YOUTUBE_METADATA_TIMEOUT_MS, 15000, 1000, 60000);
		this.maxDurationSeconds = boundedNumber(options.maxDurationSeconds ?? process.env.MEGU_YOUTUBE_MAX_DURATION_SECONDS, 900, 30, 7200);
	}

	async checkExecutable(executable, args, missingCode, label, signal) {
		return await new Promise((resolve, reject) => {
			let settled = false;
			let stdout = '';
			let stderr = '';
			const child = this.spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
			const done = (error, value) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				signal?.removeEventListener('abort', onAbort);
				if (error) reject(error); else resolve(value);
			};
			const onAbort = () => {
				terminate(child);
				done(providerError('youtube_cancelled', `${label} dependency check cancelled.`));
			};
			const timer = setTimeout(() => {
				terminate(child);
				done(providerError('youtube_timeout', `${label} dependency check timed out.`));
			}, Math.min(this.timeoutMs, 5000));
			if (typeof timer.unref === 'function') timer.unref();
			if (signal?.aborted) return onAbort();
			signal?.addEventListener('abort', onAbort, { once: true });
			child.once('error', error => done(providerError(error.code === 'ENOENT' ? missingCode : 'youtube_provider_failed', `${label} could not start.`, error)));
			child.stdout.on('data', chunk => {
				stdout += chunk;
				if (Buffer.byteLength(stdout) > 1024) {
					terminate(child);
					done(providerError('youtube_provider_output', `${label} version response was too large.`));
				}
			});
			child.stderr.on('data', chunk => {
				if (Buffer.byteLength(stderr) < 1024) stderr += chunk;
			});
			child.once('close', code => {
				const version = stdout.trim() || stderr.trim();
				if (code !== 0 || !version) return done(providerError('youtube_provider_failed', `${label} version check exited with code ${code}.`));
				done(null, version.slice(0, 100));
			});
		});
	}

	async checkBinary(signal) {
		return await this.checkExecutable(this.executable, ['--version'], 'youtube_provider_missing', 'yt-dlp', signal);
	}

	async checkDigest(expectedDigest) {
		const expected = String(expectedDigest || '').trim().toLowerCase();
		if (!/^[a-f\d]{64}$/.test(expected)) throw providerError('youtube_provider_digest_missing', 'Configure the verified yt-dlp SHA-256 digest.');
		if (!path.isAbsolute(this.executable)) throw providerError('youtube_provider_digest_missing', 'YT_DLP_PATH must be absolute before its digest can be verified.');
		const stat = await fs.promises.stat(this.executable).catch(() => null);
		if (!stat?.isFile()) throw providerError('youtube_provider_missing', 'The configured yt-dlp executable was not found.');
		const actual = await sha256File(this.executable);
		if (actual !== expected) throw providerError('youtube_provider_digest_mismatch', 'The configured yt-dlp executable failed SHA-256 verification.');
		return actual;
	}

	async checkRuntime(signal) {
		const configured = String(process.env.YT_DLP_JS_RUNTIME || '').trim();
		if (!configured) throw providerError('youtube_runtime_missing', 'YT_DLP_JS_RUNTIME is not configured.');
		const first = configured.split(',')[0].trim();
		const separator = first.indexOf(':');
		const name = (separator === -1 ? first : first.slice(0, separator)).toLowerCase();
		const configuredPath = separator === -1 ? '' : first.slice(separator + 1).trim();
		if (!['deno', 'node'].includes(name)) throw providerError('youtube_runtime_unsupported', 'Use a configured Node or Deno runtime for YouTube playback.');
		if (!configuredPath || !path.isAbsolute(configuredPath)) throw providerError('youtube_runtime_missing', 'Configure the YouTube JavaScript runtime with an absolute executable path.');
		const version = await this.checkExecutable(configuredPath, ['--version'], 'youtube_runtime_missing', `${name} runtime`, signal);
		if (name === 'node') {
			const major = Number(/^v?(\d+)/.exec(version)?.[1]);
			if (!Number.isFinite(major) || major < 22) throw providerError('youtube_runtime_unsupported', 'YouTube playback requires Node 22 or newer.');
		}
		return { name, version };
	}

	async runJson(args, signal) {
		return await new Promise((resolve, reject) => {
			let settled = false;
			let stdout = '';
			let stderr = '';
			const child = this.spawn(this.executable, [...executableArgs(), ...args], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
			const done = (error, value) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				signal?.removeEventListener('abort', onAbort);
				if (error) reject(error); else resolve(value);
			};
			const onAbort = () => {
				terminate(child);
				done(providerError('youtube_cancelled', 'YouTube request cancelled.'));
			};
			const timer = setTimeout(() => {
				terminate(child);
				done(providerError('youtube_timeout', 'YouTube took too long to respond.'));
			}, this.timeoutMs);
			if (typeof timer.unref === 'function') timer.unref();
			if (signal?.aborted) return onAbort();
			signal?.addEventListener('abort', onAbort, { once: true });
			child.once('error', error => done(providerError(error.code === 'ENOENT' ? 'youtube_provider_missing' : 'youtube_provider_failed', 'The YouTube provider could not start.', error)));
			child.stdout.on('data', chunk => {
				stdout += chunk;
				if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) {
					terminate(child);
					done(providerError('youtube_provider_output', 'YouTube metadata response was too large.'));
				}
			});
			child.stderr.on('data', chunk => { if (Buffer.byteLength(stderr) < 16384) stderr += chunk; });
			child.once('close', code => {
				if (code !== 0) return done(providerError('youtube_provider_failed', `YouTube provider exited with code ${code}.`));
				try { done(null, JSON.parse(stdout)); }
				catch (error) { done(providerError('youtube_provider_invalid', 'YouTube returned invalid metadata.', error)); }
			});
		});
	}

	async checkAvailable(signal) {
		return Boolean(await this.checkBinary(signal));
	}

	async search(query, signal) {
		const parsed = parseInput(query);
		if (parsed.kind !== 'search') return [await this.getVideo(parsed.videoId, signal)];
		const payload = await this.runJson(['--flat-playlist', '--dump-single-json', '--skip-download', `ytsearch5:${parsed.query}`], signal);
		const results = [];
		for (const entry of payload?.entries || []) {
			try { results.push(normalizeVideo(entry, this.maxDurationSeconds)); }
			catch {
				// Search may contain live, unavailable, or oversized entries.
			}
		}
		return results.slice(0, 5);
	}

	async getVideo(videoId, signal) {
		const payload = await this.runJson(['--no-playlist', '--dump-single-json', '--skip-download', canonicalUrl(videoId)], signal);
		return normalizeVideo(payload, this.maxDurationSeconds);
	}

	async openAudio(videoId, signal) {
		const url = canonicalUrl(videoId);
		return await new Promise((resolve, reject) => {
			let settled = false;
			let stderr = '';
			const args = [...executableArgs(), '--no-playlist', '--no-progress', '--format', 'bestaudio/best', '--output', '-', url];
			const child = this.spawn(this.executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
			const onAbort = () => terminate(child);
			const dispose = () => {
				signal?.removeEventListener('abort', onAbort);
				terminate(child);
				try { child.stdout.destroy(); }
				catch {
					// The stream may already be closed.
				}
			};
			if (signal?.aborted) {
				dispose();
				return reject(providerError('youtube_cancelled', 'YouTube request cancelled.'));
			}
			signal?.addEventListener('abort', onAbort, { once: true });
			child.stderr.on('data', chunk => { if (Buffer.byteLength(stderr) < 16384) stderr += chunk; });
			child.once('error', error => {
				if (settled) {
					child.stdout.destroy(error);
				}
				else {
					settled = true;
					dispose();
					reject(providerError(error.code === 'ENOENT' ? 'youtube_provider_missing' : 'youtube_provider_failed', 'The YouTube provider could not start.', error));
				}
			});
			child.once('spawn', () => {
				if (settled) return;
				settled = true;
				resolve({ stream: child.stdout, inputType: 'arbitrary', dispose, process: child });
			});
			child.once('close', code => {
				if (code !== 0 && !signal?.aborted) child.stdout.destroy(providerError('youtube_stream_failed', `YouTube audio process exited with code ${code}.`));
			});
		});
	}
}

module.exports = {
	MAX_SEARCH_LENGTH,
	MAX_URL_LENGTH,
	YouTubeProvider,
	canonicalUrl,
	normalizeVideo,
	parseInput,
	providerError,
	sha256File,
};
