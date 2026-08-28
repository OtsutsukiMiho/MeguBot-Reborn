// Runs the Megu suite in order: pure logic, then core against Postgres, then
// the HTTP layer. Refuses to run against anything but a local database — these
// tests create and delete rows, and that must never happen on the live one.
require('dotenv').config();
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const {
	describeDatabase,
	ensureTestDatabase,
	resolveTestDatabaseUrl,
} = require('./test-database.js');

const SUITES = [
	['rate-limit.test.js', 'the Discord block guard — recognise it, hold it, share it'],
	['audio-queue.test.js', 'the TTS queue — one clip, spoken once'],
	['core.test.js', 'pure logic — money, permissions, tokens, the two axes'],
	['obligations.test.js', 'who owes whom — several payers, late joiners, money sent to the wrong person'],
	['promptpay.test.js', 'the PromptPay payload — checksum, accounts, amounts'],
	['slip.test.js', 'reading pictures — slip QRs, imported accounts, and OCR text'],
	['payment-evidence.test.js', 'optimistic confirmation and multi-period allocation policy'],
	['discord-payment.test.js', 'explicit Discord slip intake and sanitized evidence rendering'],
	['copy.test.js', 'both languages — matching keys, calendars and timezone'],
	['ui-dialogs.test.js', 'embedded-browser-safe confirmation and correction dialogs'],
	['auth-notifications.test.js', 'linked identities, encrypted credentials and channel preferences'],
	['test-database.test.js', 'destructive suites are isolated from the development database'],
	// First against Postgres, because it rebuilds the schema into its pre-rename
	// shape and migrates it forward — which is where the suites below start.
	['rename.test.js', 'the megu_ rename, run against a database that already had data'],
	['session-store.test.js', 'sessions on Postgres — a restart no longer signs everyone out'],
	['notification-integration.test.js', 'linked accounts fan one event out to Discord and email without merging'],
	['account-merge.test.js', 'two accounts, one person — every reference moved, not one satang changed'],
	['e2e.test.js', 'core against Postgres — full badminton lifecycle'],
	['recurring.test.js', 'monthly agreements, periods and DM reminders'],
	['payment-due.test.js', 'the deadline — announced once, deferrable with a reason, never a mute'],
	['payment-lifecycle.test.js', 'multi-period transfers, private evidence, auto-confirmation and reversal'],
	['poll.test.js', 'the time poll — proposing, voting, and Megu deciding'],
	['corrections.test.js', 'editing, deleting and undoing — the ledger must be correctable'],
	['creditor.test.js', 'the creditor column — two people collecting, and the rows written before it existed'],
	['api.test.js', 'HTTP layer — roles, redaction, claim and payment flow'],
	['pay-routing.test.js', 'where the money is sent — two creditors, one roster, and whose QR is printed'],
	['payments.test.js', 'PromptPay QR and slips — who may see a number, and a slip spent twice'],
];

async function main() {
	const testUrl = resolveTestDatabaseUrl();
	await ensureTestDatabase(testUrl);
	// Set this before any core module is loaded. Child suites inherit it too.
	process.env.MEGU_DATABASE_URL = testUrl;

	console.log(`\nMegu test suite\n  isolated database: ${describeDatabase(testUrl)}\n`);

	let failed = 0;
	const started = process.hrtime.bigint();

	for (const [file, description] of SUITES) {
		console.log(`\n── ${file} — ${description}`);
		const res = spawnSync(process.execPath, [path.join(__dirname, file)], {
			stdio: 'inherit',
			cwd: path.join(__dirname, '..'),
			env: process.env,
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
			{ stdio: 'inherit', cwd: path.join(__dirname, '..'), env: process.env },
		);
		if (res.status !== 0) failed++;
	}

	const seconds = Number(process.hrtime.bigint() - started) / 1e9;
	console.log(failed === 0
		? `\nAll suites passed in ${seconds.toFixed(2)}s\n`
		: `\n${failed} suite(s) failed\n`);
	process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
	console.error(`\nRefusing to run the test suite: ${error.message}\n`);
	process.exitCode = 1;
});
