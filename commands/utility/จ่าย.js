const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const core = require('../../core/index.js');
const { submitDiscordSlip, money } = require('../../adapters/discord/slip-submit.js');

async function candidates(interaction, search = '') {
	return core.activities.listPaymentCandidatesForDiscord(
		interaction.user.id,
		interaction.guildId,
		search,
	);
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('จ่าย')
		.setDescription('แจ้งชำระเงินพร้อมสลิปให้ Megu ตรวจและบันทึก')
		.addNumberOption(option => option
			.setName('จำนวน')
			.setDescription('จำนวนเงินบาทที่โอน')
			.setMinValue(0.01)
			.setRequired(true))
		.addAttachmentOption(option => option
			.setName('สลิป')
			.setDescription('ภาพสลิปธนาคาร — ไม่มีสลิปจะยังไม่นับว่าจ่าย')
			.setRequired(true))
		.addStringOption(option => option
			.setName('รายการ')
			.setDescription('ชื่องานหรือรหัสบนเว็บ (เว้นไว้ได้ถ้ามีรายการเดียว)')
			.setAutocomplete(true)),

	async autocomplete(interaction) {
		const focused = interaction.options.getFocused() || '';
		const found = await candidates(interaction, focused);
		await interaction.respond(found.slice(0, 25).map(item => ({
			name: `${item.title} · ${money(item.outstandingSatang)} · ${item.code}`.slice(0, 100),
			value: item.code,
		}))).catch(() => undefined);
	},

	async execute(interaction) {
		if (!interaction.guildId) {
			return interaction.reply({ content: 'ใช้คำสั่งนี้ในเซิร์ฟเวอร์ที่รายการถูกสร้างไว้นะ', flags: MessageFlags.Ephemeral });
		}
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const search = interaction.options.getString('รายการ') || '';
		const found = await candidates(interaction, search);
		if (found.length === 0) {
			return interaction.editReply('ไม่พบยอดค้างที่ผูกกับ Discord ของคุณ ลองเข้าเว็บแล้ว claim ชื่อตัวเองก่อน');
		}
		if (found.length > 1) {
			const choices = found.slice(0, 8).map(item => `• **${item.title}** — ${money(item.outstandingSatang)} (${item.code})`).join('\n');
			return interaction.editReply(`มีหลายรายการ เลือกช่อง **รายการ** แล้วลองอีกครั้งนะ\n${choices}`);
		}
		const candidate = found[0];
		const reply = await submitDiscordSlip({
			candidate,
			amountSatang: Math.round(interaction.options.getNumber('จำนวน', true) * 100),
			attachment: interaction.options.getAttachment('สลิป', true),
			senderDiscordUid: interaction.user.id,
			notifyOwner: async (uid, content) => {
				const owner = await interaction.client.users.fetch(uid);
				await owner.send(content);
			},
		});
		await interaction.editReply(reply);
	},
};
