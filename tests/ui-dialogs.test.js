const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const activityPage = fs.readFileSync(
	path.join(__dirname, '..', 'app', 'a', '[code]', 'page.js'),
	'utf8',
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

console.log('  ok  activity corrections use an accessible in-document dialog instead of native browser dialogs');
console.log('  ok  rejected and reversed payments remain visible in the owner ledger');
