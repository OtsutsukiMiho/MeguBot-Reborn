'use strict';

const {
	ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits,
	SlashCommandBuilder, StringSelectMenuBuilder,
} = require('discord.js');
const { randomUUID } = require('node:crypto');

const { audioQueueManager, SOURCE } = require('../../backend/bot/audio_queue.js');
const { parseInput } = require('../../backend/bot/youtube_provider.js');
const { getReadyVoiceConnection } = require('../../backend/bot/voice_connection.js');

const requestTimes = new Map();
let providerJobs = 0;

const COPY = {
	en: {
		disabled: 'YouTube playback is not enabled on this bot.', dependenciesUnavailable: 'YouTube playback dependencies are not ready on this bot host.', guildOnly: 'Use this command in a Discord server.',
		joinVoice: 'Join a voice channel first.', connect: 'I cannot connect to your voice channel.', speak: 'I cannot speak in your voice channel.',
		connectionFailed: 'I could not establish a ready voice connection. Try again shortly.',
		otherChannel: 'The audio queue is active in another voice channel.', cooldown: 'Please wait a few seconds before requesting another video.',
		providerBusy: 'YouTube search is busy. Try again shortly.', resolving: 'Checking YouTube…', noResults: 'No playable results were found.',
		choose: 'Choose one result to add to the audio queue.', expired: 'This YouTube search expired. Run `/yt` again.',
		cancelled: 'YouTube request cancelled.', changedVoice: 'You must stay in the same voice channel while choosing.',
		notYours: 'This YouTube selection belongs to another user.', preparing: 'Preparing your selected video…',
		queued: (title, url, formattedDuration, ahead) => `Added **${title}** (<${url}>) · ${formattedDuration}\n${ahead ? `${ahead} item${ahead === 1 ? '' : 's'} ahead in the shared queue.` : 'Preparing to play now.'}`,
		errors: {
			youtube_query_required: 'Enter a YouTube link or search phrase.', youtube_input_too_long: 'That input is too long.',
			youtube_search_too_long: 'Search phrases are limited to 200 characters.', youtube_invalid_url: 'Only valid HTTPS YouTube links are supported.',
			youtube_invalid_video: 'That link does not identify a supported YouTube video.', youtube_playlist_unsupported: 'Playlist-only links are not supported yet.',
			youtube_duration_unknown: 'That video has no usable duration.', youtube_too_long: 'That video is longer than this server allows.',
			youtube_live_unsupported: 'Live and upcoming videos are not supported.', youtube_unavailable: 'That video is not publicly playable.',
			youtube_provider_missing: 'The YouTube provider is not installed on this bot host.', youtube_timeout: 'YouTube took too long to respond.',
			youtube_provider_failed: 'YouTube could not resolve that request.',
		},
		limits: { FULL: 'The shared audio queue is full.', CHANNEL_CONFLICT: 'The audio queue is active in another voice channel.', DUPLICATE: 'That video was already queued.', YOUTUBE_GUILD_LIMIT: 'This server has reached its YouTube queue limit.', YOUTUBE_USER_LIMIT: 'You have reached your YouTube queue limit.', YOUTUBE_DURATION_LIMIT: 'The queued YouTube duration limit has been reached.', INVALID_SOURCE: 'That video cannot be queued.' },
	},
	th: {
		disabled: 'บอตนี้ยังไม่ได้เปิดการเล่น YouTube', dependenciesUnavailable: 'โฮสต์ของบอตยังเตรียมระบบเล่น YouTube ไม่พร้อม', guildOnly: 'ใช้คำสั่งนี้ในเซิร์ฟเวอร์ Discord',
		joinVoice: 'เข้าห้องเสียงก่อนนะ', connect: 'Megu ไม่มีสิทธิ์เข้าห้องเสียงของคุณ', speak: 'Megu ไม่มีสิทธิ์พูดในห้องเสียงของคุณ',
		connectionFailed: 'Megu เชื่อมต่อห้องเสียงไม่สำเร็จ ลองอีกครั้งในอีกสักครู่',
		otherChannel: 'คิวเสียงกำลังใช้งานอยู่ในห้องเสียงอื่น', cooldown: 'รอสักครู่ก่อนขอวิดีโออีกครั้ง',
		providerBusy: 'การค้นหา YouTube กำลังยุ่ง ลองอีกครั้งในอีกสักครู่', resolving: 'กำลังตรวจสอบ YouTube…', noResults: 'ไม่พบผลลัพธ์ที่เล่นได้',
		choose: 'เลือกหนึ่งรายการเพื่อเพิ่มลงคิวเสียง', expired: 'ผลการค้นหานี้หมดอายุแล้ว ใช้ `/yt` อีกครั้ง',
		cancelled: 'ยกเลิกคำขอ YouTube แล้ว', changedVoice: 'ต้องอยู่ในห้องเสียงเดิมระหว่างเลือกรายการ',
		notYours: 'รายการเลือก YouTube นี้เป็นของผู้ใช้อื่น', preparing: 'กำลังเตรียมวิดีโอที่เลือก…',
		queued: (title, url, formattedDuration, ahead) => `เพิ่ม **${title}** (<${url}>) · ${formattedDuration}\n${ahead ? `มี ${ahead} รายการอยู่ข้างหน้าในคิวเสียงรวม` : 'กำลังเตรียมเล่นตอนนี้'}`,
		errors: {
			youtube_query_required: 'ใส่ลิงก์ YouTube หรือคำค้นหา', youtube_input_too_long: 'ข้อมูลยาวเกินไป',
			youtube_search_too_long: 'คำค้นหาต้องไม่เกิน 200 ตัวอักษร', youtube_invalid_url: 'รองรับเฉพาะลิงก์ HTTPS ของ YouTube ที่ถูกต้อง',
			youtube_invalid_video: 'ลิงก์นี้ไม่ใช่วิดีโอ YouTube ที่รองรับ', youtube_playlist_unsupported: 'ยังไม่รองรับลิงก์เพลย์ลิสต์อย่างเดียว',
			youtube_duration_unknown: 'วิดีโอนี้ไม่มีข้อมูลระยะเวลาที่ใช้ได้', youtube_too_long: 'วิดีโอนี้ยาวเกินค่าที่เซิร์ฟเวอร์อนุญาต',
			youtube_live_unsupported: 'ยังไม่รองรับไลฟ์และวิดีโอที่กำลังจะฉาย', youtube_unavailable: 'วิดีโอนี้ไม่สามารถเล่นแบบสาธารณะได้',
			youtube_provider_missing: 'โฮสต์ของบอตยังไม่ได้ติดตั้งตัวให้บริการ YouTube', youtube_timeout: 'YouTube ใช้เวลาตอบกลับนานเกินไป',
			youtube_provider_failed: 'YouTube ไม่สามารถประมวลผลคำขอนี้ได้',
		},
		limits: { FULL: 'คิวเสียงรวมเต็มแล้ว', CHANNEL_CONFLICT: 'คิวเสียงกำลังใช้งานอยู่ในห้องเสียงอื่น', DUPLICATE: 'วิดีโอนี้อยู่ในคิวแล้ว', YOUTUBE_GUILD_LIMIT: 'เซิร์ฟเวอร์นี้มีรายการ YouTube ในคิวครบกำหนดแล้ว', YOUTUBE_USER_LIMIT: 'คุณมีรายการ YouTube ในคิวครบกำหนดแล้ว', YOUTUBE_DURATION_LIMIT: 'ระยะเวลารวมของ YouTube ในคิวเต็มแล้ว', INVALID_SOURCE: 'ไม่สามารถเพิ่มวิดีโอนี้ลงคิวได้' },
	},
};

function copyFor(interaction) { return String(interaction.locale || '').toLowerCase().startsWith('th') ? COPY.th : COPY.en; }
function reply(content, components = []) { return { content, components, allowedMentions: { parse: [] } }; }
function safe(value, limit = 100) { return String(value || '').replace(/[\\`*_{}[\]()<>#+.!|~>-]/g, '').replace(/\s+/g, ' ').trim().slice(0, limit) || 'YouTube video'; }
function duration(value) {
	const seconds = Math.max(0, Number(value) || 0);
	return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
function errorText(error, copy) { return copy.errors[error?.code] || copy.limits[error?.reason] || copy.errors.youtube_provider_failed; }

function featureEnabled(guildId, override) {
	if (override !== undefined) return Boolean(override);
	if (process.env.MEGU_YOUTUBE_ENABLED !== '1') return false;
	const guildIds = String(process.env.MEGU_YOUTUBE_GUILD_IDS || '')
		.split(',')
		.map(value => value.trim())
		.filter(Boolean);
	return guildIds.length === 0 || guildIds.includes(String(guildId || ''));
}

function voiceState(interaction, copy, manager) {
	if (!interaction.guild || !interaction.member) return { error: copy.guildOnly };
	const channel = interaction.member.voice?.channel;
	if (!channel) return { error: copy.joinVoice };
	const permissions = channel.permissionsFor(interaction.guild.members.me);
	if (!permissions?.has(PermissionFlagsBits.Connect)) return { error: copy.connect };
	if (!permissions.has(PermissionFlagsBits.Speak)) return { error: copy.speak };
	if (!manager.canUseChannel(interaction.guild.id, channel.id)) return { error: copy.otherChannel };
	return { channel };
}

function takeCooldown(guildId, userId, now = Date.now()) {
	const key = `${guildId}:${userId}`;
	const last = requestTimes.get(key) || 0;
	const configured = Number(process.env.MEGU_YOUTUBE_USER_COOLDOWN_MS);
	const cooldownMs = Number.isFinite(configured) ? Math.min(60000, Math.max(1000, configured)) : 5000;
	if (now - last < cooldownMs) return false;
	requestTimes.set(key, now);
	if (requestTimes.size > 500) for (const [entry, time] of requestTimes) if (now - time > 60000) requestTimes.delete(entry);
	return true;
}

async function providerWork(task) {
	const configured = Number(process.env.MEGU_YOUTUBE_PROVIDER_CONCURRENCY);
	const limit = Number.isFinite(configured) ? Math.min(20, Math.max(1, configured)) : 4;
	if (providerJobs >= limit) throw Object.assign(new Error('YouTube provider busy.'), { code: 'youtube_provider_busy' });
	providerJobs++;
	try { return await task(); }
	finally { providerJobs--; }
}

async function chooseSearchResult(interaction, results, copy, voiceChannelId) {
	const requestId = randomUUID().replaceAll('-', '').slice(0, 20);
	const selectId = `yt:select:${requestId}`;
	const cancelId = `yt:cancel:${requestId}`;
	let selectionAccepted = false;
	const menu = new StringSelectMenuBuilder().setCustomId(selectId).setPlaceholder(copy.choose).addOptions(results.map(video => ({
		label: safe(video.title, 100), description: `${safe(video.channel, 70)} · ${duration(video.durationSeconds)}`.slice(0, 100), value: video.videoId,
	})));
	const components = [
		new ActionRowBuilder().addComponents(menu),
		new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(cancelId).setStyle(ButtonStyle.Secondary).setLabel(String(interaction.locale || '').startsWith('th') ? 'ยกเลิก' : 'Cancel')),
	];
	const message = await interaction.editReply(reply(copy.choose, components));
	try {
		const selected = await message.awaitMessageComponent({
			time: 60000,
			filter: candidate => {
				const ours = candidate.customId === selectId || candidate.customId === cancelId;
				if (!ours) return false;
				if (selectionAccepted) return false;
				if (candidate.user.id !== interaction.user.id) {
					void candidate.reply({ content: copy.notYours, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }).catch(() => undefined);
					return false;
				}
				if (candidate.guildId !== interaction.guildId) return false;
				selectionAccepted = true;
				return true;
			},
		});
		if (selected.customId === cancelId) {
			await selected.update(reply(copy.cancelled));
			return null;
		}
		const currentChannelId = selected.member?.voice?.channel?.id;
		if (String(currentChannelId || '') !== String(voiceChannelId)) {
			await selected.update(reply(copy.changedVoice));
			return null;
		}
		await selected.update(reply(copy.preparing));
		return selected.values[0];
	}
	catch {
		await interaction.editReply(reply(copy.expired)).catch(() => undefined);
		return null;
	}
}

async function executeYouTube(interaction, dependencies = {}) {
	const copy = copyFor(interaction);
	const manager = dependencies.manager || audioQueueManager;
	const provider = dependencies.provider || manager.youtubeProvider;
	const enabled = featureEnabled(interaction.guildId, dependencies.enabled);
	if (!enabled) return await interaction.reply({ ...reply(copy.disabled), flags: MessageFlags.Ephemeral });
	if (dependencies.enabled === undefined && manager.youtubeReady !== true) {
		return await interaction.reply({ ...reply(copy.dependenciesUnavailable), flags: MessageFlags.Ephemeral });
	}
	if (!interaction.inGuild?.()) return await interaction.reply({ ...reply(copy.guildOnly), flags: MessageFlags.Ephemeral });
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	const initialVoice = voiceState(interaction, copy, manager);
	if (initialVoice.error) return await interaction.editReply(reply(initialVoice.error));
	if (!takeCooldown(interaction.guild.id, interaction.user.id)) return await interaction.editReply(reply(copy.cooldown));

	try {
		const parsed = parseInput(interaction.options.getString('query', true));
		await interaction.editReply(reply(copy.resolving));
		let video;
		if (parsed.kind === 'video') {video = await providerWork(() => provider.getVideo(parsed.videoId));}
		else {
			const results = await providerWork(() => provider.search(parsed.query));
			if (!results.length) return await interaction.editReply(reply(copy.noResults));
			const videoId = await chooseSearchResult(interaction, results, copy, initialVoice.channel.id);
			if (!videoId) return;
			video = await providerWork(() => provider.getVideo(videoId));
		}
		const currentVoice = voiceState(interaction, copy, manager);
		if (currentVoice.error || currentVoice.channel.id !== initialVoice.channel.id) return await interaction.editReply(reply(copy.changedVoice));
		const connection = await getReadyVoiceConnection(interaction.guild, currentVoice.channel, { voice: dependencies.voice, timeoutMs: 15000 });
		const result = manager.addToQueue(interaction.guild.id, interaction.guild.name, connection, video.title, {
			source: SOURCE.YOUTUBE, type: SOURCE.YOUTUBE, engine: SOURCE.YOUTUBE,
			videoId: video.videoId, canonicalUrl: video.url, durationSeconds: video.durationSeconds,
			title: video.title, requestedByUserId: interaction.user.id,
			requestedByName: interaction.member.displayName || interaction.user.username,
			userName: interaction.user.username, voiceChannelId: currentVoice.channel.id, volume: 0.5,
		});
		if (!result.success) return await interaction.editReply(reply(errorText(result, copy)));
		return await interaction.editReply(reply(copy.queued(safe(video.title, 150), video.url, duration(video.durationSeconds), Math.max(0, result.position - 1))));
	}
	catch (error) {
		if (error?.code === 'youtube_provider_busy') return await interaction.editReply(reply(copy.providerBusy));
		if (error?.code === 'voice_connection_failed') return await interaction.editReply(reply(copy.connectionFailed));
		return await interaction.editReply(reply(errorText(error, copy)));
	}
}

const data = new SlashCommandBuilder()
	.setName('yt').setDescription('Play YouTube audio from a link or search')
	.setDescriptionLocalizations({ th: 'เล่นเสียง YouTube จากลิงก์หรือคำค้นหา' })
	.setDMPermission(false)
	.addStringOption(option => option.setName('query').setDescription('YouTube link or search').setDescriptionLocalizations({ th: 'ลิงก์ YouTube หรือคำค้นหา' }).setMaxLength(2048).setRequired(true));

module.exports = { data, execute: executeYouTube, executeYouTube, _test: { COPY, duration, featureEnabled, providerWork, safe, takeCooldown, voiceState } };
