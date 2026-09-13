'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { YouTubeProvider, sha256File } = require('../backend/bot/youtube_provider.js');
const { DISCORD_SNOWFLAKE } = require('./command-deployment-target.js');

const PREFLIGHT_CONFIG_ERROR = 'YOUTUBE_PREFLIGHT_CONFIG';

function configError(message) {
	return Object.assign(new Error(message), { code: PREFLIGHT_CONFIG_ERROR });
}

function validatePilotConfig(env = process.env) {
	if (env.MEGU_DISCORD_TEST_MODE === '1') {
		throw configError('MEGU_DISCORD_TEST_MODE must be disabled because that legacy mode only accepts the payment test command.');
	}
	if (env.MEGU_YOUTUBE_ENABLED !== '1') throw configError('MEGU_YOUTUBE_ENABLED must be 1 for the pilot.');
	const guildId = String(env.MEGU_DISCORD_TEST_GUILD_ID || '').trim();
	if (!DISCORD_SNOWFLAKE.test(guildId)) throw configError('MEGU_DISCORD_TEST_GUILD_ID must contain one valid Discord guild ID.');
	const guildIds = [...new Set(String(env.MEGU_YOUTUBE_GUILD_IDS || '').split(',').map(value => value.trim()).filter(Boolean))];
	if (guildIds.length !== 1 || guildIds[0] !== guildId) {
		throw configError('MEGU_YOUTUBE_GUILD_IDS must contain exactly the selected test guild during the pilot.');
	}
	const executable = String(env.YT_DLP_PATH || '').trim();
	if (!path.isAbsolute(executable)) throw configError('YT_DLP_PATH must be an absolute path to the pinned yt-dlp executable.');
	const expectedSha256 = String(env.MEGU_YOUTUBE_YTDLP_SHA256 || '').trim().toLowerCase();
	if (!/^[a-f\d]{64}$/.test(expectedSha256)) throw configError('MEGU_YOUTUBE_YTDLP_SHA256 must contain the expected 64-character SHA-256 digest.');
	return { executable, expectedSha256, guildId };
}

async function runPreflight(options = {}) {
	const env = options.env || process.env;
	const config = validatePilotConfig(env);
	const stat = await fs.promises.stat(config.executable).catch(() => null);
	if (!stat?.isFile()) throw configError('YT_DLP_PATH does not point to a readable file.');
	const actualSha256 = await sha256File(config.executable);
	if (actualSha256 !== config.expectedSha256) throw configError('The yt-dlp executable does not match MEGU_YOUTUBE_YTDLP_SHA256.');
	const provider = options.provider || new YouTubeProvider({ executable: config.executable });
	const version = await provider.checkBinary();
	const runtime = await provider.checkRuntime();
	const ffmpegPath = options.ffmpegPath || require('ffmpeg-static');
	const ffmpegStat = ffmpegPath ? await fs.promises.stat(ffmpegPath).catch(() => null) : null;
	if (!ffmpegStat?.isFile()) throw configError('The packaged FFmpeg executable is unavailable.');
	return { ...config, actualSha256, ffmpegPath, runtime, version };
}

async function main() {
	require('dotenv').config({ quiet: true });
	try {
		const result = await runPreflight();
		console.log('YouTube pilot preflight passed.');
		console.log(`Test guild: ${result.guildId}`);
		console.log(`yt-dlp: ${result.version} (SHA-256 verified)`);
		console.log(`${result.runtime.name}: ${String(result.runtime.version).replace(/[\r\n]/g, ' ').slice(0, 120)}`);
		console.log('Packaged FFmpeg: ready');
	}
	catch (error) {
		console.error(`YouTube pilot preflight failed: ${error.message}`);
		process.exitCode = 1;
	}
}

if (require.main === module) void main();

module.exports = { PREFLIGHT_CONFIG_ERROR, runPreflight, validatePilotConfig };
