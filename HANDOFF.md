# Megu — handoff

Branch: `main`

## Voice QoL controlled release — pre-commit verification PASS, 3 October 2026

The user confirms the independent **VOICE QOL RELEASE GATE PASS** and authorizes exactly one release commit. The authoritative 27-file manifest below/in COMPANY_IMPLEMENTATION_STATUS.md remains unchanged: 22 modified tracked files and five required new files. All application/test file fingerprints remained unchanged during final verification; only these two approved records receive this release checkpoint. No future custom Waiting Room template, configured-text TTS wrapper or /say templating implementation is included.

Final scoped verification: **18 focused suites PASS** (voice-qol-settings, voice-connection, voice-remote-control, voice-batching, voice-announce, audio-queue, youtube-audio, console-authorization, rate-limit, legacy-audit-schema, server-tabs-ui, copy, postgres-tls, database-pool, reminder-delivery, reminder-persistence, project-workflow-notifications, discord-invite-permissions). Completed checks were reused without source changes after interruption. The additional reminder/workflow DB checks initially encountered local ECONNREFUSED; after the user restarted the existing disposable container, both passed. The existing destination guard plus independent driver host=127.0.0.1 and exact megubot_workflow_test/_test checks passed without exposing credentials; no production DB was contacted. Fresh/additive/idempotent audit bootstrap and real writer checks passed with retained disposable history/settings. All 25 release JavaScript files parsed; whitespace and scoped credential/private-key/debug/pilot-ID/artifact review passed. Earlier production build and rendered/pilot evidence remain valid because relevant implementation is unchanged.

Production readiness: user-confirmed Render Auto-Deploy OFF/manual, FRONTEND_URL=https://megubot-reborn-67.onrender.com and unchanged settings/environment. **Current PostgreSQL/TLS, Discord, TTS/provider, reminder and workflow-notification runtime health remain PENDING read-only log verification**; last completed smoke was healthy but is not fresh evidence. No authenticated Render tab is available to the agent. No new production variable or manual SQL is required; additive audit_logs.action_type bootstrap runs on normal application startup. Do not infer permission to change settings or deploy.

Next: stage only the exact approved manifest, inspect the index, create/verify one commit, then STOP for explicit authorization to push that exact SHA to origin/main. Nothing has been pushed/deployed during this release preparation. Preserve unrelated .gitignore, app/companies/, private environments and generated local evidence; never stage them. After authorized push, use user-operated manual Render deployment of the matching SHA and passive startup/runtime/public smoke only. Process-local coordination, post-acknowledgement external moves and provider/network timing limitations remain unchanged; no distributed/exactly-once claim.

## Voice QoL isolated live pilot — COMPLETE / PASS, 3 October 2026

All remaining approved live cases PASS, user-observed, on isolated corrected MeguBot#0670 / 127.0.0.1 megubot_workflow_test. ONE controlled keeper /join retry reached Ready/acknowledged Lijiang Tower (China), no duplicate connection/subscription/queue/abort/error. Two-human Waiting Room burst at 1000ms grouped once/both names once; initial split was user-confirmed timing error. Fresh entries approximately two seconds apart separated at 500ms and grouped once at 3000ms, names correct/no generic duplicate/no move/errors. Local saves/reloads/cache refresh confirmed. Initial 3000ms NO name flags were user-corrected reporting error. Same-room Waiting Room precedence produced one Waiting Room clip without generic duplicate.

Original ห้องรอติดต่อ and 1000ms restored; save/reload/cache refresh confirmed, bot remained in playback VC, all other settings unchanged. At least two minutes quiet with no new event: no reconnect/join loop, duplicate/stuck audio, stale timer/waiter/listener warning, oscillation, retry/error flood, provider or audit/database error. No remaining unexecuted approved live case or reproducible defect. No repeated earlier PASS tests; no code change, test/build/DB rerun, runtime restart by agent, fixture deletion, staging/commit/push/deploy or production action. Detailed evidence/limits in current COMPANY_IMPLEMENTATION_STATUS.md. Main HEAD 6c5f70db518b36ce443895b650489c35daec39fb; mixed tree/index empty/unrelated work preserved.

**Next: independent RELEASE-GATE review**, not deployment/commit approval. Preserve running isolated setup/disposable DB/evidence. Process-local and provider/cache limitations remain; live observations are user-reported, exact timing/race/listener counts remain deterministic coverage. Original audit FAIL/remediation/PASS and prior pilot history follow unchanged.

## Voice QoL approved pilot checkpoint — 3 October 2026

- **Same-room Waiting Room precedence PASS**, user-observed: temporary Waiting Room=playback Lijiang Tower save/reload/cache refresh acknowledged; 3000ms retained, all other settings unchanged. One mover genuinely entered; exactly one Waiting Room clip/name once, no extra generic join clip, bot stayed put and no queue/provider/voice/runtime error. Participant label/display-name variation does not establish identity failure; user explicitly confirmed the mover name once. Next action is restoring original room ห้องรอติดต่อ and 1000ms window, then at least two minutes of quiet observation. No source change or release action.

- **3000ms live new-batch demonstration PASS**, clarified by user with runtime two-member Waiting Room text: local-only 3.0s save/reload/cache refresh acknowledged; fresh entrants roughly two seconds apart yielded exactly one grouped clip, both names once, no generic duplicate, bot stayed put, no queue/provider/voice/runtime error. Earlier NO name checks and placeholder transcript were user-confirmed observation/reporting error, not a defect; no event was repeated for clarification. Together with 500ms separate clips at comparable spacing, both configured values are demonstrated qualitatively without invented measured timings. Next: temporarily set Waiting Room=playback VC for duplicate-prevention check, then restore original room and 1000ms window and observe quietly.

- **500ms live new-batch demonstration PASS:** local-only window save/reload retained 0.5s and user explicitly confirmed bot cache refresh. Two fresh Waiting Room entrants separated by roughly two seconds produced two separate one-member clips, each name once; bot stayed in playback VC, no generic duplicate or observed queue/provider/voice/runtime error. Timing is user-observed approximate, not a measured latency claim. All other settings unchanged. Next: save/refresh 3.0s, then fresh entries with comparable spacing. Original 1000ms setting must be restored at closure.

Latest remaining-case evidence: **two-person Waiting Room grouping PASS**, user-confirmed controlled retry within configured 1000ms. Exactly one grouped clip/both names once/no generic duplicate, bot stayed in playback VC and no observed queue/provider/voice/runtime error. First split attempt user-confirmed timing error; exact event timestamps were not recovered and are not claimed. Next: 500ms/3000ms fresh-batch demo, same-room duplicate prevention, setting restoration and final quiet observation. No implementation change or release action.

Latest live evidence: **ONE controlled /join retry PASS**, after user-confirmed restart on corrected isolated working tree/local disposable DB. Bot MeguBot#0670 joined keeper’s 🗣Lijiang Tower (China); Ready and target acknowledgement observed, destination matched, no duplicate connection/subscription/queue/ABORT_ERR/timeout/runtime error. No second retry/other event. Next: confirm two consenting movers and keeper for remaining grouping; no prior case repeated. No commit/push/deploy/production action.

Independent target-concurrency recheck **PASS**, user-confirmed; original reconnect/stale-session/audit-schema PASS preserved. Exactly ONE controlled keeper /join retry authorized, only on the refreshed isolated MeguBot#0670 / loopback megubot_workflow_test. Preflight freshness/disconnected bot/keeper placement awaits user confirmation. No retry or previous-case repetition yet. After success only: remaining Waiting Room grouping/window/same-room cases, restoration and quiet observation. No release action. Historical recheck FAIL/remediation record follows unchanged.

## Voice QoL target concurrency — 3 October 2026

**REMEDIATION COMPLETE — narrow independent recheck REQUIRED; pilot remains PAUSED.** Latest Auditor FAIL identifies only target-change concurrency; original 4014 same-target recovery and all audit-bootstrap work independently PASS and remain untouched. A Ready connection can still refer to the old acknowledged channel; the previous Ready-only wait released the guild queue too early. Exact actual /join + installed-driver delayed A→B→A regression reproduced false B success and final B before the correction.

The existing per-guild FIFO now waits for native Discord.js bot voice-state acknowledgement plus Ready/current target/session before releasing the next target. Initiated transitions need a new matching bot event; healthy same-target reuse remains immediate. Same adjacent target requests coalesce; distinct targets stay ordered, with no global lock/generation/sleep/retry platform. Actual /join freshly verifies its target before replying; a changed destination gets the existing clean failure response. One existing 15-second deadline; listeners/timer/failed connection and queue entry are cleaned, preserving causes and preventing duplicate destruction.

Fresh **6 focused suites PASS**, including 15 lifecycle/actual-command checks: exact held-B A→B→A ends A with no false success/duplicate object/leaks; A→B awaits ack; A→B→C ends C and ignores an old-target update; same-target joins coalesce; failed transitions recover; other guilds remain independent; original reconnect/player/error/stale-session safeguards stay green. Remote/Waiting Room no-auto-join, batching, announce, queue and YouTube tests PASS. Five parsers, whitespace and credential/artifact review PASS. No schema/DB/UI/build rerun or alteration required. Detailed evidence and six changed files in latest COMPANY_IMPLEMENTATION_STATUS.md section.

Next: independent narrow target-acknowledgement/FIFO/final-reply/concurrency/cleanup recheck plus preserved voice consumers. Do not retry live /join before PASS. Source not reloaded into the running isolated bot; no Discord event/restart, staging/commit/push/deploy/configuration or production access. Unrelated .gitignore/app/companies/ preserved. Coordination is process-local; later external Discord moves remain outside the completed command's guarantee.

## Voice QoL pilot blockers — 3 October 2026

**REMEDIATION COMPLETE — independent Auditor recheck REQUIRED; pilot remains PAUSED.** /join found a retained same-target Disconnected/4014 connection with zero rejoin attempts; it never signaled rejoin and the 15-second driver Ready timeout caused ABORT_ERR. Correct target/Connect/Speak confirmed; idle retained subscription was not the Ready blocker. Existing main defect, independent of QoL remote controls and audit logging. Shared helper now invokes the standard driver path for Disconnected objects, safely reusing/re-signaling the same connection and cleaning up a failed attempt. Actual /join + installed SDK/local adapter old-behavior failure reproduced; 9 lifecycle checks PASS, including fresh/healthy/changed-target/4014 recovery, player preservation, timeout registry cleanup, coalescing and stale-session guards. No generic remote auto-join.

Separate existing audit bootstrap drift: writer expects nullable action_type VARCHAR(50); old/fresh DDL omitted it, with no applicable existing migration/ledger. User authorized minimal schema correction. Normal initializer now creates/adds the column idempotently; no backfill/destructive rewrite/index/framework. Real guarded PostgreSQL fresh/old/healthy bootstrap + writer regressions PASS. Actual initializer ran twice only on 127.0.0.1 / megubot_workflow_test; all guild settings and prior audit history unchanged, both configured channels preserved, one labeled local audit verification record saved. Production untouched.

Fresh 12 focused suites PASS; six parser checks, whitespace and scoped credential/artifact checks PASS. Exact evidence and seven remediation files are in COMPANY_IMPLEMENTATION_STATUS.md's latest blocker section. Pre-existing pilot PASS evidence preserved. Running isolated bot has not reloaded the helper; no restart/Discord retry performed. Auditor must recheck disconnected rejoin/cleanup/player behavior, no-auto-join/stale-session consumers, fresh/additive audit bootstrap/idempotency/data retention and actual writes. After independent PASS only: isolated candidate restart and ONE keeper /join retry, then remaining pilot cases. No staging/commit/push/deploy/config changes.

## Voice/TTS QoL settings — 2 October 2026

Implementation/focused verification COMPLETE on main `6c5f70db518b36ce443895b650489c35daec39fb`. Original independent audit FAIL (one P2 stale-destination finding) was corrected; narrow independent Auditor recheck PASS user-confirmed. Silent event-driven pilot cases resolved **CONFIG ONLY**: missing local saved configuration/startup cache 0; local dashboard save and persisted/runtime/cache/IPC agreement verified. Live PASS: remote `/say` different/no VC, remote local `/play`, configured text TTS, Waiting Room basic entry and genuine re-entry. No code change/new recheck. Disconnected safety, windows/grouping/same-room and final runtime/restoration remain pending. Full evidence is in the leading Voice/TTS section of `COMPANY_IMPLEMENTATION_STATUS.md`; prior release records intact.

Correction: connection-object identity alone is insufficient when Discord moves A→B on the same object during awaited settings/provider work. `getActiveVoiceSession` captures scalar guild/channel IDs; `isSameVoiceSession` requires those IDs plus connection identity to match the freshly resolved Ready/current session. Configured text-TTS and both `/yt` async checks now reject stale A without retargeting; fresh B remains valid. Inspected `/say`, `/play`, dashboard and queue controls are synchronous between capture/action and unchanged. Existing batch tickets already validate captured channel/generation and remain unchanged.

Actual held-settings same-object regression failed before fix (queued1 vs expected0), now PASS with fresh-B metadata agreement and no move/create. Three `/yt` held boundaries (link/selection/selected-video) PASS; in-memory old-guard probe fails. Fresh16/16 focused suites PASS, including5 shared voice-session checks,32 YouTube checks,38 batching checks, settings/remote controls, auth/rates/queue and released invite/reminder/TLS/notification/role safeguards. Six parser checks and whitespace PASS. No DB/UI dependency changed; earlier guarded DB/build/render evidence retained, not unnecessarily rerun. Remediation files: bot.js, voice_connection.js, yt.js, voice-remote-control.test.js, voice-connection.test.js, youtube-audio.test.js and both handoff records. No code staging/commit/push/deploy/live Discord action.

Existing guild-variable JSONB/JSON stores `tts_vc_batch_window_ms` (integer500–5000/default1500) and nullable `tts_waiting_room_channel_id` (same-guild ordinary voice). Existing admin route validates before writes and confirms persistence; bilingual Voice TTS UI reuses sections, CustomSelect and save guards. Disabled window remains visible/retained. Window captured at batch creation only; existing cached reads/refresh IPC reused.

Read-only `getActiveVoiceSession` supplies Ready/current same-guild bot session. Configured TTS, `/say`, `/play`, `/yt`, skip/clear wrappers and authenticated dashboard force-add accept all caller VC states, never implicitly join/move. `/join` remains caller-directed; reminder VC requirements unchanged. Requester/manager, Connect/Speak, rates and queue/provider protections retained.

Waiting collects genuine human entries independently of generic join with existing opt-out/nickname/engine/volume/EN-TH queue/flood/quiet behavior. Waiting wins when source=bot room. Waiting-only zero per-person cooldown permits genuine re-entry; guild flood protection remains. Flush revalidates source/entrant/destination connection. Waiting entry/discovery never auto-join/follow into waiting channel; missing/unready bot stays silent. Stage unsupported; AFK bring-back unchanged.

Verification PASS: 21 distinct focused suites, including38 batching checks and actual route/command/TTS/IPC coverage; JSON fallback and guarded local PostgreSQL settings write/update/clear/isolation, reminder persistence and workflow/auth/delivery regressions. Initial ECONNREFUSED resolved after user restarted disposable DB; safety guard/effective loopback/exact `megubot_workflow_test`/`_test`/connected database confirmed without credentials/URLs. Production build PASS (frontend unchanged after); 17 parser checks, whitespace and scoped credential/artifact checks PASS. Four actual EN/TH light/dark mobile/tablet/desktop states PASS for active-option/focus return, disabled retention, errors, save/reload/clear and no overflow. No production database or Discord action.

Latest next action: independent Auditor recheck of the two bounded corrections above. Pilot remains paused; no live /join retry yet. The former recovery request failed twice and is superseded by the new blocker evidence. All earlier disconnected-safety/configured-TTS/Waiting Room/remote-control PASS evidence below remains historical and valid. Nothing staged; unrelated work preserved.

## Project-topic workflow notifications — 1 October 2026

Implementation and focused verification COMPLETE; independent audit PASS confirmed by the user. Isolated live pilot concluded on 2 October 2026 with PARTIAL coverage: available Discord workflows, EN/TH rendering/authenticated links, preference suppression, ordinary real-account self-exclusion, signed-out privacy, terminal skip/no fallback, and final runtime/outbox checks PASS. Email-only/both, distinct-real-recipient/two-real-user cases and queued access revocation were not executed; raw upstream Discord 50007 was not captured. No reproducible product defect or implementation change was found. Exact evidence, fixture IDs and limits are in the leading Project-topic section of COMPANY_IMPLEMENTATION_STATUS.md. Original English/Discord-only preference restored; isolated bot unblocked; original topic unchanged. The isolated pilot made no production connection or configuration change; subsequent controlled release is recorded below. Independent LIVE PILOT RELEASE GATE: PASS, confirmed by the user on 2 October 2026; the listed coverage/transport limits are NON-BLOCKING. Controlled production rollout COMPLETE on 2 October 2026.

Five personal events use the existing transactional outbox: assigned (creation/additions only), review requested (transition into review only), returned, approved and reopened. Audiences are frozen, deduplicated and exclude the canonical source-event actor, including after account merge. Active project + enabled/dm-enabled settings + existing personal channel preferences are required. Claim and final transport checks enforce current access, role/assignment, identity, lifecycle and review-cycle freshness. Discord checks after user lookup; email checks immediately before transport. Positive Discord acknowledgement is required; explicit DM refusal/current ineligibility skip, temporary/unknown failures use existing bounded retries. Private feedback remains on the authenticated page. Existing EN/TH help text was updated without controls or redesign.

Verification: **16/16 distinct focused suites PASS**, including actual isolated PostgreSQL workflow/rollback/concurrency/reclaim/access/merge tests and substituted-network shared transport tests; **15 changed/new JavaScript parser checks PASS; whitespace PASS**. Test destination was independently verified as loopback Docker PostgreSQL 16, dedicated `megubot_workflow_test`; private configuration remains ignored and credentials/URLs were not printed. No browser/build matrix was needed for dictionary-only UI changes.

Release verification on 2 October: all 16 focused suites passed again against the guarded disposable local database after stopping both pilot processes; 15 parser checks and scoped credential/artifact checks passed. Production readiness is user-confirmed: Render manual/Auto-Deploy OFF, correct public FRONTEND_URL, healthy Discord/PostgreSQL/TLS/personal-notification runtime, existing email configuration unchanged. Release commit 6c5f70db518b36ce443895b650489c35daec39fb (feat: add project topic workflow notifications) contains exactly the approved 17 files and was pushed to origin/main on 2 October 2026; remote SHA verified. Unrelated .gitignore/app/companies/ remain outside the commit. No production settings, SQL or workflow events were changed. Controlled rollout COMPLETE: matching manual deployment and passive production smoke verified. Matching manual Render deployment succeeded, user-confirmed, with settings/environment unchanged. Fresh passive public smoke PASS: frontend, /health, /api/health and /api/health-stats returned 200; health bodies OK, bot telemetry online; signed-out /api/guilds returned 401; no sampled 5xx. User observed startup and more than five minutes of production logs: PostgreSQL/schema/core successful without TLS/certificate errors; stable Discord/no reconnect loop; reminders armed; notification dispatcher ran without workflow exceptions, lease/reclaim errors, repeated IPC acknowledgement failures or queue/retry flood. No repeated/release-specific warning or error. Production smoke PASS; milestone fully closed for this authorized rollout. Final post-deploy evidence is local/uncommitted; no second release commit or production mutation. No production workflow notification was triggered. No new schema or production setting is required. Preserve the pilot coverage limits above; no exactly-once guarantee. Exclude .gitignore, app/companies/, private environments and generated pilot artifacts.

## Voice announcement batching candidate — 30 September 2026

Implemented on hardening release `6b47659`. Independent audit PASS and non-production live pilot PASS; controlled production rollout authorized on 1 October 2026. The authoritative detailed evidence is the latest Voice announcement batching section in `COMPANY_IMPLEMENTATION_STATUS.md`.

Production rollout COMPLETE on 1 October 2026: commit `7cf7709cf0e04317fddc8f5c426108b0a86edf6d` (`feat: batch voice announcements`) pushed to and verified on remote `main`; matching manual Render deployment confirmed by the user with no settings/environment changes. Fresh frontend and health/API checks returned 200, health bodies `OK`, telemetry `online`. User-observed startup plus over five minutes of Render logs showed healthy PostgreSQL/core schema/TLS, stable Discord, armed reminders and no voice-state/batcher/queue/provider errors or repeated/release-specific warnings. Production smoke was passive; grouped audio was proven in the isolated pilot. Final post-deploy documentation edits remain local/uncommitted rather than creating another release commit.

Membership announcements now share a fixed 1.5-second window per guild/channel/join-or-leave. The existing guard counts grouped clips, preserves individual direction-specific cooldowns, and keeps configured flood/quiet behavior. Accepted batches include all names, with an explicit 1,000-member safety cap and one overflow warning. Templates/nickname fallback, opt-out, engine/voice/language/volume and existing AFK/connection/queue behavior remain intact.

Pending records hold ID tickets and text/settings, never captured channel/connection objects. Current connection identity, channel, Ready state and current membership are checked at flush. Moves/disconnects cancel pending work and invalidate in-flight tickets while retaining flood/cooldown history. Empty guilds/removal also reset that history. Invalid, flushed and exceptional batches release timers/state. No stale callback may flush a replacement batch.

Verification: 33 new batching checks (including the actual handler with substituted boundaries), plus 47 existing announcement, 4 connection, 24 audio queue and 16 rate-limit checks passed. Five JavaScript parser checks and whitespace checks passed. PR #21 `7f3bd64`/`f62d4c7` were references only, not merged/cherry-picked. Reminder/invite/TLS/security behavior and unrelated `app/companies/` were not changed.

Live pilot verified grouped join and leave clips with both distinct names spoken once, no extra/stale clip, successful pending-batch cancellation, cleanup/recovery, and post-batching Edge TTS exactly once. No runtime/queue/provider/voice errors were reported. One earlier silent leave was not reproduced; its cause remains unknown and no code was changed. Temporary debugger instrumentation was removed. Fresh release verification passed all five focused suites again: 124 checks.

Release scope is the seven batching source/test/handoff files. Exclude `.gitignore`, `app/companies/`, `.env.testbot`, debugger settings and generated logs/screenshots. Remaining limits: process-local/ephemeral batching, intentional stale/unready discard and existing queue/provider/playback limits. All required rollout gates are complete; no next feature is started. Do not change production configuration or manufacture a production voice burst.

## Two products, one bot

`/servers/*` is the bot console for server admins; `/activities` and `/a/<CODE>`
are the group activity product for ordinary members, who need no Discord
permission and — on `/a/<CODE>` — no Discord account at all. They share an
identity and a process tree, nothing else. Both sit at the top level of the
nav on purpose; neither is a sub-feature of the other. `/dashboard` used to
mean both and now permanently redirects to whichever one the URL meant.

## Start it

```bash
docker compose up -d     # local Postgres on 55432
npm test                 # isolated sibling database (`*_test`), ~6s
npm run ocr:setup        # the slip/receipt reader into public/ocr (once)
npm run db:seed          # demo activity, prints /a/<CODE>
```

Then two processes:

```bash
node backend/web/web.js  # Express API on 3001
npx next dev -p 3100     # web on 3100
```

Ports come from `.env` and must not be improvised: `NEXT_PORT=3100`,
`EXPRESS_PORT=3001`. `DISCORD_REDIRECT_URI` points at **3100**, not 3001,
because `next.config.js` proxies `/api/*` from Next through to Express. Running
Next on any other port breaks the OAuth callback.

## Discord bot invite permissions

**Independent audit: PASS, confirmed by the user on 30 September 2026; approved for controlled release with Reminder Reliability.** Final local release checks confirm the exact invite bitfield `275166620864` and OAuth scopes `bot applications.commands`.

Normal generated bot invites exclude Administrator, Kick Members, Ban Members,
and Moderate Members. Before configuring optional AutoMod kick penalties,
honeypot/ban behavior, or timeout moderation, a server operator must manually
grant the bot the corresponding Discord permission: Kick Members, Ban Members,
or Moderate Members, respectively. These features require those grants; there
is no automatic later permission escalation or change to existing guild roles.
Manage Roles and its role hierarchy safeguards, default-enabled AFK bring-back
(Move Members), and voice Connect/Speak permissions remain unchanged. Automatic
Team role synchronization remains disabled by default.

## Databases are separated

| | Where | Holds |
|---|---|---|
| `MEGU_DATABASE_URL` | local Docker Postgres | core's own tables |
| `DATABASE_URL` | Supabase | the live bot's existing tables |

Core reads `MEGU_DATABASE_URL` first and falls back to `DATABASE_URL`. In
production leave it unset and core rejoins the main database.

`npm test` derives `megu_dev_test` (or reads `MEGU_TEST_DATABASE_URL`) and
refuses any host that is not local or any database name without the `_test`
suffix. Destructive migration coverage therefore cannot touch `megu_dev`, even
when a test file is invoked directly.

**Supabase was rolled back.** The seven `megu_*` tables created during the first
round of testing were dropped; `guild_variables` (3), `user_nicks` (33),
`reminders` (1) and `audit_logs` (50) were verified unchanged before and after.
`npm run db:audit` re-checks any database on demand.

## What needs you

These could not be verified without your own Discord account:

1. **The OAuth round trip.** Log in at `/api/auth/login`, then check the server
   log prints `Megu | <name> claimed N past activities` and that
   `/api/megu/me` returns a `user` plus your servers. Everything downstream of
   the callback is tested; the callback itself needs a real Discord session.
2. **`canManage` against a real server.** Confirm a server where you are only a
   member appears in the list without settings, and one where you are admin
   appears with them.
3. **The bot process.** `/api/megu/me` asks the bot which guilds it is in over
   IPC. Running `web.js` alone means that list is empty, so servers show as
   "ยังไม่มี Megu". Run the full `npm run dev` to see it correctly.

## The two axes

Plan and money run independently. This is the single most important idea in
the model and the thing the first design got wrong.

    plan   open → confirmed → done, or cancelled
    money  none → open → settled     (derived, never stored)

A badminton court has a known price before anyone plays; a dinner bill only
after. Making money the last stage of one pipeline forced an order that is
wrong half the time. `settlement()` derives the money state from the rows it
summarises, so it can never drift out of step with them.

Recurring agreements (`kind: 'recurring'`) skip the plan axis entirely and
carry `periods` instead — one row per month, each settling on its own.

## Everything is correctable

A ledger nobody can fix is a ledger nobody can trust, and until recently every
route was a POST — a typo or a wrong amount was permanent. Owners can now
rename and remove people, hand a claimed name back, edit or delete an expense,
and undo a confirmation.

Two guards matter:

- Removing someone is **refused** while money is attached to them. Deleting the
  row would silently change what everyone else owes, which is the exact quiet
  wrongness this product exists to prevent.
- Editing an expense recomputes the split from scratch rather than patching it,
  so the shares always sum back to whatever the amount now is.

`tests/corrections.test.js` walks the realistic disaster: ฿4,000 typed instead
of ฿400, a misspelt name, the wrong person confirmed as paid, the wrong person
tapping a name.

## Why the UI was redesigned twice

The first two passes looked designed and read badly. Three things were wrong,
and only one of them was taste:

1. **The display face carried no Thai glyphs.** Measured, not guessed: Thai set
   in Fraunces came out at exactly the same width as generic serif, while Latin
   differed. Every Thai heading had been silently falling back to a system
   serif, so the editorial identity was invisible to the people this is built
   for. Anuphan replaced it — one voice across Thai and Latin.
2. **Dot leaders read as a fax, not a product.** Elegant in isolation, but a
   page of dotted rules is noise, and the empty middle of every row destroyed
   hierarchy. Rows now carry an avatar, a name, a sub-line and a figure.
3. **Nothing anchored the page.** No colour, no image, no focal point. The
   activity page now opens on a navy card with the one number the reader came
   for — what they owe — set large, with the pay button beside it.

Separation comes from filled surfaces and real corner radius now, which is what
"แบ่งให้ชัด" and "เข้าถึงง่าย" were actually asking for.

## The console runs on a token bridge

The bot console (`/servers/*`, `/developer`, everything in `app/components/Tabs/`)
was written against an earlier dark-only palette. This branch replaced
`globals.css` wholesale, which left those fifteen files referencing tokens that
no longer existed — they were rendering against undefined variables.

Rather than freeze the console in the old palette or rewrite every file, the
old token names live on at the bottom of `globals.css` as aliases onto the
current ones (`--text-secondary: var(--muted)` and four more). The console
therefore inherits this design system and gained a light theme it never had.

The ~350 hardcoded hex literals in those files were mapped to tokens in the
same pass. Four kinds of literal are deliberate and must stay:

- **Colours sent to Discord.** `presetColors` in `RoleManagerTab` and
  `EmbedCreatorTab`, the `ColorPicker` palette, and its default prop are role
  and embed colours posted to the API. A `var(--accent)` here reaches Discord
  as a literal string. A blind find-and-replace put tokens in all three; if you
  run one, exclude these.
- **`#000000` comparisons** in the role pickers — Discord's "no colour"
  sentinel, not a colour we paint with.
- **The Discord message previews** in `WelcomeTab` and `EmbedCreatorTab`
  (`#2b2d31`, `#dbdee1`, `#5865f2`) — they imitate Discord's own chrome, which
  does not follow our theme.
- **The log terminal** in `/developer` (`#0d1117` on `#c9d1d9`) — a terminal
  that inverts with the page stops reading as a terminal, and its level colours
  are calibrated for that ground.

**Discord role colours are never used as text.** A role's colour is chosen to
look right on Discord's own dark chrome; as label text on our panel it lands
wherever it lands. Measured on a light panel: Discord green `#57F287` gives
1.36:1 and yellow `#FEE75C` gives 1.21:1 — invisible. So in `MemberManagerTab`,
`RoleManagerTab` and `AutoroleTab` the role colour goes on the dot beside the
name and the name itself is `var(--ink)` (15:1+ light, 9.7:1+ dark). The hue
still identifies the role; the word stays readable.

Tints built from a role colour use `color-mix(in srgb, ${hex} 14%, transparent)`
rather than appending alpha digits to the hex. The old `${hex}14` form silently
produces invalid CSS the moment `hex` is anything but a six-digit literal.

Audit-log category badges got real tokens instead (`--cat-pink` … `--cat-tint`).
They are the one place hue is decorative rather than meaningful, so they are
the one place carrying an explicit value per theme. The originals were picked
for a dark-only page and measured about 2:1 in light; all seven are in
`npm run contrast` now and clear 4.5:1 in both themes.

## Readability is measured, not judged

`npm run contrast` reads the colour tokens straight out of `globals.css` and
measures every foreground/background pair we actually use, in both themes,
against WCAG. `npm test` runs it with `--strict`, so a palette change that
makes something unreadable fails the build like any other regression.

The first run failed nine pairs, all in the light theme, including the two
that matter most — the amount someone owes (`--rose`, 4.07:1) and Megu's own
label (`--gold-deep`, 3.58:1). Dark passed everything, which is why the
problem was easy to miss while working at night.

Weights are per-theme too (`--w-body` … `--w-heavy`): light text on a dark
ground optically gains weight, so the dark theme sets each step lower to land
at the same apparent weight.

## The time poll

The wedge from the badminton story: nobody in a group chat wants to be the one
who says "right, Saturday 7pm then." Megu holds the candidate times, collects
availability, and calls it.

Scoring deliberately punishes a veto harder than it rewards a yes
(`no: -3` against `yes: +2`), and slots are ranked by fewest objections before
score. The goal is a time nobody is blocked on, not the most popular one — in
`tests/poll.test.js` that picks Saturday 19:00 over a slot with more total
enthusiasm but two people who cannot make it.

Locking the winner sets `starts_at`, moves the plan to `confirmed`, and marks
anyone who voted no on that slot as not coming — so nobody has to ask them.

## Paying

A PromptPay QR is a string, not a transaction. `core/promptpay.js` builds the
EMVCo payload — the PromptPay AID in field 29, the amount in field 54, a
CRC-16/CCITT checksum in field 63 — and `qrcode` renders it. No gateway, no
merchant account, no fee, because none of that is involved in *encoding* a
request for ฿60. What costs money is the bank telling you it arrived, and that
is the part we do not have.

The V0 flow is optimistic and reversible:

    exact QR → transfer → mandatory slip → strict match → auto-confirm
                                                ↘ exception → owner review
    cash/offline payment → owner records receipt → owner-confirmed

`slip_matched` deliberately does not mean `bank_verified`. Megu has no bank API.
The server decodes the uploaded slip pixels itself, re-parses the checksummed
QR, refuses a duplicate reference, and compares its own OCR reading to the
exact expected amount, configured receiver name, and a plausible Bangkok
timestamp. Browser-supplied OCR fields are ignored. A five-month-old transfer is allowed
and flagged; an impossible future clock or any mismatch stays pending. The
sender's bank-account name is evidence only — somebody else may transfer for
the debtor. If the owner checks their bank and the optimistic result is wrong,
they reverse it with a required reason and the debtor is notified.

One payment has child rows in `payment_allocations`: one transfer can cover
several recurring periods, and several partial transfers can cover one period.
The payment and every state change also write append-only `payment_events`.

**The thing that is easy to get wrong.** The person paying is holding the phone
the QR is displayed on, and a phone cannot scan its own screen. Saving the
image to the photo library and letting the banking app read it from there is
the primary path in Thailand, not a fallback — so the pay screen offers an
explicit save button (share sheet on iOS, download elsewhere), a long-press
hint, and the number and amount as separate copy buttons for anyone who would
rather type. A QR alone would fail for most of the people this is built for.

Two rules the code enforces rather than assumes:

- **The full number never renders.** `payTo.masked` goes on screen and
  `payTo.number` goes to the clipboard, and both are gated behind the same
  `viewAmounts` check that hides everyone's balances — a forwarded link gets
  neither. Screens end up in screenshots; clipboards do not.
- **The QR keeps a white ground in dark mode.** `.pay-qr` carries its own
  background rather than the theme's. An inverted code is one a good many Thai
  banking apps quietly fail to read, and the person holding the phone has no
  way to know the theme is why.

The original slip is normalized to a bounded JPEG first, stripping EXIF/GPS,
then kept as temporary `bytea` readable only by payer/payee while an exception
is pending. Forged image MIME headers and oversized pixel surfaces are refused.
The server renders its own standardized evidence PNG
from an allow-list (bank, reference, names, last four account digits, amount,
date/time); it never trusts a client-provided derivative. A final decision
deletes the raw image immediately, and boot-time retention deletes unresolved
raw images after seven days. Structured evidence, allocations and audit events
remain.

## Reading pictures

Three things arrive as photographs now, and they are worth very different
amounts. Confusing them is the mistake this part of the codebase is arranged to
prevent.

| | Source | Worth |
|---|---|---|
| The account on a saved PromptPay QR | EMVCo payload, checksummed | Exact. `promptpay.readQr` |
| The bank and reference on a slip | The slip's own QR, checksummed | Exact. `core/slip.js` |
| The amount, date and dish names | OCR on a photograph | **A reading.** `core/receipt.js` |

**Importing an account.** `promptpay.readQr` is `buildPayload` run backwards.
The number is already in the picture the bank saved for its customer, and
asking somebody to copy thirteen digits by hand is asking for the one
transposed pair that quietly pays a stranger — a wrong account does not fail,
it succeeds at the wrong destination. It refuses with a reason per case, and the
reasons matter: a shop's bill-payment id (field 30) is fifteen digits and so is
an e-wallet id, so only the tag they arrive under tells them apart. Read by
length alone, a shop's code would be saved as a person's and look perfectly
fine. An amount baked into the imported QR is reported and then dropped, out
loud, because keeping it would fix every future request at whatever they were
paid once.

**The slip's QR carries no amount.** It is a nested TLV under tag `00` — API
type `000001`, sending bank, transaction reference — with its checksum under
`91` rather than the `63` a PromptPay QR uses, and resolving it into an actual
amount needs a bank's API, which costs money and an account and which Megu
deliberately does not have. What it gives is an *identifier*, and that is
enough for the one automatic check with teeth. Two things the code insists on:
the reference is namespaced (`th-bank:004:…`) because two banks may issue the
same number and a bare collision would tell an innocent person their slip was a
duplicate; and some banks print the checksum with its leading zeros stripped,
which is padded back before comparison — otherwise the bug reads as "the app
hates SCB".

**OCR proposes; the policy may accept optimistically.** A complete strict match
can mark a transfer paid, but the stored verification level remains
`slip_matched`, never `bank_verified`, and every result is reversible. Receipt
scanning remains form-fill only: it never adds expenses without a person
committing the edited proposal.

The one signal worth leaning on is `reconciles`: when the lines read off a bill
add up to the total read off the same bill, two independent readings agree.
That is the same argument as a checksum, and it is the only thing on the panel
that gets colour.

**Two non-obvious things, both verified rather than assumed.**

- Tesseract defaults to `SINGLE_BLOCK`, which *silently deletes the amount* on
  a bank slip: the figure is set two or three times larger than everything
  around it and layout analysis discards it as an outlier. The text comes back
  containing "Amount:" with nothing after it — no error, no warning. A slip is
  one column at many sizes, so `app/lib/receipt.js` sets `SINGLE_COLUMN`.
- The engine is served from this origin, not a CDN. `npm run ocr:setup` copies
  the worker and the LSTM cores out of `node_modules` and downloads the `_fast`
  language data into `public/ocr/` (gitignored, ~22MB on disk, of which a
  browser fetches one core and the languages it needs). It runs as part of
  `npm run build`. Without it the reader reports itself unavailable and every
  other part of the page carries on — an unread slip is still a slip a human
  can look at.

PromptPay account import and receipt preview decode in the browser. A payment
slip is different: the phone still shrinks it to a few hundred kilobytes, but
the server normalizes and decodes those pixels again because editable client
JSON cannot authorize an automatic payment. Server decoding is bounded to
40 megapixels and the normalized JPEG strips source metadata before temporary
storage.

## Two languages, and how not to freeze one in

English leads and Thai follows — reversed from the original decision, because
the link travels further than the group it started in. `app/copy/{en,th}.js`
hold the interface copy, `core/megu/voice.js` holds Megu's own lines in both,
and `core/format.js` holds everything built from data. `tests/copy.test.js`
fails the build when the two dictionaries drift apart, including when a phrase
that takes a value forgets to print it.

The bug worth remembering: `periods.label` used to store `"สิงหาคม 2569"`,
written on the day the month opened. A stored rendering cannot be re-rendered,
so every month created before the switch would have kept its language forever.
The key (`2026-08`) is the fact and the label is a view of it, so the API now
sends `period.key` and the browser formats it. The column still exists and is
no longer read.

`core/format.js` also fixed a live bug on the way past: month boundaries are
Bangkok's now, not the server's. `periodKeyFor` used `getUTCMonth`, so a period
opened at 02:00 on the first of September in Thailand was filed under August.

## Reminders

`core/reminders.js` decides who is late and writes the statement;
`adapters/discord/reminder-sender.js` opens the DM. The bot arms an hourly
loop on ready. One person gets one message per cooldown covering everything
they owe across every group — a statement, not a pile of pokes. Only people
with a linked Discord account are reachable; the rest are skipped rather than
silently counted as reminded.

## What is deliberately absent

Frozen out of V0, per the scope we agreed:

- Bank-verified payments — strict slip matches are optimistic and reversible;
  `bank_verified` is reserved for a future provider/API
- A `Group` entity — activities are the root; groups emerge later from repeats
- Passive Discord channel scanning — payment intake is explicit `/จ่าย` with a
  required attachment; ordinary messages are never treated as financial input
- Automatic month rollover — a new period opens when the owner asks for it,
  not on a schedule

## Layout

```
core/                    knows nothing about Discord, HTTP or React
  activities.js          activity, participants, expenses, shares, payments
  users.js               accounts, multi-provider identity, participant merge
  money.js               satang integers; splits always sum back to the total
  promptpay.js           the EMVCo QR payload, and nothing that talks to a bank
  format.js              months, dates and money, per language, from keys only
  auth/access.js         the two permission domains
  megu/voice.js          every line Megu says, in one place
  reminders.js           who is late, and the statement she sends them
adapters/
  discord/oauth.js       token exchange and profile reads
  http/megu-api.js       REST over core, mounted at /api/megu
  discord/reminder-sender.js   opens the DM and records delivery
app/
  copy/{en,th}.js        every word of the interface, one shape, two languages
  components/PayPanel.js the QR, the save button, the number, the slip
  a/[code]/page.js       public activity page, no login required
  activities/page.js     organizer view — the group/money product
  servers/page.js        server list
  servers/[guildId]/page.js    the bot console — automod, welcome, roles, TTS
  components/MeguMark.js the cat, as vector
  components/ThemeToggle.js    light / dark / system
tests/                   npm test
scripts/                 seed-demo, db-audit
```

## Two rules worth keeping

**Server permissions never reach activity money.** Discord roles decide who
configures the bot in a guild. Nothing else. A guild administrator who is not in
an activity sees no amounts — there is a test for exactly this.

**A claim is not a payment.** Pressing "จ่ายแล้ว" writes a `pending` row. A
bank transfer needs a slip and either a strict optimistic match or owner review;
cash needs an explicit owner action. `confirmation_source` and
`verification_level` must always explain why a confirmed row counts.

## Bugs found and fixed during the build

- Roster order shuffled between loads: `now()` in Postgres is the transaction
  timestamp, so every participant inserted together shared it to the
  microsecond. Added an explicit `position` column.
- `.page-title` carried `flex: 1`, which stretched the heading down the page
  inside any column layout.
- Megu said "เหลือ X คนเดียว" when more than one person was outstanding.
- The navbar overflowed below ~400px.
- Server card avatars flew to the page corner: the card had no
  `position: relative`, so the absolutely positioned avatar resolved against
  the viewport.
- Dark mode put white text on light fills. `--navy` and `--royal` were flipped
  for dark (correct for text) but also used as solid backgrounds. Fills now use
  `--brand-*` tokens that never flip; only ink and accent tokens do.
- `markSent` stamped the database clock, which made the reminder cooldown
  untestable without waiting a real day. The caller passes the time now.

## Verifying

```bash
npm test      # all suites against an isolated local `*_test` database
npm run build # vendors the OCR engine, then next build
```

`tests/recurring.test.js` is the one to read first: it demonstrates money
opening while the plan is still gathering answers, which the old model could
not express.
