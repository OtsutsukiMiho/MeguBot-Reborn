// Anything a human reads that is built from data rather than written by hand.
//
// This module is deliberately free of every other module: no database, no
// Discord, no React. Both the web pages and the bot import it, so the same
// ฿60.00 and the same "August 2026" reach a browser and a DM, and nobody has
// to remember which of the two has the newer copy of the logic.
//
// The rule that forced it into existence: a month's name must never be stored.
// `periods.label` used to hold "สิงหาคม 2569" written at the moment the month
// opened, which meant switching the site to English could not reach months
// that already existed. The key ("2026-08") is the fact; the label is a
// rendering of it, and renderings belong here.

const LANGS = ['en', 'th'];
const DEFAULT_LANG = 'en';

// Thai months are spelled out rather than taken from Intl because the runtime
// the bot ships on is not guaranteed to carry full ICU data — a Node built
// with small-icu silently falls back to English for th-TH, which is exactly
// the failure this file exists to prevent.
const THAI_MONTHS = [
	'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
	'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const THAI_MONTHS_SHORT = [
	'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
	'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const THAI_DAYS_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

const EN_MONTHS = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December',
];
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Everything this product does happens in Thailand, including the months it
// bills for. Left to the server's own clock, a period opened at 02:00 on the
// first of September in Bangkok would be filed under August, because the
// server is very likely running in UTC.
const TIMEZONE = 'Asia/Bangkok';
const BUDDHIST_OFFSET = 543;

function resolveLang(input) {
	const lang = String(input || '').slice(0, 2).toLowerCase();
	return LANGS.includes(lang) ? lang : DEFAULT_LANG;
}

/**
 * The calendar date in Bangkok, whatever the server thinks the time is.
 *
 * `en-CA` is used because it is the one common locale that formats as
 * YYYY-MM-DD, which parses without ambiguity. The locale is a formatting
 * detail here, not a language choice.
 */
function bangkokParts(date = new Date()) {
	const d = date instanceof Date ? date : new Date(date);
	const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
		timeZone: TIMEZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(d).split('-').map(Number);

	const time = new Intl.DateTimeFormat('en-GB', {
		timeZone: TIMEZONE,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	}).format(d);
	const [hour, minute] = time.split(':').map(Number);

	// Zeller-free weekday: ask Intl for it rather than deriving, so the
	// timezone shift is applied once, here.
	const weekdayName = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'short' }).format(d);
	const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayName);

	return { year, month, day, hour, minute, weekday };
}

/**
 * Money.
 *
 * Takes no language, and that is the point: ฿60.00 is not a phrase, and a
 * reader who switched the page to English has not stopped using baht. Giving
 * it a language parameter would invite somebody to localise the separators
 * one day, and the group would end up with two spellings of the same amount
 * depending on who was looking.
 */
function formatMoney(satang) {
	if (satang == null) return '—';
	const sign = satang < 0 ? '-' : '';
	const abs = Math.abs(satang);
	const baht = Math.floor(abs / 100);
	const rest = String(abs % 100).padStart(2, '0');
	return `${sign}฿${baht.toLocaleString('en-US')}.${rest}`;
}

/**
 * The month key a date falls in, in Bangkok. This is what identifies a billing
 * period; everything else about a month is derived from it.
 */
function periodKeyFor(date = new Date()) {
	const { year, month } = bangkokParts(date);
	return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * "2026-08" as a person reads it. Thai gets the Buddhist year, because a Thai
 * reader seeing 2026 has to do the arithmetic themselves.
 */
function formatPeriod(key, lang = DEFAULT_LANG, { short = false } = {}) {
	if (!key) return '';
	const [year, month] = String(key).split('-').map(Number);
	if (!year || !month || month < 1 || month > 12) return String(key);

	if (resolveLang(lang) === 'th') {
		const names = short ? THAI_MONTHS_SHORT : THAI_MONTHS;
		return `${names[month - 1]} ${year + BUDDHIST_OFFSET}`;
	}
	const name = EN_MONTHS[month - 1];
	return short ? `${name.slice(0, 3)} ${year}` : `${name} ${year}`;
}

/**
 * A date and time, in Bangkok, in the reader's language.
 *
 * Written out by hand rather than handed to `toLocaleString` so that the
 * Buddhist year, the timezone and the word order are decided here rather than
 * by whichever ICU build the process happens to have.
 */
function formatWhen(input, lang = DEFAULT_LANG, { long = false, time = true } = {}) {
	if (!input) return '';
	const date = input instanceof Date ? input : new Date(input);
	if (Number.isNaN(date.getTime())) return '';

	const { year, month, day, hour, minute, weekday } = bangkokParts(date);
	const hh = String(hour).padStart(2, '0');
	const mm = String(minute).padStart(2, '0');

	if (resolveLang(lang) === 'th') {
		const dayName = long ? THAI_DAYS[weekday] : THAI_DAYS_SHORT[weekday];
		const monthName = long ? THAI_MONTHS[month - 1] : THAI_MONTHS_SHORT[month - 1];
		const head = `${long ? 'วัน' : ''}${dayName} ${day} ${monthName} ${year + BUDDHIST_OFFSET}`;
		return time ? `${head} ${hh}:${mm} น.` : head;
	}

	const dayName = long ? EN_DAYS[weekday] : EN_DAYS[weekday].slice(0, 3);
	const monthName = long ? EN_MONTHS[month - 1] : EN_MONTHS[month - 1].slice(0, 3);
	const head = `${dayName} ${day} ${monthName} ${year}`;
	return time ? `${head}, ${hh}:${mm}` : head;
}

/**
 * "the 15th of every month" — the day a recurring agreement falls due.
 */
function formatDueDay(day, lang = DEFAULT_LANG) {
	const n = Number(day);
	if (!Number.isInteger(n) || n < 1 || n > 31) return '';
	if (resolveLang(lang) === 'th') return `ทุกวันที่ ${n}`;

	const suffix = (n % 100 >= 11 && n % 100 <= 13) ? 'th'
		: ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th';
	return `the ${n}${suffix} of every month`;
}

/**
 * A list of names as a sentence: "โอม, นัท and ฟิก".
 */
function formatNames(names, lang = DEFAULT_LANG) {
	const list = (Array.isArray(names) ? names : [names]).filter(Boolean);
	if (list.length === 0) return '';
	if (list.length === 1) return String(list[0]);
	const last = list[list.length - 1];
	const rest = list.slice(0, -1).join(', ');
	return resolveLang(lang) === 'th' ? `${rest} กับ ${last}` : `${rest} and ${last}`;
}

module.exports = {
	LANGS,
	DEFAULT_LANG,
	TIMEZONE,
	resolveLang,
	bangkokParts,
	periodKeyFor,
	formatMoney,
	formatPeriod,
	formatWhen,
	formatDueDay,
	formatNames,
};
