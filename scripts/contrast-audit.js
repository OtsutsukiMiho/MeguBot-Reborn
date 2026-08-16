// Reads the colour tokens straight out of globals.css and measures every
// foreground/background pair we actually use, in both themes, against WCAG.
//
// The point is to stop guessing. "Looks fine to me" is how a palette ends up
// unreadable for everyone whose screen, eyes or lighting differ from mine.
//
//   node scripts/contrast-audit.js          report
//   node scripts/contrast-audit.js --strict exit 1 if anything fails

const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');

const AA_BODY = 4.5;
const AA_LARGE = 3;

// foreground, background, minimum, what it is
const PAIRS = [
	['ink', 'paper', AA_BODY, 'body text on the page'],
	['ink', 'surface', AA_BODY, 'body text on a panel'],
	['ink-2', 'surface', AA_BODY, 'secondary text'],
	['muted', 'paper', AA_BODY, 'meta and sub-lines'],
	['muted', 'surface', AA_BODY, 'meta on a panel'],
	['faint', 'paper', AA_LARGE, 'counts and captions'],
	['faint', 'surface', AA_LARGE, 'counts and captions on a panel'],
	['accent', 'paper', AA_BODY, 'links and the current state'],
	['accent', 'surface', AA_BODY, 'links on a panel'],
	['gold', 'paper', AA_BODY, 'Megu name mark'],
	['gold', 'surface', AA_BODY, 'Megu name mark on a panel'],
	['due', 'paper', AA_BODY, 'amounts owed'],
	['due', 'surface', AA_BODY, 'amounts owed on a panel'],
	['due', 'due-soft', AA_BODY, 'error text on its own tint'],
	['settled', 'paper', AA_BODY, 'settled amounts'],
	['settled', 'surface', AA_BODY, 'settled amounts on a panel'],
	['settled', 'settled-soft', AA_BODY, 'settled text on its own tint'],
	['on-brand', 'brand', AA_BODY, 'button text'],
	['line-2', 'paper', 1.5, 'borders and control outlines'],
	['line-2', 'surface', 1.5, 'borders on a panel'],

	// Audit-log category badges. Measured against the panel they sit on rather
	// than their own tint, because the tint is only ~12–18% of the same hue and
	// the panel dominates what the eye actually sees behind the text.
	['cat-pink', 'surface', AA_BODY, 'audit badge — pink'],
	['cat-purple', 'surface', AA_BODY, 'audit badge — purple'],
	['cat-violet', 'surface', AA_BODY, 'audit badge — violet'],
	['cat-blue', 'surface', AA_BODY, 'audit badge — blue'],
	['cat-cyan', 'surface', AA_BODY, 'audit badge — cyan'],
	['cat-orange', 'surface', AA_BODY, 'audit badge — orange'],
	['cat-neutral', 'surface', AA_BODY, 'audit badge — neutral'],
];

function block(selector) {
	const i = CSS.indexOf(selector);
	if (i < 0) throw new Error(`token block not found: ${selector}`);
	const open = CSS.indexOf('{', i);
	const close = CSS.indexOf('\n}', open);
	return CSS.slice(open, close);
}

function tokensFrom(text) {
	const out = {};
	for (const m of text.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{3,8})\s*;/g)) {
		out[m[1]] = m[2];
	}
	return out;
}

const light = tokensFrom(block(':root {'));
const dark = { ...light, ...tokensFrom(block(':root[data-theme=\'dark\']')) };

function toRgb(hex) {
	let h = hex.replace('#', '');
	if (h.length === 3) h = [...h].map(c => c + c).join('');
	return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}

function luminance(hex) {
	const [r, g, b] = toRgb(hex).map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
	const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
	return (x + 0.05) / (y + 0.05);
}

function audit(name, tokens) {
	const rows = [];
	for (const [fg, bg, min, what] of PAIRS) {
		if (!tokens[fg] || !tokens[bg]) {
			rows.push({ fg, bg, what, missing: true });
			continue;
		}
		const r = ratio(tokens[fg], tokens[bg]);
		rows.push({ fg, bg, what, min, ratio: r, pass: r >= min });
	}

	const failed = rows.filter(r => r.missing || !r.pass);
	console.log(`\n${name}`);
	for (const row of rows) {
		if (row.missing) {
			console.log(`  ??  --${row.fg} on --${row.bg}  (token missing)`);
			continue;
		}
		const mark = row.pass ? 'ok  ' : 'FAIL';
		console.log(`  ${mark} ${row.ratio.toFixed(2).padStart(5)} : 1   need ${row.min}   --${row.fg} on --${row.bg}   ${row.what}`);
	}
	return failed.length;
}

const failures = audit('light', light) + audit('dark', dark);

console.log(failures === 0
	? '\nEvery pair meets its target.\n'
	: `\n${failures} pair(s) below target.\n`);

if (process.argv.includes('--strict') && failures > 0) process.exitCode = 1;
