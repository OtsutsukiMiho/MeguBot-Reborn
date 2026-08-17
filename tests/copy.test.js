// Two things break a translated interface, and neither shows up as an error:
// a key that exists in one language and not the other, and a formatter that
// renders the wrong calendar. Both are checked here rather than noticed later
// by a reader who cannot tell whether the blank space was meant to be there.

const assert = require('node:assert');
const format = require('../core/format.js');
const en = require('../app/copy/en.js');
const th = require('../app/copy/th.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

console.log('\ndictionaries');

/** Every leaf, as a dotted path, with what kind of thing it is. */
function shapeOf(node, prefix = '') {
	const out = {};
	for (const [key, value] of Object.entries(node)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof value === 'function') out[path] = `fn/${value.length}`;
		else if (value && typeof value === 'object') Object.assign(out, shapeOf(value, path));
		else out[path] = typeof value;
	}
	return out;
}

const shapeEn = shapeOf(en);
const shapeTh = shapeOf(th);

const missingInTh = Object.keys(shapeEn).filter(k => !(k in shapeTh));
const missingInEn = Object.keys(shapeTh).filter(k => !(k in shapeEn));
assert.deepStrictEqual(missingInTh, [], `missing from th: ${missingInTh.join(', ')}`);
assert.deepStrictEqual(missingInEn, [], `missing from en: ${missingInEn.join(', ')}`);
ok(`both languages carry the same ${Object.keys(shapeEn).length} keys`);

// A key that is a sentence in one language and a function in the other means
// one of them silently drops the value it was supposed to interpolate.
const wrongKind = Object.keys(shapeEn).filter(k => shapeEn[k] !== shapeTh[k]);
assert.deepStrictEqual(wrongKind, [], `different kinds: ${wrongKind.join(', ')}`);
ok('every key is the same kind, and takes the same number of values');

// Nothing may be empty: a blank string renders as a gap the reader has to
// guess at, and it passes every other check in this file.
const blank = Object.entries(shapeEn)
	.filter(([, kind]) => kind === 'string')
	.map(([path]) => path)
	.filter((path) => {
		const read = obj => path.split('.').reduce((o, k) => o?.[k], obj);
		return !String(read(en) || '').trim() || !String(read(th) || '').trim();
	});
assert.deepStrictEqual(blank, [], `blank strings: ${blank.join(', ')}`);
ok('no key renders as an empty string');

// A phrase that takes a value has to use it. Dropping the argument is the
// translation bug with no symptom: `owesFor: () => 'ค้างอยู่'` renders a
// grammatical sentence with the amount missing, and nothing else in this file
// would catch it.
//
// Each function is called with markers unlikely to occur in real copy, and
// every marker has to survive into the result.
const MARKERS = ['⟪0⟫', '⟪1⟫', '⟪2⟫'];
const dropped = [];
for (const [name, dict] of [['en', en], ['th', th]]) {
	for (const [path, kind] of Object.entries(shapeOf(dict))) {
		if (!kind.startsWith('fn/')) continue;
		const arity = Number(kind.slice(3));
		const fn = path.split('.').reduce((o, k) => o[k], dict);
		const args = MARKERS.slice(0, arity);
		const rendered = String(fn(...args));
		for (const marker of args) {
			if (!rendered.includes(marker)) dropped.push(`${name}.${path}`);
		}
	}
}
assert.deepStrictEqual([...new Set(dropped)], [], `values dropped by: ${dropped.join(', ')}`);
ok('every phrase that takes a value actually prints it');

console.log('\nreferences');

// A key that does not exist renders as nothing at all — React prints
// `undefined` as an empty string, so a typo in `t.pay.saveImge` is a button
// with no label rather than an error anyone would notice in review.
//
// Reading the source is crude, but it is the only check that runs without a
// browser, and the failure it catches is silent by construction.
{
	const fs = require('node:fs');
	const path = require('node:path');
	const root = path.join(__dirname, '..');
	const SOURCES = [
		'app/a/[code]/page.js',
		'app/components/PayPanel.js',
		'app/components/PromptPaySetup.js',
	];

	const read = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

	const missing = [];
	const checked = new Set();
	for (const file of SOURCES) {
		const source = fs.readFileSync(path.join(root, file), 'utf8');
		for (const match of source.matchAll(/\bt\.([A-Za-z0-9_.]+)/g)) {
			const dotted = match[1].replace(/\.$/, '');
			if (checked.has(dotted)) continue;
			checked.add(dotted);
			if (read(en, dotted) === undefined) missing.push(`${dotted} (${file})`);
		}
	}

	assert.deepStrictEqual(missing, [], `keys used but never defined: ${missing.join(', ')}`);
	ok(`all ${checked.size} keys the interface asks for exist`);
}

console.log('\nformatting');

assert.strictEqual(format.formatPeriod('2026-08', 'en'), 'August 2026');
assert.strictEqual(format.formatPeriod('2026-08', 'th'), 'สิงหาคม 2569');
ok('a month key renders as CE in English and BE in Thai');

assert.strictEqual(format.formatPeriod('2026-08', 'en', { short: true }), 'Aug 2026');
assert.strictEqual(format.formatPeriod('2026-08', 'th', { short: true }), 'ส.ค. 2569');
ok('the short form keeps the right calendar too');

// The stored key is the fact; the label is a rendering. Both languages have to
// come out of the same key, or a month opened before the switch would keep the
// language it was opened in forever.
const key = '2026-12';
assert.notStrictEqual(format.formatPeriod(key, 'en'), format.formatPeriod(key, 'th'));
assert.ok(format.formatPeriod(key, 'th').includes('2569'));
ok('one stored key renders differently per language, with no stored label');

console.log('\ntimezone');

// The month boundary is Bangkok's, not the server's. A period opened just
// after midnight on the first must not be filed under the month that ended.
const justAfterMidnight = new Date('2026-09-01T02:00:00+07:00');
assert.strictEqual(format.periodKeyFor(justAfterMidnight), '2026-09');
assert.strictEqual(justAfterMidnight.getUTCMonth() + 1, 8);
ok('02:00 on 1 September in Bangkok bills September, though UTC still says August');

const justBeforeMidnight = new Date('2026-08-31T23:30:00+07:00');
assert.strictEqual(format.periodKeyFor(justBeforeMidnight), '2026-08');
ok('23:30 on 31 August still bills August');

const when = new Date('2026-08-15T12:30:00Z');
assert.ok(format.formatWhen(when, 'en').includes('19:30'));
assert.ok(format.formatWhen(when, 'th').includes('19:30'));
ok('12:30 UTC displays as 19:30 in both languages');

assert.strictEqual(format.formatWhen(when, 'th', { long: true }), 'วันเสาร์ 15 สิงหาคม 2569 19:30 น.');
assert.strictEqual(format.formatWhen(when, 'en', { long: true }), 'Saturday 15 August 2026, 19:30');
ok('the long form reads naturally in each language');

console.log('\nmoney and lists');

assert.strictEqual(format.formatMoney(6000), '฿60.00');
assert.strictEqual(format.formatMoney(-18000), '-฿180.00');
assert.strictEqual(format.formatMoney(123405), '฿1,234.05');
assert.strictEqual(format.formatMoney(null), '—');
ok('satang render as baht, negatives and thousands included');

// Baht is baht in both languages: switching to English does not change the
// currency, so the two must agree exactly.
assert.strictEqual(format.formatMoney(6000, 'en'), format.formatMoney(6000, 'th'));
ok('money reads identically in both languages');

assert.strictEqual(format.formatNames(['Om'], 'en'), 'Om');
assert.strictEqual(format.formatNames(['Om', 'Nut', 'Fig'], 'en'), 'Om, Nut and Fig');
assert.strictEqual(format.formatNames(['โอม', 'นัท', 'ฟิก'], 'th'), 'โอม, นัท กับ ฟิก');
ok('name lists join with the right word');

assert.strictEqual(format.formatDueDay(1, 'en'), 'the 1st of every month');
assert.strictEqual(format.formatDueDay(2, 'en'), 'the 2nd of every month');
assert.strictEqual(format.formatDueDay(3, 'en'), 'the 3rd of every month');
assert.strictEqual(format.formatDueDay(11, 'en'), 'the 11th of every month');
assert.strictEqual(format.formatDueDay(21, 'en'), 'the 21st of every month');
assert.strictEqual(format.formatDueDay(15, 'th'), 'ทุกวันที่ 15');
ok('English ordinals survive 11th, 21st and the rest');

console.log('\nfallbacks');

assert.strictEqual(format.resolveLang('th-TH'), 'th');
assert.strictEqual(format.resolveLang('en-GB'), 'en');
assert.strictEqual(format.resolveLang('ja'), 'en');
assert.strictEqual(format.resolveLang(null), 'en');
ok('an unknown language falls back to English rather than breaking');

assert.strictEqual(format.formatWhen(null, 'en'), '');
assert.strictEqual(format.formatWhen('not a date', 'en'), '');
assert.strictEqual(format.formatPeriod('', 'en'), '');
assert.strictEqual(format.formatDueDay(99, 'en'), '');
ok('missing and malformed values render as nothing, not as "Invalid Date"');

console.log(`\n${n} checks passed\n`);
