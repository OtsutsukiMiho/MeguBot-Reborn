# Projects manager — implementation review and improvement plan

Reviewed: 2026-09-12. Status: recommendations, not an implementation authorization.

Baseline: `PROJECTS_DESIGN_PLAN.md`, the current working-tree source, and the screenshots supplied during this session. This review includes recent uncommitted changes. It does not certify the live deployment or repeat the original pilot's database, browser, or delivery tests.

## 1. Overall assessment

The main product is implemented: a project directory, Timeline/Topics/Updates workspace, topic reports and review, people and lifecycle settings, scheduling, and notification integration. Recent changes improve the everyday experience substantially: wider project pages, Discord avatars, custom selectors, clearer percentages, colored actions/events, and owner-approved join requests.

The next iteration should consolidate these changes and complete recovery paths before adding another major view. The largest gaps are now consistency, discoverability, and behavior after refresh, rejection, expired links, or failed requests.

The original plan's blanket “implemented and verified” status is historical evidence from September 9. It should not be interpreted as verification of every subsequent change.

## 2. Plan versus current implementation

| Area | Current evidence | Assessment |
| --- | --- | --- |
| Directory | `app/projects/page.js`: Active/Closed, search, assigned filter, pagination, creation, state and progress | Main planned surface exists; search accessibility needs attention |
| Worktable | `ProjectWorkspace.js`: Timeline, Topics, Updates, detail panel, reporting and review | Main workflow exists; report entry points now share one eligibility derivation |
| Scheduling | Timeline controls, drag confirmation, schedule editor, milestones and dependencies | Present; preserve the form alternatives and recheck localized/date edge cases |
| People | `ProjectManage.js`, `ProjectJoinSettings.js`: members, role changes, global join link, approval role selector | Deliberate evolution from the original recipient-bound-only plan |
| Legacy invitations | Core/API and invitation acceptance remain; creator/list removed from People | Compatibility remains, but the user-facing policy and legacy revocation story need documenting |
| Notifications | Project DM switch, channel configuration, reminder jobs, delivery failure UI | Present; delivery configuration needs clearer feedback and verification |
| Identity | `ProjectAvatar.js` used across project surfaces; request list obtains Discord avatar data | Improved; shape and sizing still depend on each caller's CSS |
| Progress | Larger header metric and topic-row percentage with tracks | Improved; responsive consistency and accessible announcements still need browser checks |
| Browser title | Workspace sets project name after authorized data load | Implemented for workspace; manage route lacks equivalent project-specific title handling |
| Pilot gate | API checks `MEGU_PROJECTS_ENABLED === '0'` | Gate defaults to allowing access when unset; document this instead of implying explicit opt-in enablement |

Source paths above are under `app/components/projects/` unless stated otherwise. Core behavior lives in `core/projects.js`, `core/project-reminders.js`, and `adapters/http/megu-api.js`.

## 3. Priority 1 — complete the current workflows

### 1. Join-link recovery and request lifecycle

**Confirmed:** `ProjectJoinSettings` retains the newly generated URL only in component state. `listJoinRequests` returns link expiry but not the token. Refreshing or reloading People loses the copyable link while still reporting an active link. Replacing it revokes the previous link.

**Improve:** Clearly distinguish “Create link” from “Replace link”; show the actual expiry in the project timezone. Explain the one-time copy limitation and the effect of replacement. Do not expose token hashes or place private tokens in logs. If repeat copying is required, choose a deliberate protected token-storage design rather than treating a hash as recoverable.

**Confirmed:** `requestProjectJoin` validates link expiry before checking existing membership or request status. Existing rejected requests are returned indefinitely; a new link does not reset them. An approved request followed by membership removal can return `approved` without a destination project, leaving an unclear recovery path.

**Improve:** Define separate rules for submitting a new request and reading the signed-in user's existing status. Add explicit owner-controlled reconsideration/reapplication and a useful state for previously approved users who no longer have membership. Keep expiry meaningful for new requests.

**Acceptance:** Refresh, link replacement, expiry while pending, rejection, approval, and later membership removal each show a clear next action. None grants access before authorization. Link replacement does not accidentally strand an already approved user.

### 2. Align report actions with permissions

**Resolved 2026-09-13:** The header, chooser, and detail panel now use one reportable-topic derivation. Active owners/leads receive every unfinished topic, active members receive only their assigned unfinished topics, and viewers or inactive projects receive no report action. The server mutation also rejects the viewer role explicitly.

**Remaining polish:** Explain paused/planning states and lack of assignments in context without adding a misleading disabled action.

**Acceptance:** Covered by pure role/lifecycle behavior tests and source contracts. Database integration remains part of the isolated Projects suite; do not run it against an unverified configured database.

### 3. Restore an accessible search name

**Confirmed:** The directory search input has no visible label text, `aria-label`, or `aria-labelledby`. The wrapping label contains an icon marked `aria-hidden`.

**Improve:** Keep the user-requested clean search appearance and add an EN/TH accessible name. A concise placeholder can be considered separately without restoring the removed wrapping text.

**Acceptance:** A screen reader announces the search purpose; typing, clearing, and filtering remain keyboard operable.

### 4. Make date conventions explicit and shared

**Confirmed:** Buddhist-year conversion is duplicated in workspace/manage helpers. Directory date formatting uses raw `Date` values. Topic input and general/project-creation input paths do not all normalize at the same point. Current core/date tests cover a Buddhist-year example, so this is not evidence that every current input still fails.

**Improve:** Share date parsing and display helpers with an explicit Gregorian/Buddhist convention. Label the expected input year, preserve project timezone and date precision, and avoid silently interpreting unrelated future Gregorian years as Buddhist years. Inspect existing suspicious stored dates before proposing any migration; do not bulk subtract 543 from data.

**Acceptance:** Thai 2569 and the corresponding Gregorian 2026 resolve predictably across creation, editing, directory, Gantt and history. Invalid dates, timezone changes and DST boundaries have meaningful tests.

## 4. Priority 2 — layout and interaction consistency

### 5. Adapt to panel width, not just viewport width

**Source-based risk, browser verification required:** Topic rows reserve several minimum-width columns, while responsive rules largely depend on viewport width. A wide viewport can still contain a narrow main panel when topic details are open. The header's new progress markup also retains a mobile rule positioning `em` as a grid item even though it now sits in a flex wrapper.

**Improve:** Use container-aware breakpoints for the list and header progress. Keep topic identity first, avatar/name grouped, status in a stable track, and percentage easy to scan. Allow long localized statuses to wrap within their own region. Remove obsolete selectors after confirming equivalent behavior.

**Acceptance:** Test detail open/closed at 320, 390, 768, 1024, 1366 and 1440 CSS pixels, plus 200% zoom. No page-wide overflow; no collisions or hidden assignees; Thai labels remain readable.

### 6. Consolidate avatar and progress components

**Confirmed:** `ProjectAvatar` renders the image with inherited radius; callers supply shape, background and dimensions. The recent square-avatar regression came from a caller using only a size class.

**Improve:** Give the component a circular default, clipping, fixed aspect ratio, and size variants. Keep Discord avatar preference and fallback initials. Extract a small reusable progress presentation with sizes suitable for directory, topic row, header and detail. Preserve the distinction between reported estimate and accepted completion.

**Acceptance:** All avatar callers show circles for images and fallback initials. Progress handles 0%, 100%, and no topics distinctly. A screen reader receives a meaningful progress label/value without duplicate or missing row information.

### 7. Finish the request-review interaction

**Confirmed:** Request names are now grouped with avatars and a custom Lead/Member/Viewer selector. The component still has one global busy state; the role selector is not disabled while submitting. `createdAt` is returned but not shown, and pending request data has no explicit loading presentation.

**Improve:** Show request age, a loading/empty/error distinction, and per-request pending/success feedback. Freeze that request's role during submission. Explain the selected role's access briefly. Refresh memberships and pending requests without replacing the entire settings page with a skeleton.

**Acceptance:** Approving one person cannot visually change their selected role midway through the request. A failed approval preserves the selection. Long names remain readable, and keyboard focus survives the row disappearing.

### 8. Retain work and context during refresh

**Confirmed:** Manage's `load` sets page loading on every reload. Workspace supports a quiet reload in some flows. This inconsistency can unmount controls and lose local state, including the just-created join URL.

**Improve:** Separate initial loading from mutation refresh. Update affected records, retain scroll and active section, and announce success near the action. For report conflicts, verify that retained drafts have an explicit path to reviewing latest values and retrying safely with the correct revision/idempotency behavior.

**Acceptance:** Role edits, approval, and notification saves preserve the active tab and focus. Network failures retain drafts. An uncertain report response followed by retry cannot duplicate a report.

### 9. Make Updates easier to understand

**Confirmed:** Event colors and filters exist; several event summaries still depend on generic payload title/summary/reason rendering.

**Improve:** Render concise event-specific descriptions: who changed what, affected topic, and meaningful old/new values. Include request approval role and schedule/assignment changes where available. Use color as a supporting cue, retain text labels, and link the affected topic. Persist filters when sharing a workspace URL where useful.

**Acceptance:** A lead can understand a schedule or assignment change without opening multiple topics. English and Thai have matching event coverage and pagination remains stable.

## 5. Priority 3 — useful product additions

| Idea | User value | Scope and completion criteria |
| --- | --- | --- |
| Attention filters | Find blocked, overdue, unassigned or awaiting-review work quickly | Add a small filter group to Timeline/Topics with counts and clear reset; avoid another dashboard of cards |
| Guided first project | Reduce setup uncertainty | A compact checklist for first topic, assignee, join link and activation, driven by actual saved state |
| Notification delivery clarity | Understand who receives reminders and why | Explain project switch versus personal preferences; show last attempt/outcome without private report text; any test-send action must be explicit |
| Consistent browser titles | Identify multiple open projects | Workspace and manage use authorized project name; generic title during loading or access denial |
| Searchable people at pilot limit | Make 50-member administration manageable | Name search and role filter while preserving owner placement and keyboard access |
| Collaborators during topic creation | Avoid a second edit step | Optional custom multi-selection with an explicit primary assignee; retain a simple default for one-person topics |

Keep Kanban, attachments, threaded discussion, automatic rescheduling and workload forecasting deferred until evidence shows they solve a recurring user problem.

## 6. Reconcile the original plan

Update the baseline plan in a future implementation/documentation pass:

1. Record owner-approved global join links as the primary web entry flow. A link requests access; it does not grant project membership.
2. Record role selection during approval and the owner-only approval rule. Explain the remaining recipient-bound API/Discord compatibility and decide how owners revoke legacy invitations without restoring the removed creator.
3. Add join-link/request routes and storage to the API/storage tables.
4. Record project DM settings separately from account preferences and channel destinations.
5. Record the recent avatar, selector, width, progress and browser-title changes.
6. Replace unconditional completion wording with dated verification evidence and remaining acceptance checks.
7. Document gate defaults from source and verify the intended deployment setting without treating a missing variable as a disabled pilot.

## 7. Recommended implementation sequence

| Batch | Work | Exit evidence |
| --- | --- | --- |
| A — workflow correctness | Join recovery policy, report eligibility, accessible search, date conventions | Meaningful unit/integration cases for permissions, request states and date behavior; focused keyboard check |
| B — interface consistency | Container-aware rows, shared avatars/progress, request feedback, quiet refresh | Desktop/mobile and light/dark screenshots with long Thai/English content; retained-focus and draft checks |
| C — operational clarity | Event descriptions, delivery feedback, title consistency, attention filters | Lead/member/viewer tasks completed without coaching; notification transports mocked in automated checks |
| D — documentation | Reconcile baseline plan and rollout notes | Claims map to current source and dated evidence; deferred work remains explicit |

No new infrastructure or schema migration is required for every item. Decide migrations only after the relevant lifecycle/token-storage design is selected.

## 8. Verification performed for this review

- Read the baseline plan and inspected current directory, workspace, manage, join UI, styles, request core and API integration.
- Re-ran `node tests/project-join.test.js`: passed.
- Re-ran `node tests/projects-contract.test.js`: passed.
- These tests include mocked core behavior and source contracts. They do not prove live browser layout, real Discord delivery, database concurrency or all new role choices.
- Earlier successful builds and September 9 pilot checks are historical evidence. No new production build, database fixture run, real notification send or live browser session was performed for this document-only review.

Recommended next step: implement Batch A, then verify Batch B against the current screenshots and real responsive layouts. Preserve the current visual identity and the user's decision to use only the global join-link creator.
