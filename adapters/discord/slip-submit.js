const crypto = require('node:crypto');
const defaultCore = require('../../core/index.js');
const { readDiscordSlip, stampWhen } = require('./payment-evidence.js');

// One slip, however it arrived.
//
// `/จ่าย` takes a slip as a command attachment; the pay button on a bill card
// or a due-date DM takes it through a modal upload. Both used to be — and must
// stay — the same ledger write: record the payment, attach the evidence, let
// the reader decide whether it confirms itself, and tell the organiser. Kept in
// one place so the two doors cannot drift into two different rules about what
// counts as paid.

const MAX_SLIP_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function money(satang) {
	return `฿${(satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function siteUrl() {
	return String(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
}

/** "1,200", "1200.5", "฿ 99" → satang; anything else → null. */
function parseBaht(value) {
	const text = String(value ?? '').replace(/[฿,\s]/g, '').replace(/บาท$/, '');
	if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
	const satang = Math.round(Number(text) * 100);
	return Number.isSafeInteger(satang) && satang > 0 ? satang : null;
}

/**
 * @param {object} input
 * @param {object} input.candidate      from activities.listPaymentCandidatesForDiscord
 * @param {number} input.amountSatang
 * @param {{ url: string, contentType?: string, size?: number }} input.attachment
 * @param {string} input.senderDiscordUid
 * @param {(uid: string, content: string) => Promise<unknown>} [input.notifyOwner]
 * @returns {Promise<string>} the reply to show the payer
 */
async function submitDiscordSlip({ candidate, amountSatang, attachment, senderDiscordUid, notifyOwner = null, core = defaultCore }) {
	if (!candidate.payee?.promptpayId) {
		return `**${candidate.title}** ยังไม่มีพร้อมเพย์ของผู้รับ จึงตรวจการโอนผ่าน Discord ไม่ได้ ให้คนจัดตั้งพร้อมเพย์ก่อนนะ`;
	}
	if (!Number.isSafeInteger(amountSatang) || amountSatang <= 0 || amountSatang > candidate.outstandingSatang) {
		return `ยอดนี้เกินยอดค้างของ **${candidate.title}** (${money(candidate.outstandingSatang)})`;
	}
	const allocation = core.paymentEvidence.allocateOldestFirst(amountSatang, candidate.periods);
	if (allocation.unallocatedSatang > 0) return 'แบ่งยอดเข้ารายการนี้ไม่ได้ กรุณาลองใหม่';

	const mime = String(attachment?.contentType || '').toLowerCase().split(';')[0];
	if (!IMAGE_TYPES.has(mime) || !(attachment.size > 0) || attachment.size > MAX_SLIP_BYTES) {
		return 'สลิปต้องเป็น JPG, PNG หรือ WebP และมีขนาดไม่เกิน 2 MB';
	}

	// Discord's CDN, not the Discord API — no route bucket and no ban counter
	// involved — but the body is still checked before it is believed.
	const response = await fetch(attachment.url);
	if (!response.ok) return 'ดาวน์โหลดภาพสลิปจาก Discord ไม่สำเร็จ ลองแนบใหม่อีกครั้ง';
	const image = Buffer.from(await response.arrayBuffer());
	if (image.length === 0 || image.length > MAX_SLIP_BYTES) return 'ภาพสลิปอ่านไม่ได้หรือมีขนาดใหญ่เกินไป';

	let reading;
	try {
		reading = await readDiscordSlip(image);
	}
	catch (error) {
		if (error.code === 'slip_unreadable') return 'ไฟล์นี้เปิดเป็นภาพสลิปไม่ได้ กรุณาแนบ JPG, PNG หรือ WebP ใหม่';
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
		if (error.code === 'slip_duplicate') return 'สลิปนี้ถูกใช้แจ้งชำระรายการอื่นไปแล้ว';
		throw error;
	}

	const link = `${siteUrl()}/a/${candidate.code}`;
	if (notifyOwner && candidate.ownerDiscordUid && candidate.ownerDiscordUid !== String(senderDiscordUid)) {
		const detail = result.autoConfirmed
			? 'Megu จับคู่สลิปและลงยอดให้อัตโนมัติแล้ว หากเงินไม่เข้าจริงให้เปิดเว็บแล้วย้อนผลพร้อมใส่เหตุผล'
			: `ยังไม่ลงว่าได้รับเงิน: ${result.reasons.join(', ') || 'ต้องตรวจด้วยตนเอง'}`;
		// The payment is already recorded; a closed DM must not turn that into
		// an error for the payer. A refusal still reaches the block guard —
		// guardRestClient() records it below every call — so this is not the
		// swallowed failure DISCORD-RATE-LIMITS.md rule 3 forbids.
		try {
			await notifyOwner(candidate.ownerDiscordUid, `💸 **${candidate.participantName}** แจ้งจ่าย ${money(amountSatang)} · **${candidate.title}**\n${detail}\n${link}`);
		}
		catch (error) {
			console.warn(`[Megu] Could not DM the organiser of ${candidate.code}: ${error.message}`);
		}
	}

	const status = result.autoConfirmed
		? `✅ บันทึกว่า **ชำระแล้ว ${money(amountSatang)}** ให้ **${candidate.title}**`
		: `🧾 รับสลิป **${money(amountSatang)}** ของ **${candidate.title}** แล้ว แต่ข้อมูลยังไม่ครบ จึงรอเจ้าของตรวจ`;
	return `${status}\n${link}`;
}

module.exports = { submitDiscordSlip, parseBaht, money, siteUrl, MAX_SLIP_BYTES };
