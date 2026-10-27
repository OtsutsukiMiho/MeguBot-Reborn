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
// screen uses (app/copy/*.js, held). The organiser reads this in a DM and has
// to decide what to check; "receiver_unreadable" tells them nothing.
const HELD = {
	th: {
		reference_missing: 'ไม่พบเลขอ้างอิงธนาคารในรูป อาจไม่ใช่สลิปโอนเงิน',
		amount_unreadable: 'อ่านยอดเงินจากรูปไม่ออก',
		amount_mismatch: 'ยอดในสลิปไม่ตรงกับยอดที่เรียกเก็บ',
		receiver_not_configured: 'ยังไม่ได้ตั้งช่องทางรับเงิน เลยไม่มีชื่อให้เทียบว่าโอนถูกคนไหม',
		receiver_unreadable: 'อ่านไม่ออกว่าโอนเข้าบัญชีใคร',
		receiver_mismatch: 'ชื่อผู้รับในสลิปไม่ตรงกับบัญชีที่ตั้งไว้',
		time_unreadable: 'อ่านวันเวลาจากรูปไม่ออก',
		time_in_future: 'สลิปลงวันที่ล่วงหน้า',
		uploaded_late: 'ส่งมาหลังวันที่บนสลิปเกินหนึ่งเดือน',
	},
	en: {
		reference_missing: 'No bank reference in the picture, so it may not be a transfer slip.',
		amount_unreadable: 'Could not read an amount off the picture.',
		amount_mismatch: 'The amount on the slip is not the amount asked for.',
		receiver_not_configured: 'No payout account is set up yet, so there was nothing to check the receiver against.',
		receiver_unreadable: 'Could not read who the money went to.',
		receiver_mismatch: 'The name on the slip is not the account you set up.',
		time_unreadable: 'Could not read a date and time.',
		time_in_future: 'The slip is dated in the future.',
		uploaded_late: 'Sent more than a month after the transfer is dated.',
	},
};

function heldReasons(reasons = [], lang = 'th') {
	const held = HELD[lang] || HELD.th;
	return reasons.map(code => `• ${held[code] || code}`).join('\n');
}

// Everything the payer and the receiver read, in each language. The payer's
// reply follows the payer; the receiver's DM follows the receiver.
const COPY = {
	th: {
		noPromptPay: title => `**${title}** ยังไม่มีพร้อมเพย์ของผู้รับ จึงตรวจการโอนผ่าน Discord ไม่ได้ ให้คนจัดตั้งพร้อมเพย์ก่อนนะ`,
		overOwed: (title, owed) => `ยอดนี้เกินยอดค้างของ **${title}** (${owed})`,
		unallocated: 'แบ่งยอดเข้ารายการนี้ไม่ได้ กรุณาลองใหม่',
		badFile: 'สลิปต้องเป็น JPG, PNG หรือ WebP และมีขนาดไม่เกิน 2 MB',
		downloadFailed: 'ดาวน์โหลดภาพสลิปจาก Discord ไม่สำเร็จ ลองแนบใหม่อีกครั้ง',
		unreadableImage: 'ภาพสลิปอ่านไม่ได้หรือมีขนาดใหญ่เกินไป',
		notAnImage: 'ไฟล์นี้เปิดเป็นภาพสลิปไม่ได้ กรุณาแนบ JPG, PNG หรือ WebP ใหม่',
		duplicate: 'สลิปนี้ถูกใช้แจ้งชำระรายการอื่นไปแล้ว',
		autoDetail: 'Megu จับคู่สลิปและลงยอดให้อัตโนมัติแล้ว ถ้าเงินไม่เข้าจริง กดปุ่มด้านล่างเพื่อย้อนผลพร้อมใส่เหตุผล',
		heldDetail: reasons => `ยังไม่ลงว่าได้รับเงิน เช็กบัญชีแล้วกดปุ่มด้านล่าง ดูสลิปได้ที่ลิงก์ ที่ต้องตรวจเองเพราะ\n${reasons || '• ต้องตรวจด้วยตนเอง'}`,
		ownerDm: (name, amount, title) => `**${name}** แจ้งจ่าย ${amount} ให้ **${title}**`,
		paid: (amount, title) => `บันทึกว่า **ชำระแล้ว ${amount}** ให้ **${title}**`,
		held: (amount, title) => `รับสลิป **${amount}** ของ **${title}** แล้ว แต่ข้อมูลยังไม่ครบ จึงรอเจ้าของตรวจ`,
	},
	en: {
		noPromptPay: title => `**${title}** has no PromptPay number for the receiver yet, so a transfer cannot be checked from Discord. Ask the organiser to set one first.`,
		overOwed: (title, owed) => `That is more than you still owe on **${title}** (${owed}).`,
		unallocated: 'This amount could not be applied to the bill. Please try again.',
		badFile: 'The slip must be a JPG, PNG or WebP of 2 MB or less.',
		downloadFailed: 'The slip could not be downloaded from Discord. Please attach it again.',
		unreadableImage: 'The slip picture could not be read or is too large.',
		notAnImage: 'This file does not open as a slip picture. Please attach a JPG, PNG or WebP.',
		duplicate: 'This slip has already been used for another payment.',
		autoDetail: 'Megu matched the slip and recorded the payment. If the money did not arrive, press the button below to undo it and say why.',
		heldDetail: reasons => `Not marked as received yet. Check your account, then press a button below; the slip is at the link. It needs your check because:\n${reasons || '• It needs checking by hand'}`,
		ownerDm: (name, amount, title) => `**${name}** says they paid ${amount} for **${title}**`,
		paid: (amount, title) => `Recorded as **paid, ${amount}** for **${title}**`,
		held: (amount, title) => `Got your **${amount}** slip for **${title}**, but some details are missing, so the organiser will check it.`,
	},
};

// The organiser's answer, on the DM that asked for it. Before these the only
// way to say "that is not a slip" was the web, which a Discord-only group never
// opens. The custom ids carry the `evt:` prefix, so `/event` handles them
// wherever the DM came from (`/จ่าย` or a card's pay button).
const DECISION_LABELS = {
	th: { confirm: 'ได้รับแล้ว', reject: 'ยังไม่เข้า', undo: 'เงินไม่เข้า ย้อนผล' },
	en: { confirm: 'Received', reject: 'Not received', undo: 'Not received, undo' },
};

function ownerDecisionButtons(code, paymentId, { autoConfirmed = false, lang = 'th' } = {}) {
	const labels = DECISION_LABELS[lang] || DECISION_LABELS.th;
	const row = new ActionRowBuilder();
	if (autoConfirmed) {
		row.addComponents(new ButtonBuilder().setCustomId(`evt:pundo:${code}:${paymentId}`).setStyle(ButtonStyle.Secondary).setLabel(labels.undo));
	}
	else {
		row.addComponents(
			new ButtonBuilder().setCustomId(`evt:pok:${code}:${paymentId}`).setStyle(ButtonStyle.Success).setLabel(labels.confirm),
			new ButtonBuilder().setCustomId(`evt:pno:${code}:${paymentId}`).setStyle(ButtonStyle.Danger).setLabel(labels.reject),
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
 * @param {string} [input.lang]  the payer's language, for the reply
 * @param {(uid: string) => Promise<string>} [input.langFor]  the receiver's language, for the DM
 * @returns {Promise<string>} the reply to show the payer
 */
async function submitDiscordSlip({ candidate, amountSatang, attachment, senderDiscordUid, notifyOwner = null, core = defaultCore, lang = 'th', langFor = null }) {
	const t = COPY[lang] || COPY.th;
	if (!candidate.payee?.promptpayId) return t.noPromptPay(candidate.title);
	if (!Number.isSafeInteger(amountSatang) || amountSatang <= 0 || amountSatang > candidate.outstandingSatang) {
		return t.overOwed(candidate.title, money(candidate.outstandingSatang));
	}
	const allocation = core.paymentEvidence.allocateOldestFirst(amountSatang, candidate.periods);
	if (allocation.unallocatedSatang > 0) return t.unallocated;

	const mime = String(attachment?.contentType || '').toLowerCase().split(';')[0];
	if (!IMAGE_TYPES.has(mime) || !(attachment.size > 0) || attachment.size > MAX_SLIP_BYTES) return t.badFile;

	// Discord's CDN, not the Discord API — no route bucket and no ban counter
	// involved — but the body is still checked before it is believed.
	const response = await fetch(attachment.url);
	if (!response.ok) return t.downloadFailed;
	const image = Buffer.from(await response.arrayBuffer());
	if (image.length === 0 || image.length > MAX_SLIP_BYTES) return t.unreadableImage;

	let reading;
	try {
		reading = await readDiscordSlip(image);
	}
	catch (error) {
		if (error.code === 'slip_unreadable') return t.notAnImage;
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
		if (error.code === 'slip_duplicate') return t.duplicate;
		throw error;
	}

	const link = `${siteUrl()}/a/${candidate.code}`;
	// Told: whoever the money went to, since they are the one who can see
	// whether it arrived. That is the owner unless someone else's card pays.
	const receiverUid = candidate.payeeDiscordUid || candidate.ownerDiscordUid;
	if (notifyOwner && receiverUid && receiverUid !== String(senderDiscordUid)) {
		let ownerLang;
		try {
			ownerLang = (langFor && await langFor(receiverUid)) || 'th';
		}
		catch {
			ownerLang = 'th';
		}
		const o = COPY[ownerLang] || COPY.th;
		const detail = result.autoConfirmed ? o.autoDetail : o.heldDetail(heldReasons(result.reasons, ownerLang));
		// The payment is already recorded; a closed DM must not turn that into
		// an error for the payer. A refusal still reaches the block guard —
		// guardRestClient() records it below every call — so this is not the
		// swallowed failure DISCORD-RATE-LIMITS.md rule 3 forbids.
		try {
			await notifyOwner(receiverUid, {
				content: `${o.ownerDm(candidate.participantName, money(amountSatang), candidate.title)}\n${detail}\n${link}`,
				components: ownerDecisionButtons(candidate.code, payment.id, { autoConfirmed: result.autoConfirmed, lang: ownerLang }),
			});
		}
		catch (error) {
			console.warn(`[Megu] Could not DM the receiver of ${candidate.code}: ${error.message}`);
		}
	}

	const status = result.autoConfirmed ? t.paid(money(amountSatang), candidate.title) : t.held(money(amountSatang), candidate.title);
	return `${status}\n${link}`;
}

module.exports = { submitDiscordSlip, ownerDecisionButtons, DECISION_LABELS, heldReasons, parseBaht, money, siteUrl, MAX_SLIP_BYTES };
