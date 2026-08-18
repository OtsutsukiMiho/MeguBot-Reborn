const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const crypto = require('node:crypto');
const core = require('../../core/index.js');
const { readDiscordSlip, stampWhen } = require('../../adapters/discord/payment-evidence.js');

const MAX_SLIP_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function money(satang) {
	return `฿${(satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

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
		if (!candidate.payee?.promptpayId) {
			return interaction.editReply(`**${candidate.title}** ยังไม่มีพร้อมเพย์ของผู้รับ จึงตรวจการโอนผ่าน flow นี้ไม่ได้`);
		}

		const amountSatang = Math.round(interaction.options.getNumber('จำนวน', true) * 100);
		if (!Number.isSafeInteger(amountSatang) || amountSatang <= 0 || amountSatang > candidate.outstandingSatang) {
			return interaction.editReply(`ยอดนี้เกินยอดค้างของ **${candidate.title}** (${money(candidate.outstandingSatang)})`);
		}
		const allocation = core.paymentEvidence.allocateOldestFirst(amountSatang, candidate.periods);
		if (allocation.unallocatedSatang > 0) return interaction.editReply('แบ่งยอดเข้ารายการนี้ไม่ได้ กรุณาลองใหม่');

		const attachment = interaction.options.getAttachment('สลิป', true);
		const mime = String(attachment.contentType || '').toLowerCase();
		if (!IMAGE_TYPES.has(mime) || attachment.size <= 0 || attachment.size > MAX_SLIP_BYTES) {
			return interaction.editReply('สลิปต้องเป็น JPG, PNG หรือ WebP และมีขนาดไม่เกิน 2 MB');
		}

		const response = await fetch(attachment.url);
		if (!response.ok) return interaction.editReply('ดาวน์โหลดภาพสลิปจาก Discord ไม่สำเร็จ ลองแนบใหม่อีกครั้ง');
		const image = Buffer.from(await response.arrayBuffer());
		if (image.length === 0 || image.length > MAX_SLIP_BYTES) return interaction.editReply('ภาพสลิปอ่านไม่ได้หรือมีขนาดใหญ่เกินไป');

		let reading;
		try {
			reading = await readDiscordSlip(image);
		}
		catch (error) {
			if (error.code === 'slip_unreadable') {
				return interaction.editReply('ไฟล์นี้เปิดเป็นภาพสลิปไม่ได้ กรุณาแนบ JPG, PNG หรือ WebP ใหม่');
			}
			throw error;
		}
		const payment = await core.activities.recordPayment(candidate.activityId, candidate.participantId, {
			amountSatang,
			method: 'bank_transfer',
			expectedSatang: amountSatang,
			promptpayTarget: candidate.payee.promptpayId,
			allocations: allocation.allocations,
		});

		let result;
		try {
			result = await core.activities.attachSlip(payment.id, {
				image: reading.normalizedImage,
				mime: reading.normalizedMime,
				evidenceImage: reading.evidenceImage,
				evidenceMime: reading.evidenceImage ? 'image/png' : null,
				evidenceHash: reading.evidenceImage
					? crypto.createHash('sha256').update(reading.evidenceImage).digest('hex')
					: null,
				ref: reading.slip?.ref || null,
				bank: reading.slip?.bank?.code || null,
				amountSatang: reading.read.amountSatang,
				when: stampWhen(reading.read.when),
				senderName: reading.read.parties?.sender?.name || null,
				receiverName: reading.read.parties?.receiver?.name || null,
				senderAccountTail: reading.read.parties?.sender?.accountTail || null,
				receiverAccountTail: reading.read.parties?.receiver?.accountTail || null,
				expectedReceiverName: candidate.payee.promptpayName,
			});
		}
		catch (error) {
			await core.activities.removePayment(payment.id, null, error.code || 'discord_slip_failed').catch(() => undefined);
			if (error.code === 'slip_duplicate') return interaction.editReply('สลิปนี้ถูกใช้แจ้งชำระรายการอื่นไปแล้ว');
			throw error;
		}

		const baseUrl = String(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
		const link = `${baseUrl}/a/${candidate.code}`;
		const status = result.autoConfirmed
			? `✅ บันทึกว่า **ชำระแล้ว ${money(amountSatang)}** ให้ **${candidate.title}**`
			: `🧾 รับสลิป **${money(amountSatang)}** ของ **${candidate.title}** แล้ว แต่ข้อมูลยังไม่ครบ จึงรอเจ้าของตรวจ`;
		await interaction.editReply(`${status}\n${link}`);

		if (candidate.ownerDiscordUid && candidate.ownerDiscordUid !== interaction.user.id) {
			const owner = await interaction.client.users.fetch(candidate.ownerDiscordUid).catch(() => null);
			if (owner) {
				const detail = result.autoConfirmed
					? 'Megu จับคู่สลิปและลงยอดให้อัตโนมัติแล้ว หากเงินไม่เข้าจริงให้เปิดเว็บแล้วย้อนผลพร้อมใส่เหตุผล'
					: `ยังไม่ลงว่าได้รับเงิน: ${result.reasons.join(', ') || 'ต้องตรวจด้วยตนเอง'}`;
				await owner.send(`💸 **${candidate.participantName}** แจ้งจ่าย ${money(amountSatang)} · **${candidate.title}**\n${detail}\n${link}`).catch(() => undefined);
			}
		}
	},
};
