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

// Which languages exist, and what makes each one different, lives in
// `locales.js`. This file renders; that file is the registry. Nothing below may
// name a language: a `lang === 'th'` here is a third language's bug, waiting.
const { LANGS, DEFAULT_LANG, resolveLang, localeFor } = require('./locales.js');

// Everything this product does happens in Thailand, including the months it
// bills for. Left to the server's own clock, a period opened at 02:00 on the
// first of September in Bangkok would be filed under August, because the
// server is very likely running in UTC.
//
// This is a fact about the product, not about the reader's language, which is
// why it is here and not in the registry. Nobody's choice of English moves the
// billing month.
const TIMEZONE = 'Asia/Bangkok';

/**
 * Month and weekday names for a locale, falling back to Intl.
 *
 * A registry entry that spells them out is saying "do not trust Intl for this
 * language here" — which Thai does, because a Node built with small-icu
 * silently answers in English for th-TH. A locale that leaves them null gets
 * Intl, which is right until somebody proves otherwise for that language.
 */
function calendarNames(locale, { long }) {
	const months = long ? locale.months : locale.monthsShort;
	const days = long ? locale.days : locale.daysShort;
	if (months && days) return { months, days };

	const monthFormat = new Intl.DateTimeFormat(locale.intl, { month: long ? 'long' : 'short', timeZone: 'UTC' });
	const dayFormat = new Intl.DateTimeFormat(locale.intl, { weekday: long ? 'long' : 'short', timeZone: 'UTC' });
	return {
		months: months || Array.from({ length: 12 }, (_, i) => monthFormat.format(Date.UTC(2021, i, 15))),
		// 2021-08-01 was a Sunday, which is index 0 the way `bangkokParts` counts.
		days: days || Array.from({ length: 7 }, (_, i) => dayFormat.format(Date.UTC(2021, 7, 1 + i))),
	};
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
function formatMoney(minorUnits, currency = 'THB', lang = DEFAULT_LANG) {
	if (minorUnits == null) return '—';
	// Backward compatibility for the former formatMoney(value, lang) API.
	// Currency was added later; callers that only choose a language still mean
	// Thai baht, not a fictional currency code named "EN" or "TH".
	if (LANGS.includes(String(currency).toLowerCase())) {
		lang = currency;
		currency = 'THB';
	}
	const code = String(currency || 'THB').toUpperCase();
	const locale = localeFor(lang).intl;
	try {
		return new Intl.NumberFormat(locale, {
			style: 'currency',
			currency: code,
			currencyDisplay: 'narrowSymbol',
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(Number(minorUnits) / 100);
	}
	catch {
		return `${code} ${(Number(minorUnits) / 100).toFixed(2)}`;
	}
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

	const locale = localeFor(lang);
	const { months } = calendarNames(locale, { long: !short });
	return locale.patterns.period({
		month: months[month - 1],
		year: year + locale.yearOffset,
	});
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

	const locale = localeFor(lang);
	const names = calendarNames(locale, { long });
	return locale.patterns.when({
		dayName: names.days[weekday],
		day,
		month: names.months[month - 1],
		year: year + locale.yearOffset,
		time: time ? `${hh}:${mm}` : null,
		long,
	});
}

/**
 * "the 15th of every month" — the day a recurring agreement falls due.
 */
function formatDueDay(day, lang = DEFAULT_LANG) {
	const n = Number(day);
	if (!Number.isInteger(n) || n < 1 || n > 31) return '';
	const locale = localeFor(lang);
	return locale.patterns.dueDay({ day: n, ordinal: locale.ordinal ? locale.ordinal(n) : String(n) });
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
	return `${rest} ${localeFor(lang).conjunction} ${last}`;
}

/**
 * How many, said the way the language says it.
 *
 * `count === 1 ? 'participant' : 'participants'` is an English rule written
 * into a dictionary that is not only English. Thai has one form, Polish has
 * three, Arabic has six — so the choice is made by `Intl.PluralRules` and the
 * dictionary supplies whichever forms its language actually needs.
 *
 * `forms` is keyed by CLDR category. `other` is required and is what any
 * missing category falls back to, so a dictionary that only writes `other` is
 * correct for every language that only needs one.
 */
function plural(count, forms, lang = DEFAULT_LANG) {
	const n = Number(count);
	if (!Number.isFinite(n)) return String(forms?.other ?? '');
	// An ICU build without plural data falls through to `other`, which is the
	// correct answer for every language that only has one form and a survivable
	// one for the rest.
	let category;
	try {
		category = new Intl.PluralRules(localeFor(lang).intl).select(n);
	}
	catch {
		category = 'other';
	}
	const form = forms?.[category] ?? forms?.other ?? '';
	return typeof form === 'function' ? form(n) : String(form);
}

module.exports = {
	LANGS,
	DEFAULT_LANG,
	TIMEZONE,
	resolveLang,
	localeFor,
	plural,
	bangkokParts,
	periodKeyFor,
	formatMoney,
	formatPeriod,
	formatWhen,
	formatDueDay,
	formatNames,
};
