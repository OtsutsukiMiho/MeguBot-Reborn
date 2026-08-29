// Every language Megu speaks, and everything that makes one different.
//
// This file exists so that adding a third is data rather than engineering. The
// two-language version of this was spread across at least six places — a LANGS
// array here, a second one in the navbar, a `CHECK (locale IN ('en','th'))` in
// the schema, and a scattering of `lang === 'th' ? … : …` in formatters and
// components. Every one of those is a place a third language would have had to
// be remembered, and the one that got forgotten would have failed quietly, in
// whichever screen nobody opened that week.
//
// What belongs here is what genuinely differs between languages and cannot be
// looked up: which Intl tag to format numbers with, whether the calendar runs
// on a different year, the word that joins the last two items of a list. What
// does not belong here is anything about money, permissions or payments —
// business behaviour must never read a locale, and nothing in this file gives
// it a way to.
//
// English is the base. It is the fallback for a missing translation, the
// default for a reader Megu knows nothing about, and the language the codebase
// itself is written in.

const DEFAULT_LANG = 'en';

const EN_MONTHS = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December',
];
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Thai months and days are spelled out rather than taken from Intl because the
// runtime the bot ships on is not guaranteed to carry full ICU data — a Node
// built with small-icu silently falls back to English for th-TH, which is
// exactly the failure this avoids. A locale that leaves these null is trusting
// Intl, which is the right default for a language nobody has hit that problem
// with yet.
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

/**
 * @typedef {object} Locale
 * @property {string} code        what travels in URLs, the database and `<html lang>`
 * @property {string} label       what the switch in the navbar says, in that language
 * @property {string} intl        the tag handed to Intl for numbers and currency
 * @property {number} yearOffset  added to the Gregorian year — 543 for the Thai calendar
 * @property {string} conjunction the word before the last item of a list
 * @property {string[]|null} months      written out when Intl cannot be trusted, else null
 * @property {string[]|null} monthsShort
 * @property {string[]|null} days
 * @property {string[]|null} daysShort
 * @property {(day: number) => string|null} ordinal  "the 3rd", where a language has such a thing
 */
const LOCALES = {
	en: {
		code: 'en',
		label: 'EN',
		intl: 'en-US',
		yearOffset: 0,
		conjunction: 'and',
		months: EN_MONTHS,
		monthsShort: EN_MONTHS.map(name => name.slice(0, 3)),
		days: EN_DAYS,
		daysShort: EN_DAYS.map(name => name.slice(0, 3)),
		ordinal: (n) => {
			const suffix = (n % 100 >= 11 && n % 100 <= 13) ? 'th'
				: ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th';
			return `${n}${suffix}`;
		},
		patterns: {
			period: ({ month, year }) => `${month} ${year}`,
			when: ({ dayName, day, month, year, time }) => {
				const head = `${dayName} ${day} ${month} ${year}`;
				return time ? `${head}, ${time}` : head;
			},
			dueDay: ({ ordinal }) => `the ${ordinal} of every month`,
		},
	},
	th: {
		code: 'th',
		label: 'ไทย',
		intl: 'th-TH',
		// A Thai reader shown 2026 has to do the arithmetic themselves.
		yearOffset: 543,
		conjunction: 'กับ',
		months: THAI_MONTHS,
		monthsShort: THAI_MONTHS_SHORT,
		days: THAI_DAYS,
		daysShort: THAI_DAYS_SHORT,
		// Thai has no ordinal form; the pattern below reads the plain number.
		ordinal: null,
		patterns: {
			period: ({ month, year }) => `${month} ${year}`,
			when: ({ dayName, day, month, year, time, long }) => {
				const head = `${long ? 'วัน' : ''}${dayName} ${day} ${month} ${year}`;
				return time ? `${head} ${time} น.` : head;
			},
			dueDay: ({ day }) => `ทุกวันที่ ${day}`,
		},
	},
};

// The shapes a locale entry must have. A new language that forgets one of these
// would otherwise fail somewhere far from here, in whichever screen renders a
// date first — so it fails on import instead.
for (const [code, locale] of Object.entries(LOCALES)) {
	for (const field of ['code', 'label', 'intl', 'conjunction', 'patterns']) {
		if (locale[field] == null) throw new Error(`locale ${code} is missing ${field}`);
	}
	for (const pattern of ['period', 'when', 'dueDay']) {
		if (typeof locale.patterns[pattern] !== 'function') {
			throw new Error(`locale ${code} is missing the ${pattern} pattern`);
		}
	}
	if (locale.code !== code) throw new Error(`locale ${code} disagrees with its own code`);
}

const LANGS = Object.keys(LOCALES);

/**
 * The locale to use for whatever was asked for.
 *
 * Takes anything — a bare code, a full BCP 47 tag from a browser, a database
 * column, undefined — and returns a code Megu actually speaks. `zh-Hans-CN`
 * matches `zh` if `zh` is registered; nothing matches English.
 */
function resolveLang(input) {
	const raw = String(input || '').trim().toLowerCase();
	if (!raw) return DEFAULT_LANG;
	if (LOCALES[raw]) return raw;

	const base = raw.split(/[-_]/)[0];
	return LOCALES[base] ? base : DEFAULT_LANG;
}

/** The registry entry, always — an unknown code resolves to English first. */
function localeFor(input) {
	return LOCALES[resolveLang(input)];
}

/** Is this a language Megu has been taught? Used to validate stored preferences. */
function isSupported(input) {
	const raw = String(input || '').trim().toLowerCase();
	return Boolean(LOCALES[raw]);
}

/**
 * The switch in the navbar, as data.
 *
 * Ordered with English first because it is the base, then by code, so the list
 * does not reshuffle when a language is added in the middle.
 */
function localeChoices() {
	return LANGS
		.slice()
		.sort((a, b) => (a === DEFAULT_LANG ? -1 : b === DEFAULT_LANG ? 1 : a.localeCompare(b)))
		.map(code => ({ code, label: LOCALES[code].label }));
}

module.exports = { LOCALES, LANGS, DEFAULT_LANG, resolveLang, localeFor, isSupported, localeChoices };
