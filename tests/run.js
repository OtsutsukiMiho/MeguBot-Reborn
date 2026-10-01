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
	['discord-notification-transport.test.js', 'shared Discord notices — positive acknowledgement and transport-boundary privacy'],
	['project-workflow-notifications.test.js', 'project topic workflows — atomic audience, review-cycle freshness and durable delivery'],
	['reminder-delivery.test.js', 'scheduled Discord reminders — send ordering, retry, overdue recurrence and overlapping ticks'],
	['reminder-persistence.test.js', 'scheduled reminder persistence — current/legacy PostgreSQL tables and write acknowledgements'],
	['team-archive-disclosure.test.js', 'team archive — bilingual irreversible goal consequence and safe cancellation'],
	['custom-select-keyboard.test.js', 'shared selector — keyboard, search, disabled options and accessible listbox'],
	['creation-request.test.js', 'team/project creation — immediate latch and immutable retry intent'],
	['workspace-creation.test.js', 'team/project creation — durable atomic receipts and concurrent/lost-response retries'],
	['team-workspace-ui.test.js', 'team workspace — shared navigation and focused projects'],
	['workspace-draft-guard.test.js', 'workspace drafts — SPA navigation and history protection'],
	['company-retirement-preflight.test.js', 'legacy Company retirement — read-only reference and access-risk inventory'],
	['company-retirement-rehearsal.test.js', 'legacy Company retirement — populated migration and exact rollback rehearsal'],
	['company-retirement-durable.test.js', 'legacy Company retirement — committed disposable migration and native backup recovery'],
	['company-retirement-native.test.js', 'server-native startup — no Company activation and preserved private boundaries'],
	['team-goal-measurement.test.js', 'private goal measurements — numeric and milestone semantics'],
	['team-goal-schema.test.js', 'private goal storage — versions, constraints and retained references'],
	['team-goal-access.test.js', 'private goal access — explicit participants and administration metadata'],
	['team-goals.test.js', 'private goal integration — draft creation and access boundaries'],
	['team-goal-concurrency.test.js', 'private goal concurrency — real connection races and stale-write rejection'],
	['team-goal-reference.test.js', 'private goal references — independent project access and current redaction'],
	['team-goal-notifications.test.js', 'private goal notifications — outbox privacy, reminders and dispatch rechecks'],
	['team-goals-ui.test.js', 'goal directory UI — bilingual states, privacy labels and pagination'],
	['team-goal-detail-ui.test.js', 'goal detail UI — measurements, history and private-content boundaries'],
	['team-goal-create-ui.test.js', 'goal creation UI — member scope, measurement modes and Thai dates'],
	['team-goal-actions-ui.test.js', 'goal action UI — evidence, review, responses and stale drafts'],
	['team-goal-reviewer-ui.test.js', 'reviewer reassignment UI — eligible members and renewed consent'],
	['team-goal-terms-ui.test.js', 'goal terms UI — draft edits and immutable-version revisions'],
	['project-insights.test.js', 'project metrics — honest denominators and completion snapshots'],
	['project-metric-parity.test.js', 'project metrics — shared directory/team/detail calculation'],
	['server-role-schema.test.js', 'server role configuration — guild scope and consent constraints'],
	['server-role-titles.test.js', 'server role titles — display-only labels and live authorization'],
	['server-role-team-creation.test.js', 'server role team creation — owner selection, atomicity and concurrency'],
	['team-membership-sources.test.js', 'team membership sources — conservative migration, provenance and merge history'],
	['server-role-retirement.test.js', 'role source retirement — final eligibility and ownership safety'],
	['server-role-reconciliation.test.js', 'role reconciliation — authoritative source grants and safe retirement'],
	['server-role-sync.test.js', 'role synchronization — durable bounded work and lease fencing'],
	['server-role-sync-concurrency.test.js', 'role synchronization concurrency — real leases and superseded workers'],
	['server-role-bot.test.js', 'role bot integration — fresh evidence and actual member intent gates'],
	['server-role-automatic.test.js', 'automatic role consent — versioned preview and safe transitions'],
	['server-role-events.test.js', 'role recovery events — identity and gateway scheduling without proof'],
	['server-role-notifications.test.js', 'role private outbox — cycle deduplication and current dispatch checks'],
	['role-team-creation-ui.test.js', 'role team creation UI — preview, owner requirements and guarded retries'],
	['server-role-titles-ui.test.js', 'server role titles UI — localized settings and safe save states'],
	['team-member-titles-ui.test.js', 'team member titles — bounded loading and display-only badges'],
	['server-role-preview.test.js', 'server role preview — partial roster and access boundaries'],
	['server-role-preview-ui.test.js', 'server role preview UI — localized account and approval states'],
	['server-workspace-discovery.test.js', 'server workspace discovery — member and manager separation'],
	['project-completion.test.js', 'completion history — deadline snapshots survive edits and reopen cycles'],
	['project-directory-filters.test.js', 'project directory — URL filters preserve scope and bilingual searches'],
	['rate-limit.test.js', 'the Discord block guard — recognise it, hold it, share it'],
	['discord-oauth.test.js', 'OAuth 429s — preserve the body and honour Retry-After'],
	['discord-invite-permissions.test.js', 'Discord bot invites — least-privilege permissions, scopes and encoding'],
	['console-authorization.test.js', 'console security — current authority and caller/target/bot role hierarchy'],
	['autorole-command.test.js', 'automatic-role commands — atomic mutation and coherent concurrent joins'],
	['discord-oauth-session.test.js', 'OAuth sessions — retired legacy callback and current request lifecycle'],
	['audio-queue.test.js', 'the TTS queue — one clip, spoken once'],
	['voice-connection.test.js', 'Discord voice — late networking errors never terminate the bot'],
	['database-pool.test.js', 'database pools — bounded capacity and explicit cleanup'],
	['mutation-origin.test.js', 'authenticated mutations — exact public origin and fail-closed evidence'],
	['postgres-tls.test.js', 'PostgreSQL TLS — trusted certificates, URL policy and shared pool enforcement'],
	['company-role-policy.test.js', 'Discord role mapping — explicit grants and safe unavailable evidence'],
	['youtube-audio.test.js', 'YouTube audio — safe input, explicit selection and queue controls'],
	['voice-announce.test.js', 'saying who arrived — once, not once per reconnect'],
	['voice-batching.test.js', 'voice membership batches — grouped workload and fresh connection/channel checks'],
	['health-log.test.js', 'the health log — it describes an incident, it never causes one'],
	['locales.test.js', 'the locale registry — a third language is translations, not code'],
	['split.test.js', 'dividing an expense — exact, percentage and weighted, always reconciling'],
	['core.test.js', 'pure logic — money, permissions, tokens, the two axes'],
	['obligations.test.js', 'who owes whom — several payers, late joiners, money sent to the wrong person'],
	['promptpay.test.js', 'the PromptPay payload — checksum, accounts, amounts'],
	['slip.test.js', 'reading pictures — slip QRs, imported accounts, and OCR text'],
	['payment-evidence.test.js', 'optimistic confirmation and multi-period allocation policy'],
	['discord-payment.test.js', 'explicit Discord slip intake and sanitized evidence rendering'],
	['copy.test.js', 'both languages — matching keys, calendars and timezone'],
	['ui-dialogs.test.js', 'embedded-browser-safe confirmation and correction dialogs'],
	['server-tabs-ui.test.js', 'server tools — one responsive workspace with accessible controls'],
	['server-dashboard-drafts.test.js', 'server tool drafts — preserved locally and guarded on departure'],
	['server-dashboard-request.test.js', 'server tool requests — confirmed, rejected and ambiguous outcomes'],
	['project-join.test.js', 'project join requests — owner approval, token checks and member limits'],
	['teams-contract.test.js', 'teams — reusable rosters, dual project access and account navigation'],
	['project-filters.test.js', 'project attention filters — exact rules, counts, search and URL state'],
	['projects-contract.test.js', 'project UI and validation contracts — private routes, dates, invitations and assignments'],
	['project-channel-dispatcher.test.js', 'project channel delivery — overlap, rate limits and lost acknowledgements'],
	['auth-notifications.test.js', 'linked identities, encrypted credentials and channel preferences'],
	['test-database.test.js', 'destructive suites are isolated from the development database'],
	// First against Postgres, because it rebuilds the schema into its pre-rename
	// shape and migrates it forward — which is where the suites below start.
	['rename.test.js', 'the megu_ rename, run against a database that already had data'],
	['company-schema.test.js', 'companies — access-preserving and rerunnable legacy migration'],
	['companies.test.js', 'companies — verified claims and private structural directory'],
	['company-lifecycle.test.js', 'companies — approvals, ownership, archive and project revocation'],
	['session-store.test.js', 'sessions on Postgres — a restart no longer signs everyone out'],
	['console-role-settings.test.js', 'atomic automatic-role settings and consistent join fallback'],
	['notification-integration.test.js', 'linked accounts fan one event out to Discord and email without merging'],
	['account-merge.test.js', 'two accounts, one person — every reference moved, not one satang changed'],
	['projects.test.js', 'private project work — scheduling, reporting, idempotency and review'],
	['teams.test.js', 'reusable teams — joins, dual access, removal, archive and conversion'],
	['projects-scale.test.js', 'project pilot limits — bounded reads at 100 topics and 50 members'],
	['e2e.test.js', 'core against Postgres — full badminton lifecycle'],
	['recurring.test.js', 'monthly agreements, periods and DM reminders'],
	['payment-due.test.js', 'the deadline — announced once, deferrable with a reason, never a mute'],
	['payment-lifecycle.test.js', 'multi-period transfers, private evidence, auto-confirmation and reversal'],
	['poll.test.js', 'the time poll — proposing, voting, and Megu deciding'],
	['payment-methods.test.js', 'where a person can be paid — owned by them, and only editable by them'],
	['split-expenses.test.js', 'split modes against Postgres — the division survives a correction'],
	['corrections.test.js', 'editing, deleting and undoing — the ledger must be correctable'],
	['creditor.test.js', 'the creditor column — two people collecting, and the rows written before it existed'],
	['api.test.js', 'HTTP layer — roles, redaction, claim and payment flow'],
	['pay-routing.test.js', 'where the money is sent — two creditors, one roster, and whose QR is printed'],
	['receipt-access.test.js', 'one payment in detail — the payer, the creditor and the organizer, and nobody else'],
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
