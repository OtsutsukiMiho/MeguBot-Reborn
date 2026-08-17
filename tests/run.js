// Runs the Megu suite in order: pure logic, then core against Postgres, then
// the HTTP layer. Refuses to run against anything but a local database — these
// tests create and delete rows, and that must never happen on the live one.
require('dotenv').config();
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const db = require('../core/db.js');

const SUITES = [
	['audio-queue.test.js', 'the TTS queue — one clip, spoken once'],
	['core.test.js', 'pure logic — money, permissions, tokens, the two axes'],
	// First against Postgres, because it rebuilds the schema into its pre-rename
	// shape and migrates it forward — which is where the suites below start.
	['rename.test.js', 'the megu_ rename, run against a database that already had data'],
	['e2e.test.js', 'core against Postgres — full badminton lifecycle'],
	['recurring.test.js', 'monthly agreements, periods and DM reminders'],
	['poll.test.js', 'the time poll — proposing, voting, and Megu deciding'],
	['corrections.test.js', 'editing, deleting and undoing — the ledger must be correctable'],
	['api.test.js', 'HTTP layer — roles, redaction, claim and payment flow'],
];

if (!db.isLocal(db.connectionString())) {
	console.error('\nRefusing to run: core is pointed at a remote database.');
	console.error(`  ${db.describe()}`);
	console.error('\nStart the local one and retry:\n  docker compose up -d\n');
	process.exit(1);
}

console.log(`\nMegu test suite\n  database: ${db.describe()}\n`);

let failed = 0;
const started = process.hrtime.bigint();

for (const [file, description] of SUITES) {
	console.log(`\n── ${file} — ${description}`);
	const res = spawnSync(process.execPath, [path.join(__dirname, file)], {
		stdio: 'inherit',
		cwd: path.join(__dirname, '..'),
	});
	if (res.status !== 0) failed++;
}

// Readability is a test, not a matter of taste. Every colour pair we ship has
// to clear WCAG in both themes or this fails like anything else.
console.log('\n── contrast — every colour pair, both themes, against WCAG');
{
	const res = spawnSync(
		process.execPath,
		[path.join(__dirname, '..', 'scripts', 'contrast-audit.js'), '--strict'],
		{ stdio: 'inherit', cwd: path.join(__dirname, '..') },
	);
	if (res.status !== 0) failed++;
}

const seconds = Number(process.hrtime.bigint() - started) / 1e9;
console.log(failed === 0
	? `\nAll suites passed in ${seconds.toFixed(2)}s\n`
	: `\n${failed} suite(s) failed\n`);
process.exit(failed === 0 ? 0 : 1);
