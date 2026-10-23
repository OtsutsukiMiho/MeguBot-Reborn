const crypto = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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

// Why a slip was held for the organiser, in the same words the web's payment
// screen uses (app/copy/th.js → held). The organiser reads this in a DM and
// has to decide what to check; "receiver_unreadable" tells them nothing.
const HELD = {
	reference_missing: 'ไม่พบเลขอ้างอิงธนาคารในรูป อาจไม่ใช่สลิปโอนเงิน',
	amount_unreadable: 'อ่านยอดเงินจากรูปไม่ออก',
	amount_mismatch: 'ยอดในสลิปไม่ตรงกับยอดที่เรียกเก็บ',
	receiver_not_configured: 'ยังไม่ได้ตั้งช่องทางรับเงิน เลยไม่มีชื่อให้เทียบว่าโอนถูกคนไหม',
	receiver_unreadable: 'อ่านไม่ออกว่าโอนเข้าบัญชีใคร',
	receiver_mismatch: 'ชื่อผู้รับในสลิปไม่ตรงกับบัญชีที่ตั้งไว้',
	time_unreadable: 'อ่านวันเวลาจากรูปไม่ออก',
	time_in_future: 'สลิปลงวันที่ล่วงหน้า',
	uploaded_late: 'ส่งมาหลังวันที่บนสลิปเกินหนึ่งเดือน',
};

function heldReasons(reasons = []) {
	return reasons.map(code => `• ${HELD[code] || code}`).join('\n');
}

// The organiser's answer, on the DM that asked for it. Before these the only
// way to say "that is not a slip" was the web, which a Discord-only group never
// opens. The custom ids carry the `evt:` prefix, so `/event` handles them
// wherever the DM came from (`/จ่าย` or a card's pay button).
const DECISION_LABELS = { confirm: 'ได้รับแล้ว', reject: 'ยังไม่เข้า', undo: 'เงินไม่เข้า ย้อนผล' };

function ownerDecisionButtons(code, paymentId, { autoConfirmed = false } = {}) {
	const row = new ActionRowBuilder();
	if (autoConfirmed) {
		row.addComponents(new ButtonBuilder().setCustomId(`evt:pundo:${code}:${paymentId}`).setStyle(ButtonStyle.Secondary).setLabel(DECISION_LABELS.undo));
	}
	else {
		row.addComponents(
			new ButtonBuilder().setCustomId(`evt:pok:${code}:${paymentId}`).setStyle(ButtonStyle.Success).setLabel(DECISION_LABELS.confirm),
			new ButtonBuilder().setCustomId(`evt:pno:${code}:${paymentId}`).setStyle(ButtonStyle.Danger).setLabel(DECISION_LABELS.reject),
		);
	}
	return [row];
}
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
 * @param {(uid: string, message: { content: string, components: object[] }) => Promise<unknown>} [input.notifyOwner]
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
			? 'Megu จับคู่สลิปและลงยอดให้อัตโนมัติแล้ว ถ้าเงินไม่เข้าจริง กดปุ่มด้านล่างเพื่อย้อนผลพร้อมใส่เหตุผล'
			: `ยังไม่ลงว่าได้รับเงิน เช็กบัญชีแล้วกดปุ่มด้านล่าง ดูสลิปได้ที่ลิงก์ ที่ต้องตรวจเองเพราะ\n${heldReasons(result.reasons) || '• ต้องตรวจด้วยตนเอง'}`;
		// The payment is already recorded; a closed DM must not turn that into
		// an error for the payer. A refusal still reaches the block guard —
		// guardRestClient() records it below every call — so this is not the
		// swallowed failure DISCORD-RATE-LIMITS.md rule 3 forbids.
		try {
			await notifyOwner(candidate.ownerDiscordUid, {
				content: `**${candidate.participantName}** แจ้งจ่าย ${money(amountSatang)} ให้ **${candidate.title}**\n${detail}\n${link}`,
				components: ownerDecisionButtons(candidate.code, payment.id, { autoConfirmed: result.autoConfirmed }),
			});
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

module.exports = { submitDiscordSlip, ownerDecisionButtons, DECISION_LABELS, heldReasons, parseBaht, money, siteUrl, MAX_SLIP_BYTES };
