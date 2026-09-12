# Megu Projects — Product, UX, and Delivery Plan

Status: Implemented and verified for a feature-gated pilot. Enabling the gate remains a product rollout decision.
Updated: 2026-09-09. Refined from the supplied rough outline and reconciled with the shipped implementation.
Surfaces: `/projects`, `/p/[code]`, `/p/[code]/manage`, Discord `/projects`.
Authority: [DIRECTION.md](DIRECTION.md) for product priorities; [DESIGN.md](DESIGN.md) for visual language; [DATABASE.md](DATABASE.md) and source code for architecture.

## Direction contract

**THESIS:** The project page is a shared worktable: accountable work and time are visible together, without a generic metric-card dashboard.
**OWN-WORLD:** Inherit Megu's fired-celadon console—warm parchment, forest/celadon action and state, warm rules, Thai-capable type, flat operated surfaces.
**STORY:** A contributor sees what needs them, reports it; a lead scans the same timeline, resolves blockers, and accepts finished work.
**FIRST VIEWPORT:** Compact project identity and one report action; a narrow My work strip; Timeline/Topics/Updates above the first real topic row, with a contextual detail panel on wide screens.
**FORM:** Operate surface; shared timeline worktable; code-led implementation using the approved plan and generated concept preview as critique reference.
**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## 1. Purpose and product fit

Megu Projects helps a Discord group answer three questions: **Who owns the work? When is it due? What changed since the last update?** A project contains topics, accountable people, a shared timeline, and durable progress history. Discord handles quick actions; the web console handles planning and review.

The audience is a small community team, study group, event crew, or server staff working toward a shared deliverable. Leads need a trustworthy overview; contributors need to find their work and submit useful updates without navigating a full project-management suite.

This began as a proposed extension rather than an established roadmap priority. The implementation request approved a limited, feature-gated Projects pilot without replacing `DIRECTION.md`, changing the priority of Megu's voice experience, or authorizing a platform rewrite.

### Success criteria

- A first-time lead can create a project, add a topic, and assign its owner through a guided flow.
- A returning contributor can find their assigned topic and open its report form from the first screen, or report from Discord.
- A lead can distinguish incomplete, blocked, overdue, and awaiting-review work without interpreting color alone.
- Both surfaces show the same saved state and history; retries do not create duplicate reports.
- During the pilot, observe these tasks without coaching. Record task completion, navigation mistakes, and recovery problems before setting adoption or speed targets.

### Boundaries

Projects is separate from Activities: ongoing work is not attendance, expense splitting, or payment state. Reuse infrastructure and visual patterns, not Activity access rules or lifecycle states. Existing Activities, server settings, PersonalSettingsTab, voice behavior, and account preferences remain unchanged.

## 2. Scope and release slices

| Slice | Included | Exit condition |
| --- | --- | --- |
| A — Useful pilot | Private projects; invitations and roles; topics and assignments; form-based scheduling; read-only Gantt and accessible list; reports and completion review; history; essential Discord actions; EN/TH | End-to-end workflow passes permission, concurrency, and usability checks |
| B — Reliable follow-up | Opt-in reminders and blocker notifications; delivery settings and failure visibility | Delivery survives restarts, respects revocation, and suppresses obsolete reminders |
| C — Advanced scheduling | Gantt drag/resize; finish-to-start dependencies; milestones | Scheduling works through pointer and keyboard/form controls, with conflict recovery |

Each slice is independently releasable behind a feature gate. The Gantt is part of the pilot; dragging bars is not a prerequisite for useful scheduling.

Deferred: Kanban, attachments, threaded comments, automatic Discord threads, recurring topics, time tracking, workload forecasting, critical-path calculations, automatic dependency rescheduling, public project pages, custom roles, and organization-wide portfolios. These are not hidden acceptance requirements.

## 3. Domain language and state rules

Use **Project**, **Topic**, **Owner**, **Lead**, **Member**, **Viewer**, **Report**, and **Milestone** consistently. A topic is one accountable unit of work, not a nested project. Its primary assignee is accountable; additional assignees are collaborators.

### Project lifecycle

| State | Behavior |
| --- | --- |
| `planning` | Structure and assignments can be prepared; reporting is not open |
| `active` | Reporting, review, and scheduling available |
| `paused` | Viewing and planning edits available; reports, approvals, and reminders paused |
| `completed` | Closed successfully; read-only until reopened |
| `cancelled` | Stopped without claiming completion; read-only until reopened |

Owner or lead can activate, pause, and resume. Only the owner can complete, cancel, or reopen a project. Normal completion requires all non-archived topics to be completed. Closing with unfinished work requires confirmation and a reason; preserve the actual percentage and label the outcome “Closed with unfinished work.” Never rewrite reports or complete remaining topics automatically. Reopening returns to `active` and creates a history event.

### Topic workflow and progress

| Workflow | Progress rule | Meaning |
| --- | --- | --- |
| `not_started` | Exactly 0% | Work has not begun |
| `in_progress` | 0–99% | Work underway |
| `in_review` | 0–99% | Completion review requested; last estimate preserved |
| `completed` | Exactly 100% | Owner or lead approved completion |

Blocked is a separate flag with a required reason, not another workflow state. A topic can be “In progress · Blocked” without losing its percentage. Clearing a blocker requires an explanatory update. Blocked topics cannot be approved until cleared. Approval writes an event and sets progress to 100 atomically. Contributors see “Request completion review,” not a promise that their report completes the topic.

Reports update the shared topic estimate, not separate personal percentages. Lowering progress requires a reason. Owner/lead can return review work to `in_progress`, or reopen completed work with a reason and a new 0–99 estimate. Completed topics cannot receive normal progress reports until reopened. Archival is a separate reversible flag: it removes a topic from current work without deleting history. Archived topics are read-only until restored.

### Project rollup

`progress = sum(topic progress × topic weight) / sum(topic weight)` for non-archived topics only.

- Pilot weight is always 1; custom weighting is deferred.
- Round only for display. With no included topics, show “No topics yet,” not 100%.
- Milestones do not enter the denominator. Blocked work does.
- Archiving/restoring a topic changes the denominator; record this visibly in history.
- Progress is a reported estimate, not elapsed time or a prediction of delivery confidence.

### Identity

Persist canonical Megu user IDs. Discord IDs identify linked external accounts, not arbitrary principals supplied by clients. Invitations may target Discord identities before sign-in, but become active memberships only after authenticated acceptance. Do not create anonymous active participants to bypass account linking.

## 4. Permissions and privacy

Projects are private by default. A seven-character project code is a locator, **not an access credential**. Knowing a URL or sharing a guild does not grant membership. Public projections and anonymous reports are out of scope.

| Action | Owner | Lead | Member | Viewer |
| --- | --- | --- | --- | --- |
| Read project, topics, reports | Yes | Yes | Yes | Yes |
| Create/edit/archive topics; dates and assignments | Yes | Yes | No | No |
| Report progress / change blocker | Any topic | Any topic | Assigned topics | No |
| Approve completion / reopen topic | Yes | Yes | No | No |
| Invite/revoke members or viewers | Yes | Yes, excluding owner/leads | No | No |
| Promote/demote leads; transfer ownership | Yes | No | No | No |
| Activate/pause/resume project | Yes | Yes | No | No |
| Close/cancel/reopen; configure channel destination | Yes | No | No | No |

Lifecycle restrictions apply even when a role normally permits an action. Leads cannot grant lead/owner roles or modify another lead. Ownership transfer requires confirmation by the current owner and acceptance by the recipient; preserve exactly one owner transactionally. The former owner becomes a lead. An owner must transfer before leaving.

Invitations are recipient-bound, expiring, single-use, and revocable; no open “join by code” in the pilot. Recheck authorization on every read and mutation, including autocomplete, report feeds, and Discord interactions. All referenced records must belong to the same project. Use a neutral not-found response for inaccessible project codes to limit enumeration.

Revocation removes future access immediately and clears active assignments with an event. Historical attribution remains. Removing the primary assignee leaves “Unassigned”; never silently promote a collaborator. Downgrading someone to viewer also clears their active assignments.

The invite flow explains that all participants, including viewers, can read reports. Discord channel posting is a separate disclosure choice: the owner selects and confirms the destination and data shared there. Report notes and blocker descriptions are excluded from channel messages by default. Validate both the owner's authority over the destination and the bot's permissions; accepting arbitrary guild/channel IDs is insufficient.

## 5. Information architecture and visual direction

Inherit Megu's warm-paper/forest light theme, sapphire dark theme, semantic tokens, Thai-capable typography, and flat section rules from `DESIGN.md`. This is an operational console: no oversized hero, decorative metric grid, or nested cards around every field.

### `/projects` — Find or start work

- Compact title, brief explanation, and one “Create project” action.
- Active and Closed filters, title/code search, and “Assigned to me.” Planning/paused projects remain in the active directory with explicit labels.
- Responsive rows: title, role, lifecycle, progress, next due date, last update. Use “No deadline” and “No updates yet” honestly.
- First-run empty state explains Projects and offers creation. Filtered empty state offers “Clear filters.”
- Creation asks only title, optional description, timezone, and optional project deadline. Create in `planning`, then guide the lead through first topic, invitations, and activation. Discord linking is optional.

### `/p/[code]` — Work and review

The first viewport contains a compact header, the contributor's next action, and the beginning of real work. Avoid stacking a hero, metric cards, a large report card, and tabs above the first topic.

```text
Projects / Project title                  [Report progress] [More]
Active · 8 topics · 3 people · Due 30 Sep   42% reported progress
My work: 2 assigned · 1 awaiting review    [Choose topic]
Timeline | Topics | Updates               [Filter] [Add topic*]
----------------------------------------------------------------
Topic / owner / status                     Shared date grid
Website / Mina / In progress               ========----
Artwork / Nop / In review                       =====--
Unscheduled topics (2)                     [Set dates*]
```

Layout sketch with synthetic data. Asterisks identify owner/lead controls; they are not literal UI copy.

- **Timeline:** desktop default, with pinned topic labels and one shared date axis.
- **Topics:** the same records in an accessible sortable list, not a duplicate section below the Gantt.
- **Updates:** reports and project events, filterable by topic/person, with cursor pagination.
- Preserve view/filter/selected-topic state in the URL where appropriate. Shared topic links open the detail panel after authentication; closing it restores the user's list position.
- “Report progress” opens an assigned-topic chooser, or the only assigned topic directly. Viewers get no disabled reporting CTA; unassigned members get a useful explanation.
- Owner/lead “Add topic” belongs near the work surface; project settings live under More.
- Topic selection opens one detail panel with overview, assignees, dates, progress, blocker, and history. The focused report form replaces panel content instead of stacking dialogs.

### `/p/[code]/manage` — Infrequent administration

Use compact settings navigation: **General**, **People**, **Discord & notifications**, **Lifecycle**. Reuse genuinely generic form/feedback primitives, not server-specific draft or permission state.

Use explicit section saves, inline validation, retained input after failure, and unsaved-change navigation warnings. Topic scheduling stays near the topic. Owner-only closure and ownership transfer sit in Lifecycle with clear consequences, separate from routine saves. No hard-delete project action in the pilot.

### Responsive and accessible behavior

- Wide screens: pinned topic column, bounded horizontal timeline, side detail panel when space permits.
- Narrow screens: Topics is the initial view unless a view was explicitly selected; details/reporting use a full-height sheet or page. Timeline remains available without page-wide overflow.
- Use content-driven breakpoints consistent with existing components. Verify 320, 390, 768, 1024, and 1440 CSS pixels; 200% zoom; and the 1366×768 first viewport.
- All scheduling/reporting actions have labeled keyboard-accessible forms. Never rely on hover, drag, color, or tiny handles alone.
- Implement view-tab semantics, visible focus, dialog focus management/restoration, and accessible save/error announcements.
- Use comfortably sized touch controls, reduced motion, and explicit text status. Reuse semantic colors rather than introducing unrelated chart hex values.

## 6. Gantt and scheduling contract

### Pilot rendering

Start with semantic topic rows and a synchronized date grid. SVG is a candidate for bars/connectors, not an assumed performance guarantee. Keep a readable list alternative and profile representative data before choosing virtualization or another renderer.

Provide day/week/month zoom, Today, and Fit project. Default to a useful date range around scheduled work with bounded scrolling. Empty dates belong in “Unscheduled,” never a bar inferred from today. Deadline-only topics have a due marker, not an invented duration. Completed topics retain their scheduled position with explicit completion styling.

Use labels/legend for today, due markers, completed work, and blockers. “Overdue” means the deadline has passed and work is incomplete. “Due soon” is a configured reminder window, not a predictive risk score. Do not label work “at risk” merely because it is under 80% within 48 hours.

### Date semantics

- Store exact instants as UTC `timestamptz`, plus the project's IANA timezone and date-only precision metadata. Default to the creator's configured timezone when available; otherwise confirm a suggested timezone.
- Date-only deadlines mean the end of that calendar day in the project timezone; date-only starts mean its start. Explain this beside inputs and preserve precision for faithful editing.
- Reject start after deadline. Either date may be absent; absence must not become a database `now()` default.
- Display project-zone dates with a visible timezone label. A local-time hint may supplement, not replace, the shared reference.
- Changing timezone requires choosing “Keep exact times” or “Keep local dates/times,” previewing effects, and a version-checked transaction. Never silently shift schedules.
- Project deadline is a target rather than a hard topic constraint. Warn on later topic deadlines, require acknowledgement, and record the override.

### Advanced scheduling — Slice C

Owners/leads can move or resize bars; assignees report but do not reschedule. Dragging previews calendar dates. Drop opens a compact confirmation with old/new dates and warnings. Send one versioned mutation after confirmation, not writes on every pointer movement. Escape cancels; failed saves restore authoritative dates while retaining proposed values for retry. Do not assume a local calendar day always equals 24 hours across daylight-saving changes.

Provide an equivalent “Edit schedule” form for keyboard, touch, and assistive technology. Announce saved dates. On stale revision, show the latest schedule and require deliberate reapplication instead of overwriting another person's changes.

Dependencies are same-project directed finish-to-start edges. Reject self-links, duplicates, and cycles in a concurrency-safe transaction. A successor starting before its predecessor's deadline gets a warning; missing dates mean “Schedule not evaluated.” Dependencies are advisory: no report blocking or automatic shifting. Edge removal creates an event.

Milestones are named point-in-time targets with `open`/`reached` state, separate from topics. Owners/leads manage them. Show labeled diamond markers and equivalent list rows; milestones accept no reports and do not affect progress. Dependent milestones and automatic completion are deferred.

## 7. Reporting, review, and conflict recovery

1. Choose an assigned topic; show its current status, estimate, deadline, and latest report.
2. Enter whole-number progress through a labeled numeric input; a slider may supplement it. Choose “Continue work” or “Request completion review.”
3. Enter a required summary. Optional blocker controls explain visibility and notification behavior. New blockers, blocker clearance, and progress decreases require explanatory text.
4. Preview the resulting state and submit once. Preserve input after validation, network, permission, or version errors.
5. Confirm the saved report inline and refresh topic/rollup from the authoritative response. Clear the draft only after confirmed success.

Reports are append-only. Correct mistakes with a subsequent report optionally referencing the original; no silent edits to historical percentages. Render a safe Markdown subset without raw HTML, unsafe links, or automatic mass mentions. Lead approval/return is an explicit action with its own event; general comment threads are deferred.

One transaction rechecks access/lifecycle, validates the topic revision, inserts the report, updates topic state, and records an event. Slice B also enqueues notification work transactionally. Do not derive current state from whichever report timestamp sorts last.

Use a web client-generated idempotency key or the Discord interaction ID. Same actor/key/payload returns the original result; changed payload under the same key conflicts. Persist keys across process restarts. If another report wins, return a revision conflict, preserve unsent text, and show what changed. Retrying an uncertain response with the same key must not append twice.

Updates includes reports, approvals, lifecycle, assignments, schedules, and archival with concise before/after descriptions. History is cursor-paginated; the page must not download every report on first load.

## 8. Discord and notification experience

The command grammar is proposed UX, not existing registration. Validate against actual registration constraints during implementation.

| Command group | Pilot behavior |
| --- | --- |
| `/projects create`, `list`, `view` | Create planning project; list accessible work; summary with console link |
| `/projects topic add`, `assign`, `schedule`, `view` | Authorized planning actions and topic details |
| `/projects report` | Project/topic, progress, summary, optional review request or blocker |
| `/projects review` | Lead approves or returns topic with reason |
| `/projects member invite`, `remove`, `role` | Role-bounded membership actions; recipient acceptance through authenticated flow |
| `/projects state` | Authorized lifecycle transition with required confirmation |

Ownership transfer and channel configuration may link to the protected web flow. Dependencies and milestones can initially remain web-managed. Do not claim every advanced action is available in Discord. Autocomplete must not reveal inaccessible project data.

Default private command results to ephemeral. Build links from the configured public origin, not an invented domain. Preserve verified actor identity through modals/deferred interactions. Provide clear account-linking recovery and permission explanations.

### Notifications — Slice B

- Default off until opted in. Offer 48h/24h deadline reminders with the project's timezone and chosen destination visible.
- Respect account notification preferences. Paused/terminal projects, completed/archived topics, revoked members, removed assignments, and revised deadlines suppress obsolete jobs.
- Blocker notification is explicit, not a ping on every percentage update. Coalesce repeated blocker notifications and prohibit automatic `@everyone`/role mentions.
- Channel messages share minimal status and an authenticated link by default. Show the owner a disclosure preview before enabling. Account DM/email and guild-channel delivery are different recipient models.
- Use durable scheduling and leased workers, not page timers. Revalidate state/destination before dispatch; cancel/rebuild pending jobs after schedule changes.
- Dedupe by event, recipient/destination, threshold, and deadline revision. A rescheduled deadline can generate a new valid reminder without reviving obsolete jobs.
- Reuse shared Discord rate limiting with bounded retries/backoff and visible failures. On restart, skip expired windows rather than flooding users with stale reminders.
- External send acknowledgement can be lost; minimize duplicates without promising exactly-once Discord delivery. Revocation prevents unclaimed sends but cannot retract messages already handed to the external service.

## 9. Repository integration and storage

These are existing integration points, not evidence that Projects exists. Recheck interfaces before implementation. Follow `AGENTS.md` and installed Next.js guides before writing framework code.

| Existing source | Reuse / extension |
| --- | --- |
| `core/activities.js`, `core/index.js` | Core-service organization; add a separate Projects domain |
| `core/ids.js` | ID/code conventions; project-code helper with unique-collision retry, not a security credential |
| `core/schema.js` | Additive schema and migration/advisory-lock conventions |
| `core/account-merge.js` | Extend reference repointing and duplicate-membership reconciliation |
| `adapters/http/megu-api.js` | Session actors, authorization boundaries, configured-origin links |
| `core/notifications.js` | Durable events/deliveries, preferences, dedupe, worker claims |
| `adapters/notifications/dispatcher.js` | Project DM/email rendering; channel delivery needs an explicit adapter extension |
| `adapters/discord/rate-limit.js` | Shared Discord request coordination |
| `commands/utility/` | New handlers calling the same Projects core services |
| `app/activities/page.js`, dashboard primitives | Generic navigation, localization, loading, forms, and feedback patterns |

Proposed additions: `core/projects.js`, a reminder module separate from payment reminders, `commands/utility/projects.js`, routes under `app/projects/` and `app/p/[code]/`, and focused Projects components. Keep state transitions/authorization in the core rather than duplicating web and Discord rules.

### Storage contract, not executable migration SQL

| Proposed table | Responsibilities |
| --- | --- |
| `projects` | Unique ID/code; authoritative owner; text; lifecycle; timezone; optional dates/precision; revision; timestamps |
| `project_memberships` | Canonical user, project, role, active/revoked state; unique project/user |
| `project_invitations` | Recipient identity, granted role, inviter, token hash, expiry, acceptance/revocation |
| `project_ownership_transfers` | Current/proposed owner, expiry, acceptance/cancellation, proposal revision |
| `project_topics` | Project; immutable topic number; text; workflow/progress; blocker/reason; schedule/precision; weight; position; archive flag; revision |
| `project_topic_assignees` | Topic and same-project membership; primary flag; unique topic/member |
| `project_progress_reports` | Project/topic/author; reported values; summary/reason; optional correction reference; timestamp |
| `project_events` | Ordered report and non-report history, actor, structured before/after values |
| `project_mutations` | Idempotency key, actor, request fingerprint, stored result, retention policy |
| `project_notification_settings` / reminder jobs | Slice B consent, destinations, deadline revision, scheduling and cancellation; integrate durable delivery infrastructure |
| `project_dependencies` | Slice C same-project predecessor/successor edges |
| `project_milestones` | Slice C title, due instant/precision, state, revision |

Required constraints and migration behavior:

- Follow current plain table naming and canonical account foreign keys. Prevent cross-project assignments, reports, and dependencies with composite foreign keys where appropriate, backed by service checks.
- Validate states, integer progress bounds, workflow/progress consistency, positive weight, date ordering, and blocker reasons at the appropriate database/service boundary.
- Enforce zero or one primary assignee with a partial unique index. Assignees must be active non-viewers. Multiple collaborators must not create multiple primary owners.
- Treat the project's owner reference as authoritative; serialize transfer/membership changes so the owner cannot be removed or duplicated.
- Lock appropriate topic/project records for conflicting mutations. Serialize dependency-cycle validation per project so concurrent edges cannot each pass against stale graphs.
- Stable topic numbers are independent of display order. Reordering must not change command references or links.
- No cascade-deleting history on archival or member revocation. Future permanent deletion/account erasure requires explicit retention/anonymization rules; append-only does not imply indefinite retention.
- Account merge must handle ownership, memberships, assignments, bound invitations, transfers, and author references. Resolve overlaps deterministically, preserve the strongest valid role and attribution, and test ownership cases.
- Index membership lookup, topic ordering, cursor history, invitation lookup, and due-job claims. Avoid redundant indexes for already unique codes.
- Use additive migrations and rollback-safe gating. Do not drop existing tables or mix this domain into legacy voice/bot tables.

## 10. Proposed API contract

Base: `/api/megu/projects`. All routes require authenticated actors, server-side access checks, bounded input, same-project validation, and the application's mutation/CSRF protections. Discord calls the same core services with a verified actor; supplied `userId`/`discordUid` is never authority.

| Route suffix | Method | Purpose / restriction |
| --- | --- | --- |
| `/` | GET / POST | Paginated accessible directory / create planning project |
| `/:code` | GET / PATCH | Authorized summary / owner-lead metadata, excluding lifecycle and roles |
| `/:code/state` | POST | Explicit authorized transition with revision and required reason |
| `/:code/invitations` | POST | Role-bounded, recipient-bound invitation |
| `/:code/invitations/:id` | DELETE | Revoke pending invitation |
| `/invitations/:token/accept` | POST | Matching authenticated recipient accepts; token alone is insufficient |
| `/:code/members` | GET | Membership list |
| `/:code/members/:id` | PATCH / DELETE | Role-bounded change / revoke or authorized self-leave |
| `/:code/ownership-transfer` | POST | Owner proposes expiring recipient-confirmed transfer |
| `/:code/ownership-transfer/:id` | DELETE | Current owner cancels pending transfer |
| `/:code/ownership-transfer/:id/accept` | POST | Recipient accepts; recheck proposal, expiry, membership, current owner |
| `/:code/topics` | GET / POST | Filtered list / owner-lead creation |
| `/:code/topics/:id` | GET / PATCH | Detail / owner-lead metadata, dates, position, archive flag; excludes reported state |
| `/:code/topics/:id/assignees` | PUT | Atomic owner-lead assignment replacement |
| `/:code/topics/:id/reports` | GET / POST | Paginated history / assigned-member or owner-lead report |
| `/:code/topics/:id/review` | POST | Owner-lead approve, return, reopen; atomic event/state change |
| `/:code/events` | GET | Cursor-paginated updates |
| `/:code/notification-settings` | GET / PATCH | Slice B owner-managed destinations; personal preferences remain account-scoped |
| `/:code/dependencies` | POST | Slice C owner-lead edge creation |
| `/:code/dependencies/:id` | DELETE | Slice C owner-lead edge removal |
| `/:code/milestones` | GET / POST | Slice C list / owner-lead creation |
| `/:code/milestones/:id` | PATCH / DELETE | Slice C owner-lead edit/reach/remove with history |

Bound summary responses rather than returning unlimited full bundles. Use deterministic `(created_at, id)` history cursors. Mutations return authoritative changed records, revisions, and relevant aggregates.

Reject unknown mutable fields. Mutations carry expected revisions; event-creating actions carry persistent idempotency keys. Use structured field errors, `401` for unauthenticated access, neutral `404` for inaccessible projects, `403` for forbidden actions inside accessible projects, `409` for stale revisions/idempotency conflicts, `422` for validation, and `429` for rate limits. Follow the existing response-envelope convention rather than inventing a second global format.

## 11. Copy, edge states, and limits

### Localization

Provide EN/TH for UI, command replies, validation, relative time, and notifications. Reuse established locale selection and Thai typography. Dates need a consistent explicit year convention; codes remain unchanged and copyable. Test long Thai and mixed-script names without fixed-height clipping.

| English intent | Proposed Thai copy |
| --- | --- |
| My work | งานของฉัน |
| Report progress | รายงานความคืบหน้า |
| Request completion review | ขอให้ตรวจรับงาน |
| Blocked | ติดปัญหา |
| Unassigned | ยังไม่ได้มอบหมาย |
| No deadline | ยังไม่กำหนดส่ง |
| Changes not saved. Your draft is still here. | ยังบันทึกไม่ได้ ข้อมูลที่กรอกยังอยู่ |

Review labels against the existing glossary in context before shipping. Prefer specific recovery actions to generic errors. A queued notification must never be described as delivered.

### Required states

- Loading: stable skeleton, no flash of unauthorized project content.
- No topics: owner/lead sees Add topic; others see planning has not started.
- No assignments, no filtered results, no updates: separate explanations and useful actions.
- Unscheduled, overdue, blocked, awaiting review, paused, closed: explicit labels and only valid actions.
- Stale edit: latest values alongside retained unsaved proposal for deliberate retry.
- Lost access while editing: stop submission, explain the change, do not leak refreshed private data.
- Network failure: retain in-memory draft and retry safely; no default private-report persistence in shared-browser storage.
- Notification failure: tell the owner about destination problems without treating a successfully saved report as failed.

Proposed pilot limits, not current product limits: 100 non-archived topics and 50 active members per project; 120-character titles; 4,000-character descriptions/report summaries; 1,000-character blocker/review reasons; history pages of 30, maximum 100. Enforce published limits across surfaces where platform input limits permit. Explain narrower Discord fields and link to the web; never silently truncate. Profile at these limits and test larger historical datasets through pagination before expansion.

## 12. Delivery sequence and acceptance gates

No fixed dates or effort estimates are promised before implementation discovery. Each stage delivers evidence, not just files.

1. **Approve pilot:** confirm fit with `DIRECTION.md`, accept/amend proposed defaults, define audience and feature gate.
2. **Core and storage:** additive migrations, identity, permissions, lifecycle, assignments, reporting transactions, events, account merge. Prove contracts in isolated-database tests before exposing writes.
3. **Pilot vertical slice:** create/invite/assign/report/review on web and Discord; responsive Topics and read-only Timeline; all empty/error states in EN/TH and both themes.
4. **Slice A acceptance:** run the matrix below and observe lead/contributor tasks. Fix blocking usability/correctness issues before enabling the pilot.
5. **Slice B:** durable opted-in notifications, destination validation, scheduling revisions, failure visibility. Exercise restart/failure scenarios before enabling sends.
6. **Slice C:** form-first dependencies/milestones, then pointer scheduling. Prove equivalence, conflicts, and concurrency-safe cycle detection.
7. **Rollout/rollback:** expand after reviewing access errors, conflicting edits, report/delivery failures, and task completion. Gate off entry points and scheduled sends when necessary; preserve data and avoid destructive rollback migrations.

### Verification matrix

| Area | Required evidence |
| --- | --- |
| Authorization | Nonmember cannot enumerate/read; viewer cannot write; assignee cannot reschedule; lead cannot self-promote; cross-project IDs rejected |
| Identity | Recipient verified; revoked/expired invites rejected; overlapping membership/ownership account merges preserve invariants |
| Lifecycle | Planning/paused/terminal restrictions; valid reopening; force-close reason; incomplete rollup preserved |
| Reporting | Same-key retry inserts once; changed payload conflicts; simultaneous reports cannot silently overwrite; transaction rollback leaves no partial state |
| Progress | No-topic display; equal-weight rollup; independent blocker; approval rules; archive/restore denominator events |
| Scheduling | Missing dates, date-only input, timezone changes, DST boundaries, target-date warnings, stale revisions |
| Advanced scheduling | Concurrent cycles and cross-project edges rejected; milestones excluded from rollup; keyboard/pointer equivalence |
| Notifications | Opt-out/revocation, reassignment, rescheduling, pause/close, restart, lease expiry, rate limits, lost acknowledgement, channel access failure |
| Interface | First-screen action discovery; keyboard completion; focus return; reduced motion; zoom; narrow layouts; long EN/TH; both themes |
| Operations | Pagination, pilot-size profiling, gating actions/sends, diagnostics without report bodies or invite tokens in logs |

Use an explicitly isolated test database and mocked Discord/email transports. Never run destructive fixtures against production data or send real channel messages during automated verification.

## 13. Defaults awaiting product approval

Recommended defaults: private recipient-bound access; equal weights; one primary assignee plus collaborators; lead-approved completion; lead-controlled scheduling; explicit section saves. Preserve Gantt as the planning surface with Topics as its fully functional accessible alternative. Notifications require consent; dependencies/milestones follow the core reporting workflow rather than delaying it.

These defaults were implemented for the feature-gated pilot. The shipped surface keeps private recipient-bound access, equal topic weights, one primary assignee plus collaborators, lead-approved completion, lead-controlled scheduling, explicit section saves, opt-in notifications, and a fully functional Topics alternative to the Gantt.

## 14. Implementation record

Implemented surfaces and integration points:

- Web directory, project worktable, protected administration, and invitation acceptance at `/projects`, `/p/[code]`, `/p/[code]/manage`, and `/projects/invitations/[token]`.
- Projects core domain, additive schema, permissions, lifecycle, invitations, ownership transfer, account merge behavior, assignments, reporting, review, history, dependencies, milestones, and timezone-safe scheduling.
- Durable account and validated Discord-channel notifications with deadline revisions, leased claims, retry/backoff, revocation checks, failure visibility, and feature-gate suppression.
- Ephemeral Discord `/projects` workflows with inaccessible-data-safe autocomplete, idempotent reporting, no automatic mentions, and English/Thai replies.
- Responsive EN/TH interface with explicit empty/overdue/blocked states, accessible tabs and forms, sortable Topics, keyboard and pointer scheduling, conflict recovery, report preview, unsaved-change protection, focus-managed mobile details, and authoritative save announcements.
- Shared Timeline/Topics attention filters for blocked, overdue, awaiting-review, and primary-unassigned work, combined with Assigned to me and multilingual title search. Filter URLs are bounded and restorable; selected details and report drafts survive row filtering; Timeline scheduling context remains project-wide.
- Unified report-action eligibility across the workspace header, chooser, detail panel, and core: active owners/leads can report any unfinished topic, active members only their assignments, and viewers cannot report.

Verification completed on 2026-09-09:

- An explicitly isolated PostgreSQL database passed the Projects integration suite, including authorization boundaries, invitations, lifecycle restrictions, account merge behavior, concurrent reports, dependency-cycle serialization, deadline revalidation, and cleanup isolation.
- Mocked Discord-channel delivery passed overlapping-worker deduplication, restart and expired-lease recovery, bounded retry/backoff after rate limiting, lost acknowledgement handling, current-destination revalidation, and failure-state visibility.
- Pilot-size profiling completed with 100 topics and 50 members: the workspace returned the full pilot topic/member set with history bounded to 30 records; a representative run measured about 133 ms for the workspace bundle, 7 ms for a 30-event history page, and 4 ms for the directory row.
- Real-browser QA covered 320, 390, 768, 1024, and 1440 CSS-pixel layouts; the 1366×768 first viewport; a 720 CSS-pixel zoom-equivalent viewport; light and dark themes; Thai copy; tab-keyboard navigation; mobile dialog focus entry, Escape dismissal, and focus restoration; retained drafts and unsaved-navigation warning; and safe Markdown rendering. No page-level horizontal overflow remained in the checked views.
- Reduced-motion behavior is present in the scoped workspace stylesheet and covered by the interface contract test. Scheduling and reporting retain form-based keyboard/touch alternatives to pointer interaction.
- Projects contract, copy parity, core, auth/notification, account-merge, dispatcher, and scale suites passed. `git diff --check` passed and the optimized Next.js production build completed successfully.

Attention-filter verification completed on 2026-09-13:

- Pure behavior coverage passed attention overlap, completed exclusions, canonical deadline boundaries, invalid dates, collaborator-without-primary accountability, report eligibility by role and lifecycle, assignee/search composition, Thai search, URL validation, 120-character bounds, and unrelated query preservation.
- Copy parity and Projects source contracts passed. The contract asserts that filtered rows do not replace the full topic set used by dependencies, milestones, and Fit project.
- Focused browser QA covered the detail-open compact layout, full-width desktop controls, 390 CSS-pixel mobile layout, English/Thai expansion, selector keyboard semantics, result announcements, and both theme palettes.
- The optimized Next.js 16.3.0 build and `git diff --check` passed. Database/reporting mutations were not required because the feature is a read-only client derivation and leaves existing authorization and action gates unchanged.

### Pilot enablement note

The implementation evidence is complete for the feature-gated pilot. Product owners still need to choose the initial audience, enable the gate, and monitor access errors, conflicts, report failures, notification failures, and observed task completion during the limited rollout. Real Discord sends remain off in automated verification; test coverage uses mocked transports and the isolated database only.
