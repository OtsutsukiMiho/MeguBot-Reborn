// core is loaded on first use, not when bot.js loads this file.
const loadCore = () => require('../../core/index.js');
const { submitDiscordSlip, parseBaht } = require('./slip-submit.js');
const { formatPeriod } = require('../../core/format.js');

// Paying by typing in the bill's own thread.
//
// "จ่าย ต.ค. 2569" or "pay 10/2026" with a slip attached, sent in a bill's
// private thread, is the same payment as `/pay` with that bill picked. The
// thread already says which bill; the words say which month, and the slip
// says the rest.
//
// Only that shape is read: a message in a thread that belongs to exactly one
// bill, starting with a payment word, carrying an image. Anything else in the
// thread is conversation and is left alone, and no other channel is read at
// all. The message is deleted once it has been handled, because a slip shows
// the payer's bank name and account digits to everyone in the thread; what
// Megu keeps instead is its own evidence card.
//
// Rate limits: this answers a message Discord pushed to us. Per payment it is
// at most one delete, one reply in the thread and the receiver's DM, each
// through discordCall, and one payment per person is read at a time.

const KEYWORD = /^\s*(จ่ายแล้ว|จ่าย|โอนแล้ว|โอน|paid|pay)(?=[\s,.:]|$)/i;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
// Written with or without the dots: "ต.ค." and "ตค" are both common.
const THAI_SHORT = ['มค', 'กพ', 'มีค', 'เมย', 'พค', 'มิย', 'กค', 'สค', 'กย', 'ตค', 'พย', 'ธค'];
const EN_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
// A month name with the day before it and the year after it, to keep their
// numbers from being read as an amount.
const MONTH_WORDS = new RegExp(`((?<![\\d,.])\\d{1,2}\\s*)?(${[
	...THAI_MONTHS,
	...THAI_SHORT.map(name => `${name.split('').join('\\.?')}\\.?`),
	...EN_MONTHS.map(name => `\\b${name.slice(0, 3)}[a-z]*\\b`),
].join('|')})(\\s*\\d{4}|\\s*\\d{2})?(?!\\d)`, 'gi');

/**
 * A year as people write it: 2569 and 2026 are the same year, and so are 69
 * and 26 once the century is known. A four-digit year from 2400 on is the
 * Buddhist era. A two-digit year is read in whichever era lands closer to
 * now, so "69" is 2569 (2026) and "26" is 2026.
 */
function normalizeYear(raw, now) {
	const year = Number(raw);
	if (!Number.isInteger(year)) return null;
	if (String(raw).length === 4) return year >= 2400 ? year - 543 : year;
	if (String(raw).length !== 2) return null;
	const current = now.getFullYear();
	const common = 2000 + year;
	const buddhist = 2500 + year - 543;
	return Math.abs(buddhist - current) < Math.abs(common - current) ? buddhist : common;
}

function monthKey(year, month) {
	if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
	return `${year}-${String(month).padStart(2, '0')}`;
}

/** The month a message names, as "YYYY-MM", or null when it names none. */
function readMonth(text, now = new Date()) {
	const thisYear = now.getFullYear();
	const plain = String(text).replace(/[๐-๙]/g, digit => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit)));

	// 27/10/2569, 27-10-2026, 27.10.69: day, month, year.
	// Not preceded by a digit, comma or dot, so "1,200.50" is not a date.
	let match = plain.match(/(?<![\d,.])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/);
	if (match) return monthKey(normalizeYear(match[3], now), Number(match[2]));
	// 10/2569 or 10/69 is a month and a year; 27/10 is a day and a month.
	match = plain.match(/(?<![\d,.])(\d{1,2})[/.-](\d{4}|\d{2})(?![\d.])/);
	if (match) {
		const [first, second] = [Number(match[1]), match[2]];
		if (first >= 1 && first <= 12) return monthKey(normalizeYear(second, now), first);
		if (second.length === 2 && Number(second) <= 12) return monthKey(thisYear, Number(second));
	}

	// Month names, Thai or English, with an optional year after them.
	const squeezed = plain.replace(/\./g, '').toLowerCase();
	const yearAfter = (index, length) => {
		const rest = squeezed.slice(index + length).match(/^\s*(\d{4}|\d{2})(?!\d)/);
		return rest ? normalizeYear(rest[1], now) : thisYear;
	};
	for (const names of [THAI_MONTHS, THAI_SHORT]) {
		for (let i = 0; i < names.length; i++) {
			const at = squeezed.indexOf(names[i]);
			if (at >= 0) return monthKey(yearAfter(at, names[i].length), i + 1);
		}
	}
	for (let i = 0; i < EN_MONTHS.length; i++) {
		const found = squeezed.match(new RegExp(`\\b(${EN_MONTHS[i]}|${EN_MONTHS[i].slice(0, 3)})\\b`));
		if (found) return monthKey(yearAfter(found.index, found[0].length), i + 1);
	}
	return null;
}

/**
 * What a payment message asks for: the month it names and the amount, when
 * it gives one. Null when the message is not a payment at all.
 */
function parsePaymentMessage(text, now = new Date()) {
	const match = String(text || '').match(KEYWORD);
	if (!match) return null;
	const rest = String(text).slice(match[0].length);
	// A bare number that is not part of a date is an amount: "จ่าย 150",
	// "pay ฿1,200.50". Dates, and the day and year around a month name
	// ("27 ต.ค. 69"), are taken out first.
	const withoutDates = rest
		.replace(/[๐-๙]/g, digit => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit)))
		.replace(MONTH_WORDS, ' ')
		.replace(/(?<![\d,.])\d{1,2}[/.-]\d{1,2}[/.-](\d{4}|\d{2})(?!\d)/g, ' ')
		.replace(/(?<![\d,.])\d{1,2}[/.-](\d{4}|\d{2})(?![\d.])/g, ' ')
		.replace(/(^|\s)\d{4}(?=\s|$)/g, ' ');
	const amount = withoutDates.match(/(^|\s)(฿?\s?\d[\d,]*(\.\d{1,2})?)\s*(บาท|thb|baht)?(?=\s|$)/i);
	return {
		periodKey: readMonth(rest, now),
		amountSatang: amount ? parseBaht(amount[2]) : null,
		// The reply is in the language the payment was asked in.
		lang: /[฀-๿]/.test(match[1]) ? 'th' : 'en',
	};
}

const T = {
	th: {
		notOnBill: name => `**${name}** ไม่มียอดค้างในบิลนี้ เลยไม่ได้บันทึกสลิป ถ้าคิดว่าผิด ลองใช้ /pay`,
		noMonth: (name, month) => `**${name}** ไม่มียอดค้างของ${month} เลยไม่ได้บันทึกสลิป ลองระบุเดือนอื่น หรือใช้ /pay`,
		failed: name => `อ่านสลิปของ **${name}** ไม่สำเร็จ ลองส่งใหม่อีกครั้ง หรือใช้ /pay`,
		removed: 'ลบข้อความที่มีสลิปออกแล้ว Megu เก็บไว้แค่หลักฐานการโอน',
		forMonth: month => ` ของ${month}`,
	},
	en: {
		notOnBill: name => `**${name}** owes nothing on this bill, so the slip was not recorded. If that is wrong, try /pay.`,
		noMonth: (name, month) => `**${name}** owes nothing for ${month}, so the slip was not recorded. Name another month or use /pay.`,
		failed: name => `Could not read **${name}**'s slip. Send it again, or use /pay.`,
		removed: 'The message with the slip was removed. Megu keeps only its own record of the transfer.',
		forMonth: month => ` for ${month}`,
	},
};

const reading = new Set();

/**
 * Handles a message if it is a payment in a bill thread. Returns true when it
 * was one (handled or refused), false when the message is none of our
 * business and the rest of the bot should see it.
 */
async function handleThreadPayment(message, { core = loadCore(), discordCall, now = () => new Date(), submit = submitDiscordSlip } = {}) {
	if (!message.guild || message.author?.bot || !message.channel?.isThread?.()) return false;
	const image = [...(message.attachments?.values?.() || [])]
		.find(item => IMAGE_TYPES.has(String(item.contentType || '').toLowerCase().split(';')[0]));
	if (!image) return false;
	const asked = parsePaymentMessage(message.content, now());
	if (!asked) return false;
	const code = await core.activities.getActivityCodeByChannel(message.channelId);
	if (!code) return false;
	if (reading.has(message.author.id)) return true;
	reading.add(message.author.id);

	const lang = asked.lang;
	const t = T[lang];
	const name = message.member?.displayName || message.author.globalName || message.author.username;
	let reply;
	try {
		reply = await answer(message, { core, code, asked, image, t, lang, name, submit });
	}
	catch (error) {
		console.warn(`[Megu] Could not read a slip in the thread of ${code}: ${error.message}`);
		reply = t.failed(name);
	}
	finally {
		reading.delete(message.author.id);
	}

	// The slip goes either way: recorded or not, it showed bank details to
	// everyone in the thread.
	const removed = await discordCall(`removing a slip message in the thread of ${code}`, async () => {
		await message.delete();
		return true;
	}, false);
	await discordCall(`answering a payment in the thread of ${code}`, () => message.channel.send({
		content: removed ? `${reply}\n${t.removed}` : reply,
		allowedMentions: { parse: [] },
	}), null);
	return true;
}

async function answer(message, { core, code, asked, image, t, lang, name, submit }) {
	const [candidate] = (await core.activities.listPaymentCandidatesForDiscord(message.author.id, message.guild.id, code))
		.filter(item => item.code === code);
	if (!candidate) return t.notOnBill(name);

	// A monthly bill pays one month: the one named, or the oldest unpaid.
	let target = candidate;
	let monthNote = '';
	if (candidate.kind === 'recurring') {
		const period = asked.periodKey
			? candidate.periods.find(item => item.key === asked.periodKey)
			: [...candidate.periods].sort((a, b) => String(a.key).localeCompare(String(b.key)))[0];
		if (!period) return t.noMonth(name, formatPeriod(asked.periodKey, lang) || asked.periodKey);
		target = { ...candidate, periods: [period], outstandingSatang: period.outstandingSatang };
		monthNote = t.forMonth(formatPeriod(period.key, lang) || period.key);
	}

	const result = await submit({
		candidate: target,
		amountSatang: asked.amountSatang || target.outstandingSatang,
		attachment: { url: image.url, contentType: image.contentType, size: image.size },
		senderDiscordUid: message.author.id,
		core,
		notifyOwner: async (uid, note) => {
			const owner = await message.client.users.fetch(uid);
			await owner.send({ ...note, allowedMentions: { parse: [] } });
		},
	});
	return `**${name}**${monthNote}: ${result}`;
}

module.exports = { handleThreadPayment, parsePaymentMessage, readMonth, normalizeYear };
