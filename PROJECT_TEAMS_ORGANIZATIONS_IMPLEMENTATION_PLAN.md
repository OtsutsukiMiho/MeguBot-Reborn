# Project teams and organizations — implementation plan

Status: implemented locally on 2026-09-14; schema, domain, API, UI, compatibility, and focused verification are complete. Production rollout remains an operator action.

## 1. Outcome and product decisions

Introduce reusable teams so a user can maintain a roster once and choose people from it for multiple projects. Preserve standalone projects and their existing shareable, owner-approved join links. Remove the redundant Account item in the global navigation; keep account access through the signed-in username.

Use **Team** in the initial UI. A team may represent an organization, company, club, or informal group. Use one entity, not separate organization and team hierarchies. Nested departments, billing, SSO, custom permission builders, and multiple teams owning one project are out of scope for this release.

Recommended decisions for the implementation agent:

- Projects have either no team (standalone) or exactly one team.
- Team membership and project membership are separate. Joining a team does not grant access to all its project content.
- A project owner selects active team members for that project and assigns their project roles.
- Team roles are fixed: owner, admin, member. Project roles remain owner, lead, member, viewer.
- Team name, description, and a theme-color swatch are customizable. Use a generated initials mark initially; member avatars come from Discord. Custom role labels and uploaded logos can follow later.
- Team projects require team membership. External contributors must join the team first. Standalone projects retain their current invite flow.
- Existing projects remain standalone unless their owners explicitly convert them.

## 2. Current implementation to preserve

Verified source entry points:

| Surface | Current source / behavior |
| --- | --- |
| Domain and authorization | `core/projects.js`; existing owner/lead/member/viewer roles and revision checks |
| Storage | `core/schema.js`; `projects`, `project_memberships`, topic assignees, invitations, join links/requests, ownership transfers, events and notification jobs |
| Project directory | `app/projects/page.js` |
| Workspace | `app/components/projects/ProjectWorkspace.js` |
| Settings / people | `app/components/projects/ProjectManage.js` |
| Join-link controls | `app/components/projects/ProjectJoinSettings.js` |
| Join flow | `app/components/projects/ProjectJoin.js`, `app/projects/join/[token]/page.js` |
| Shared controls | `CustomSelect`, `ProjectAvatar`, existing project CSS modules |
| Navigation | `app/components/Navbar.js`; username already links to `/account`, alongside a separate Account menu item |
| Regression coverage | `tests/projects.test.js`, `tests/projects-contract.test.js`, `tests/projects-scale.test.js` |

Before coding, locate the actual route handlers for `/api/megu/projects` and reuse their session, validation, authorization, error, and transaction conventions. Read repository instructions and the installed Next.js guides before changing app components. Do not assume the backend web server owns every route.

## 3. User experience

### Projects directory

Keep Projects as the global navigation entry. Inside `/projects`, add an accessible scope selector: All projects, Standalone, and each team the user belongs to. Include a Manage teams link, rather than adding another crowded global nav item.

Create project begins with **Standalone** or **Team project**. Team selection offers only teams where the user may create projects. Default to the selected team when creation starts from its page; otherwise default to standalone. Explain the access model before submission.

Project rows show a small team name or Standalone label. All projects must contain only projects the user is allowed to open; team membership alone must not leak project titles through the directory, search, counts, or notifications.

### Team pages

- `/teams`: teams the current user belongs to, with create-team action.
- `/teams/[teamId]`: team identity and projects accessible to the current user.
- `/teams/[teamId]/manage`: General, People, Join requests, and Ownership/archive sections. Owner/admin can manage the roster; owner-only controls stay visibly distinct.
- `/teams/join/[token]`: minimal public entry, Discord sign-in if necessary, request access, pending/approved/rejected/expired states.

People rows align Discord avatar and display name together on the left, with role and actions on the right. Include roster search, pagination, member count, and meaningful empty/loading/error states. Use the existing custom select, circular Discord avatars, English/Thai copy, responsive layout, and visible keyboard focus.

### Project settings → People

Standalone projects keep the existing join-link controls and project-owner approval with a project-role dropdown.

Team projects show team identity, project members, and **Add from team**. Open a searchable multi-select roster with Discord avatars. Exclude existing project members and inactive team members; assign an initial project role (member by default). Apply a bulk addition atomically, with server-side revalidation of every selection. Existing members can receive different roles afterward.

Do not show standalone join-link creation on team projects. Show a concise explanation and a team-management link only to people allowed to use it. Project leads may select ordinary contributors from the team, but cannot grant lead or owner privileges.

### Navigation simplification

Remove only the `/account` menu item from `Navbar.js`. Keep username account access and make the avatar and username one accessible `/account` link if practical. Preserve sign out, developer visibility, language controls, and theme toggle. Ensure the identity link remains available at mobile widths and exposes `aria-current="page"` on account routes.

## 4. Authorization contract

Enforce permissions in the domain/service layer as well as the UI.

| Action | Team owner | Team admin | Team member |
| --- | --- | --- | --- |
| Edit team profile | Yes | Yes | No |
| Create team project | Yes | Yes | No |
| Create/revoke team join link, review requests | Yes | Yes, approve as member only | No |
| Promote/demote admin | Yes | No | No |
| Remove ordinary team member | Yes | Yes | Self-leave only |
| Transfer team ownership or archive team | Yes | No | No |
| Read project contents | Only with active project membership | Only with active project membership | Only with active project membership |

The creator of a team project becomes its project owner. Team ownership does not implicitly override project ownership. Preserve the existing project owner/lead permission boundaries, including notifications, approval, lifecycle, and ownership transfer.

Effective access to a team project requires both active team membership and active project membership. A user can have different roles in different teams and projects. Never infer authority from Discord guild roles or client-supplied role fields.

## 5. Storage and domain model

Use additive migrations through the existing schema mechanism. Adapt names/types to existing identity and ID conventions.

- `teams`: id, name (1–120), description (0–4000), color from an allowlist, created_by, created_at, updated_at, archived_at, revision.
- `team_memberships`: team_id, user_id, role (owner/admin/member), joined_at, revoked_at. Unique team/user pair; partial unique active-owner index. Enforce at least one active owner through transactions, not only the index.
- `projects.team_id`: nullable FK to teams with deletion restricted; index it. Existing rows remain null.
- `team_join_links`: team_id, token_hash, expires_at, revoked_at, created_by, created_at. One active link per team; reuse the project flow's token hashing and expiry conventions (seven days).
- `team_join_requests`: team_id, user_id, originating_link_id, status, requested_at, reviewed_at, reviewed_by. Prevent duplicate pending requests per team/user.
- `team_ownership_transfers`: current owner, proposed owner, expiry, status, revision as needed; reuse the two-party acceptance pattern.
- `team_events`: actor, event type, relevant IDs, timestamp, and bounded non-secret metadata for roster, role, link, conversion, and ownership changes.

Keep `project_memberships` as the project roster. Do not copy the entire team into every project or invent parallel project-role storage. Keep old authors and reports intact when access is revoked. Rejoining a team must not silently reactivate previous project access.

Add `core/teams.js` for team rules; share an explicit effective-project-access helper with `core/projects.js`. Audit all reads and writes, including lists, topics, reports, assignment, exports if present, Discord project commands, reminders, and channel/DM delivery. Background senders must recheck membership immediately before delivery.

## 6. Membership changes and lifecycle invariants

Team removal/leave must transactionally revoke project memberships within that team and end active topic assignments without deleting historical reports. Preserve other teams and standalone memberships. Warn with affected-project and assignment counts, disclose detail only when the actor may read it, and leave topics visibly unassigned where appropriate.

Block removal or leave while the person owns any team project. Return a clear transfer-required result without exposing inaccessible project names. Resolve ownership through the existing project owner; do not silently promote another member. The same rule applies to the team owner leaving before team ownership transfer.

Project ownership transfers on team projects may target only active team members. Removing someone from one project does not remove them from the team. Team admins cannot remove/promote peer admins; only the owner can. No one can use self-demotion or concurrent requests to remove the last owner.

Archive is reversible and does not delete projects or memberships. An archived team denies new projects, roster changes, join approvals, and project mutations; existing authorized users retain read access. Revoke join links when archiving. Require the owner to restore the team before new writes; restoration does not revive revoked links. Defer hard deletion.

## 7. Invite compatibility and project conversion

### Standalone compatibility

Preserve `/projects/join/[token]`, owner-only project approval, existing role selection, expiry/revocation, and existing invitations. Never reinterpret an old project token as a team token. Authentication redirects must retain the intended request without exposing the token to logs or analytics.

### Team joins

Team links request team membership, never automatic project access. Approval defaults to member; admins cannot grant admin/owner through approval payloads. Link rotation/expiry/revocation prevents new requests and invalidates pending requests originating from that link; enforce the same rule at review time. Duplicate/replayed approval is idempotent. Use rate limits and existing session/CSRF protection.

### Convert standalone → team

Allow only the project owner who is also owner/admin of the destination team. Present the target team, existing roster, outstanding requests, and consequences before committing.

Require every current project member to be an active destination-team member. Show unresolved members and direct the owner to invite them to the team or explicitly remove them first. Do not silently enroll people into a team or discard members.

In one transaction, set team_id, preserve project roles and history, revoke project join links and targeted invitations, reject pending standalone join requests with a conversion reason, increment revision, and write an audit event. Concurrent approval must recheck project mode under the same lock and fail after conversion.

Existing team projects cannot be detached or moved between teams in v1. Show that limitation before conversion. A later transfer workflow needs separate permission and data-disclosure design.

## 8. API proposal

Adapt to the existing API router rather than creating a second server.

| Endpoint | Purpose |
| --- | --- |
| `GET/POST /api/megu/teams` | List own teams / create team |
| `GET/PATCH /api/megu/teams/:id` | Authorized team details / profile update |
| `GET /api/megu/teams/:id/members` | Paginated/searchable active roster |
| `PATCH/DELETE /api/megu/teams/:id/members/:userId` | Role change / removal or self-leave |
| `POST/DELETE /api/megu/teams/:id/join-link` | Generate/rotate / revoke link |
| `GET /api/megu/teams/:id/join-requests` | Review queue |
| `POST /api/megu/teams/:id/join-requests/:requestId` | Approve/reject |
| `GET/POST /api/megu/teams/join/:token` | Minimal preview / authenticated request |
| `POST /api/megu/teams/:id/ownership-transfer` | Propose ownership transfer |
| `POST/DELETE /api/megu/teams/:id/ownership-transfer/:transferId` | Accept / cancel transfer |
| `POST /api/megu/teams/:id/archive` and `/restore` | Team lifecycle |
| Existing project create endpoint | Accept optional teamId and validate creator authority |
| `POST /api/megu/projects/:code/team` | Explicit standalone conversion |
| `POST /api/megu/projects/:code/members` | Add selected team members with validated roles |

Use explicit known-field validation, bounded pagination and batches, domain error codes, and expected revisions for mutable resources. Lock team then affected projects in stable ID order for membership cascades and conversion. Reuse that order across competing operations to avoid deadlocks. Return capabilities with team/project responses so UI and server policy stay aligned, while rechecking policy on every mutation.

## 9. Implementation sequence and handoff

1. **Baseline:** inspect API routing, current membership checks, schema updates, account merge behavior, notification recipients, and local test-database setup. Record actual paths and capture standalone invite regression behavior.
2. **Schema/domain:** introduce additive tables/team_id and team services; implement role and effective-access checks, transaction locking, removal, archive, and ownership transfer. Extend account merge so team memberships, sole ownership, requests, and transfers remain consistent when identities combine.
3. **API:** implement team endpoints and project extensions. Preserve old endpoint behavior for team_id=null. Test authorization and races before enabling UI.
4. **Team UI:** directory, identity editor, roster, approvals, ownership/archive, and join page. Use existing UI conventions and EN/TH copy. Keep focus stable when editing modal fields.
5. **Project integration:** scope filter, create-mode choice, team indicator, roster picker, and explicit conversion screen. Continue standalone join controls untouched for standalone projects.
6. **Navigation:** remove Account menu entry and verify username/avatar account access on desktop/mobile.
7. **Verification/rollout:** run required domain and integration tests against an isolated database, app build, and browser acceptance flows. Update implementation notes with results and any unresolved requirements. Do not mark incomplete manual gates as passed.

Suggested new components: `TeamDirectory`, `TeamManage`, `TeamJoin`, and `ProjectTeamPicker`. Prefer small focused components to further expanding the existing large project settings/workspace files.

## 10. Acceptance checklist

- Existing standalone project data, membership roles, invite URLs, and approval behavior remain valid after migration.
- A user can create/customize a team, share its link, approve a member, and reuse that roster in two projects.
- A user can belong to multiple teams with distinct roles without cross-team data exposure.
- Joining a team alone cannot reveal unassigned project content through page/API/list/count/search/notification paths.
- Add-from-team validates active membership and permissible roles on the server; crafted cross-team IDs are rejected.
- Team removal revokes project access and future notification delivery; historical reports remain attributed correctly.
- Rejoining does not restore former project access automatically.
- Last-owner safeguards, peer-admin restrictions, project ownership blockers, and two-party transfers hold under concurrent requests.
- Link expiry, rotation, revocation, approval replay, duplicate requests, and sign-in redirects behave predictably.
- Conversion keeps history and roles, refuses unresolved members, and cannot race with an old standalone approval.
- Archived teams remain readable to authorized users and reject writes consistently across web and Discord paths.
- Team pages and custom selects work with keyboard navigation, EN/TH, long names, empty/error states, and mobile layouts.
- Account disappears from the top menu while username/avatar still opens `/account`, including on mobile.
- Relevant existing project suites and new behavior tests pass; production build passes. Do not run destructive database tests against configured production data.

## 11. Release and rollback

Use a server-side team feature flag and matching UI availability. Add schema before deploying dependent code; enable only after access checks and migration tests pass. Existing standalone projects must continue working with teams disabled.

After team projects exist, do not roll back to code that ignores team_id: it could retain revoked project access. An emergency flag disables team creation/conversion and new team mutations while keeping effective-access checks in place. Prefer a forward fix; never drop team tables or erase membership history as rollback.

Before implementation is considered complete, document actual migration steps, environment flag names, test evidence, and any manual rollout actions in this file.

## 12. Implementation record

Implemented the plan as an additive upgrade. The durable domain decision is recorded in
`docs/adr/0001-team-and-project-membership.md`, and the shared vocabulary/invariants are
recorded in `CONTEXT.md`.

### Delivered

- Added `teams`, `team_memberships`, join links/requests, ownership transfers, audit events,
  and nullable `projects.team_id` through the idempotent statements in `core/schema.js`.
- Added `core/teams.js` with fixed team roles, manager capabilities, revision checks,
  Discord-first avatars, paginated server-side roster search, privacy-scoped removal-impact
  counts, owner/admin boundaries, join approvals, link rotation/revocation, ownership
  transfer, and reversible archive/restore.
- Enforced dual membership for team projects throughout project reads and writes. Team
  removal revokes affected project memberships and clears active assignments without
  deleting report history. Notification claims, reminders, and Discord-channel delivery
  recheck team access before sending.
- Preserved standalone invitations and join links. Team projects reject standalone invite
  creation/acceptance. Standalone-to-team conversion validates the complete roster and
  atomically revokes old invitation paths while retaining project history and roles.
- Added the `/teams`, `/teams/[teamId]`, `/teams/[teamId]/manage`, and
  `/teams/join/[token]` experiences, plus team scopes, team project creation, project badges,
  add-from-team, and conversion within Projects. The UI includes EN/TH copy, custom selects,
  Discord avatars, loading/error/empty/permission states, responsive layouts, and an
  accessible pre-removal confirmation showing authorized impact counts.
- Removed the standalone Account navigation item. The avatar and username form one
  accessible `/account` link and retain `aria-current` on account routes.
- Extended account merge handling for every new team-owned user reference and duplicate
  team membership/request cases.

### Rollout controls and migration order

The flags are documented in `README.md`:

```dotenv
MEGU_PROJECTS_ENABLED=1
NEXT_PUBLIC_MEGU_PROJECTS_ENABLED=1
MEGU_PROJECT_TEAMS_ENABLED=1
NEXT_PUBLIC_MEGU_PROJECT_TEAMS_ENABLED=1
```

Deploy in this order:

1. Back up the database and deploy/run the additive `core/schema.js` initialization. Existing
   projects remain standalone because `projects.team_id` defaults to null.
2. Deploy server and client code with both team flags set to `0`; confirm ordinary project
   reads, writes, and standalone invitation acceptance.
3. Set both team flags to `1`, rebuild the Next.js client so its public flag is embedded, and
   restart the API/worker processes.
4. Smoke-test team creation, one Discord join request, one team project, add-from-team, member
   removal impact, archive/read-only behavior, and a standalone join link before broad use.

Emergency rollback disables team creation, conversion, and team mutation with both team
flags set to `0`. Keep this code version (and its effective-access checks) deployed after any
team project exists; do not drop the additive tables or deploy an older version that ignores
`team_id`.

### Verification evidence

- `node tests/teams.test.js` passed against a disposable PostgreSQL 18 database, covering
  Discord join approval, admin restrictions, dual project access, privacy-scoped removal
  impact, revocation/rejoin behavior, archive/write denial, two-party team ownership transfer,
  conversion, and team-scoped directory visibility.
- `node tests/projects.test.js`, `node tests/project-join.test.js`,
  `node tests/teams-contract.test.js`, `node tests/projects-contract.test.js`,
  `node tests/copy.test.js`, `node tests/auth-notifications.test.js`, and
  `node tests/project-channel-dispatcher.test.js` passed.
- `node node_modules/next/dist/bin/next build` passed with all four team routes included.
- `git diff --check` passed. The existing contrast audit passed in both themes.
- The full runner reached all new team and project suites successfully. It still reports two
  unrelated baseline/environment failures: `discord-oauth.test.js` sees the configured Discord
  proxy instead of its expected default endpoint, and `payments.test.js` has a date-sensitive
  fixture now classified as `uploaded_late` on 2026-09-14. Neither failure touches team code.

### Remaining operator checks

- Run the four-role browser smoke test (owner, admin, member, non-member) against a deployed
  instance with its real Express API and Discord OAuth session.
- Observe query latency and authorization-error rates during the initial rollout. Keep the
  500-member and 200-pending-request limits until production measurements justify changing
  them.
