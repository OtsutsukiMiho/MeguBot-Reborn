// Reading a slip or a restaurant bill out of the words OCR came back with.
//
// The honest framing first, because it decides every choice below: this is a
// reading, not a fact. A camera pointed at thermal paper under a restaurant's
// lighting produces text with holes in it, and no amount of care here turns
// that into evidence. Everything this file returns is a proposal for a human to
// accept, and the interface is required to say so.
//
// What it can do is check itself. If the items it read add up to the total it
// read, two independent readings agree, and that is worth far more than either
// number alone — the same logic as the checksum on a QR. `reconciles` is that
// check, and it is the one signal the screen may lean on.
//
// Kept free of the browser so it can be tested against real slip and receipt
// text without an image or a canvas anywhere near it.

// ── text repair ──────────────────────────────────────────────────────────────

// Thai "ำ" arrives two ways: as U+0E33, and as U+0E4D U+0E32 — the same glyph
// assembled from a nicikhit and a sara aa. Fonts render them identically and
// OCR emits whichever the training data had, so "จำนวนเงิน" and "จํานวนเงิน"
// are the same word and only one of them would ever match a keyword list.
const THAI_SARA_AM = /ํา/g;

// Zero-width space, the two zero-width joiners, the byte-order mark and a
// non-breaking space. OCR sprinkles these between Thai clusters, and one of
// them inside a word makes every keyword match fail with nothing on screen to
// suggest why. Written as escapes because that is the only form of these
// characters a person reading this file can see.
const INVISIBLE = new RegExp('\u200B|\u200C|\u200D|\uFEFF|\u00A0', 'g');

// What OCR reliably mistakes for a digit when the surrounding token is numeric.
const DIGIT_LOOKALIKES = { O: '0', o: '0', D: '0', l: '1', I: '1', i: '1', '|': '1', S: '5', s: '5', B: '8', Z: '2', g: '9' };

function normalise(raw) {
	return String(raw == null ? '' : raw)
		.replace(THAI_SARA_AM, 'ำ')
		.replace(INVISIBLE, ' ')
		// Thai banking apps print 1,000.00, but OCR frequently turns the comma
		// into another dot. Repair only the unmistakable thousands+satang shape.
		.replace(/\b(\d{1,3})\.(\d{3})\.(\d{2})\b/g, '$1,$2.$3')
		.replace(/\r\n?/g, '\n');
}

/**
 * Repair digits, but only inside something already shaped like a number.
 *
 * Turning every O into a zero across a whole receipt would rewrite the food.
 * This only fires on a token made entirely of digits, separators and the
 * handful of characters that get confused for digits — where the intent is
 * unambiguous and the alternative is dropping the amount entirely.
 */
function repairDigits(token) {
	if (!/\d/.test(token)) return token;
	if (!/^[\d.,\s฿OoDlIi|SsBZg]+$/.test(token)) return token;
	return token.replace(/[OoDlIi|SsBZg]/g, ch => DIGIT_LOOKALIKES[ch] || ch);
}

// ── money ────────────────────────────────────────────────────────────────────

const BAHT = '(?:\\u0E3F|THB|บาท|Baht|BAHT)';
const NUMBER = '\\d{1,3}(?:[,\\s]\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?';
const MONEY = new RegExp(`(${BAHT})?\\s*(${NUMBER})\\s*(${BAHT})?`, 'g');

/**
 * Baht as written into the integer satang core counts in, by string arithmetic
 * — `66.50 * 100` is 6649.999999999999 and this is the one number nobody may
 * round by accident.
 */
function toSatang(text) {
	const cleaned = String(text).replace(/[,\s]/g, '');
	if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
	const [baht, fraction = ''] = cleaned.split('.');
	const satang = Number(baht) * 100 + Number(fraction.padEnd(2, '0'));
	return Number.isSafeInteger(satang) ? satang : null;
}

/**
 * Every number on a line that could be money, with how much it looks like it.
 *
 * Strength is the whole trick. A receipt is full of numbers that are not
 * amounts — table numbers, quantities, times, a fifteen-digit reference — and
 * the difference between them and the total is almost never the value. It is
 * the shape: a currency mark beside it, two decimal places, a thousands
 * separator. Ranking by shape and then by position is what stops "Table 5"
 * becoming a five-baht charge.
 */
function moneyOn(line) {
	const found = [];
	const text = normalise(line);
	MONEY.lastIndex = 0;

	let match;
	while ((match = MONEY.exec(text)) != null) {
		const [whole, before, digits, after] = match;
		const repaired = repairDigits(digits);
		const satang = toSatang(repaired);
		if (satang == null) continue;

		const hasCurrency = Boolean(before || after);
		const hasDecimals = /\.\d{1,2}$/.test(repaired);
		const hasSeparator = /[,\s]\d{3}/.test(repaired);
		const bare = !hasCurrency && !hasDecimals && !hasSeparator;

		// A bare run of digits long enough to be a reference number, a phone
		// number or an account is not a price. Six figures of food would be
		// remarkable; six figures of transaction id is Tuesday.
		if (bare && repaired.replace(/\D/g, '').length > 6) continue;

		// A bare four-digit number sitting where a year sits, next to a slash
		// or a dash, is a date and not ฿2,026.
		if (bare && /^(?:19|20|25|26)\d{2}$/.test(repaired) && /[/\-.]/.test(text.slice(Math.max(0, match.index - 1), match.index + whole.length + 1))) continue;

		// Part of a clock reading.
		if (/:\s*$/.test(text.slice(0, match.index)) || /^\s*:/.test(text.slice(match.index + whole.length))) continue;

		found.push({
			satang,
			at: match.index,
			end: match.index + whole.length,
			strength: (hasCurrency ? 3 : 0) + (hasDecimals ? 2 : 0) + (hasSeparator ? 1 : 0),
		});
	}

	return found;
}

// ── the words that label a number ────────────────────────────────────────────

// One transfer, one amount. `จำนวน` is what every Thai banking app prints.
const AMOUNT_WORDS = [
	'จำนวนเงิน', 'จำนวน', 'ยอดเงิน', 'ยอดโอน', 'โอนเงิน',
	'amount', 'transfer amount', 'paid', 'total amount',
];

// The bottom line of a restaurant bill, in the shapes Thai kitchens print it.
const TOTAL_WORDS = [
	'รวมทั้งสิ้น', 'ยอดสุทธิ', 'รวมสุทธิ', 'ยอดรวมสุทธิ', 'ยอดรวม', 'รวมเงิน', 'สุทธิ', 'รวม',
	'grand total', 'net total', 'total due', 'amount due', 'balance due', 'total',
];

const SUBTOTAL_WORDS = ['รวมย่อย', 'ยอดก่อนภาษี', 'ราคารวม', 'subtotal', 'sub total', 'sub-total'];
const TAX_WORDS = ['ภาษีมูลค่าเพิ่ม', 'ภาษี', 'vat', 'tax'];
const SERVICE_WORDS = ['ค่าบริการ', 'เซอร์วิสชาร์จ', 'service charge', 'service'];
const DISCOUNT_WORDS = ['ส่วนลด', 'ลด', 'discount', 'promotion'];

// Lines whose number must never be read as what is owed. Cash tendered and
// change given are both larger and smaller than the bill by design, and a fee
// on a slip sits directly under the amount it is not.
const NOT_THE_BILL = [
	'เงินสด', 'รับเงิน', 'เงินทอน', 'ทอน', 'cash', 'change', 'tendered',
	'ค่าธรรมเนียม', 'fee', 'ค่าบริการโอน',
	'คงเหลือ', 'ยอดคงเหลือ', 'balance', 'available',
];

function mentions(line, words) {
	const haystack = normalise(line).toLowerCase();
	return words.some(word => haystack.includes(word.toLowerCase()));
}

/**
 * Where on the line the label ends, so the item's name can be cut from it.
 */
function labelOf(line, money) {
	const text = normalise(line);
	const before = text.slice(0, money.at);
	return before
		.replace(/[.…·•\-–—_]{2,}\s*$/, '')
		.replace(/\s*[xX×]\s*\d+\s*$/, '')
		.replace(/^\s*\d+\s*[xX×]\s*/, '')
		.replace(/^\s*\d+[.)]\s*/, '')
		.trim();
}

/**
 * How many of the thing, if the line says.
 *
 * Written as `2 x ผัดไทย`, `ผัดไทย x2`, or a bare count in the left column.
 * Quantity is read but never used to recompute the price: the printed figure
 * is what the kitchen charged, and multiplying a unit price back out is how you
 * end up disagreeing with a bill somebody is holding.
 */
function quantityOf(line) {
	const text = normalise(line);
	const patterns = [/^\s*(\d{1,3})\s*[xX×]\s/, /[xX×]\s*(\d{1,3})\s*(?=[^\d]*$)/, /^\s*(\d{1,3})\s+\D/];
	for (const pattern of patterns) {
		const found = text.match(pattern);
		if (found) {
			const count = Number(found[1]);
			if (count >= 1 && count <= 999) return count;
		}
	}
	return null;
}

// ── dates ────────────────────────────────────────────────────────────────────

const THAI_MONTHS = [
	['ม.ค.', 'มกราคม', 'jan'], ['ก.พ.', 'กุมภาพันธ์', 'feb'], ['มี.ค.', 'มีนาคม', 'mar'],
	['เม.ย.', 'เมษายน', 'apr'], ['พ.ค.', 'พฤษภาคม', 'may'], ['มิ.ย.', 'มิถุนายน', 'jun'],
	['ก.ค.', 'กรกฎาคม', 'jul'], ['ส.ค.', 'สิงหาคม', 'aug'], ['ก.ย.', 'กันยายน', 'sep'],
	['ต.ค.', 'ตุลาคม', 'oct'], ['พ.ย.', 'พฤศจิกายน', 'nov'], ['ธ.ค.', 'ธันวาคม', 'dec'],
];

/**
 * A Buddhist year written on a slip, as the Gregorian one everything else uses.
 *
 * Anything past 2400 is พุทธศักราช and cannot be a Gregorian year anyone is
 * transferring money in.
 *
 * Two digits are the awkward case, because Thai apps shorten both calendars:
 * "18 ส.ค. 69" is 2569 and "18/08/26" is 2026, and both are this week. They
 * split cleanly on the number itself — a short Buddhist year is in the sixties
 * and seventies, a short Gregorian one in the twenties and thirties — so the
 * boundary sits at 40, where neither reading lands anywhere near the present.
 */
function gregorianYear(year) {
	const value = Number(year);
	if (!Number.isFinite(value)) return null;
	if (value > 2400) return value - 543;
	if (value < 100) return value > 40 ? value + 1957 : value + 2000;
	return value;
}

/**
 * When the slip says it happened.
 *
 * Returned as a plain `{ year, month, day, hour, minute }` rather than a Date,
 * because a slip carries a wall clock in Bangkok and nothing else — attaching a
 * timezone here would be inventing information, and this codebase has already
 * been bitten once by a month that turned over at the wrong hour.
 */
function readWhen(text) {
	const lines = normalise(text);

	let date = null;

	// 18/08/2569, 18-08-2026, 18.08.69
	const numeric = lines.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/);
	if (numeric) {
		const year = gregorianYear(numeric[3]);
		const day = Number(numeric[1]);
		const month = Number(numeric[2]);
		if (year && month >= 1 && month <= 12 && day >= 1 && day <= 31) date = { year, month, day };
	}

	// 2026-08-18
	if (!date) {
		const iso = lines.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
		if (iso) date = { year: gregorianYear(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
	}

	// 18 ส.ค. 2569 — and its English and long-form Thai equivalents
	if (!date) {
		for (let index = 0; index < THAI_MONTHS.length; index++) {
			for (const name of THAI_MONTHS[index]) {
				const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				const found = lines.match(new RegExp(`\\b(\\d{1,2})\\s*${escaped}[a-z]*\\.?\\s*(\\d{2,4})\\b`, 'i'));
				if (found) {
					date = { year: gregorianYear(found[2]), month: index + 1, day: Number(found[1]) };
					break;
				}
			}
			if (date) break;
		}
	}

	if (!date || !date.year) return null;

	// Sparse OCR commonly inserts an empty line between every visible row. Use
	// adjacent non-empty rows so a `Date` label still reaches the timestamp it
	// labels instead of stopping at an OCR-created blank line.
	const rows = lines.split('\n').map(row => row.trim()).filter(Boolean);
	const dateRow = rows.findIndex((row) => {
		const lower = row.toLowerCase();
		return /วันที่|date/iu.test(row)
			|| /\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b/.test(row)
			|| THAI_MONTHS.flat().some(month => lower.includes(month.toLowerCase()));
	});
	// Search the date line and the line immediately after its label. This keeps
	// 0.00 fees and 1,000.00 amounts from being mistaken for midnight/one AM.
	const clockHaystack = dateRow >= 0 ? `${rows[dateRow]} ${rows[dateRow + 1] || ''}` : lines;
	const clock = clockHaystack.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)(?:[:.]([0-5]\d))?\s*(?:น\.?)?/);
	return {
		...date,
		hour: clock ? Number(clock[1]) : null,
		minute: clock ? Number(clock[2]) : null,
	};
}

// ── transfer parties ────────────────────────────────────────────────────────

// A label must end, be separated from its value by whitespace, or use an
// explicit delimiter. Sparse OCR often emits noise such as `to.` inside a
// party block; treating any `to` prefix as a receiver label swaps the parties.
const LABEL_SUFFIX = '(?:\\s*[:：-]\\s*|\\s+|$)';
const SENDER_LABEL = new RegExp(`^(?:จาก|ผู้โอน|ผู้ชำระ|from|sender)${LABEL_SUFFIX}`, 'iu');
const RECEIVER_LABEL = new RegExp(`^(?:ไปยัง|ผู้รับ|ผู้รับเงิน|to|receiver)${LABEL_SUFFIX}`, 'iu');
const PARTY_STOP = /^(?:จำนวน|ยอด|amount|ค่าธรรมเนียม|fee|วันที่|เวลา|date|รหัส|reference)\b/iu;
const BANK_LINE = /(?:ธนาคาร|กรุงไทย|กสิกร|ไทยพาณิชย์|กรุงเทพ|กรุงศรี|ออมสิน|ttb|scb|kbank|krungthai|bangkok bank|krungsri)/iu;

function accountTail(line) {
	const text = String(line || '');
	if (!/[xX*•]|บัญชี|account/iu.test(text)) return null;
	const digits = text.replace(/\D/g, '');
	return digits.length >= 2 ? digits.slice(-4) : null;
}

function looksLikePartyName(line) {
	const text = String(line || '').trim();
	if (!text || PARTY_STOP.test(text) || BANK_LINE.test(text)) return false;
	if (accountTail(text)) return false;
	if (!/[A-Za-zก-๙]/u.test(text)) return false;
	// Bank-account names are not two-letter OCR fragments such as `to.` or
	// `fr:`. Requiring three visible letters still allows initials inside a
	// normal name while discarding these isolated label remnants.
	if (text.replace(/[^A-Za-zก-๙]/gu, '').length < 3) return false;
	return !/^โอนเงินสำเร็จ$/iu.test(text);
}

function readParty(lines, label, otherLabel) {
	const start = lines.findIndex(line => label.test(line));
	if (start < 0) return null;

	const sameLine = lines[start].replace(label, '').trim();
	const candidates = sameLine ? [sameLine, ...lines.slice(start + 1, start + 9)] : lines.slice(start + 1, start + 9);
	let name = null;
	let tail = null;
	for (const candidate of candidates) {
		if (otherLabel.test(candidate) || PARTY_STOP.test(candidate)) break;
		if (!tail) tail = accountTail(candidate);
		if (!name && looksLikePartyName(candidate)) {
			name = candidate.trim().replace(/^[^A-Za-zก-๙]+/u, '').trim();
		}
	}
	return name || tail ? { name, accountTail: tail } : null;
}

/** What the visible text says about who sent and received the transfer. */
function readTransferParties(text) {
	const lines = normalise(text).split('\n').map(line => line.trim()).filter(Boolean);
	return {
		sender: readParty(lines, SENDER_LABEL, RECEIVER_LABEL),
		receiver: readParty(lines, RECEIVER_LABEL, SENDER_LABEL),
	};
}

// ── the whole reading ────────────────────────────────────────────────────────

/**
 * Read a slip or a bill out of OCR text.
 *
 * `kind` is a hint, not a switch: a transfer slip is looked at for one labelled
 * amount, a restaurant bill for a list and a total. Both passes run either way,
 * because a slip photographed sideways and a receipt with one line on it are
 * the same picture as far as this can tell.
 *
 * @param {string} raw       whatever OCR produced
 * @param {{kind?: 'slip'|'receipt'}} [options]
 */
function readReceiptText(raw, { kind = 'receipt' } = {}) {
	const text = normalise(raw);
	const lines = text.split('\n').map(line => line.trim()).filter(Boolean);

	const items = [];
	let total = null;
	let subtotal = null;
	let tax = null;
	let service = null;
	let discount = null;
	let labelled = null;

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		let money = moneyOn(line);

		// Banking apps put the label and the figure on separate lines — "จำนวน:"
		// and then ฿1,250.00 underneath, often in a much larger face. Read as
		// lines, that label owns no number and the amount owns no label, and
		// the one figure the whole slip exists to state goes unread. So a
		// labelling word with nothing after it borrows the next line's number.
		let borrowed = false;
		if (money.length === 0) {
			const labelsSomething = mentions(line, AMOUNT_WORDS) || mentions(line, TOTAL_WORDS);
			if (!labelsSomething || index + 1 >= lines.length) continue;
			money = moneyOn(lines[index + 1]);
			// Only when the next line is the figure and nothing else, or the
			// borrowing would swallow the first item of the bill.
			if (money.length !== 1 || labelOf(lines[index + 1], money[0])) continue;
			borrowed = true;
		}

		// The rightmost figure on a line is the one in the amount column. Any
		// numbers to its left are quantities, unit prices or table numbers.
		const last = money[money.length - 1];
		const label = borrowed ? '' : labelOf(line, last);

		if (mentions(line, NOT_THE_BILL)) continue;

		if (mentions(line, TOTAL_WORDS) && !mentions(line, SUBTOTAL_WORDS)) {
			// A receipt may print several totals as it works down the page. The
			// last one is the one that was charged.
			total = last.satang;
			continue;
		}
		if (mentions(line, SUBTOTAL_WORDS)) {
			subtotal = last.satang;
			continue;
		}
		if (mentions(line, TAX_WORDS)) {
			tax = last.satang;
			continue;
		}
		if (mentions(line, SERVICE_WORDS)) {
			service = last.satang;
			continue;
		}
		if (mentions(line, DISCOUNT_WORDS)) {
			discount = last.satang;
			continue;
		}

		if (labelled == null && mentions(line, AMOUNT_WORDS)) {
			labelled = last.satang;
			continue;
		}

		// What is left is a line of the bill: something with a name and a price
		// against it. A price with no name is a stray number.
		if (label && label.length >= 2 && last.strength > 0) {
			items.push({ label, quantity: quantityOf(line), amountSatang: last.satang });
		}
	}

	const itemsSum = items.reduce((sum, item) => sum + item.amountSatang, 0);

	// The self-check. Items plus the charges the bill lists, against the total
	// it printed. When these agree, two separate readings of the same paper
	// agree, and that is the only thing here worth calling evidence.
	const expected = itemsSum + (tax || 0) + (service || 0) - (discount || 0);
	const reconciles = total != null && items.length > 0 ? expected === total : null;

	// Which number is "the" number, and how it was arrived at, because the
	// screen says different things for each. A figure sitting under the word
	// "จำนวนเงิน" is worth more than the largest number on the page, and the
	// reader deserves to know which one they are being shown.
	let amountSatang = null;
	let amountSource = null;
	if (kind === 'slip' && labelled != null) {
		amountSatang = labelled;
		amountSource = 'labelled';
	}
	else if (total != null) {
		amountSatang = total;
		amountSource = 'total';
	}
	else if (labelled != null) {
		amountSatang = labelled;
		amountSource = 'labelled';
	}
	else if (items.length > 0) {
		amountSatang = itemsSum;
		amountSource = 'items';
	}
	else {
		// Nothing was labelled and nothing was itemised. The largest figure on
		// a slip is very often the amount — and "very often" is exactly why
		// this is reported as a guess rather than shown as the answer.
		const all = lines.flatMap(moneyOn).filter(m => m.strength > 0);
		if (all.length > 0) {
			amountSatang = Math.max(...all.map(m => m.satang));
			amountSource = 'guess';
		}
	}

	return {
		amountSatang,
		amountSource,
		when: readWhen(text),
		parties: kind === 'slip' ? readTransferParties(text) : null,
		items,
		itemsSum,
		totalSatang: total,
		subtotalSatang: subtotal,
		taxSatang: tax,
		serviceSatang: service,
		discountSatang: discount,
		reconciles,
	};
}

module.exports = {
	readReceiptText,
	readWhen,
	readTransferParties,
	moneyOn,
	toSatang,
	normalise,
	repairDigits,
	quantityOf,
	gregorianYear,
};
