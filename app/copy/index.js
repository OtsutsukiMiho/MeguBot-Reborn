'use client';

const { useMemo } = require('react');
const { useLang } = require('../components/LangProvider');
const format = require('../../core/format.js');
const en = require('./en.js');
const th = require('./th.js');

const DICTIONARIES = { en, th };

function dictionaryFor(lang) {
	return DICTIONARIES[format.resolveLang(lang)];
}

/**
 * Everything a component needs to render words: the dictionary, and the
 * formatters already bound to the reader's language.
 *
 * `fmt` exists so that no component ever passes `lang` to a formatter by hand.
 * The one that gets forgotten is the one that renders a Buddhist year on an
 * English page, and it will be forgotten in the file nobody looks at again.
 */
function useCopy() {
	const { lang, setLang } = useLang();

	return useMemo(() => {
		const resolved = format.resolveLang(lang);
		const t = dictionaryFor(resolved);

		return {
			lang: resolved,
			setLang,
			t,
			fmt: {
				money: satang => format.formatMoney(satang),
				when: (iso, options) => format.formatWhen(iso, resolved, options),
				period: (key, options) => format.formatPeriod(key, resolved, options),
				dueDay: day => format.formatDueDay(day, resolved),
				names: list => format.formatNames(list, resolved),
			},

			/**
			 * Turn what the server said into what the reader sees.
			 *
			 * The API sends a machine-readable `code` and a human `message`.
			 * A code we have a translation for wins; anything else falls back to
			 * the server's own words, so a new error added on the server is
			 * merely untranslated rather than invisible.
			 */
			error: (payload) => {
				if (!payload) return '';
				if (typeof payload === 'string') return t.errors[payload] || payload;
				return t.errors[payload.code] || payload.message || t.errors.failed;
			},
		};
	}, [lang, setLang]);
}

module.exports = { useCopy, dictionaryFor, DICTIONARIES };
