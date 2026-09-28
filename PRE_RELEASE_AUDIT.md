# Pre-Release Audit

## Release assembly verdict — 28 September 2026

**Latest user-supplied independent verdict: F1–F8 and the later anonymous-participant mutation-origin blocker are VERIFIED REMEDIATED. No local product blocker from the final integrated audit remains open.** Earlier candidate/pending language below is historical and preserved as the evidence trail; it is superseded by this independent verdict. This does not certify deployment-only checks.

The current release manifest is `RELEASE_MANIFEST.md`: 220 changed/new paths classified, 215 intended overlays and five deliberately excluded historical prototype/incident-document paths. Mixed bot/database/health runtime files are explicitly included because the current release and registered 103-suite runner directly depend on their F1/F7/process/voice contracts. `PRE_RELEASE_AUDIT.md` and the manifest are now explicitly unignored by `.gitignore`; both are staged with the manifest.

Fresh verification of the isolated current-tree candidate is complete: all **103 registered suites passed** on a new disposable loopback PostgreSQL database; the production Next build with release feature flags passed; 140 applicable JavaScript syntax checks and `git diff --check` passed; and all **14 release browser scripts passed** (English/Thai, desktop/mobile, navigation, creation/retry, invitations, archive warning/cancel, goals, role configuration/status, restoration and selector keyboard behavior). Two shared-database test fixture cleanup/isolation issues and two browser fixture assertions/routes were corrected in four already-manifested test files; no product code changed during this verification. Earlier failed runs are retained in local logs, and the successful full run is `.tmp/release-full-test-3.log`. The browser tests use synthetic API fixtures, so live Discord/OAuth, production proxy, retained database, migration and external TLS/CA configuration remain deployment checks, not local blockers. This candidate is staged for commit review; nothing has been committed, pushed or deployed.

### Read-only production preflight — 28 September 2026

The currently deployed Render public URL, `https://megubot-reborn-67.onrender.com`, serves the site and `/health` returns `OK`. Its login initiation reaches Discord with `redirect_uri` equal to the public `/api/auth/callback`, and supplies OAuth state and client ID; a complete live login/code exchange was not attempted. The Render Environment dashboard requires sign-in in the available browser, so deployed variable names/values, feature flags, current deploy commit and CA mount remain unverified. No secret was displayed or copied.

**DEPLOYMENT-ONLY PENDING, not a release-staging blocker:** deployed `FRONTEND_URL`, OAuth redirect registration/configuration, feature flags, PostgreSQL CA/trust, proxy Origin/Referer preservation, live Discord/OAuth behavior and `workspace_creations` schema rollout. The trust check includes the Supabase SSL certificate source, CA availability/mount in Render, `MEGU_PG_CA_FILE`, a trusted production TLS connection and rejection of an untrusted certificate. No further dashboard inspection is part of staging.

Three empty, unauthenticated production POST probes to the account-merge route (same Origin, sibling Origin and no Origin) all returned HTTP 409 from its no-ticket path. This shows the *currently deployed* service does not exhibit the candidate's shared origin-guard response; it does not invalidate the independently verified local release candidate. Recheck the actual deployed candidate after rollout, including authenticated/browser-cookie mutations. The repository-configured Supabase URL was tested with the candidate's certificate-verifying PostgreSQL policy, but the TLS handshake failed closed with `SELF_SIGNED_CERT_IN_CHAIN` before any SQL ran. Thus the live `workspace_creations` schema was **not** verified. Obtain the trusted Supabase root certificate through the provider dashboard and configure the Render CA mount/`MEGU_PG_CA_FILE` if Render's runtime trust store does not already validate its connection; never disable verification. Live Discord command/role behavior, OAuth callback completion, deployed flags and the production receipt schema remain external checks. No deployment setting or production data was changed.

### Staged release candidate

All 215 manifest category 1–3 paths are staged, including 147 new files. The five excluded historical paths remain unstaged. The staged diff passes whitespace checks after removing two trailing spaces in the release planning document; it contains no generated/binary artifacts, unusual Git modes or likely live secrets. Three credential-shaped URLs found by the scan are synthetic test fixtures. No release path has an unstaged edit. The first scoped `git add` warned about an ignored `backend/database` directory, but the tracked `backend/database/database.js` and all 214 other intended paths are present in the verified index. No commit, push or deployment occurred.

## Current anonymous participant mutation-origin blocker — 28 September 2026

**LOCAL REMEDIATION CANDIDATE; READY FOR INDEPENDENT AUDITOR VERIFICATION, NOT CLOSED.** The final integrated audit found that the F6 guard skipped unsafe `/api/megu/a/:code/...` requests without a login session, even when `megu_pt` identified a participant. Before this correction, the shared guard allowed a device-cookie RSVP POST with `Origin: https://sibling.example.test` to reach the handler. This is a distinct residual blocker; earlier findings and verdicts remain historical records below. Release assembly has not started.

`adapters/http/mutation-origin.js` now applies the existing exact trusted-Origin / same-origin Referer validation to every unsafe activity-scoped request, regardless of login session or existing device cookie. This includes a first-time `/claim` request that may receive its cookie later in the router. The six anonymous writer paths inspected were claim, defer, RSVP, pay, payment-slip upload and slot vote. The guard still runs after cookie/session parsing and before `/api/megu`; it does not alter participant matching, route authorization, cookie attributes, signed-in guard behavior, public activity GETs, unsigned ping or OAuth GETs. No supported production non-browser caller of these activity HTTP mutations was found in the scoped consumer check. README now documents the activity-mutation origin requirement.

Evidence: `tests/mutation-origin.test.js` covers anonymous device-cookie form and JSON success, trusted Referer fallback, sibling/cross/malformed/missing/conflicting evidence rejection, all six writer patterns, first-cookie-free claim, route authorization, signed-in mutations, public GET/ping and OAuth GET. `tests/api.test.js` mounts the shared guard ahead of the real router; a claimed participant's sibling-origin form, cross-origin JSON and missing-origin RSVP are rejected without changing the stored answer, while same-origin JSON/form actions and unclaimed-visitor denial still work. Focused origin suite passed; real API suite passed **45 checks** on owned loopback disposable PostgreSQL; current OAuth session and auth-notification suites passed; three changed JavaScript syntax checks and scoped whitespace checks passed. A fresh read-only candidate review found no concrete surviving bypass or regression in the scoped path; the owned test cluster was stopped. No full suite, browser/deployed-proxy check, live Discord or release assembly was run.

Residual verification: the independent Auditor must reproduce the original sibling-origin device-cookie attack against the candidate and assess the production proxy's Origin/Referer delivery. Clients sending cookie-authenticated activity writes without trusted Origin or Referer now receive 403 by design. **Do not mark this blocker CLOSED from local tests. Exact next task: independent verification of this blocker; release assembly remains on hold.**

## Current F4/F8 remediation candidates — 28 September 2026

**Latest user-supplied independent verdicts: F1, F2, F3, F5, F6 and F7 VERIFIED REMEDIATED. Their implementations are unchanged. F4 and F8 are implemented and locally verified, READY FOR INDEPENDENT VERIFICATION, not CLOSED.** The original F4/F8 findings and earlier records below remain authoritative historical evidence. This is not a final release audit.

### F4: archive disclosure

The existing `teams.archiveHint` used both in the owner danger zone and the final confirmation now says in natural English and Thai that team/project changes may resume after restoration, while unfinished goal workflows stay archived even after the team is restored. It also says goal history remains under existing access rules. The existing `TeamManage` review/cancel/confirm flow was not changed; it displays this warning before the write, and cancellation remains read-only. No goal lifecycle, consent, publication, history, permission, backend or API behavior was modified. No private goal details or impact counts were added to the warning.

New `tests/team-archive-disclosure.test.js` renders the actual Lifecycle review for both languages, asserts the warning appears before final confirmation, verifies opening/cancelling makes no request, and confirms only explicit approval calls the archive endpoint. `tests/team-goals.test.js` passed against a fresh guarded disposable PostgreSQL database: unfinished goal version becomes archived, team restoration does not reactivate it, previous reviewed goal version/history remains, and archived goal event is not duplicated. The fresh database was removed.

### F8: shared selector semantics

`CustomSelect` now names its `role=listbox` with the existing consumer-provided `ariaLabel` or localized fallback. It maintains a visible active option with `aria-activedescendant`, while `aria-selected` continues to reflect the controlled value. ArrowDown/ArrowUp and Home/End move through enabled filtered options; Enter/Space select where appropriate; Space in the search input remains text entry. Escape closes and returns focus to the trigger, and moving focus outside closes the popup. Opened search focuses its input; otherwise the listbox gets focus. Options are no longer separate Tab stops; disabled options cannot activate. Active options scroll into view. Mouse selection, search filtering, compact/default sizes, controlled values and established colors/layout remain. Existing consumer APIs were not changed.

New `tests/custom-select-keyboard.test.js` executes the shared component's handlers in compact/default and searchable variants, checking accessible naming, active-descendant IDs, selected-value stability, arrows, Home/End, disabled skip, Space/Enter, filtering, empty-search Enter protection, pointer activation, Escape/focus return and Tab-out closure. Both focused suites were registered in `tests/run.js`.

Verification: focused F4/F8 tests, bilingual copy, server-tabs UI, team/project contracts and team workspace UI pass (7 direct suites in the final focused rerun). Seven additional direct selector-consumer/goal UI suites passed before the final index-only selector render cleanup: `team-goal-actions-ui`, `team-goal-create-ui`, `team-goal-reviewer-ui`, `team-goal-terms-ui`, `role-team-creation-ui`, `server-role-titles-ui`, `server-role-preview-ui`. Native team-goals lifecycle passes on fresh guarded PostgreSQL. Installed Next SWC compiles the three affected client/copy modules; three touched tests/runner pass JavaScript syntax; scoped tracked/new-file whitespace passes. No full suite/build, live browser viewport or screen-reader session was run. Shared popup width/max-height responsive rules were retained; compact/default component behavior passed. Owned local database cluster was stopped at closure.

Exact files touched: `app/components/CustomSelect.js`, `app/components/customSelect.module.css`, `app/copy/en.js`, `app/copy/th.js`, `tests/team-archive-disclosure.test.js`, `tests/custom-select-keyboard.test.js`, `tests/run.js`, this audit and `COMPANY_IMPLEMENTATION_STATUS.md`. Pre-existing mixed working-tree changes are preserved; this list does not claim ownership of full file diffs. No new dependency, generated browser artifact, staging or checkpoint was added.

Residual independent gates: auditor should verify F4 wording/lifecycle and F8 keyboard/screen-reader behavior in a real browser, including desktop/mobile viewport focus and overflow. No live service/Discord/deployment behavior changed. **F4/F8 READY FOR INDEPENDENT VERIFICATION; do not mark CLOSED based on this local evidence or start a final release audit.**

## Current F5 reload/navigation correction — 28 September 2026

**F5 remains OPEN pending independent verification.** The independent auditor verified the durable server receipts, mounted-form retries, concurrency, payload/actor/kind binding, rollback and authorization; that backend mechanism was not changed. The auditor reproduced a remaining client bypass: commit, lost response, reload/navigation, remount, new UUID, duplicate team/project. This correction addresses only that client lifecycle gap. F1/F2/F3/F6/F7 remain independently VERIFIED REMEDIATED; F4/F8 were not touched. The previous F5 candidate section and original finding below remain historical evidence.

`useCreationRequest` now writes a versioned unresolved attempt into per-tab `sessionStorage` synchronously **before** the create fetch. It includes the UUID, authenticated actor ID, team/project endpoint, actual parent identity (project team ID or team Discord guild ID where present), frozen submitted payload, deterministic field fingerprint, unresolved state and creation timestamp. The client fails before the network request if storage cannot be read or written; a pre-send write failure leaves fields editable for recovery. On remount it loads only a valid record for the signed-in actor, kind and applicable parent, restores the fields and offers the existing Retry action with an explanatory EN/TH message. Mounting as another authenticated actor purges the former actor's browser-session records. Both entry routes for the same team project share its actual-parent key; a locked team-B route cannot load a team-A attempt. A general project route can recover a pending team project; submitting a specific parent looks up that parent's matching record even when another parent was displayed first.

Mounted ambiguous retries keep the frozen snapshot and key. Restored fields are editable; equivalent submitted fields reuse the prior key, while materially changed intent gets a new key. A confirmed success removes the record and stays latched until navigation; initial definitive 4xx removes it and leaves fields editable. After any ambiguity, later 401/403/409/422 retain the key because they cannot prove the first request did not commit. An accepted explicit cancel or shared draft-discard confirmation retires that attempt; cancelled discard, ordinary navigation, component unmount and reload leave it intact. Expired/invalid records are removed on recovery, with a bounded seven-day lifetime that does not extend on retries. Server receipts remain authoritative.

The independent candidate reviewer found an additional route-alias bypass after the first client patch: starting a team project through the general page then returning through the team-specific page used different route scopes. It was reproduced, corrected by scoping on the actual payload parent, and covered in both route directions. A second parent record cannot erase the first unresolved attempt. No server-side F5 or other finding implementation changed.

Verification: `tests/creation-request.test.js` covers persist-before-fetch, dropped response, reload while in flight, navigation/remount, actor/kind/parent isolation, cross-route same-parent reuse, unrelated-parent records, changed intent, success, definitive and post-ambiguity denials, storage failure, explicit retirement and expiry. `tests/workspace-creation.test.js` executes the original auditor sequence against native disposable PostgreSQL and real HTTP for both team and project, proving one entity and the original receipt/key after remount. `tests/workspace-draft-guard.test.js` proves cancelled discard retains state and confirmed discard retires it. All 11 relevant direct suites exit 0: `workspace-creation`, `creation-request`, `teams-contract`, `projects-contract`, `workspace-draft-guard`, `copy`, `ui-dialogs`, `projects`, `server-role-team-creation`, `account-merge`, `api`. `teams.test.js` failed on the reused disposable database at its pending-notification assertion, then **passed on a fresh guarded disposable database**, which was removed; no product/fixture changes were made. Installed Next SWC compiles seven affected client/copy modules; three touched test files pass syntax; scoped tracked/new-file whitespace passes. No full broad suite/build/browser capture or live deployment was run. The owned loopback PostgreSQL cluster was stopped after checks.

Files touched in this correction: `app/components/useCreationRequest.js`, `app/components/useDraftGuard.js`, `app/components/projects/CreateProject.js`, `app/components/projects/NewProject.js`, `app/components/teams/TeamDirectory.js`, `app/copy/en.js`, `app/copy/th.js`, `tests/creation-request.test.js`, `tests/workspace-creation.test.js`, `tests/workspace-draft-guard.test.js`, this audit and `COMPANY_IMPLEMENTATION_STATUS.md`. The working tree already contained mixed earlier changes; do not infer ownership of full file diffs. No staging, checkpoint, new dependency or generated artifact was added.

Residual limits: `sessionStorage` is per browser tab and session; closing the browser, clearing site data, or reaching the seven-day expiration loses automatic key recovery. A deliberate replacement/abandonment creates a new logical attempt, so a prior ambiguous creation may already exist; the UI explains retry rather than silently creating. Cross-tab recovery and live browser/network-loss exercise remain unverified. Existing deployment needs the prior durable receipt schema, coordinated keyed workers and valid browser storage. **READY FOR INDEPENDENT F5 VERIFICATION, not CLOSED. Do not start F4/F8.**

## Current F5 remediation candidate — 28 September 2026

**User-supplied independent verdicts: F1, F2, F3, F6 and F7 VERIFIED REMEDIATED. Their implementations are unchanged. F5 is implemented and locally verified, READY FOR INDEPENDENT VERIFICATION, not CLOSED. F4/F8 remain excluded.** The original audit findings and earlier candidate/review records below are historical and preserved. The previously investigated broader failure is existing reminders-fixture/database-state incompatibility, not a product regression; that unrelated debt was not changed or rerun.

### Creation boundary and affected consumers

- One shared `core/workspace-creation.js` boundary wraps the existing team/project transactions. A PostgreSQL transaction advisory lock serializes each globally unique request key; the entity, owner membership, manual membership source/events where applicable, and successful JSON receipt commit together. Receipt persistence failure rolls everything back. Concurrent identical requests and lost-acknowledgement retries return the persisted original result without inserting or repeating creation effects.
- Additive `workspace_creations` schema stores request key, immutable actor ID, creation kind, SHA-256 of the normalized logical payload, result JSON and creation time. Different actor/kind/payload reuse fails with `idempotency_conflict`. Team payload excludes volatile Discord name/icon enrichment. Existing field normalization, validation and ownership/membership rules remain. Missing/invalid HTTP keys fail with 422.
- Successful receipt replay checks current entity access, not historical permissions. Team HTTP creation still checks current managed-guild authority before every attempt. Missing actors, revoked access and account-boundary reuse cannot retrieve or recreate a successful receipt. Actor binding deliberately has no user/entity foreign key: merge/deletion must not reassign or erase the key and permit duplicate creation. Actual account merging verifies this immutable tombstone behavior. No receipt expiry/deletion policy is introduced.
- Both HTTP creation routes require `requestKey`; runtime Discord project creation derives it from the stable interaction ID. Internal keyless calls remain supported for existing fixtures/internal contracts; role-derived batch team creation retains its existing separate atomic receipt mechanism. The new boundary does not replace that batch implementation.
- One client hook captures a UUID and immutable submitted payload before awaiting, immediately latches submissions, and freezes fields. Team draft/cancel protection is preserved; project creation gains the same latch/frozen behavior. Network failures, 5xx responses and unreadable responses retain the captured attempt for retry. An initial definitive 4xx unlocks correction while preserving entered data. After any ambiguous response, later 401/403/409/422 responses also retain the original key/payload; a denial cannot prove that the first request did not commit. Successful submission stays latched until navigation. A newly mounted intentional creation form receives a new key.

### Review and verification evidence

Fresh scoped investigator traced creation callers, authorization, transaction boundaries and account-merge dependencies. One fresh candidate review found that a later 4xx after a lost acknowledgement discarded the captured key. This was confirmed, corrected with an explicit uncertain-attempt latch, and covered for both flows with 401/403/409/422 followed by successful retry. No independent remediation verdict is claimed from this local review.

New `tests/workspace-creation.test.js` uses guarded native loopback PostgreSQL: two independent connections are observed waiting on the same advisory lock; both creations return one result/receipt. Both flows cover compatible normalized replay, incompatible payload, foreign actor, cross-kind key reuse, deliberate new key, validation recovery, receipt-write rollback, unchanged ownership/membership/source/event counts, revoked access, and real HTTP response loss after committed creation. HTTP authentication, managed-guild authorization failure/recovery/revocation, Discord duplicate interaction delivery/new interaction, and actual account merge with immutable receipt issuer are also covered. New `tests/creation-request.test.js` executes the client hook for immediate double submission, frozen payload, stable ambiguous retries including later denial, 503, initial validation recovery, success latch and intentional new keys; project field/guard wiring is checked. Both suites are registered with the supported runner.

Final targeted verification: **10 suites exit 0** — `creation-request`, `workspace-creation`, `teams-contract`, `projects-contract`, `ui-dialogs`, `teams`, `projects`, `server-role-team-creation`, `account-merge`, `api`. JavaScript syntax passes for 10 changed backend/command/test files; Next's installed SWC compiles all three affected client modules. Scoped tracked/new-file whitespace checks pass. No full broad suite, production build, browser matrix, retained/provider database access, live Discord mutation or deployment was performed. Tests used only the owned disposable loopback database; its cluster was stopped at closure. No secrets, debug servers, generated review artifacts, staging or checkpoint commit were added.

Exact F5 files: `core/workspace-creation.js`, `core/schema.js`, `core/teams.js`, `core/projects.js`, `adapters/http/megu-api.js`, `commands/utility/projects.js`, `app/components/useCreationRequest.js`, `app/components/projects/CreateProject.js`, `app/components/teams/TeamDirectory.js`, `tests/creation-request.test.js`, `tests/workspace-creation.test.js`, `tests/teams-contract.test.js`, `tests/run.js`, this audit and `COMPANY_IMPLEMENTATION_STATUS.md`. Existing interleaved changes are preserved; this list is this batch's touched-file set, not ownership of each file's full diff.

### Deployment and remaining limits

Deploy the additive table with the existing schema initializer/required DDL privileges, retain/back up its receipts, and coordinate all supported creation writers and browser clients: old HTTP clients without keys now receive 422; old workers must not remain able to accept unkeyed creation during rollout. No live deployment or provider migration rehearsal is claimed. Client keys survive retries in the mounted form, not browser reload/navigation; abandoning that form starts a new logical attempt and does not recover an earlier receipt automatically. Native behavior and client state are verified, but no fresh live browser/network-disconnect exercise was run. Mixed historical voice/database work and ignored audit-document status require explicit release selection. **Next task: independent F5 verification; do not start F4/F8 without authorization.**

Audit date: 27 September 2026 (Asia/Bangkok).

This document records the completed independent audit of the current repository at `E:\MeguBotReborn`. It records findings and proposed verification; it does not record remediation or authorize deployment. No findings were fixed during the audit. Creation of this document is the sole authorized documentation change following the audit.

## Audit scope

### What was inspected

- Repository instructions in `AGENTS.md`, token-optimizer, and Ponytail; the review used a cross-cutting scope covering authorization, shared contracts, schema, lifecycle, and affected consumers.
- Active server, team, project, and goal routes; frontend API calls; navigation and draft guards; owner/admin/member boundaries; Discord role configuration, consent, synchronization, and bot mutation handlers.
- Current OAuth callbacks, account/session handling, credential storage, and development-login gating.
- Membership removal/retention, ownership transfer, archive/restore, goal lifecycle, schema installation, retained Company restrictions, sync fencing, and notification eligibility.
- Existing test/build/browser logs and the relevant verification scripts, including their mutation behavior.
- Scoped Git status/diff, whitespace checks, relevant TODO/FIXME/debugger markers, ignored artifacts, tracked configuration keys, and a scoped credential-pattern search.
- English/Thai copy, responsive/theme styling, keyboard/focus implementation, and three retained archive-review screenshots at 390, 768, and 1440 pixels.

### What was actually executed

- Read-only source, log, metadata, and Git inspection. Git's ownership exception was supplied only as a command-local option; persistent Git configuration was not changed.
- Seven focused checks, all passing:
  - `tests/team-workspace-ui.test.js`
  - `tests/workspace-draft-guard.test.js`
  - `tests/team-goal-detail-ui.test.js`
  - `tests/teams-contract.test.js`
  - `tests/copy.test.js`
  - `tests/team-goal-access.test.js`
  - `tests/server-role-preview-ui.test.js`
- Isolated, in-memory reproductions using current source slices and mocked dependencies:
  - Manage Server-only admission through the console guard, followed by Administrator-role assignment through the bot handler.
  - Admission using cached console authority without a current Discord permission query.
  - Legacy OAuth state validation with absent stored state.
  - Identical project creation replay producing two IDs and two insert attempts.
  - Team archive/restore leaving an unfinished goal archived.
- Comparison against HEAD confirmed that the console admission guard, manageable-guild filter, batch member-role handler, and weak legacy OAuth state guard predate the working-tree release changes.
- Current `git diff --check`, which passed.

The in-memory reproductions did not connect to Discord or PostgreSQL, exchange OAuth codes, sign anyone in, or perform real mutations. An initial diagnostic assertion expected literal `false` from the legacy state expression; JavaScript returned falsy `undefined`. The diagnostic was corrected to test Boolean rejection semantics and then passed. This was a probe assertion issue, not a product-suite failure.

### What was not verified

- No fresh production build, broad database suite, migration rehearsal, or browser script was run. These write build artifacts, database data, or screenshots; existing relevant evidence was inspected instead.
- No live Discord permission change, role assignment, OAuth exchange, production database operation, notification delivery, or deployment was performed.
- Browser records use synthetic APIs. They support frontend behavior, not live frontend/backend/Discord integration.
- No fresh screen-reader session or comprehensive assistive-technology certification was performed.
- Existing logs have timestamps but no source hashes binding their results to the exact working tree.
- Conclusions concern inspected paths; they are not a claim that every endpoint or every possible behavior was exhaustively verified.

### Repository and working-tree assumptions

- The current repository state was authoritative; prior completion claims were not treated as proof.
- At audit completion, Git reported 56 modified tracked files and 126 untracked entries. Those entries must not all be assumed to belong to this release.
- Historical voice/database work was mixed with release work and requires explicit release selection.
- No inspected application source file under `core`, `adapters`, `backend`, or `app` had a modification timestamp later than the final recorded build at 13:45:05 on 27 September 2026.
- The broad regression record predates the final frontend edits; later focused checks, build, and browser records cover the frontend follow-up. Backend evidence was assessed against the source timestamps and reviewed paths.
- This document adds one file after those observations. It does not rebase the findings onto subsequent application changes.

## Release status

**LOCAL RELEASE BLOCKERS FOUND**

F1 is a confirmed release blocker. F2 and F3 are serious existing authorization/authentication risks requiring resolution. Passing existing suites and frontend checks do not override the reproduced security findings.

### F7 broader-smoke failure investigation — 27 September 2026

**Disposition: existing reminder-fixture incompatibility on a reused disposable database, triggered by an accidental harness invocation; not caused by F7. No product/test code changed. This failure does not block proceeding to F5 remediation once authorized. F7's independent verification/closure gate is unchanged; F4/F5/F8 were not started.**

Recovered the full desktop command-execution event (not the truncated chat excerpt): `C:/Users/MARU/.codex/sessions/2026/09/26/rollout-2026-09-26T20-23-46-01a0dde2-d869-7d61-bab6-a84b1e2d1456.jsonl`, event ordinal 5900, completed `2026-09-27T16:20:51.290Z`, process/session `26983`, exit 1, duration approximately 55.67 seconds. The recorded `node -e` VM smoke loaded the actual `tests/run.js` after setting `MEGU_TEST_DATABASE_URL` and `MEGU_DATABASE_URL` to `postgresql://megu_security@127.0.0.1:55445/megu_security_test`. Its require substitute matched only `name === 'child_process'`, while the runner imports `node:child_process`; real `spawnSync` therefore executed child suites. VM console substitution suppressed suite headings and the aggregate summary. The outer `assert.equal(code, 0)` at `[eval]:1:665` reported `1 !== 0` after the child failure; it is a consequence, not another product failure.

**Exact failing child: `node tests/rename.test.js`. Exact failing operation: line 87, `INSERT INTO reminders (user_id, message) VALUES ($1, $2)` for the `__rename_probe__` fixture.** The log records `FAILED null value in column "guild_id" of relation "reminders" violates not-null constraint`. The complete output has one child `FAILED` marker; other voice/provider failure messages are explicitly passing negative-path tests. This failure occurred before the suite's first checkpoint and before calling `initCoreSchema`, so no migration assertion failed.

Root cause: `tests/rename.test.js:81` uses `CREATE TABLE IF NOT EXISTS` with a nullable simplified reminders shape, but a reused database already contains the real bot table. `backend/database/database.js:87` requires guild/channel/time values. The existing table remains unchanged, then the fixture omits those required values. A read-only information-schema census confirmed `user_id`, `guild_id`, `channel_id` and `reminder_time` are NOT NULL in the owned reused database. `git show HEAD:tests/rename.test.js` and `git show HEAD:backend/database/database.js` contain the same fixture and required-column contract; `git diff -- tests/rename.test.js` is empty. F7 changes connection destination validation/TLS options, not either schema or insert.

Focused reproduction: process-only test/core/legacy URLs all set to the owned loopback `megu_security_test` database, then `node tests/rename.test.js`: **exit 1 with the exact recorded guild_id error**. Control: create a uniquely named `megu_failure_control_<8 hex>_test` database through the corrected helper on the same loopback cluster, set all three URLs to that database and run the SAME `node tests/rename.test.js`: **exit 0, all 6 checks passed**, including concurrent migration, retained rows/FKs, bot-table preservation and rerunnable migration. The owned control database was removed afterward. This isolates pre-existing database shape rather than F7/client behavior as the cause. No entire broad-suite rerun, retained/provider access, deployment or product/test edits occurred.

Release implication: the reused-database fixture can produce a false-negative full-run result and prevents that invocation from proving rename coverage. It is existing test-isolation/fixture debt, not demonstrated release behavior or data-loss risk. A fresh local disposable database provides valid focused migration evidence; the broader release suite is still not claimed as passing. The smoke procedure was already corrected to substitute the actual `node:child_process` import; use that exact import (or both aliases) and avoid a reused schema when evaluating this legacy fixture. No unrelated fixture fix was made. Original failure evidence below is preserved and now explained. The owned loopback cluster was stopped at investigation closure.

### Current F7 disposable-test helper correction — 27 September 2026

**Independent verdict: F1, F2, F3 and F6 VERIFIED REMEDIATED; the five corrected operator paths and three application pools are independently verified. F7 is STILL NOT CLOSED.** The independent auditor reproduced a remaining supported-runner bypass in `tests/test-database.js`: `postgresql://test@localhost/fixture_test?host=db.example.test&sslmode=disable` passed the apparent-host guard while installed pg selected remote plaintext. This correction is locally verified and **READY FOR INDEPENDENT VERIFICATION**. No F1–F3/F6 implementation or F4/F5/F8 work was changed.

`parseDatabaseUrl` now sanitizes connection/TLS options with the existing shared helper and inspects the installed `pg.Client.connectionParameters` without connecting. It validates the EFFECTIVE host and database, rejects duplicate host parameters and unsupported native address/service selectors, rejects malformed/remote/socket destinations, and requires the existing safe database pathname. Numeric IPv4/DNS case/trailing-dot/IPv6 forms are normalized using Node's URL facilities and pinned into one canonical query host. Explicit and derived resolver URLs and `ensureTestDatabase` return that canonical URL; creation still requires `_test`, connects only to the local administrative database and uses the shared connection options. SSL false is selected only for the validated intentional local destination. TLS query flags cannot re-enable an alternate policy or cause certificate-file reads. The shared remote TLS implementation and all previously verified constructors are unchanged.

Boolean-only consumers of `isDisposableTestDatabase` keep their original URL, so the predicate now accepts only inputs already safe to consume unchanged. A noncanonical local form can instead be normalized through `resolveTestDatabaseUrl`/`ensureTestDatabase`; its canonical result passes the predicate. Existing localhost/127.0.0.1/container inputs remain supported, and IPv6 resolution/creation supplies pg the unbracketed `::1` host. This avoids silently approving inputs that downstream consumers would classify differently.

Regression evidence: `tests/test-database.test.js` covers 11 local forms, query IPv6/empty host, hostile PGHOST fallback, explicit and derived resolver rejection, and 23 remote/ambiguous/malformed cases. Cases include the exact auditor URI, SSL variants, both duplicate-host orders/final-empty tricks, encoded host keys/values, direct remote DNS/IPv4/IPv6, malformed/socket hosts and native selectors. A spy using the installed driver confirms ZERO connect calls for rejected targets and checks canonical IPv6 administrative options, local plaintext and certificate-flag sanitation. The existing TLS suite was updated only where the stricter Company guard now rejects effective remote targets before constructing a rehearsal connection; all other verified application/operator/TLS checks remain.

Fresh read-only candidate review found two correctness gaps in the initial patch: boolean-only consumers retained noncanonical input, and encoded socket authority `%2Ftmp` plus `host=localhost` changed pg's effective database. Both were confirmed with the installed driver and corrected; regression assertions cover both. No second review/closure claim is implied.

Verification passed: `node tests/test-database.test.js` (pure and native disposable variants), `node tests/postgres-tls.test.js`, `node tests/company-retirement-preflight.test.js`, `node tests/company-retirement-rehearsal.test.js`, JavaScript syntax and scoped whitespace. A smoke execution of the actual `tests/run.js` bootstrap against the native local database, substituting child suite execution, verified canonical isolated URL propagation. An earlier smoke harness missed the `node:child_process` alias and accidentally invoked broader children; that run finished with aggregate failure and is NOT claimed as passing evidence. It was not rerun or used to broaden remediation. The corrected bootstrap passed. Only the owned loopback `megu_security_test` database at port 55445 was used; no retained/provider connection or deployment occurred. The owned cluster was stopped and ephemeral TLS fixtures/listeners were cleaned.

Exact changed files: `tests/test-database.js`, `tests/test-database.test.js`, `tests/postgres-tls.test.js`, this audit and `COMPANY_IMPLEMENTATION_STATUS.md`. No new dependency, secret, certificate or competing status document was added.

Residual gates: provider TLS acceptance and CA mounting remain deployment-only checks from the independently verified paths. Recognized container aliases retain their existing trusted local-development assumption; arbitrary DNS/IP targets are rejected. IPv4-mapped IPv6, socket/service routes and ambiguous duplicate hosts are intentionally unsupported here. No passing broad release-suite claim is made. **Exact next task: independent F7 verification; do not continue F4/F5/F8.**

### Previous F7 operator-path correction — 27 September 2026 (historical; paths independently verified)

**Independent verdicts: F1, F2, F3 and F6 VERIFIED REMEDIATED. Their implementations are unchanged. F7 remains NOT CLOSED: the independent auditor verified the three application pools but reproduced downgrade/plaintext selection in the supported health/instance operator tools. The correction below is locally verified and READY FOR INDEPENDENT VERIFICATION.** Original findings and previous review evidence are retained below. F4/F5/F8 remain outside this work.

The scoped constructor probe covered core, retained legacy and application health pools (already verified), both operator pools, authorized retained Company inventory, local Company rehearsal and the embedded cloud setup database check. The Discord `Client` is not PostgreSQL. `scripts/health-log.js` and `scripts/instance-audit.js` now spread the existing `postgresConnectionOptions` before constructing their pools. `scripts/company-retirement-preflight.js`, `scripts/company-retirement-rehearsal.js` and `scripts/cloud-setup.sh` use that SAME helper for their Clients. No second TLS policy or shared-helper change was introduced. URL selection, pool size/timeouts, read-only sessions, inventory authorization and rehearsal rollback behavior are preserved.

Remote transport always requires authenticated TLS; `sslmode=disable`, `ssl=0`, no-verify modes, libpq compatibility and URL certificate options cannot replace the shared settings after pg reparses the URL. Node trust or the configured validated CA bundle supplies trust; native hostname/IP identity verification remains enabled. Intentional local hosts retain plaintext. An invalid explicit CA cannot construct a remote connection.

Regression: `tests/postgres-tls.test.js` now executes the five actual operator entry points with substituted network constructors, then parses their captured options with the installed `pg.Client`. It covers default remote transport, downgrade variants, custom CA retention, local transport, invalid CA rejection, effective remote query-host selection, preserved timeouts, and successful read-only operator completion/pool cleanup. Each captured remote policy is exercised against ephemeral native TLS for trusted acceptance, untrusted rejection and wrong-hostname rejection. Existing three application-pool, split-routing, native IP SAN and legacy fail-closed checks remain intact.

Verification: `node tests/postgres-tls.test.js`, `node tests/database-pool.test.js` (3 checks), `node tests/health-log.test.js` (10 checks), `node tests/company-retirement-preflight.test.js` and `node tests/company-retirement-rehearsal.test.js` all passed. Company checks used only the owned loopback `megu_security_test` database on port 55445 with process-only test/core/legacy URLs. JavaScript syntax, cloud shell syntax and scoped whitespace checks passed. Fresh read-only candidate review identified the cloud constructor omission; it was migrated and included in the same review, which found no surviving F7 bypass. Test-harness corrections handled the shell's synchronous CA failure, the rehearsal's existing generic error and asynchronous completion without weakening security assertions. Temporary TLS fixtures/listeners were cleaned; the owned PostgreSQL cluster was stopped. No provider connection, retained inventory, secret output, deployment or unrelated suite was run.

Exact files changed in this correction: `scripts/health-log.js`, `scripts/instance-audit.js`, `scripts/company-retirement-preflight.js`, `scripts/company-retirement-rehearsal.js`, `scripts/cloud-setup.sh`, `tests/postgres-tls.test.js`, `DATABASE.md`, this audit and `COMPANY_IMPLEMENTATION_STATUS.md`.

Residual limits: deployment must provide the authenticated provider CA via Node trust or `MEGU_PG_CA_FILE` in operator processes as well as application workers, and confirm provider DNS/IP identity and file permissions. Live provider TLS remains untested. Existing local-only Company/cloud guards inspect the URI hostname rather than pg's query-host override; the shared helper now enforces TLS for such a remote target, but the separate local-only guard contract is not repaired by this F7 correction. Encoded authority hostnames can fail closed through identity mismatch; use canonical provider hostnames. **Next task: independent F7 verification; do not advance F4/F5/F8.**

### Previous F6/F7 remediation candidates — 27 September 2026 (historical)

**Latest independent verdict: F1, F2 and F3 VERIFIED REMEDIATED. F6/F7 implementation candidates locally verified and READY FOR INDEPENDENT VERIFICATION; neither is CLOSED.** Original F6/F7 findings and earlier independent/local evidence below remain intact. Original audit release statements above and prior candidate verdicts below are historical. No F4/F5/F8 changes were made.

**F6 shared boundary:** `adapters/http/mutation-origin.js` is mounted after Express session loading and before the mounted APIs/console routes. The direct affected classes are guild console/member/settings/role actions, developer actions, account merge/cancel and logout. Other signed-in API mutations also cross this boundary. It validates unsafe methods using the configured `FRONTEND_URL` public origin; private Express Host and forwarded Host are not trusted-origin sources. Origin must be one exact HTTP(S) serialized origin. When absent, an exact-origin Referer may supply evidence. Missing both, malformed/null Origin, conflicting Referer/Fetch-Site, cross-site and same-site sibling-origin evidence receive 403 before mutation handlers. A dummy Authorization header supplies no exemption. There is no demonstrated console machine-auth contract to preserve via a bypass. Same-origin forms/JSON work; normal authentication and permissions remain necessary. OAuth initiation/callback GETs, cookie attributes and unsigned public API contracts are unchanged.

**F7 shared trust:** `core/postgres-connection.js` supplies core (`MEGU_DATABASE_URL || DATABASE_URL`), retained legacy (`DATABASE_URL`) and the directly discovered health-log pool (`DATABASE_URL`). All remote connections use certificate-chain and hostname authentication. Unset `MEGU_PG_CA_FILE` uses Node's configured trust store; an explicit readable PEM trusted-CA bundle is validated before use. Empty/missing/unreadable/malformed/non-CA configured files fail safely. No provider CA, credential or private key was invented/committed. URL TLS switches are removed before pg reparses the URL, preventing `sslmode=disable/no-verify`, `ssl=no-verify`, libpq compatibility and certificate flags from overriding the shared policy. The candidate reviewer reproduced `postgresql://test@db.example.test/test?host=localhost&host=db.example.test`: first-value classification selected plaintext while pg connected to the last remote host. Confirmed and fixed by matching pg's last effective host semantics, including empty-value fallback; the added actual `pg.Client` regression checks remote TLS stays verified. Local loopback/container behavior and split core/legacy routing are preserved. Remote legacy initialization failures now propagate instead of switching retained writes to local JSON; existing local fallback remains, and health recording continues to isolate failures.

| Verification gate | Actual result |
| --- | --- |
| `node tests/mutation-origin.test.js` | Exit 0; real HTTP sessions/forms/JSON, exact Origin and Referer acceptance, missing/malformed/null/conflicting/cross-site/sibling denial, forwarded-host and dummy-machine-header denial, POST/PUT/PATCH/DELETE across route classes, actual console authentication/authorization guard and OAuth GET compatibility |
| `node tests/postgres-tls.test.js` | Exit 0; native TLS accepts the ephemeral trusted CA+hostname, rejects an untrusted chain and wrong hostname; actual pg option parsing cannot disable verification; duplicate-host regression, all three pool construction policies, CA failure cases, remote legacy fail-closed, local URLs and split routing pass |
| `node tests/console-authorization.test.js`, `node tests/autorole-command.test.js`, `node tests/discord-oauth-session.test.js`, `node tests/discord-oauth.test.js` | Exit 0 each; 122 console checks, atomic autorole command behavior and current OAuth/login/linking/regeneration/response contracts remain intact; F1–F3 were not reopened or redesigned |
| `node tests/database-pool.test.js`, `node tests/health-log.test.js`, `node tests/auth-notifications.test.js` | Exit 0 each; pool 3 checks, health failure-isolation 10 checks and existing auth/notification contracts |
| `tests/session-store.test.js`, `tests/console-role-settings.test.js`, `tests/account-merge.test.js`, `tests/api.test.js` with guarded disposable DB | Exit 0 each; persistent sessions 12, shared role settings/command races, identity merge and API 44 checks |
| Guarded disposable local legacy `initDatabase`, setting read/write/delete and `close` smoke check | Exit 0; stayed PostgreSQL rather than falling back to JSON |
| `node --check` on nine changed JavaScript files; scoped tracked/new-file whitespace inspection | Passed |

The fresh read-only candidate review found no concrete F6 bypass and identified the duplicate-host F7 bypass above. It was confirmed, corrected and regression-tested after that review; this is not an independent closure verdict. Final installed-driver/Node inspection also found that pg omits SNI for IP targets and Node can then use a localhost identity. The shared TLS options now supply the effective database host explicitly; native already-connected-socket tests accept a matching IP SAN and reject a different remote IP even when the certificate also includes localhost. Initial test scaffolding needed a valid console guild parameter and a stubbed legacy cleanup timer; these were harness corrections, not weakened assertions or product fixes. OpenSSL generated test CA/server keys only in an OS temporary directory, native TLS listeners were closed, and the directory was removed. No key/certificate contents or environment secrets were printed or added to tracked files.

All DB checks set process-only `MEGU_TEST_DATABASE_URL`, `MEGU_DATABASE_URL` and `DATABASE_URL` to `postgresql://megu_security@127.0.0.1:55445/megu_security_test`; tests use `ensureTestDatabase(resolveTestDatabaseUrl())`. The owned loopback cluster was stopped at closure. No retained database, live OAuth/Discord/provider-TLS operation, production CA download, feature activation, broad build/browser/full release suite or deployment was performed. Relevant existing evidence outside the dependency closure was retained.

Changed files: `adapters/http/mutation-origin.js`, `core/postgres-connection.js`, `backend/web/web.js`, `core/db.js`, `backend/database/database.js`, `adapters/health/health-log.js`, `tests/mutation-origin.test.js`, `tests/postgres-tls.test.js`, `tests/run.js`, `README.md`, `DATABASE.md`, `PRE_RELEASE_AUDIT.md`, `COMPANY_IMPLEMENTATION_STATUS.md`. The health pool widened F7 only because it shared the exact insecure TLS behavior and deployment URL; unrelated voice/database work remains preserved.

Remaining deployment requirements: configure the single public frontend origin and verify browser Origin/Referer delivery through the deployed Next proxy. Headerless cookie clients now fail intentionally; no new machine authentication was invented. Determine the actual provider CA chain from an authenticated provider source; if Node trust cannot validate it, mount a read-only trusted CA bundle and set `MEGU_PG_CA_FILE` in every process. Verify provider hostname, bundle permissions and successful connections for both database URLs when split. URI certificate flags are replaced by the shared CA contract; mutual-TLS client-certificate deployment is not established by repository documentation. Remote legacy initialization outages now fail rather than use JSON. These production checks and independent F6/F7 verification remain outstanding; neither finding is CLOSED by local tests.

### Latest independent verdict and F1 command-writer correction — 27 September 2026 (historical; now independently verified)

**F2 VERIFIED REMEDIATED. F3 VERIFIED REMEDIATED. Neither implementation was changed by this correction. F1 remains NOT CLOSED: this command-writer candidate is implemented and locally verified, ready for another independent verification.** F4–F8 remain open/out of scope. The original findings, earlier local evidence and superseded candidate claims below are historical and preserved.

Independent verification found the web effective-grant/CAS save correct, but reproduced a sibling writer in `/autorole clear human`: it committed `autorole_ids=[]`, a concurrent join read this empty list with the still-present privileged `autorole_id`, and the join attempted the privileged fallback grant before the command cleared that ID. Human remove-last used the same split write pattern. The auditor used the actual handlers with in-memory substitutes.

**Writer closure:** scoped automatic-role field references across commands/backend/adapters/core/scripts found the web configuration route and `commands/utility/autorole.js` as runtime writers. The shared database adapter is their persistence implementation; frontend fields submit to the web route. Command human/bot add, human/bot remove and human/bot/all clear now use one `getAllGuildVars` snapshot and one `compareAndSetGuildRoleVars` commit for all three fields. No command uses per-key role reads/writes. Array copies preserve the expected snapshot for conflict comparison. Human edits start from the actual supported effective list/fallback; a populated low list never imports a dormant privileged legacy ID. Bot-only edits preserve both human fields, human-only edits preserve bot roles, and all-clear removes both representations together. A stale command receives an ephemeral retry response rather than success. Administrator command access and existing bot Manage Roles/hierarchy checks are preserved. Web effective-grant/caller hierarchy validation, the native PostgreSQL/JSON CAS implementation, the coherent join reader and F2/F3 runtime code are unchanged.

| Focused verification | Actual result |
| --- | --- |
| `node tests/autorole-command.test.js` | Exit 0; actual clear-human and remove-last commands suspended before commit while actual join assignment runs; only complete old-low or complete new-empty configuration is observed, never dormant privileged fallback; every add/remove/clear target uses one CAS and no per-key writes/reads; target retention, supported fallback add/remove/status, stale rejection, Administrator default and bot safeguards pass |
| Same runnable regression loading `HEAD:commands/utility/autorole.js` through an in-memory source substitute | Vulnerable baseline rejected by `Join must not observe privileged fallback between field writes`; no live Discord or persistence used |
| `node tests/console-role-settings.test.js` with guarded disposable database | Exit 0; native PostgreSQL command-versus-web race rejects the stale command, fresh command clear succeeds; actual JSON command uses the same boundary; previous concurrent save/lock contention/unrelated data retention/coherent join cases pass |
| `node tests/console-authorization.test.js` | Exit 0, 122 checks; web privileged fallback rejection, current caller/bot hierarchy, allowed low-role transitions, safe clearing and stale-save denial remain intact |
| `node tests/server-role-bot.test.js`, `node tests/guild-member-settings.test.js` | Exit 0 each; bot role integration and 18 member/settings checks pass |
| `node --check` on command, new command test, role-settings test and runner; scoped tracked/new-file whitespace checks | Passed |

The fresh read-only candidate reviewer found no concrete surviving F1 bypass/regression and ran the command regression independently; its code review does not close the finding. The first test harness invocation hit a CRLF-sensitive source-slice `Unexpected token catch`; normalizing only the test's source string located the correct join body, after which the baseline reproduction and final checks passed. No product code was altered for this harness issue.

Database verification set process-only `MEGU_TEST_DATABASE_URL` and `MEGU_DATABASE_URL` to `postgresql://megu_security@127.0.0.1:55445/megu_security_test`; the owning test calls `ensureTestDatabase(resolveTestDatabaseUrl())` and asserts the core connection matches this guarded URL. The existing owned test cluster was started with explicit loopback/port and stopped at closure. No retained DB, OAuth, live Discord mutation, feature activation, full release suite/build or browser matrix was run. No unrelated working-tree changes were removed/staged/committed.

Exact correction files: `commands/utility/autorole.js`, new registered `tests/autorole-command.test.js`, `tests/console-role-settings.test.js`, `tests/run.js`, `PRE_RELEASE_AUDIT.md`, `COMPANY_IMPLEMENTATION_STATUS.md`. Residual requirements: another independent F1 verification; every deployed command/web worker must contain the correction; live Discord permission/hierarchy behavior remains unverified. Existing JSON lock contention fails closed and crash-left locks require operator cleanup only after confirming no live writer. F1 is not marked REMEDIATED by this local implementation.

### Independent verification and F1/F3 follow-up — 27 September 2026 (historical)

**F2 independently VERIFIED REMEDIATED; unchanged by this follow-up. F1/F3 implementation candidates locally verified and ready for another independent verification; neither is marked REMEDIATED.** F4–F8 remain open and out of scope. Original findings and historical evidence below are preserved.

Independent verification reproduced two gaps in the first batch: F1 accepted `{autorole_ids:[low], autorole_id:high}` → `{autorole_ids:[], autorole_id:high}` with caller position 5, privileged role 7 and bot 10, enabling the bot's fallback on join. F3 accepted concurrent callbacks holding separate snapshots of the same stored OAuth request; two distinct valid code substitutes caused two exchanges/accounts. The old concurrent test shared one request object and did not prove shared-storage protection. These results supersede the first-batch local F1/F3 completion claim.

**F1 candidate:** effective before/after grants now follow the join rule: a nonempty human list, otherwise the legacy ID. Newly effective grants and incumbent stored additions use current Manage Roles and caller/role/bot hierarchy verification before any write. Scalar-to-array transitions cannot conceal an effective addition. Low-role changes, authorized legacy fallback and safe clearing are retained; removing protected/deleted roles does not require hierarchy authority over those removed roles. A fresh candidate reviewer reproduced a further concurrent-write bypass: an unchanged save retaining dormant high and a safe save changing fallback to low/clearing the list could interleave separate writes to produce high/empty. Confirmed and fixed with a row-locked PostgreSQL compare-and-set, or an exclusive native lock plus synchronous JSON save, covering all three role fields together. Stale snapshots return 409 before other settings writes. Join selection reads one uncached settings snapshot so stale per-key cache entries cannot reconstruct an unsafe combination. Only the existing role-settings writer and join consumer were changed.

**F3 candidate:** the session store atomically inserts a unique `(sid,state)` claim from an unexpired stored session whose entire request matches and whose linking account remains bound. The callback awaits this claim before exchange; missing storage capability/denied claim rejects with 403 and storage errors return 503 with no exchange. A separate `web_oauth_consumptions` table keeps claims outside session JSON, preventing stale saves from resurrecting a state. Claims remain until the request deadline; malformed/future timestamps and unsupported intents fail closed. Current login, callback aliases, session regeneration, linking and account-change protections remain. The read-only candidate reviewer found no concrete surviving F3 bypass; that review is not a renewed independent verification verdict.

| Follow-up verification command/gate | Actual result |
| --- | --- |
| `node tests/console-authorization.test.js` | Exit 0, 122 checks; exact dormant high fallback rejected without writes, authorized low fallback/list transitions and full clearing accepted, bot hierarchy and current permission denial preserved, scalar representation and stale-save rejection covered |
| `node tests/discord-oauth-session.test.js` | Exit 0; two independent snapshots/distinct code substitutes yield one exchange/account and one rejection; absent/mismatch/expired/sequential replay, malformed/future time, intent, missing/failed atomic storage, current login/linking, account continuity and regeneration failure covered |
| `node tests/console-role-settings.test.js` on guarded disposable DB | Exit 0; actual PostgreSQL helper concurrency/stale-save rejection, atomic JSON save/lock contention/cleanup, unrelated-setting retention and actual join selection with mixed cached reads forbidden |
| `tests/session-store.test.js` on guarded disposable DB | Exit 0, 12 checks; actual callback plus two independently loaded snapshots/two store instances for both login and linking produce exactly one successful callback and token exchange; stale-save replay denied across store restart, new state accepted, stored expiry/missing state/account changes fail closed; existing persistence/regeneration HTTP consumers preserved |
| `node tests/discord-oauth.test.js`, `node tests/rate-limit.test.js`, `node tests/auth-notifications.test.js` | Exit 0 each |
| `node tests/server-role-bot.test.js`, `node tests/server-workspace-discovery.test.js`, `node tests/server-role-preview.test.js`, `node tests/company-role-policy.test.js`, `node tests/guild-member-settings.test.js`, `node tests/database-pool.test.js` | Exit 0 each; bot/discovery/pool checks rerun after the final F1 storage/join change |
| `tests/account-merge.test.js`, `tests/api.test.js`, `tests/server-role-titles.test.js` on guarded disposable DB | Exit 0 each; API 44 checks, account merging and role authority retained |
| `node --check` on nine changed JavaScript files; scoped `git diff --check` and new-file whitespace inspection | Passed |

Database commands set process-only `MEGU_TEST_DATABASE_URL` and `MEGU_DATABASE_URL` to `postgresql://megu_security@127.0.0.1:55445/megu_security_test`; each owning check first uses `ensureTestDatabase(resolveTestDatabaseUrl())`. The owned cluster initially required sandbox escalation to start and then an explicit dedicated-port restart; the first connection attempt was refused on 55445 before that correction. All final checks used the dedicated disposable cluster. A final test-strengthening edit duplicated a `const winner` declaration; syntax caught it, the duplicate was removed, and all nine syntax checks and four focused suites passed on the final sources. OAuth exchanges and Discord authority use controlled substitutes; no live provider or retained database operation occurred. The owned test process is stopped at closure. No full release suite/build/browser matrix was repeated.

Changed files in this follow-up: `backend/web/web.js`, `backend/bot/bot.js`, `backend/database/database.js`, `adapters/http/pg-session-store.js`, `tests/console-authorization.test.js`, `tests/discord-oauth-session.test.js`, `tests/session-store.test.js`, `tests/console-role-settings.test.js`, `tests/run.js`, `COMPANY_IMPLEMENTATION_STATUS.md`, `PRE_RELEASE_AUDIT.md`. Existing mixed changes were preserved; no checkpoint/staging/push.

Residual risks/checks: another independent verification must establish closure of F1/F3. Deployed PostgreSQL privileges must allow the claim table/index creation; all callback workers must be upgraded before deployment relies on this invariant, since old workers do not consume claims. Remote Discord authority/mutation cannot be atomic; permission/hierarchy revocation still needs deployment verification. JSON fallback lock contention fails closed, and a crash can leave an operator-cleanup lock; confirm no live writer before removal. Live OAuth redirect configuration/provider behavior and deployment remain unverified. F4–F8 and deployment-only findings are unchanged.

### First remediation batch — 27 September 2026 (historical)

The original audit descriptions below are retained. The first batch reported **F1, F2 and F3 REMEDIATED locally**; subsequent independent verification superseded that claim for F1/F3 as recorded above. F2 is independently VERIFIED REMEDIATED. This historical record is not deployment approval or a renewed full release audit. F4–F8 remain open and were not changed by this batch.

**F1/F2 authorization changes:** `adapters/discord/console-authorization.js` is the shared Discord verification boundary used by `backend/web/web.js` and the role IPC handlers in `backend/bot/bot.js`. Protected console requests refresh the guild and role definitions and force-fetch the authenticated Discord member. Session guild lists are discovery metadata, not permission evidence. General console management requires current owner/Administrator/Manage Server authority; member routes require current membership; role routes require current owner/Administrator/Manage Roles authority. The caller ID is taken from the trusted session independently of request-body fields. Role mutations reverify the caller and bot, force-fetch the target, and enforce caller, target and bot hierarchy using Discord's role comparator, including equal-position ordering. Owner authority bypasses caller hierarchy only; it does not bypass bot restrictions or protected targets. Batch replacement preserves managed roles and existing roles outside authority, while unauthorized requested assignments fail rather than being silently filtered. Outages, missing callers and unverifiable evidence deny access.

Automatic-role and reaction-role configuration use the same boundary to prevent indirect privileged assignments. Every grant configuration change requires current Manage Roles authority; newly granted/enabled roles must be below caller and bot hierarchy. Deleting/disabling stale or protected mappings remains possible without granting a role. Unchanged role settings remain compatible with legitimate Manage Server-only configuration updates. Existing team approval/consent and automatic synchronization contracts were not changed.

**F3 retirement:** Both unused `/api/auth/legacy/discord` registrations and their parallel `oauth2State` flow were removed. Scoped application/configuration references showed no dependency on these routes; the configured local callback path is `/api/auth/callback`. The current `/api/auth/callback` and `/api/auth/discord/callback` implementation remains intact, including session-bound request expiry/consumption, login session regeneration and account-link continuity.

**Focused regression evidence:** New runnable suites `tests/console-authorization.test.js` and `tests/discord-oauth-session.test.js` execute the actual web guards/routes and bot handlers with mocked Discord/OAuth dependencies. Both are registered in `tests/run.js`.

| Verification | Actual result |
| --- | --- |
| `node tests/console-authorization.test.js` | Exit 0; 106 checks, including self-assigned Administrator reproduction, Manage Server-only/no Manage Roles rejection, trusted identity, populated-session demotion/departure, private-read downgrade, hierarchy/tie ordering, protected targets, bot capability/hierarchy, authorized owner/admin/role-manager operations, single/batch and create/update/delete paths, outages, delegated grants and stale-mapping cleanup |
| `node tests/discord-oauth-session.test.js` | Exit 0; legacy retirement, absent/mismatched/expired/replayed request rejection before exchange, current login/linking, both callback aliases, session regeneration failure and linking-account changes |
| `node tests/discord-oauth.test.js`, `node tests/rate-limit.test.js`, `node tests/auth-notifications.test.js` | Exit 0 for each; OAuth response/proxy behavior, 16 block-guard checks and credential/channel contracts |
| `node tests/server-role-bot.test.js`, `node tests/server-workspace-discovery.test.js`, `node tests/server-role-preview.test.js`, `node tests/company-role-policy.test.js` | Exit 0 for each; existing fresh-evidence, consent/policy, discovery and preview boundaries preserved |
| `node tests/guild-member-settings.test.js`, `node tests/server-tabs-ui.test.js`, `node tests/server-role-preview-ui.test.js` | Exit 0 for each; 18 existing member/settings checks and relevant UI contracts |
| `tests/session-store.test.js`, `tests/account-merge.test.js`, `tests/api.test.js`, `tests/server-role-titles.test.js` on the isolated local database | Exit 0 for each; 9 persistent-session checks, identity/merge preservation, 44 API authorization checks and role-title live authority/revision/outage checks |
| Syntax checks for both server files, the new authorization module, both new tests and `tests/run.js`; scoped `git diff --check` | Passed |

Database suites used a newly initialized disposable PostgreSQL instance on loopback port 55445, with `MEGU_DATABASE_URL=postgresql://megu_security@127.0.0.1:55445/megu_security_test`. Each database check called `ensureTestDatabase(resolveTestDatabaseUrl())` before loading its suite. The initial unconfigured session-store invocation failed to connect; rerunning with the guarded disposable database passed. No existing historical database instance or production database was modified. The owned test instance was stopped after verification.

The separate read-only candidate review found a stale-role cleanup regression; it was corrected and protected by runnable tests. Final scope inspection preserved unrelated routes and pre-existing changes. No tests were weakened. No full release audit/build, live Discord mutation, live OAuth exchange or production deployment was performed. Live Discord revocation/hierarchy behavior, API load/rate-limit characteristics and deployed OAuth redirect registration remain deployment checks. Discord authority and mutation cannot be made atomic across the remote API; checks occur in the shared mutation handler before execution. Cached discovery labels may remain until discovery refresh, but do not authorize protected reads or writes.

## Findings summary

| Severity | Count | Findings |
| --- | ---: | --- |
| BLOCKER | 1 | F1 |
| HIGH | 2 | F2, F3 |
| MEDIUM | 4 | F4, F5, F6, F7 |
| LOW | 1 | F8 |
| Total | 8 | |

## Blockers

### F1 — Server managers can grant themselves Administrator

- **Severity:** BLOCKER.
- **Affected flow:** Server → member role management.
- **Finding:** Manage Server-only accounts can invoke role-management operations, and role eligibility is checked against the bot's hierarchy instead of the authenticated caller's authority and hierarchy.
- **Evidence:** `manageableGuilds` admits Manage Server permission (`0x20`) as console authority. `requireAdminGuild` accepts membership in that cached list. The member-role endpoint forwards the caller's display name without their identity or permission proof. The bot's batch handler filters requested roles using `botHighest` and then calls `member.roles.set`.
- **Relevant files:** `backend/web/web.js:528` (`requireAdminGuild`), `backend/web/web.js:730` (`manageableGuilds`), `backend/web/web.js:2158` (member-role endpoint), `backend/bot/bot.js:3109` (batch role handler), especially `backend/bot/bot.js:3135` and `backend/bot/bot.js:3140`.
- **User impact:** A Manage Server-only user can assign themselves an existing Administrator role below the bot, even without Manage Roles or sufficient personal hierarchy.
- **Reproducibility:** Confirmed with unchanged middleware and bot-handler source and mocked Discord objects. No live role assignment was attempted. The relevant authorization implementations are unchanged from HEAD. Exploitation requires an assignable privileged role below the bot and a bot capable of assigning it.
- **Smallest safe fix:** Forward the authenticated caller's Discord ID from the trusted session and verify fresh caller permissions, caller hierarchy, target hierarchy, and bot constraints before role mutations. Apply the shared guard to sibling role mutation paths.
- **Required verification:** Reject Manage Server-only callers, removed permissions, roles above the caller, and protected targets. Verify legitimate operations and owner exceptions as applicable. Verify both batch and single-role mutations, and role create/update/delete paths.

## High findings

### F2 — Revoked Discord permissions remain usable

- **Severity:** HIGH.
- **Affected flow:** Server settings, roles, member lists, audit logs, and other console operations.
- **Finding:** Populated session guild lists remain authorization evidence without a current Discord verification.
- **Evidence:** `ensureDiscordGuilds` returns immediately when `adminGuilds` and `allGuilds` exist. `requireAdminGuild` and `requireGuildAccess` authorize using those cached lists. Destructive bot handlers do not independently verify the caller.
- **Relevant files:** `backend/web/web.js:492` (`ensureDiscordGuilds`), `backend/web/web.js:528` (`requireAdminGuild`), `backend/web/web.js:546` (`requireGuildAccess`), `backend/web/web.js:1316` (console restoration middleware), and affected mutation handlers in `backend/bot/bot.js`, including `backend/bot/bot.js:2888` and `backend/bot/bot.js:3109`.
- **User impact:** Someone removed from a server or demoted can retain console access until another refresh or session expiry, including protected reads and destructive actions.
- **Reproducibility:** Confirmed from the current guards and an isolated middleware check admitting cached authority without a live permission query. Actual Discord demotion was not performed. The console authorization guard is unchanged from HEAD.
- **Smallest safe fix:** Verify current membership and operation-specific authority before protected reads and mutations. Deny access when required verification is unavailable. Share the mutation verification boundary with the F1 fix.
- **Required verification:** Log in, revoke authority, then attempt direct API reads and writes without logging out. Cover departure, demotion, populated sessions, Discord outages, and valid current access.

### F3 — Legacy OAuth callback accepts unsolicited state

- **Severity:** HIGH.
- **Affected flow:** Direct access to the legacy Discord login callback.
- **Finding:** The legacy callback permits a nonempty supplied state when there is no stored OAuth state in the session.
- **Evidence:** The guard is `if (!state || (req.session.oauth2State && state !== req.session.oauth2State))`. It rejects mismatches only when stored state exists. Successful processing replaces the session's account. The active current callback requires a matching request and checks expiry.
- **Relevant files:** `backend/web/web.js:1001` (legacy callback registration), `backend/web/web.js:1004` (weak state guard), `backend/web/web.js:1029` (state consumption), and the session-establishment code later in that callback. Compare `backend/web/web.js:878` for current validation.
- **User impact:** Login CSRF/session swapping is possible with a valid attacker-controlled authorization code. This is not a demonstrated arbitrary account takeover.
- **Reproducibility:** The exact predicate was evaluated in memory: absent stored state permits a nonempty unsolicited state; mismatched stored state rejects it. No OAuth exchange was performed. The weak guard is unchanged from HEAD.
- **Smallest safe fix:** Retire the unused legacy callback, or require a matching, unexpired, single-use, session-bound OAuth request. Keep the current login/linking path intact.
- **Required verification:** Reject absent, mismatched, expired, and replayed state before token exchange. Confirm current login and account linking, including account changes during linking.

## Medium findings

### F4 — Team archive confirmation omits permanent goal consequences

- **Severity:** MEDIUM.
- **Affected flow:** Team settings → archive → restore.
- **Finding:** Archiving ends unfinished goal workflows, but the confirmation describes a pause until the team is restored.
- **Evidence:** `archiveForTeam` changes unfinished goal versions to lifecycle `archived`. `restoreTeam` restores the team and rebuilds project reminders without restoring those goals. English and Thai archive copy describe team/project changes pausing until restoration without explaining the goal consequence.
- **Relevant files:** `core/team-goal-lifecycle.js:29`, especially `core/team-goal-lifecycle.js:36`; `core/teams.js:842` (`archiveTeam`); `core/teams.js:865` (`restoreTeam`); `app/components/teams/TeamManage.js:281`; `app/copy/en.js:841`; `app/copy/th.js:840`.
- **User impact:** An owner can unintentionally end ongoing goal workflows while expecting a reversible pause. Goal history remains stored; this is not a demonstrated deletion of goal data.
- **Reproducibility:** Confirmed by executing the current archive/restore implementations against in-memory state: the unfinished goal remained archived after team restoration.
- **Smallest safe fix:** Explicitly warn in both languages that unfinished goals remain archived after team restoration. Preserve private-content boundaries if adding impact counts. Do not silently resurrect archived goals or their consent.
- **Required verification:** Confirm the warning and cancellation path in both languages. Archive and restore a team containing unfinished goals, confirm the disclosed lifecycle outcome, and verify history remains retained.

### F5 — Creation retries can produce duplicate workspaces

- **Severity:** MEDIUM.
- **Affected flow:** Project/team creation after a lost response; project submission while pending.
- **Finding:** Creation lacks durable retry deduplication. Project creation also lacks the immediate submission latch used by team creation.
- **Evidence:** `createProject` generates fresh IDs and accepts no creation receipt/request key. `createTeam` similarly inserts a new team without creation retry deduplication. `CreateProject` sets React busy state without an immediate latch; submitted text fields remain editable while pending. Team creation has a client latch, but it is cleared after a failed/ambiguous response and cannot deduplicate a committed server request.
- **Relevant files:** `core/projects.js:329`, `core/projects.js:360`; `core/teams.js:186` and `core/teams.js:206`; `adapters/http/megu-api.js:1208` and `adapters/http/megu-api.js:1364`; `app/components/projects/CreateProject.js:27`; `app/components/teams/TeamDirectory.js:78` onward.
- **User impact:** A committed request whose response is lost can be retried into another project/team. Edits made during project submission can also be lost when the submitted creation succeeds and navigation occurs.
- **Reproducibility:** Replaying identical project input produced two IDs and two insert attempts using the current service implementation in memory. Team replay risk is source-confirmed; no real duplicate rows were created.
- **Smallest safe fix:** Add a stable creation request key with server-side receipts and retain it through ambiguous retries. Add an immediate project submission latch and freeze submitted fields. A deliberate new creation must receive a new key.
- **Required verification:** Double submission, lost acknowledgement followed by retry, changed payload with the same key, intentional creation with a new key, and field/submission recovery on validation failures. Cover both team and project creation.

### F6 — Console POSTs lack same-origin CSRF enforcement

- **Severity:** MEDIUM, conditional on an attacker-controlled same-site sibling origin.
- **Affected flow:** Destructive server-console actions.
- **Finding:** Authenticated console mutations accept simple forms without shared Origin/CSRF validation.
- **Evidence:** The application parses URL-encoded forms globally. Console routes such as role deletion have no Origin/CSRF checks. Session cookies use `SameSite=Lax`, which does not distinguish same-site sibling origins.
- **Relevant files:** `backend/web/web.js:144` (form parser), `backend/web/web.js:235` (cookie policy), and `backend/web/web.js:2107` (role deletion), with other authenticated console POST routes sharing the same boundary.
- **User impact:** An attacker controlling a same-site sibling origin can submit authenticated forms that trigger console actions. The finding does not establish unrestricted cross-site exploitation or prove that such a sibling origin exists in production.
- **Reproducibility:** Source-confirmed. Exploitation requires the stated origin foothold and a valid victim session. No destructive browser request was sent.
- **Smallest safe fix:** Apply shared same-origin validation or CSRF protection to authenticated mutations, preserving intended legitimate clients.
- **Required verification:** Reject sibling-origin forms and cross-site requests, verify handling of missing/invalid origin evidence, and allow legitimate same-origin actions.

### F7 — Remote database certificate verification is disabled

- **Severity:** MEDIUM; deployment exposure remains unverified.
- **Affected flow:** Core and legacy PostgreSQL connections.
- **Finding:** Remote database TLS connections do not authenticate the server certificate.
- **Evidence:** Both relevant pools use `rejectUnauthorized: false` for their TLS configuration.
- **Relevant files:** `core/db.js:43`; `backend/database/database.js:42`.
- **User impact:** An active network interception can expose database credentials and data when these settings are used for remote connections. No interception or production exposure was demonstrated.
- **Reproducibility:** The configuration is confirmed in current source. Remote certificate behavior was not tested against production.
- **Smallest safe fix:** Configure the database provider's trusted CA and enable certificate verification, preserving appropriate local database behavior.
- **Required verification:** Accept the intended certificate and reject an untrusted certificate. Check both pools and local development/test connection behavior.

## Low findings

### F8 — Custom listboxes have incomplete keyboard semantics

- **Severity:** LOW.
- **Affected flow:** Team/server selectors, ownership selection, and role configuration.
- **Finding:** The shared selector advertises listbox/option semantics without expected focused-option navigation or an accessible name on the listbox itself.
- **Evidence:** Keyboard handling supports Escape, but not arrow/Home/End option navigation. Options are individually tabbable buttons. The listbox has `role="listbox"` and `tabIndex="-1"` without its own accessible name.
- **Relevant files:** `app/components/CustomSelect.js:57`, `app/components/CustomSelect.js:154`, and `app/components/CustomSelect.js:164`.
- **User impact:** Selection remains possible through Tab and button activation, but behavior differs from expected listbox interaction, especially for keyboard and assistive-technology users.
- **Reproducibility:** Source-confirmed; no fresh screen-reader session was performed.
- **Smallest safe fix:** Add an accessible listbox name and focused-option keyboard navigation in the shared component.
- **Required verification:** Keyboard-only selection, arrow/Home/End behavior, Escape/focus return, search, disabled states, and a screen-reader check.

## Security / authorization assessment

Release is blocked by F1. F2 and F3 are separate serious existing risks. F6 and F7 describe additional conditional security exposure.

No issue was found in the inspected current OAuth expiry/linking/session-regeneration path, production exclusion of development login, team owner/admin/member boundaries, private project membership boundaries, or private goal content separation. The goal access check passed independently and confirmed that unrelated managers receive administration metadata rather than private content.

New role-mapping flows establish separate server authority and team-owner approval. Automatic sync requires current evidence, checks ownership/consent and lease/revision conditions, and preserves membership when evidence is unavailable or partial. These stronger checks do not protect the separate legacy console mutation paths in F1/F2.

OAuth credentials are encrypted using AES-256-GCM in `core/auth/credential-vault.js`; storage routing is in `core/oauth-credentials.js`. No encryption defect was found in the inspected implementation.

## Data / migration assessment

- Schema installation in `core/schema.js:1017` runs transactionally under an advisory lock.
- Fresh installations avoid creating retired Company storage; existing Company storage is maintained when present.
- `core/company-access.js` retains Company eligibility restrictions. Disabling Company screens does not bypass them.
- Team/project ownership transfer requires an eligible recipient and explicit acceptance. Manual membership provenance protects ownership from role-source retirement.
- Member removal protects team/project owners, revokes applicable memberships, removes assignments, and reconciles goal eligibility within the relevant transaction.
- Goal mutations use revision/version checks and locking. Published versions/history remain retained.
- `core/server-role-reconciliation.js` checks mapping revisions and job lease ownership before applying work.
- Existing durable rollback evidence reports committed Company retirement observed separately and native backup recovery of exact populated rows/constraints on disposable data. The recorded backup SHA-256 is `a20a944c0ee60eb47c9c8380e2268487986201657ef0067a0dfec9a505ebdd2f`.

No additional integrity defect was found in those inspected paths. F4 concerns undisclosed lifecycle consequences and F5 concerns duplicate creation. Production data compatibility, migration privileges, and a real production restore remain unverified.

Relevant migration/recovery evidence: `.tmp/company-durable-rollback.log`, `tests/company-retirement-durable.test.js`, `tests/company-retirement-rehearsal.test.js`, `scripts/company-retirement-preflight.js`, and `scripts/company-retirement-rehearsal.js`. The scripts were inspected, not executed in this audit.

## UX / accessibility assessment

The audit reviewed navigation/context, confirmations, loading/error/retry behavior, bilingual copy, draft protection, responsive styling, and keyboard/focus implementation. Independently rerun focused checks passed for shared navigation, draft links/history/unload behavior, goal detail/privacy, team contracts, bilingual copy, and role preview states.

Retained browser records cover English/Thai, light/dark themes, and mobile/tablet/desktop. Three archive-review screenshots were inspected:

- `.impeccable/review/workspace-ux/archive-review-th-dark-390.png`
- `.impeccable/review/workspace-ux/archive-review-en-light-768.png`
- `.impeccable/review/workspace-ux/archive-review-en-dark-1440.png`

No overflow or obscured archive actions were evident in those captures. They are retained synthetic-API evidence, not fresh live end-to-end verification. F4, F5, and F8 remain the reported UX/accessibility issues. Full assistive-technology compliance was not established.

## Build / test status

### Independently executed during this audit

| Check | Actual result |
| --- | --- |
| `tests/team-workspace-ui.test.js` | Exit 0; EN/TH navigation, focused bounded projects, cursors, empty metrics, authorization/loading/error states, selector navigation |
| `tests/workspace-draft-guard.test.js` | Exit 0; EN/TH links/history/unload, cancellation, grouped drafts, in-flight protection, release and cleanup |
| `tests/team-goal-detail-ui.test.js` | Exit 0; EN/TH version/history navigation, measurement semantics, proposal/administration privacy |
| `tests/teams-contract.test.js` | Exit 0; roster, dual access, team-project UX and account-navigation contracts |
| `tests/copy.test.js` | Exit 0; bilingual copy check |
| `tests/team-goal-access.test.js` | Exit 0; feature gate, subject/reviewer content, manager metadata, revoked/ordinary-member denial |
| `tests/server-role-preview-ui.test.js` | Exit 0; EN/TH account states, restoration confirmation, stale approval disabled |
| Current `git diff --check` | Passed; no whitespace defects reported |

The isolated finding reproductions confirmed F1, the cached-authority admission underlying F2, the weak state guard in F3, project replay in F5, and archive/restore behavior in F4. These are source-backed mock checks, not production integration tests.

### Latest known existing evidence inspected

| Check | Recorded result and evidence |
| --- | --- |
| Broad regression | 93 suite headers matched the 93 registered suites; `All suites passed in 48.13s`; `.tmp/ux-final-regression.log`, timestamp 27 September 2026 13:36:44 |
| Contrast | `Every pair meets its target.` in `.tmp/ux-final-regression.log` |
| Production build | Compilation, static page generation, and final optimization completed; `.tmp/ux-finish-build.log`, timestamp 27 September 2026 13:45:05 |
| Later frontend contracts | `.tmp/ux-final-shortcuts.log`, `.tmp/ux-final-goal.log`, `.tmp/ux-final-copy.log`, `.tmp/ux-finish-project.log`, and `.tmp/ux-finish-team.log` report passes; the copy record reports 25 checks passed |
| Workspace UX browser | 140 EN/TH light/dark mobile/tablet/desktop captures; navigation, invitation recovery, context/shortcuts, transfer review, archive cancellation, save feedback, creation draft/submission/cancel safeguards; `.tmp/ux-finish-ux-browser.log` |
| Automatic roles browser | 48 EN/TH light/dark mobile/desktop captures; uncertain receipts, separate authority, partial holders, ownership/outage attention, consent, draft protection and access loss; `.tmp/ux-finish-roles-browser.log` |
| Goal workflow browser | 72 EN/TH light/dark 390/768/1440 captures; acceptances, evidence, review/return, stale publication recovery, immutable published UI, responses, privacy and access loss; `.tmp/ux-finish-goal-browser.log` |
| Project Insights browser | 36 EN/TH light/dark 390/768/1440 captures; header parity, unknown-history denominator, source-topic filter URL/reload behavior and empty-topic metrics; `.tmp/ux-finish-insights-browser.log` |

The latest browser records total 296 captures. They use synthetic APIs and were not rerun. The three inspected captures are a subset, not independent visual inspection of all 296 images.

No dedicated lint/typecheck scripts exist in `package.json`. The successful build's TypeScript phase is not evidence of comprehensive JavaScript type checking. The existing test runner creates/deletes database rows, and browser scripts write screenshot artifacts; neither was rerun during this read-only audit.

Freshness is based on source/log modification timestamps and relevant source review, not an immutable source hash. No inspected application source file was newer than the final recorded build.

## Repository / release hygiene

- Audit-time working tree: 56 modified tracked files and 126 untracked entries, before adding this document.
- Historical voice/database changes coexist with release changes. Examples include `backend/bot/voice_connection.js`, `adapters/health/health-log.js`, `backend/database/database.js`, `core/db.js`, and `VOICE_DATABASE_RESTART_INCIDENT_PLAN.md`. Their presence does not establish release ownership.
- Essential application code and tests are untracked. A tracked-only release would omit functionality; define the intended release file set explicitly.
- `.tmp`, `.impeccable`, `temp`, local logs, `.env`, build outputs, and other local artifacts are ignored by `.gitignore`.
- `config.json` is tracked, but its inspected keys/content contained no secret fields. `.env` credentials were not printed or inventoried.
- A scoped credential-pattern search across application source, scripts, tests, README, and configuration found no matches. This does not prove that no secret exists anywhere in the repository or history.
- No relevant TODO/FIXME/debugger markers were found in the inspected release paths.
- `/api/megu/companies` returns disabled status and all four prototype Company pages call `notFound`. Compatibility services/restrictions remain intentionally active for retained data; they are not evidence that Company workspaces are available.
- README documents project/team feature flags but omits the separate Goals and automatic-role-sync opt-ins. Deployment instructions should explicitly record `MEGU_TEAM_GOALS_ENABLED` and `MEGU_TEAM_ROLE_SYNC_ENABLED`, together with relevant project/team/Discord flags.
- Existing status/verification claims are evidence references, not overrides for these independently reproduced findings.

## Deployment-only checks

These checks were not completed locally and are not implied by passing synthetic or in-memory tests:

1. Live Discord authority removal, caller hierarchy, target hierarchy, bot hierarchy, and member-intent approval.
2. OAuth redirect registration/configuration and removal or hardening of the reachable legacy callback.
3. Production feature-flag consistency across frontend build, web process, and bot process, including Goals and automatic sync.
4. HTTPS/proxy/session-cookie behavior, stable session secrets, credential encryption keys, and exposure to attacker-controlled same-site sibling origins.
5. Actual database CA/certificate validation, migration privileges, existing-data compatibility, backup availability, and a verified restore.
6. Real notification delivery, consent/recipient rechecks, worker restart recovery, and concurrent instance behavior.
7. Real-account browser flows against the deployed APIs, including direct unauthorized routes, creation retries, membership/ownership changes, archive consequences, and reload/history behavior.

Local automated regression checks for the findings should precede these deployment checks. Production verification must not use destructive test fixtures or assume that local disposable-database safeguards authorize production operations.

## Ordered remediation plan

1. **F1/F2: fix the shared console authority boundary.** Enforce fresh operation-specific caller permissions and hierarchy, propagate authenticated caller identity, and protect affected reads as well as sibling mutation paths. Verify rejection cases before any live role-management pilot.
2. **F3: retire or harden the legacy OAuth path.** Reject callbacks without a valid session-bound request before token exchange. Preserve current login/linking behavior.
3. **F6: enforce same-origin/CSRF protection for authenticated mutations.** Centralize the boundary and verify simple forms as well as JSON requests.
4. **F7: enable remote database certificate authentication.** Configure the provider CA coherently for both pools and verify valid/untrusted certificates plus local behavior.
5. **F5: make creation retry-safe.** Add durable request receipts for project/team creation, then wire stable frontend request keys and the immediate project latch/frozen submitted fields. Do not rely solely on disabling the submit button.
6. **F4: disclose archive consequences accurately.** Update English/Thai review copy to explain unfinished goals remain archived after restoration, preserving private-content boundaries and cancellation.
7. **F8: complete shared selector keyboard semantics.** Add the accessible name and focused-option navigation without redesigning the surrounding UI.
8. **Verify the affected dependency closure and assemble the release.** Run focused security/lifecycle/retry/accessibility checks, affected integration/concurrency tests, the appropriate broader suite, production build, and real deployed flows. Select intended release files and record deployment flags; leave unrelated historical work untouched.

The plan proposes fixes only. No step has been implemented by this audit or by creation of this document. It contains no unrelated cleanup or redesign work.

## Verified areas with no findings

Within the stated source/test evidence and limits, the following important areas did not reveal an additional issue:

- Current OAuth request expiry, linking-account checks, and login session regeneration.
- Production exclusion of development login and encrypted OAuth credential storage.
- Team owner/admin/member separation, owner protection during removal, and recipient acceptance for ownership transfer.
- Private project access requiring applicable project and team membership; retained Company eligibility restrictions remain enforced.
- Goal subject/reviewer private content and unrelated-manager metadata separation; the independent goal access check passed.
- New role-mapping separation of server authority and owner consent, current-evidence requirements, and unavailable/partial-evidence preservation.
- Membership source provenance, manual retention safeguards, and suppression against unintended role-based resurrection.
- Transactional schema installation, revision/version guards, retained goal history, and role worker revision/lease fencing.
- Shared workspace navigation, bounded project reads, loading/error/retry states, draft cancellation/history/unload protection, and bilingual copy contracts covered by the passing focused checks.
- Responsive archive actions in the three inspected mobile/tablet/desktop screenshots.
- Project Insights handling of empty projects and unknown completion history in inspected source and existing verification records.
- Current whitespace check and the scoped TODO/debugger/credential-pattern searches.

These statements do not negate F1–F8 or certify uninspected paths, live integrations, or deployment configuration.
