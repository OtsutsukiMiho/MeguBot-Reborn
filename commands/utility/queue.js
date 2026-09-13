'use strict';

const { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, escapeMarkdown } = require('discord.js');
const { audioQueueManager } = require('../../backend/bot/audio_queue.js');

const COPY = {
	en: {
		title: 'Audio Queue', empty: 'The audio queue is empty. Use `/play`, `/yt`, or a TTS channel to add audio.',
		current: 'Currently playing / preparing', upNext: 'Up next', none: 'No upcoming items.',
		cleared: count => `Stopped playback and cleared ${count} item${count === 1 ? '' : 's'} from the audio queue.`,
		alreadyEmpty: 'The audio queue is already empty.', skipped: 'Skipped the current audio item.',
		cannotSkip: 'Only the current requester in the same voice channel or a server manager can skip this item.',
		manageRequired: 'You need Manage Server permission to clear the audio queue.',
		more: count => `…and ${count} more`, total: count => `${count} item${count === 1 ? '' : 's'} total`,
		states: { QUEUED: 'Queued', PREPARING: 'Preparing', PLAYING: 'Playing' },
	},
	th: {
		title: 'คิวเสียง', empty: 'คิวเสียงว่างอยู่ ใช้ `/play`, `/yt` หรือช่อง TTS เพื่อเพิ่มเสียง',
		current: 'กำลังเล่น / กำลังเตรียม', upNext: 'รายการถัดไป', none: 'ไม่มีรายการถัดไป',
		cleared: count => `หยุดการเล่นและล้าง ${count} รายการออกจากคิวเสียงแล้ว`,
		alreadyEmpty: 'คิวเสียงว่างอยู่แล้ว', skipped: 'ข้ามรายการเสียงปัจจุบันแล้ว',
		cannotSkip: 'เฉพาะผู้ขอรายการปัจจุบันที่อยู่ในห้องเสียงเดียวกัน หรือผู้จัดการเซิร์ฟเวอร์เท่านั้นที่ข้ามได้',
		manageRequired: 'ต้องมีสิทธิ์จัดการเซิร์ฟเวอร์เพื่อล้างคิวเสียง',
		more: count => `…และอีก ${count} รายการ`, total: count => `ทั้งหมด ${count} รายการ`,
		states: { QUEUED: 'อยู่ในคิว', PREPARING: 'กำลังเตรียม', PLAYING: 'กำลังเล่น' },
	},
};

function copyFor(interaction) { return String(interaction.locale || '').toLowerCase().startsWith('th') ? COPY.th : COPY.en; }
function duration(seconds) {
	const value = Number(seconds);
	return Number.isFinite(value) && value > 0 ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` : null;
}
function source(item) { return item.source || item.options?.type || item.options?.engine || 'TTS'; }
function line(item, position = null) {
	const prefix = position == null ? '' : `\`${position}.\` `;
	const title = escapeMarkdown(String(item.title || item.text || 'Audio').slice(0, 150));
	const details = [source(item), duration(item.durationSeconds), item.requestedByName || item.options?.userName || 'System'].filter(Boolean).join(' · ');
	return `${prefix}**${title}**\n${escapeMarkdown(details)}`;
}

const data = new SlashCommandBuilder()
	.setName('queue').setDescription('View or manage the shared audio queue')
	.setDescriptionLocalizations({ th: 'ดูหรือจัดการคิวเสียงรวม' })
	.setDMPermission(false)
	.addSubcommand(command => command.setName('view').setDescription('Display the current audio queue').setDescriptionLocalizations({ th: 'แสดงคิวเสียงปัจจุบัน' }))
	.addSubcommand(command => command.setName('skip').setDescription('Skip the current audio item').setDescriptionLocalizations({ th: 'ข้ามรายการเสียงปัจจุบัน' }))
	.addSubcommand(command => command.setName('clear').setDescription('Stop playback and clear the audio queue').setDescriptionLocalizations({ th: 'หยุดและล้างคิวเสียงทั้งหมด' }));

async function executeAction(interaction, subcommand, dependencies = {}) {
	const manager = dependencies.manager || audioQueueManager;
	const copy = copyFor(interaction);
	const guildId = interaction.guildId || interaction.guild?.id;
	if (!guildId) return await interaction.reply({ content: copy.empty, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
	const queue = manager.getQueue(guildId);
	const canManage = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) === true;

	if (subcommand === 'clear') {
		if (!canManage) return await interaction.reply({ content: copy.manageRequired, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
		const count = queue.length;
		if (!count) return await interaction.reply({ content: copy.alreadyEmpty, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
		manager.clearQueue(guildId);
		return await interaction.reply({ content: copy.cleared(count), allowedMentions: { parse: [] } });
	}

	if (subcommand === 'skip') {
		const current = queue[0];
		if (!current) return await interaction.reply({ content: copy.alreadyEmpty, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
		const sameRequester = String(current.requestedByUserId || '') === String(interaction.user.id);
		const sameChannel = Boolean(interaction.member?.voice?.channel?.id && String(interaction.member.voice.channel.id) === String(current.voiceChannelId || ''));
		if (!canManage && !(sameRequester && sameChannel)) return await interaction.reply({ content: copy.cannotSkip, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
		manager.skipCurrent(guildId);
		return await interaction.reply({ content: copy.skipped, allowedMentions: { parse: [] } });
	}

	if (!queue.length) return await interaction.reply({ content: copy.empty, allowedMentions: { parse: [] } });
	const current = queue[0];
	const upcoming = queue.slice(1, 11);
	const embed = new EmbedBuilder()
		.setTitle(`🎵 ${copy.title} — ${String(interaction.guild?.name || '').slice(0, 100)}`)
		.setColor(0x3B82F6)
		.addFields({ name: `▶️ ${copy.current}`, value: `${line(current)}\n${copy.states[current.state] || escapeMarkdown(String(current.state || 'QUEUED'))}`, inline: false });
	if (upcoming.length) {
		const remaining = Math.max(0, queue.length - 1 - upcoming.length);
		embed.addFields({ name: `📋 ${copy.upNext} (${queue.length - 1})`, value: `${upcoming.map((item, index) => line(item, index + 1)).join('\n')}${remaining ? `\n${copy.more(remaining)}` : ''}`.slice(0, 1024), inline: false });
	}
	else {
		embed.addFields({ name: `📋 ${copy.upNext}`, value: copy.none, inline: false });
	}
	embed.setFooter({ text: copy.total(queue.length) }).setTimestamp();
	return await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function execute(interaction, dependencies = {}) {
	const subcommand = interaction.options.getSubcommand(false) || 'view';
	return await executeAction(interaction, subcommand, dependencies);
}

module.exports = { data, execute, executeAction, _test: { COPY, duration, line } };
