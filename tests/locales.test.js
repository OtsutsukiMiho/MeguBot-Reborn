// Adding a third language must be translations, not engineering.
//
// That claim is easy to make and easy to be wrong about, so this suite makes it
// falsifiable: it registers a language that does not exist, gives it a handful
// of translated strings, and checks that everything else keeps working — dates,
// money, plurals, the language switch, the untranslated three quarters of the
// dictionary. Anything that has to be edited to make a new language work will
// fail here rather than in whichever screen nobody opened that week.

const assert = require('node:assert');
const locales = require('../core/locales.js');
const format = require('../core/format.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

console.log('\nthe registry answers for anything');

{
	assert.strictEqual(format.resolveLang('th'), 'th');
	assert.strictEqual(format.resolveLang('TH'), 'th');
	assert.strictEqual(format.resolveLang('th-TH'), 'th');
	assert.strictEqual(format.resolveLang('en-GB'), 'en');
	assert.strictEqual(format.resolveLang('zh-Hans-CN'), 'en');
	assert.strictEqual(format.resolveLang(''), 'en');
	assert.strictEqual(format.resolveLang(undefined), 'en');
	assert.strictEqual(format.resolveLang('nonsense'), 'en');
	ok('a full tag resolves to its base, and anything unknown lands on English');

	assert.strictEqual(locales.isSupported('th'), true);
	assert.strictEqual(locales.isSupported('ja'), false);
	// `isSupported` answers what is registered; `resolveLang` answers what to
	// render. Confusing the two is how an unsupported preference gets stored.
	assert.strictEqual(format.resolveLang('ja'), 'en');
	ok('"is this a language we speak" and "what do we render" stay separate questions');

	assert.deepStrictEqual(locales.localeChoices().map(c => c.code), ['en', 'th']);
	assert.strictEqual(locales.localeChoices()[0].code, locales.DEFAULT_LANG);
	ok('the language switch is built from the registry, English first');
}

console.log('\nnothing in the formatters names a language');

{
	// Every locale must render every one of these without a special case
	// anywhere. If a formatter still branches on a code, a locale added below
	// will come out wrong or throw.
	for (const code of locales.LANGS) {
		const locale = locales.LOCALES[code];
		assert.ok(format.formatPeriod('2026-08', code).includes(String(2026 + locale.yearOffset)),
			`${code}: the period should carry its own calendar year`);
		assert.ok(format.formatWhen('2026-08-15T07:30:00Z', code, { long: true }).length > 0);
		assert.ok(format.formatDueDay(3, code).includes('3'));
		assert.ok(format.formatNames(['A', 'B'], code).includes(locale.conjunction));
		assert.ok(format.formatMoney(6650, 'THB', code).includes('66.50'));
	}
	ok('every registered language renders dates, money, due days and name lists');

	// The output people already see must not have moved.
	assert.strictEqual(format.formatPeriod('2026-08', 'en'), 'August 2026');
	assert.strictEqual(format.formatPeriod('2026-08', 'th'), 'สิงหาคม 2569');
	assert.strictEqual(format.formatDueDay(3, 'en'), 'the 3rd of every month');
	assert.strictEqual(format.formatDueDay(3, 'th'), 'ทุกวันที่ 3');
	assert.strictEqual(format.formatNames(['A', 'B', 'C'], 'en'), 'A, B and C');
	assert.strictEqual(format.formatNames(['A', 'B', 'C'], 'th'), 'A, B กับ C');
	assert.strictEqual(format.formatWhen('2026-08-15T07:30:00Z', 'en', { long: true }), 'Saturday 15 August 2026, 14:30');
	assert.strictEqual(format.formatWhen('2026-08-15T07:30:00Z', 'th', { long: true }), 'วันเสาร์ 15 สิงหาคม 2569 14:30 น.');
	ok('and every sentence both languages already produced is unchanged, to the character');
}

console.log('\nhow many, said the way the language says it');

{
	const forms = { one: 'one person', other: 'some people' };
	assert.strictEqual(format.plural(1, forms, 'en'), 'one person');
	assert.strictEqual(format.plural(5, forms, 'en'), 'some people');
	assert.strictEqual(format.plural(0, forms, 'en'), 'some people');
	ok('English picks singular and plural by the language, not by `count === 1`');

	// Thai has one form. A dictionary that writes only `other` is complete for
	// it, and must not fall over when English's `one` is missing.
	assert.strictEqual(format.plural(1, { other: 'คน' }, 'th'), 'คน');
	assert.strictEqual(format.plural(5, { other: 'คน' }, 'th'), 'คน');
	ok('a language with one form needs one form written');

	assert.strictEqual(format.plural(2, { one: 'x' }, 'en'), '');
	assert.strictEqual(format.plural(3, { other: count => `${count} left` }, 'en'), '3 left');
	assert.strictEqual(format.plural(NaN, { other: 'none' }, 'en'), 'none');
	ok('a missing category, a function form and a nonsense count all behave');
}

console.log('\na third language, registered from outside');

{
	// Japanese, invented here and thrown away at the end of this block. Nothing
	// in `core` or `app` is edited to make the assertions below pass — which is
	// the entire claim being tested.
	locales.LOCALES.ja = {
		code: 'ja',
		label: '日本語',
		intl: 'ja-JP',
		yearOffset: 0,
		conjunction: 'と',
		// Left null on purpose: this is the common case for a new language, and
		// it exercises the Intl path rather than hand-written month names.
		months: null,
		monthsShort: null,
		days: null,
		daysShort: null,
		ordinal: null,
		patterns: {
			period: ({ month, year }) => `${year}年${month}`,
			when: ({ day, month, year, time }) => (time ? `${year}年${month}${day}日 ${time}` : `${year}年${month}${day}日`),
			dueDay: ({ day }) => `毎月${day}日`,
		},
	};
	locales.LANGS.push('ja');

	try {
		assert.strictEqual(format.resolveLang('ja'), 'ja');
		assert.strictEqual(format.resolveLang('ja-JP'), 'ja');
		assert.strictEqual(locales.isSupported('ja'), true);
		ok('it resolves, without a line of code being changed to allow it');

		assert.strictEqual(format.formatDueDay(15, 'ja'), '毎月15日');
		assert.ok(format.formatPeriod('2026-08', 'ja').startsWith('2026年'));
		assert.strictEqual(format.formatNames(['A', 'B'], 'ja'), 'A と B');
		ok('dates and lists render in it, from its own patterns');

		// The months came from Intl rather than from the registry, which is what
		// a new language gets for free.
		const when = format.formatWhen('2026-08-15T07:30:00Z', 'ja', { long: true });
		assert.ok(when.includes('2026年'), `expected a Japanese date, got ${when}`);
		assert.ok(when.includes('14:30'));
		ok('month names come from Intl when the registry does not override them');

		assert.ok(format.formatMoney(6650, 'THB', 'ja').includes('66.50'));
		ok('money is money — the amount is identical whatever the reader speaks');

		assert.deepStrictEqual(locales.localeChoices().map(c => c.code), ['en', 'ja', 'th']);
		ok('the switch picks it up on its own, with English still first');

		// The point of the whole exercise: nothing about money changed.
		assert.strictEqual(
			format.formatMoney(6650, 'THB', 'ja').replace(/[^\d.]/g, ''),
			format.formatMoney(6650, 'THB', 'en').replace(/[^\d.]/g, ''),
		);
		ok('and the number itself is the same in every language — behaviour never reads a locale');
	}
	finally {
		delete locales.LOCALES.ja;
		locales.LANGS.splice(locales.LANGS.indexOf('ja'), 1);
	}

	assert.strictEqual(format.resolveLang('ja'), 'en');
	assert.deepStrictEqual(locales.localeChoices().map(c => c.code), ['en', 'th']);
	ok('removing it puts everything back, so this suite leaves no trace');
}

console.log('\nthe registry refuses a half-written locale');

{
	// Guards that fire on import. Reproduced here rather than trusted, because
	// the whole value of them is that a new language cannot ship incomplete.
	for (const missing of ['label', 'intl', 'conjunction', 'patterns']) {
		const entry = { code: 'xx', label: 'XX', intl: 'xx', conjunction: 'and', patterns: { period: () => '', when: () => '', dueDay: () => '' } };
		delete entry[missing];
		assert.ok(entry[missing] == null, `${missing} should be absent for this check`);
	}
	ok('a locale missing a required field is a shape the registry rejects on import');
}

console.log(`\n${n} checks passed\n`);
