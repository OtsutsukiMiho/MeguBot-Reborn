// Which language a bill speaks: the server's for what the group reads, the
// person's own for what only they read. Pure, so it runs without a database.
const assert = require('node:assert/strict');
const { LANGS } = require('../core/locales.js');
const { serverLang, personalLang, normalizeServerLang, SERVER_LANG_KEY } = require('../core/server-lang.js');
const { billPreview } = require('../core/bill-preview.js');
const { LABELS } = require('../adapters/notifications/payment-due.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

assert.equal(SERVER_LANG_KEY, 'megu_lang');

assert.equal(serverLang({ stored: 'en', preferredLocale: 'th' }), 'en');
assert.equal(serverLang({ stored: 'TH', preferredLocale: 'en-US' }), 'th');
ok('a stored server choice beats the Discord locale');

assert.equal(serverLang({ preferredLocale: 'th' }), 'th');
assert.equal(serverLang({ preferredLocale: 'en-GB' }), 'en');
assert.equal(serverLang({ stored: 'xx', preferredLocale: 'th' }), 'th', 'a stored value Megu does not speak is ignored');
ok('with no choice stored, the server follows its own Discord locale');

assert.equal(serverLang({}), 'th');
assert.equal(serverLang({ stored: null, preferredLocale: null }), 'th');
ok('a server Megu knows nothing about is Thai, like every bill default');

assert.equal(personalLang({ preference: { locale: 'en', localeSet: true }, clientLocale: 'th' }), 'en');
assert.equal(personalLang({ preference: { locale: 'th', localeSet: true }, clientLocale: 'en-US' }), 'th');
ok('a person\'s own choice beats their Discord client');

assert.equal(personalLang({ preference: { locale: 'en', localeSet: false }, clientLocale: 'th' }), 'th',
	'the sign-in default is not a choice');
assert.equal(personalLang({ preference: null, clientLocale: 'en-US' }), 'en');
assert.equal(personalLang({ clientLocale: 'th' }), 'th');
ok('without a choice of their own, a person gets their Discord client language');

assert.equal(normalizeServerLang('th'), 'th');
assert.equal(normalizeServerLang(' EN '), 'en');
for (const auto of ['', null, undefined, 'auto']) assert.equal(normalizeServerLang(auto), null);
assert.throws(() => normalizeServerLang('fr'), /server_lang_invalid/);
ok('the dashboard and the slash command store a code, or nothing for "follow Discord"');

{
	const bill = { title: 'Netflix', kind: 'recurring', planState: 'confirmed', dueDay: 5, participants: [{ rsvp: 'yes' }, { rsvp: 'yes' }] };
	assert.match(billPreview(bill, serverLang({ stored: 'en' })).description, /^Monthly bill, split 2 ways/);
	assert.match(billPreview(bill, serverLang({ preferredLocale: 'th' })).description, /^บิลรายเดือน หารกัน 2 คน/);
	assert.match(billPreview(bill, 'xx').description, /^บิลรายเดือน/, 'an unknown language falls back to Thai');
	ok('the link preview speaks the server language it is given');
}

// Every language Megu speaks needs its buttons written out. A third language
// added to core/locales.js fails here until it has them, instead of quietly
// posting Thai buttons.
for (const lang of LANGS) {
	for (const key of ['pay', 'notNow', 'slip', 'open']) {
		assert.ok(LABELS[lang]?.[key], `due-date button ${key} is missing for ${lang}`);
	}
}
ok('the due-date buttons exist in every language');

// The rule for anything a person reads: no middle dot, arrow, em dash or emoji.
{
	const fs = require('node:fs');
	const path = require('node:path');
	const files = ['core/server-lang.js', 'commands/utility/megu-language.js', 'app/components/Tabs/LanguageTab.js'];
	const quoted = /(['"`])((?:(?!\1).)*)\1/g;
	const banned = /[\u00b7\u2190\u2192\u2014]|\p{Extended_Pictographic}/u;
	for (const file of files) {
		const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
		for (const [, , text] of source.matchAll(quoted)) assert.ok(!banned.test(text), `${file}: ${text}`);
	}
	for (const lang of ['th', 'en']) {
		const copy = require(`../app/copy/${lang}.js`);
		const tab = (copy.default || copy)?.serverTabs?.language;
		if (!tab) continue;
		for (const value of Object.values(tab)) {
			const text = typeof value === 'function' ? value('X') : typeof value === 'string' ? value : JSON.stringify(value);
			assert.ok(!banned.test(text), `${lang} language tab: ${text}`);
		}
	}
	ok('the new wording has no middle dots, arrows, em dashes or emoji');
}

console.log(`\n${n} checks passed`);
