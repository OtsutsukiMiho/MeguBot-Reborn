const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Three guarantees about the activity screens, checked by reading them.
//
// They were written when all of this was one file. It is now five — a shell
// that owns the dialog and the request path, and one screen per task — so the
// checks read the set rather than the file. The guarantees are unchanged, and
// that is the point of restating them here: a refactor that splits a page is
// exactly when an accessible dialog quietly turns back into `confirm()`, or a
// history panel gets dropped because nobody noticed which screen it belonged
// to.

const root = path.join(__dirname, '..', 'app');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const shell = read('components', 'activity', 'ActivityShell.js');
const rows = read('components', 'activity', 'Rows.js');
const summary = read('a', '[code]', 'page.js');
const payScreen = read('a', '[code]', 'pay', 'page.js');
const manageScreen = read('a', '[code]', 'manage', 'page.js');
const answerScreen = read('a', '[code]', 'rsvp', 'page.js');
const everything = [shell, rows, summary, payScreen, manageScreen, answerScreen].join('\n');

// Native dialogs block the page and are unstyleable, and in the embedded
// browsers people open Discord links in they can be suppressed outright — the
// reader then sees a button that does nothing at all.
assert.doesNotMatch(everything, /window\.prompt\s*\(/, 'activity actions must not use native prompt()');
assert.doesNotMatch(everything, /\bwindow\.confirm\s*\(/, 'activity actions must not use native confirm()');
assert.match(shell, /role="dialog"/);
assert.match(shell, /aria-modal="true"/);
assert.match(shell, /reason:\s*reason\.trim\(\)/);

assert.match(
	manageScreen,
	/const corrected = payments\.filter\(p => \['rejected', 'reversed'\]\.includes\(p\.status\)\)/,
	'owners must retain a visible history of rejected and reversed payments',
);
assert.match(manageScreen, /t\.pending\.historyTitle|<PaymentHistory/);
assert.match(rows, /export function PaymentHistory\s*\(/, 'payment history component must be defined');
assert.match(
	manageScreen,
	/\{corrected\.length > 0 && \(\s*<PaymentHistory/,
	'owner correction history must render from the organizer screen, where owner state is defined',
);

const expenseRowComponent = rows.slice(rows.indexOf('export function ExpenseRow'));
assert.doesNotMatch(
	expenseRowComponent,
	/\bisOwner\b|\bcorrected\b|<PaymentHistory/,
	'ExpenseRow must not reference activity-level owner or payment state',
);

// The split is the feature, so it is worth asserting rather than assuming: the
// payment screen exists to be only the payment. If the roster or the invite
// link creep back onto it, the reason the route was created is gone.
assert.doesNotMatch(payScreen, /PersonRow|t\.invite\.|<TimePoll|ExpenseRow/, 'the payment screen must carry nothing but the payment');
assert.match(payScreen, /ScreenHead/, 'and it must offer a way back — most readers arrive from an email');

console.log('  ok  activity corrections use an accessible in-document dialog instead of native browser dialogs');
console.log('  ok  rejected and reversed payments remain visible in the owner ledger');
console.log('  ok  payment history stays on the organizer screen and cannot crash ExpenseRow');
console.log('  ok  the payment screen shows the payment and nothing else');
