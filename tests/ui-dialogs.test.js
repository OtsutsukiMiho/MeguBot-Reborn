const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const activityPage = fs.readFileSync(
	path.join(__dirname, '..', 'app', 'a', '[code]', 'page.js'),
	'utf8',
);
const activityComponent = activityPage.slice(
	activityPage.indexOf('export default function ActivityPage'),
	activityPage.indexOf('function ActionDialog'),
);
const expenseRowComponent = activityPage.slice(
	activityPage.indexOf('function ExpenseRow'),
	activityPage.indexOf('function TimePoll'),
);

assert.doesNotMatch(activityPage, /window\.prompt\s*\(/, 'activity actions must not use native prompt()');
assert.doesNotMatch(activityPage, /\bconfirm\s*\(/, 'activity actions must not use native confirm()');
assert.match(activityPage, /role="dialog"/);
assert.match(activityPage, /aria-modal="true"/);
assert.match(activityPage, /reason:\s*reason\.trim\(\)/);
assert.match(
	activityPage,
	/const corrected = payments\.filter\(p => \['rejected', 'reversed'\]\.includes\(p\.status\)\)/,
	'owners must retain a visible history of rejected and reversed payments',
);
assert.match(activityPage, /t\.pending\.historyTitle/);
assert.match(activityPage, /function PaymentHistory\s*\(/, 'payment history component must be defined');
assert.match(
	activityComponent,
	/\{isOwner && corrected\.length > 0 && \(\s*<PaymentHistory/,
	'owner correction history must render from ActivityPage, where owner state is defined',
);
assert.doesNotMatch(
	expenseRowComponent,
	/\bisOwner\b|\bcorrected\b|<PaymentHistory/,
	'ExpenseRow must not reference activity-level owner or payment state',
);

console.log('  ok  activity corrections use an accessible in-document dialog instead of native browser dialogs');
console.log('  ok  rejected and reversed payments remain visible in the owner ledger');
console.log('  ok  payment history stays in ActivityPage scope and cannot crash ExpenseRow');
