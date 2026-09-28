# Discord Server Workspaces, Teams, Projects, and Goal Evaluation

## Authoritative clarification — 20 September 2026

The user clarified that “company” is an analogy for an existing Discord server, **not a new group type**. This correction supersedes conflicting company-specific requirements below; those sections remain historical implementation context until rewritten.

- The hierarchy is **Discord server → teams → projects**. Use the server's Discord name/icon and guild ID, not an independently named company identity.
- `/teams` selects a Discord server workspace or an independent team. Server teamwork pages use `/teams/server/[guildId]` and focused child routes; `/servers/[guildId]` remains bot administration.
- Do not expose “Create company,” “Claim company,” a separate company roster, company invitations, company ownership transfers, or company archive/rename controls. Discord owns server identity and server membership.
- Server ownership/administration follows freshly verified Discord authority, not a second app-appointed company owner. Existing explicit team/project ownership and private-content boundaries remain unchanged. Discord authority does not automatically reveal private project content.
- Discord role linking is configured within the server workspace. Department roles create/link teams; title badges remain display-only; role-derived team membership requires the previously specified approval/consent/provenance rules. No separate company admission step is required.
- Retain independent teams, standalone projects and their current invitation flows. Preserve work on project insights and private goals/reviews.
- The in-progress company implementation has not been rolled out. Its schema must not be activated/backfilled as a separate membership hierarchy. Refactor or retire those paths safely; inspect actual persisted references before deleting any data or dropping tables. A guild-keyed internal configuration record is permissible, but it is not a second user-managed organization.

Implementation status is incomplete until the runtime, tests, routes and documentation reflect this correction—not merely the wording on screen.

Status: Proposed implementation specification for review and agent handoff
Prepared: 19 September 2026
Deliverable: Planning only; existing runtime behavior is not changed by this document.

## 1. Product decision

Use each existing Discord server as the parent workspace for its teams. A server can contain multiple teams, and each team can contain multiple projects. A person may belong to several teams across several Discord servers. Do not introduce a separate Company group, registration flow, membership roster, or ownership layer.

Add **Teams** directly to the global navbar, beside Projects. `/teams` becomes the entry point for choosing a Discord server workspace or an independent team. `/projects` remains the user's cross-server project directory. These are different tasks: Teams answers “where do we work and who is involved?”; Projects answers “what am I working on?”

Reuse the server dashboard's interaction pattern: persistent identity, context switcher, grouped left navigation, and one focused content panel. Do not put bot administration, company management, team management, project work, and personal evaluation into one page.

```text
Discord server (the workspace itself; no additional Company entity)
  ├─ Team: Engineering
  │   ├─ Project: Website
  │   └─ Project: Discord bot
  └─ Team: Design
      └─ Project: Brand refresh

Independent team → Projects                 [existing compatibility mode]
Standalone project → Owner-approved joins   [existing compatibility mode]
```

“Company” is only an explanatory analogy, not a product label or new group type. Use “Server” or “Server workspace” in the interface and the actual Discord server name in headings. Clubs, classes, and informal groups can use the same structure.

### Discord roles within this hierarchy

- Department roles such as IT Team, Accounting, and Dev Team can be selected to create a team or linked to an existing team in the same server. Creating a Megu team from a role does not create or modify the Discord role.
- Position roles such as CEO, Team Lead, and Developer can supply display-only titles. A title must never implicitly grant application administrator, project-owner, or private-review access.
- Team access roles remain explicit: ownership, administration, membership, and viewing permissions are distinct from Discord role names. Offer a preview of affected members before applying a mapping; default to approval-based additions.
- Any optional automatic membership synchronization needs explicit opt-in, source tracking, removal rules, and outage handling. It must not automatically enroll team members in private projects.
- A person can hold multiple Discord roles and belong to multiple teams. Match roles by guild ID and role ID, never by their names. Renaming a role updates its display label without creating a new team.
- Keep independent teams and standalone project invitations working without a Discord-role mapping.

### Handoff acceptance gate for the clarification

The implementation is not ready if users must create, claim, join, or transfer ownership of a Company before using their Discord server workspace. Any older company-specific sections below must be translated to guild-scoped configuration or explicitly retired, not implemented literally. Server configuration can be stored internally, but cannot become a second authorization roster. Preserve explicit team/project access and private goals/review boundaries.

## 2. What the professor suggested

The attached conversation recommends two measurement areas:

1. Project progress.
2. Evaluating each person's work against their goals.

Implement these as separate features. Existing reported topic percentages describe progress, not quality, effort, or individual ability. Do not turn the number of tasks, Discord activity, or a project's completion percentage into an employee ranking.

The recommended individual feature is **Goals & reviews**: an agreed goal, measurable target, evidence, a self-review, and an explicitly assigned human reviewer. Use “member” in general product copy because many workspaces are not employers. The screenshot supplies the product direction; the precise workflows below are proposed design decisions.

## 3. Current implementation and gaps

Inspected sources:

| Area | Existing source | Current behavior / consequence |
| --- | --- | --- |
| Global navigation | `app/components/Navbar.js` | Projects is first-class; Teams is absent. Account already opens from user identity and must remain that way. |
| Project directory | `app/projects/page.js` | Listing, filters, team selection, and inline creation share a screen. |
| Team directory | `app/components/teams/TeamDirectory.js` | Teams are grouped by optional Discord guild association; creation is embedded above the list. |
| Team overview | `app/components/teams/TeamOverview.js` | Project list and settings link; company hierarchy is not explicit. |
| Team management | `app/components/teams/TeamManage.js` | General, people, requests, lifecycle panels. Preserve their capabilities while splitting routes. |
| Server bridge | `app/components/Tabs/ProjectsTeamsTab.js` | A combined teams/projects view inside the bot dashboard. Make it a concise bridge to the company workspace. |
| Membership | `core/teams.js`, `core/projects.js` | A team project requires both active team and project memberships. |
| Persistence | `core/schema.js` | Teams have optional `discord_guild_id`; projects have nullable `team_id`; there is no company entity. |
| Metrics | `core/teams.js`, `core/projects.js` | Current progress uses topic percentages; team overview includes an average over non-archived topics. There is no formal member-goal review model. |
| Authorization decision | `docs/adr/0001-team-and-project-membership.md` | Team membership provides eligibility, not blanket project access. Preserve this boundary. |
| Integration | `adapters/http/megu-api.js`, `backend/web/web.js`, `backend/bot/bot.js` | Existing managed-guild discovery, roster lookup, server workspace, and notification paths can be extended. |

The problem is primarily navigation and scope, not a need to rebuild projects. Preserve the timeline, topics, updates, assignment, reports, join approvals, Discord avatars, date handling, and current themes.

## 4. Domain model and non-negotiable rules

### Proposed glossary

- **Company workspace:** One persisted workspace with a unique Discord guild ID. Owns organization settings and a set of teams.
- **Company owner:** An explicit Megu ownership record, initially claimed by the verified Discord guild owner. Exactly one active owner after activation.
- **Company admin:** An explicitly appointed Megu administrator. Manages company structure and ordinary membership, not ownership or private reviews by default.
- **Company member:** Active workspace eligibility. Does not grant team membership or private project access.
- **Team:** A working group inside one company, or an existing independent group. Retains its own owner/admin/member roles.
- **Project:** Belongs to zero or one team. No direct company-only projects in v1; company projects are reached through their team.
- **Goal:** A measurable agreement for one member in one team over a defined period.
- **Review:** A human assessment of a goal version and its evidence, separate from reported project progress.

### Invariants

1. `companies.discord_guild_id` is unique, including archived companies. Re-activating a server uses the same company record.
2. A team has at most one company; a project has at most one team. No multi-team project membership model in this release.
3. Team-project access requires active project and team membership, plus active company membership if the team belongs to a company. Archived ancestors allow authorized historical reads but deny mutations.
4. Company ownership and Discord Administrator/Manage Server permission do not grant access to all private project contents or individual reviews.
5. Discord roles provide organization labels and, only through an explicitly authorized mapping, company/team membership. Default to approval-based suggestions; automatic membership is opt-in under section 15. Roles never grant private project access, ownership, reviewer assignment, or management permission automatically.
6. Legacy independent teams and standalone projects continue working. New creation defaults to a company context, but an explicit “Independent team” option remains available.
7. Standalone projects retain their owner-approved project join links. Team projects use team eligibility followed by explicit project membership.
8. Company/team removal revokes affected active membership and assignments transactionally; history remains attributable. Rejoining never silently restores old project memberships.
9. Ordinary removal is blocked if the target owns an affected team or project until ownership is transferred. Do not strand ownerless work.
10. A disconnected bot does not erase company data. App membership continues governing existing reads; new Discord-dependent verification and roster imports become unavailable.
11. A Discord server ownership change does not automatically transfer Megu company ownership. Use the existing two-party ownership pattern; unavailable-owner recovery is an explicit audited support operation outside the member UI.
12. No destructive company deletion, automatic company merge, or team transfer between companies in v1. Optional, bounded Discord role reconciliation is permitted only under section 15; it is not general permission synchronization.

Record these as a proposed successor ADR during implementation. Update `CONTEXT.md` when the model ships: the current “Team can represent a company” definition then becomes legacy terminology. Do not silently change ADR 0001's privacy decision.

## 5. Navigation and routes

Use lowercase canonical paths. Avoid parallel `/Projects` and `/Teams` implementations.

| Route | Primary task | Main action |
| --- | --- | --- |
| `/teams` | Choose company workspace; secondary independent-team section | Set up company, if eligible |
| `/companies/[companyId]` | Company overview and switcher | Open a team |
| `/companies/[companyId]/teams` | Search/browse teams in this company | Create team |
| `/companies/[companyId]/teams/new` | Create a team with fixed company context | Create team |
| `/companies/[companyId]/people` | Company roster and eligibility | Approve/add eligible member |
| `/companies/[companyId]/requests` | Company access requests | Approve/decline |
| `/companies/[companyId]/settings` | Company profile, Discord state, ownership, archive | Save / ownership actions |
| `/teams/[teamId]` | Team overview | Open project |
| `/teams/[teamId]/projects` | Team-scoped projects | Create project |
| `/teams/[teamId]/people` | Team roster | Add from company / share team link |
| `/teams/[teamId]/requests` | Team join requests | Approve/decline |
| `/teams/[teamId]/goals` | My goals or authorized reviewer queue | Create proposed goal |
| `/teams/[teamId]/goals/[goalId]` | Goal evidence and review | Update / submit / review |
| `/teams/[teamId]/settings` | Team configuration and lifecycle | Save |
| `/projects` | My accessible projects across all contexts | New project |
| `/projects/new?team=…` | Focused project creation | Create project |
| `/p/[code]` | Existing project workspace | Existing work/report action |
| `/p/[code]?view=insights` | Project measurements | Inspect source topics |

Keep `/teams/[id]/manage?tab=…` as a redirect adapter to the corresponding new route. Preserve `/projects?team=…&create=1` by translating it to the new creation route. Keep project/team join-token URLs unchanged.

`/teams?server=<guildId>` resolves to the authorized company workspace or its setup state. Never reveal whether an inaccessible company exists through redirects, titles, or API errors. The existing `/servers/[guildId]?tab=projects` entry becomes a short “Company workspace” bridge with an Open workspace action; bot settings stay under Servers.

Global navbar active state: Teams for `/teams/*` and `/companies/*`; Projects for `/projects/*` and `/p/*`. Do not mark both active. Respect existing feature flags and provide mobile navigation without hiding Teams in a project-only submenu.

## 6. Screen design and task flows

### Company selector: `/teams`

Title: “Teams”; description: “Choose a company workspace to find your teams.” Company rows show server icon, company name, user's company role, and an authorized team count. Keep independent teams in a separate labeled section, not interleaved with companies. A “Set up company” action opens eligible Discord servers using the existing selector pattern.

The current managed-guild endpoint alone is insufficient: ordinary company members must see their existing workspaces even without Manage Server. Return existing authorized companies from Megu membership; separately fetch eligible setup servers only when the setup flow opens.

### Company workspace

Header: company/server identity, optional company switcher, membership role, and Discord connection status. Left rail: Overview, Teams, People, Requests, Settings. Hide unauthorized management destinations; handle direct URL attempts on the server as well.

Overview shows the user's teams and accessible project attention items. No universal employee performance chart. If company admins see all team names for structural management, explicitly distinguish that directory metadata from project contents; do not include hidden-project totals or percentages.

```text
Megu | Home | Servers | Activities | Projects | Teams | Bills | User

[Company switcher]  Company name / Discord server
Overview          | Your teams                 [Browse teams]
Teams             | Engineering · your role · accessible projects
People            | Design · your role · accessible projects
Requests          |
Settings          | Needs attention (projects you can access)
```

### Team workspace

Breadcrumb: Teams → Company → Team. Independent teams omit Company. Header names the team; the left rail offers Overview, Projects, People, Requests, Goals & reviews, Settings. Only one route's main content is rendered/fetched at a time.

Overview highlights active accessible projects and relevant upcoming deadlines. Projects is a stable table/list. People contains Discord avatars, left-aligned identity, aligned role controls, and explicit actions. Requests contains request identity, date, role choice, and approval buttons. Settings does not contain the working project list or review queue.

### Project directory and creation

Keep project browsing on `/projects`. Use server-side search, company/team scope, active/closed status, and “Assigned to me.” URL parameters preserve filters and pagination; selecting a different company clears an incompatible team filter.

Move creation out of the directory. From a team, company and team are fixed context. From the global directory, select Standalone or Team project, then Company and Team from eligible memberships. Independent teams have their own labeled option. Never default to the first server silently.

Project rows: name and company/team breadcrumb, prominent progress, readable state, deadline. Internal project codes remain available in details/copy actions but are not the main identity. Browser titles use names: `Project name · Megu`, `Team name · Company · Megu`.

### Visual and interaction requirements

- Operate mode: preserve current light/dark tokens, Thai-capable typography, flat dividers, custom select, dialogs, and circular Discord avatars. This is an information-architecture change, not a new brand theme.
- Desktop uses roughly 220–240px navigation and a flexible main column; keep the established wide project workspace. Content forms have readable widths even when tables use available space.
- At narrow widths, use one labeled section selector/drawer instead of a compressed sidebar. Breadcrumbs wrap; long names never displace role/actions or progress.
- Prominent numeric percentages use tabular digits and adjacent labels/bars. Color reinforces state but never substitutes for text.
- Loading, no membership, no results, no teams, archived, Discord unavailable, access revoked, and retry states have distinct copy. A failed fetch is not an empty list.
- Preserve drafts across refresh failures and warn before navigating away from unsaved forms. Keep modal component identities stable to avoid the previously reported one-character/focus-reset bug.
- Keyboard focus, Escape behavior, labeled controls, `aria-current`, and reduced motion must work in both languages. Test 390px, 768px, and 1440px in light/dark and English/Thai.

## 7. Project indicators

Add an Insights view using existing topic/report data. Use one server-side metric implementation for project header, directory, team project list, and Insights; no independent frontend formulas.

| Indicator | Definition | Empty / exception behavior |
| --- | --- | --- |
| Reported progress | Rounded arithmetic mean of current progress of non-archived topics | No topics → “No topics yet”, not an invented 0% measurement |
| Completed topics | Completed non-archived topics / all non-archived topics | Show numerator and denominator |
| Overdue topics | Not completed, not archived, due instant passed | Undated topics excluded; disclose undated count |
| Blocked topics | Current blocked flag/state among non-archived topics | Use existing domain definition |
| Awaiting review | Current workflow is `in_review` | Link to filtered topics |
| On-time completion | Completed on/before due date / completed topics with a known completion time and due date | Unknown legacy completion time excluded and counted; zero denominator → N/A |

Date-only deadlines end at the end of that calendar date in the project's timezone, using existing date-precision utilities. Persist Gregorian timestamps/dates; render Buddhist Era only through the existing locale layer. Do not add 543 during input storage.

For a newly tracked completion, record `completed_at` and the due-date snapshot at that transition. Reopening clears current completion state but retains the event. If a topic is completed again, its new completion event defines current on-time status; retain the prior event for history. Never infer a missing historical completion time from `updated_at`.

Show freshness and an explanation beside each metric. Exclude archived topics consistently. Defer weighted project percentages, burn-down charts, and company-wide performance rollups until reliable histories and explicit weighting exist. Counts and progress remain scoped to projects the caller can read.

## 8. Goals & reviews specification

Ship after the company/team navigation, behind a separate feature flag. A goal belongs to exactly one team and one active member; it may optionally reference a project/topic the member and reviewer can both access. Team owners/admins create proposals; members can propose their own goals. Appoint exactly one reviewer, an active team owner/admin other than the subject. If no eligible second reviewer exists, allow personal tracking with “No reviewer assigned,” but block final approval.

### Goal fields and calculation

Required: title, description of success, subject, team, period start/end, timezone, measurement kind (`numeric` or `milestone`), and reviewer where available.

Numeric goals include unit, direction (`increase` or `decrease`), baseline, target, and current reported value. Validate finite numbers and target greater than baseline for increase / less for decrease. Achievement is clamped to 0–100: `100 * (current - baseline) / (target - baseline)`. Show actual value alongside the percentage so exceeding target is still visible.

Milestone goals have explicit acceptance criteria and use a human-reviewed “Met / Partially met / Not met / Not assessed” result. Do not fabricate a numeric percentage for them. Null current values remain “Not reported.” A goal's percentage is not an employee score and is not averaged across members.

Evidence updates contain author, timestamp, reported value where applicable, a bounded text note, and optional HTTPS reference links. No arbitrary file-upload subsystem in this release. Linking a private project does not expose its title or evidence to unauthorized viewers.

### Lifecycle

`draft → proposed → active → submitted → reviewed`

- Subject and reviewer must both accept the proposed target before Active. A manager-created proposal is not automatically accepted by the subject.
- Active goals accept append-only evidence. The subject submits a self-review; the reviewer can return it to Active with a reason or publish a review.
- Reviewed records are immutable. Revisions create a new version with links to the prior review, actor, reason, and renewed acceptance. Concurrent transitions use row locks plus expected version.
- Archived/cancelled goals preserve evidence and stop reminders. Revoking membership removes ordinary access but retains authored history for authorized remaining participants. If a subject loses team access, cancel active goals with a reason; do not erase records.
- If a reviewer leaves, mark active goals as requiring reviewer reassignment. An authorized team manager may reassign without reading private evidence; the new reviewer and subject must accept the assignment. Published reviews remain immutable.

### Review rubric and privacy

Reviewer records outcome (`exceeded`, `met`, `partially_met`, `not_met`, `not_assessed`), evidence-based explanation, and next step. The subject may acknowledge and add a response without overwriting the review. Target changes and publication are audited.

Default visibility: subject and assigned reviewer only, with active team/company eligibility. Other managers can see only minimal administration fields needed to assign reviewers (goal ID, subject, reviewer, period, lifecycle), not goal content, values, evidence, or ratings. Company owner/admin receives no automatic review-content privilege. Reviewer access to a linked project must be checked independently every time.

No public leaderboard, productivity ranking, automated employment decision, or score derived from Discord messages/voice activity. No team-wide rating summaries or review export in v1. Notifications contain a generic action and private link, never a rating or evidence text.

## 9. Access and joining

| Action | Authorized actor |
| --- | --- |
| Claim an unclaimed company | Freshly verified Discord guild owner with linked Megu identity and bot present |
| Company settings / create company teams | Active company owner/admin; owner-only ownership/archive controls |
| Browse company structural team directory | Company owner/admin; ordinary members see their own teams |
| Read a team's roster | Existing active team membership plus company eligibility |
| Read a private project | Existing project + team membership plus company eligibility |
| Manage team members | Existing team owner/admin plus company eligibility |
| Approve company request | Company owner/admin; only owner can appoint admins |
| Approve team request | Existing authorized team approver; requested company eligibility required |
| Approve standalone project request | Existing project owner |
| Read/write private goal content | Subject or assigned reviewer, according to lifecycle and active membership |

Company access may be requested through a separate company link. Existing team links remain useful: if the requester lacks company membership, display “Company approval required” and create an idempotent company request first; keep the team request pending and do not approve it implicitly. After company approval, the team owner still decides team membership. Adding a company member to a team is explicit; adding that team member to a project is a further explicit selection.

For new company admissions, verify that the linked Discord account belongs to the company guild using a bounded bot lookup. If verification is unavailable, leave pending and offer retry, never pretend the person is absent. For manually granted memberships, Discord departure does not silently revoke app access; app owners manage those grants explicitly. Role-derived grants follow section 15's reconciliation and revocation rules. Explain this distinction in company settings.

Retain current standalone-project/team owner notifications and delivery preferences. Company requests notify current company owner/admin approvers; goal reminders notify only the subject/reviewer. Use the existing outbox, unique event/cycle keys, retry policy, and authorization recheck immediately before delivery. No direct Discord/email sends inside database transactions.

## 10. Data model and migration

Additive schema proposal (names follow existing conventions):

- `companies`: text ID, unique guild ID, display name/icon snapshots, lifecycle (`unclaimed`, `active`, `archived`), created/updated/archive timestamps, revision. Guild snapshots are display data, never permission evidence.
- `company_memberships`: company/user composite key, role (`owner`, `admin`, `member`), created/revoked timestamps; partial unique active-owner index.
- `company_join_links`, `company_join_requests`: reuse hashed-token storage, expiry/revocation, one active link per company, request cycles, status, origin link and audit conventions.
- `company_events` and `company_ownership_transfers`: mirror current team patterns and enforce two-party ownership acceptance.
- `teams.company_id`: nullable FK `ON DELETE RESTRICT`, indexed with archive/name filters. Existing team/project IDs and join tokens remain stable.
- Goal tables: `team_goals`, `team_goal_versions`, `team_goal_updates`, `team_goal_reviews`, `team_goal_responses`. Use FKs, version uniqueness, finite numeric validation in application code, bounded text, lifecycle constraints, and append-only review/history semantics.
- Topic completion metadata: add `completed_at` and completion deadline snapshot only if equivalent authoritative event data is not already available. Do not duplicate an existing event source unnecessarily.

### Backfill rules

1. Run a read-only inventory: distinct connected guilds, conflicting guild snapshots, active team owners, team/project memberships, and flag state. Produce counts, never tokens.
2. Create one `unclaimed` company per distinct existing `teams.discord_guild_id`. Use deterministic selection of the latest nonempty guild display snapshot and keep the guild ID as identity.
3. Attach connected teams to that company. Union existing active team memberships into company membership with role `member`; deduplicate by user. This preserves existing access. Do not elect the first team owner as company owner.
4. Existing team owners keep management of their teams while the company is unclaimed. Company governance and new company-level team creation remain unavailable until the verified guild owner claims it. An unclaimed company may temporarily have zero owner; Active requires exactly one.
5. Claim is transactional: verify Discord outside the transaction, then lock the company, recheck unclaimed status, and appoint the actor as owner. Competing claims return the existing state safely. Preserve existing owners' private-team boundaries.
6. Independent teams stay independent; standalone project rows are untouched. Existing historical memberships are never reactivated by backfill.
7. Deploy compatibility reads/writes before enabling company routes. Old create/connect endpoints must map verified guild associations to `company_id` in the same transaction; reject moving an attached team to another company. Old disconnect must not null company ownership—return an explicit unsupported-transition error and remove that control for company teams.
8. Backfill is rerunnable under the repository's migration locking strategy. Audit before/after counts and unique guild constraints, then enable company authorization before exposing new routes.
9. Retain legacy guild fields during rollout as compatibility snapshots. Only a later migration removes them. On rollback disable new UI/routes and use a compatibility release that still enforces company revocations; do not roll back to code that bypasses the new membership checks.

Register new user foreign-key tables with `core/account-merge.js` reference inventory and implement merge behavior for company membership/ownership and goal subject/reviewer authorship. Avoid producing self-review or duplicate-owner conflicts; refuse ambiguous merges using the existing conflict mechanism. Extend isolated test cleanup/schema fixtures accordingly.

## 11. API contracts

Extend the existing Express `/api/megu` router; keep Next's proxy architecture. New endpoints are proposals, not claims that they already exist.

| Endpoint family | Purpose |
| --- | --- |
| `GET /companies` | Caller-visible companies, cursor pagination |
| `POST /companies/claim` | Verified guild-owner claim, idempotent guild uniqueness |
| `GET/PATCH /companies/:id` | Authorized summary/settings with revision check |
| `/companies/:id/teams` | Scoped list/create; never trust submitted guild snapshots |
| `/companies/:id/members`, `/join-links`, `/join-requests` | Membership and approval operations |
| `/companies/:id/ownership-transfers`, `/archive`, `/restore` | Owner-governed lifecycle |
| `GET /projects?companyId=…&teamId=…&q=…&status=…&cursor=…` | Server-side filtered project directory |
| `GET /projects/:code/insights` | Shared metrics plus denominator/freshness metadata |
| `/teams/:id/goals` and `/teams/:id/goals/:goalId` | Subject/reviewer-scoped goals |
| Goal `/accept`, `/updates`, `/submit`, `/return`, `/reviews`, `/responses` | Explicit versioned state transitions |

Use existing CSRF/session protections, input validation, and error envelopes. Every nested resource query checks parent ownership/scope; a valid goal ID from another team must fail. Return server-derived capabilities, cursors, and `asOf`. Use opaque-not-found responses for inaccessible private resources and 409 for stale versions/invalid transitions.

Page size default 25, maximum 100. Filter before pagination; use stable `(sort_key,id)` cursors. Aggregate in bounded SQL, not per-row calls. Abort or ignore stale browser fetches after company switches. No browser-driven Discord polling or database pool per workspace; reuse existing database modules and preserve incident pool limits. Optional role reconciliation uses section 15's shared bounded worker. Consult installed Next guides before writing route/layout code.

## 12. Implementation phases and file map

### Phase A — Company model and compatibility

Implement company persistence, access helpers, migrations/backfill, claiming, membership, request notifications, and account-merge handling. Extend `core/schema.js`, new `core/companies.js`, `core/teams.js`, `core/projects.js`, `core/index.js`, `core/account-merge.js`, `core/notifications.js`, `adapters/http/megu-api.js`, and the existing Discord verification adapters. Add server-side feature flag `MEGU_COMPANIES_ENABLED` and matching public UI flag, initially off. Both enforce disabled state consistently.

Deliverable: idempotent migration and authorization tests pass; existing standalone and independent-team contracts remain valid.

### Phase B — Focused workspaces and navigation

Add Navbar Teams entry; create company selector/pages and reusable `CompanyWorkspaceShell` / `TeamWorkspaceShell`. Reuse visual primitives from the server dashboard without copying its admin permission gate. Split TeamDirectory, TeamOverview, and TeamManage by route. Reduce ProjectsTeamsTab to a bridge. Split CreateProject into a reusable component for `/projects/new`. Remove duplicate Projects/Teams subnavigation where the global navbar already handles it.

Touch `app/components/Navbar.js`, `app/components/teams/*`, `app/teams/*`, new `app/companies/*`, `app/projects/page.js`, new project-create route, `app/components/projects/ProjectDirectoryNav.js`, `app/components/Tabs/ProjectsTeamsTab.js`, and both copy dictionaries. Preserve deep-link redirect adapters and query state.

Deliverable: a member can navigate Company → Team → Project and back without opening Settings or losing context.

### Phase C — Project insights

Add one metric service in core and an Insights view in `app/components/projects/ProjectWorkspace.js`. Replace duplicate directory/team aggregation code with shared definitions. Add completion snapshots and drill-down filters where needed. Add SQL indexes justified by query plans.

Deliverable: all progress displays agree; no-data states and timezone/deadline edge cases pass.

### Phase D — Goals & reviews

Add persistence, explicit state transitions, capability-limited serializers, private UI, outbox reminders, and immutable reviews. Gate with `MEGU_TEAM_GOALS_ENABLED` plus its public counterpart, initially off. Do not expose incomplete review controls during Phase B.

Deliverable: subject/reviewer workflow and privacy tests pass before enabling it for a pilot team.

### Phase E — Rollout and documentation

Update `CONTEXT.md`, add successor ADR, update user-facing docs, and record migration/test results in this document. Ship A+B first, C next, D after its pilot. Keep rollback additive. Do not start a duplicate bot instance for testing or change pool limits, bot tokens, or database URLs as part of the UI rollout.

## 13. Acceptance tests and completion gate

Automated requirements:

1. Two teams linked to the same guild backfill into one company; rerunning creates no duplicates. Separate guilds remain separate companies.
2. Backfill preserves active access and leaves independent teams, standalone projects, join tokens, ownership, and history intact.
3. Concurrent company claims create one owner; client-supplied guild names/permissions cannot grant authority. Ordinary server members cannot claim a company.
4. Company admins cannot fetch private project data, hidden project counts, review evidence, or ratings without the necessary independent grants.
5. Company/team removal, archive, rejoin, ownership blockers, request cycles, and background delivery rechecks obey the full access chain.
6. Existing team links handle missing company eligibility without implicitly admitting the requester to a team/project. Standalone joins still work.
7. New company/team filters operate before pagination and cannot cross scopes. Browser Back/Forward restores context; old manage/create links resolve correctly.
8. Empty and archived topics, reopened completion, unknown history, overdue date-only deadlines, and Thai Buddhist Era display produce correct metric denominators and dates.
9. Goal targets are finite and directional; both acceptances are required; reviewer cannot be the subject. Unauthorized field access fails even if the client requests a different serializer/route.
10. Concurrent submissions/reviews conflict safely; published reviews remain immutable; reviewer departure/reassignment and subject responses preserve history.
11. Account merges preserve new references and reject ownership/self-review conflicts without partial mutation.
12. Notification retries produce one alert per request/review event, honor preferences, and never include private assessment content.

Manual scenarios:

- Guild owner sets up company → creates Engineering and Design → adds eligible people → Engineering owner creates two projects → explicitly selects project members.
- Ordinary member reaches Teams directly from navbar, enters their company/team, opens an assigned project, and returns using breadcrumbs.
- Existing standalone-project invite is accepted through the unchanged owner approval flow.
- Company admin sees structural teams but cannot open a private project; reviewer only sees their authorized goal records.
- Switch language/theme and inspect 390px/768px/1440px; long Thai names, long role badges, percentage emphasis, custom dropdowns, and typing in dialogs remain usable.
- Bot unavailable: existing work remains readable and appropriate Megu-only actions work; Discord verification reports unavailable and does not change access.

Use the isolated local database test harness. Extend `tests/teams.test.js`, `tests/teams-contract.test.js`, `tests/projects.test.js`, `tests/project-join.test.js`, `tests/account-merge.test.js`, `tests/auth-notifications.test.js`, and add company/goal suites. Report unavailable live checks explicitly. Completion requires passing membership/migration tests, responsive screenshots for the main flows, and a documented flag rollout; code compilation alone is insufficient.

## 14. Handoff instruction

Implement this specification in phases, inspecting the current working tree and existing feature work first. Preserve unrelated changes. Treat the decisions in sections 4, 8, 9, and 10 as authorization/data contracts; do not invent broader access to simplify the UI. Keep the current design system and shared controls. Record each phase's tests and remaining live checks. Do not claim Goals & reviews is complete when only project percentage displays exist.

This proposal intentionally keeps independent work supported, separates Discord organization roles from app permissions, and limits personal evaluation to agreed goals reviewed by a person. Section 15 extends the original proposal with explicitly configured role-derived membership, without expanding access to existing private projects.

## 15. Discord roles → company titles and team membership

Added following the user's clarification. This section is required implementation scope and supersedes the earlier proposal's blanket exclusion of role synchronization. Ship it in two increments (15A and 15B), not as an unreviewed import of Discord permissions.

### 15.1 Three different meanings of “role”

#### User-facing example and scope clarification

For a Discord server called **Acme**, create one Acme company workspace. Its existing **IT Team**, **Accounting Team**, and **Dev Team** Discord roles can each create a corresponding Megu team, or link to teams already created in that company. Each team can contain multiple projects. A person holding both IT and Dev roles can belong to both teams; do not create a separate team for each person or duplicate teams on repeated imports.

The **CEO** role can appear as a company title alongside a person's team memberships. It does not automatically make that person a Megu company owner, team admin, project lead, or reviewer. Those access assignments remain explicit. If the company actually wants an Executive team, it can separately map the CEO role to that team using the same approval and membership rules.

“Create from Discord role” means **create a Megu team using an existing Discord role**, not create or assign roles inside Discord. This release reads Discord roles; two-way role management is outside scope. On the setup screen, explain this before confirmation and offer clear choices: **Create team from role**, **Link role to existing team**, and **Display as company title**.

Default behavior is an approval-based member preview, not silent enrollment. Optional automatic membership is the separately gated Phase 15B below. Neither mode grants project access: project owners still select their project roster. Independent teams and standalone-project join links continue working without a Discord role mapping.

| Concept | Examples | Effect |
| --- | --- | --- |
| Discord role | IT Team, Accounting, Dev Team, CEO | A server-defined ID and current set of holders |
| Organization title | CEO, Developer, Accountant | Display badge sourced from selected Discord roles; no authorization |
| Megu access role | Company owner/admin/member; team owner/admin/member; project role | Explicit application permissions, separate from job title |

Recommended mapping: `IT Team → IT team`, `Accounting → Accounting team`, `Dev Team → Development team`, `CEO → company title badge`. A CEO may also be appointed company admin manually by the company owner. Do not infer hierarchy or app authority from role names, colors, position, or Discord Administrator permission. One person can hold multiple titles and belong to multiple teams.

Terminology in controls must be explicit: “Discord role,” “Company title,” and “Access role,” never three unlabeled “Role” selectors. Update the proposed successor ADR and glossary with these distinctions when implementation ships.

### 15.2 Setup and management UX

Add `/companies/[companyId]/integrations/discord-roles`, labeled **Discord roles** in the company sidebar for company owner/admin. Team People/Settings shows its linked roles, membership mode, last successful check, and a link to this page. Ordinary members see their relevant badges and membership source, not integration administration.

The setup flow offers:

1. **Create teams from roles:** select several eligible roles, preview one new team per role, edit proposed team names, and explicitly select an eligible Megu team owner for each. Never invent an owner from Discord role order. Create/link operations are transactional and idempotent; unresolved owners block the affected team creation.
2. **Link an existing team:** select a team in this company and one or more Discord roles. Multiple linked roles use ANY-match, stated in helper text. A role may feed multiple teams only after a warning and confirmation of the extra memberships.
3. **Show company titles:** select roles such as CEO/Developer to display as badges for existing company members. A title-only mapping creates no membership.

Use the existing searchable custom selection component, with role name and color swatch, member counts only when reliably available, and server context. Preserve readable theme text rather than using arbitrary Discord colors as text. Role IDs are canonical; identical names require disambiguation. Default-exclude `@everyone`, integration-managed roles, and bot accounts from membership import. Company-linked teams only: independent teams must first follow an explicitly supported company attachment flow, not bypass scope via this screen.

Preview shows existing memberships, proposed additions, proposed removals, pending approvals, unregistered Discord users, ownership blockers, and unavailable data. No Discord account placeholders become Megu users. Unregistered holders sign in with Discord before eligibility is applied. Revalidate the actor, company, mapping version, and relevant role membership before committing; stale previews return 409 and require refresh.

Team creation/linking requires company owner/admin plus that team's owner approval for an existing team; changing a membership mapping requires the same approval. The company owner must explicitly authorize automatic mode, and the existing team's owner must consent. Company admins cannot use a new mapping to insert themselves into a private team without its owner's consent. Title-only mappings can be managed by company owner/admin.

### 15.3 Membership modes

**Approval-based (default, Phase 15A):** role holders become eligible suggestions. An authorized approver explicitly adds selected registered users as company/team members; missing company eligibility needs separate company approval. Accepted grants are manual, with import provenance for audit, and survive subsequent role changes. Explain “Role changes do not remove approved members.” Dismissed suggestions stay dismissed until an explicit reset or new eligibility cycle. Ordinary join links remain usable.

**Automatic membership (optional, Phase 15B):** after explicit consent above, a matching role adds a role-derived company-member grant and a role-derived team-member grant for a linked, registered Discord identity. No app owner/admin role is derived. Explain before enabling: “People who can assign this Discord role can grant membership to this team.” Treat that delegation as an authorization decision, not a styling preference.

Default automatic sync off. Require a preview and explicit confirmation before first enable and before switching mappings. Disabling, unlinking, or switching automatic → approval mode previews and revokes that mapping's derived grants; it must not silently convert them to permanent manual membership. Converting selected grants to manual requires separate authorized company/team approval.

Joining a team does NOT join any project. Existing project owners still explicitly choose members; existing standalone-project join links are unchanged. No role-to-project mapping in this release. Company or team owner/admin appointments, ownership transfers, and reviewer appointments remain manual.

### 15.4 Grant provenance, removal, and safety

Represent eligibility sources separately from effective membership. A user may have a manual grant and multiple mapping-derived grants. Removing one Discord role removes only its source; other valid sources preserve effective membership. ANY-match remains active while any mapped role still matches. Company role-derived eligibility is retained while any company/team mapping requires it.

When the final source disappears, use the existing company/team revocation transaction: remove effective eligibility and affected project memberships/assignments, preserve history, and follow goal cancellation/reviewer reassignment rules. Restoring a Discord role can restore company/team eligibility only; it must never restore revoked project memberships or assignments. Recheck access for queued deliveries.

Manual removal must create a company/team suppression record so reconciliation cannot immediately re-add the user. Company suppression overrides all derived grants within that company; team suppression overrides only that team. Only an authorized human clears it. Join-link approval explicitly clears the relevant suppression only after showing that consequence.

Do not appoint an owner from a derived-only grant. Before transferring team/project ownership to a synced member, require explicit manual company/team grants from the respective authorized approvers. If legacy/inconsistent data would strand an owner during reconciliation, record a blocked revocation, alert responsible owners, and require transfer or explicit manual retention; never silently delete ownership or loop endlessly. Expose these exceptions in the sync screen.

Confirmed role deletion, removal from a member, or confirmed guild departure revokes the corresponding derived source. Rename/color changes update display snapshots only. Missing cache entries, partial member lists, permission errors, bot removal, and timeouts are NOT proof of removal. Mark sync degraded, stop new automatic grants, preserve last confirmed grants, and alert administrators. This is eventual, not immediate revocation; show last successful verification and warn that manual removal is required when urgent access revocation cannot wait for Discord recovery.

### 15.5 Persistence and backend contract

Extend the schema proposal with:

- `company_discord_role_mappings`: company, target kind (team membership/title), target team or title configuration, mode, enabled state, revision, consenting actors/timestamps, display snapshots, and last reconciliation status. Roles are referenced by guild-scoped IDs through mapping-role rows with uniqueness constraints.
- Membership source records for company/team effective memberships: manual or mapping source, mapping ID where applicable, eligibility cycle, created/revoked timestamps. Backfill all existing active memberships as manual; imported history must not erase this source.
- Company/team membership suppressions: scope, user, actor, reason, created/cleared timestamps.
- Sync audit/checkpoint records: mapping revision, bounded run cursor, last success, counts, errors, and exceptions. Never persist bot credentials or unnecessary full Discord rosters in this feature.

Extend account-merge handling for all new user references and preserve suppressions across merges. Do not convert derived memberships to manual during merge; deduplicate sources and run the existing ownership/self-review conflict checks.

API family under `/api/megu/companies/:id/discord-role-mappings`: authorized list/create/update/delete; `/preview`, `/confirm`, `/reconcile`, and `/status` operations. Role discovery is guild-scoped and bot-backed, never client-supplied evidence. Mutation uses existing CSRF protection, expected mapping revision, owner consent, and idempotency keys. Reconcile requests enqueue bounded work instead of doing full guild scans in HTTP requests. Expose safe capabilities/status, not full server rosters to ordinary team members.

Implementation must inspect the installed Discord library and current bot gateway/intents configuration before selecting events or roster APIs. Verify required member intents and permissions are actually available; if not, disable automatic mode and explain the missing capability. Do not request Manage Roles just to read/link roles; this integration never assigns, deletes, or edits Discord roles. Document any required Discord developer-portal configuration as an explicit operator step.

Use the existing bot as the single integration owner, with a durable work queue/lease and one shared bounded reconciliation worker. Process relevant member/role changes, reconcile after reconnect/startup, and perform rate-limited periodic reconciliation to recover missed events. No worker per page/team, duplicate bot, unbounded Promise.all, or new database pool. Coalesce events by company/user; authorize and verify mapping version at application time. Complete reliable snapshots or authoritative member lookups are required before removals; stale jobs must not overwrite newer mapping decisions. Outbox notifications summarize membership changes, deduplicate by eligibility cycle, and honor delivery preferences.

### 15.6 Delivery and acceptance gate

Insert **Phase 15A** after A+B: role discovery, title badges, create-from-role/link workflows, approval-based suggestions, source provenance, suppression handling, migration tests, and integration status. This is the first release's role support.

Ship **Phase 15B** separately behind a server-enforced automatic-role-sync flag (UI flag alone is insufficient): explicit consent, event processing, durable reconciliation, removal behavior, and operational alerts. Do not expose an automatic toggle until these controls and tests pass. C/D can proceed without automatic sync.

Required tests in addition to section 13:

1. IT and Dev role holders can join multiple mapped teams; title-only CEO never grants access/admin/reviewer authority.
2. Wrong-guild role IDs, forged snapshots, unapproved mappings, stale previews, and concurrent create/enable operations cannot grant membership or create duplicate teams.
3. A manual grant survives role loss; multiple sources preserve membership until the final source is removed; manual suppression prevents re-addition.
4. Role removal/deletion and confirmed departure revoke only derived grants. Role rename/color change preserves mapping identity. Partial scans/timeouts never mass-remove users.
5. Removing final team/company eligibility revokes project access and assignments, and role restoration never restores them. Ownership exceptions and private goal handling follow explicit policy.
6. A registered user's first sign-in triggers eligible reconciliation without creating users for an entire guild. Approval-mode additions remain manual; unregistered and bot users are handled correctly.
7. Duplicate/out-of-order events, reconnect recovery, stale mapping revisions, rate limits, disable/unlink, and mode changes produce idempotent grants, audit records, and notifications.
8. Company/team join links and independent teams remain compatible; account merge preserves grant provenance/suppressions; no private project/review contents leak via role previews or badges.

Manual demonstration: select IT/Accounting/Dev roles → create or link three teams → approve owner selections and member preview → show CEO title separately → assign project members explicitly → optionally enable automatic mode for one pilot team → verify role addition/removal and outage behavior with consenting test accounts. No live role changes or production-wide sync activation as part of automated tests.
