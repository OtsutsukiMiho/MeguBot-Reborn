// Whether Megu reads your name out loud when you join a voice channel.
//
// The announcement exists for the room — everyone already in the channel learns
// who arrived without looking away from what they are doing. The person whose
// name is being read is the one who gets nothing from it, and in a large or
// public server they may have good reasons not to want it: a name that is not
// the one they use out loud, a channel they join quietly, or simply not wanting
// to be announced.
//
// Until now the only remedy was asking an admin to turn the feature off for the
// whole server, which is not a remedy. This is per person and per server, and it
// needs nobody's permission.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../../backend/database/database.js');
const { BotLogs, COLOR } = require('../../backend/bot/bot_functions.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('announce')
		.setDescription('Choose whether Megu says your name when you join a voice channel')
		// The preference is per server, so there is no server to apply it to in
		// a DM. Without this, interaction.guild is null and reading .id throws a
		// TypeError that surfaces as the dispatcher's generic error message.
		.setDMPermission(false)
		.addSubcommand(subcommand =>
			subcommand
				.setName('off')
				.setDescription('Stop announcing my name when I join or leave'),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('on')
				.setDescription('Announce my name again'),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('status')
				.setDescription('Check whether my name is announced'),
		),

	async execute(interaction) {
		// setDMPermission(false) is the real guard, but it only takes effect
		// once the command list has been redeployed, and an old registration
		// outlives this file.
		if (!interaction.guild) {
			return await interaction.reply({
				content: '❌ คำสั่งนี้ใช้ได้เฉพาะในเซิร์ฟเวอร์ เพราะการตั้งค่านี้แยกตามเซิร์ฟเวอร์',
				flags: MessageFlags.Ephemeral,
			});
		}

		const subcommand = interaction.options.getSubcommand();
		const guildId = interaction.guild.id;
		const userId = interaction.user.id;

		if (subcommand === 'status') {
			const optedOut = await database.getAnnounceOptOut(guildId, userId);
			return await interaction.reply({
				content: optedOut
					? '🔇 Megu ไม่ประกาศชื่อคุณตอนเข้าห้องเสียง — เปิดกลับด้วย `/announce on`'
					: '🔊 Megu ประกาศชื่อคุณตอนเข้าห้องเสียง — ปิดได้ด้วย `/announce off`',
				flags: MessageFlags.Ephemeral,
			});
		}

		const optOut = subcommand === 'off';
		const saved = await database.setAnnounceOptOut(guildId, userId, optOut);

		// Saying "done" when nothing was written would be the worst possible
		// failure here: they would believe they had opted out, and find out
		// otherwise by being announced.
		if (!saved) {
			return await interaction.reply({
				content: '⚠️ บันทึกไม่สำเร็จ — ฐานข้อมูลไม่ตอบ ลองใหม่อีกครั้งนะ (ตอนนี้ค่ายังเป็นของเดิม)',
				flags: MessageFlags.Ephemeral,
			});
		}

		BotLogs(interaction.guild.name, `${COLOR.dark_purple}Voice announce ${optOut ? 'disabled' : 'enabled'} for ${COLOR.gray}[${COLOR.white}${interaction.user.tag}${COLOR.gray}]`);

		return await interaction.reply({
			content: optOut
				? '🔇 ได้เลย จะไม่ประกาศชื่อคุณตอนเข้า/ออกห้องเสียงแล้ว'
				: '🔊 กลับมาประกาศชื่อคุณตอนเข้า/ออกห้องเสียงแล้ว',
			flags: MessageFlags.Ephemeral,
		});
	},
};
