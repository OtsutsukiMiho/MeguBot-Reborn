# Release candidate file manifest

Base: Git `HEAD` `c8d1c601770abbd6af3c90519a15602b234686bc` plus the changed/new overlays below. The unchanged tracked baseline is inherited; this table enumerates every currently changed or untracked path and the audit document newly exposed by `.gitignore`. The 215 intended paths are staged; no file has been committed, pushed or deployed.

The candidate includes whole current files at the listed paths. The changed bot/legacy/core database/health files are mixed-history runtime companions: the current bot imports the changed voice module, the registered runner exercises it, F1 requires the shared atomic role-settings writer, and F7 requires the shared PostgreSQL TLS policy across core/legacy/health/operator pools. Their inclusion is explicit, not accidental. `index.js` carries the matching bot/web process shutdown contract. The standalone voice incident plan is excluded.

The four unshipped `app/companies/[companyId]` prototype pages only call `notFound()`. They have no direct consumer; omitting them preserves a 404 while server-native `/teams/server/[guildId]` routes ship. Retained `core/companies.js`, Company access/schema and compatibility tests remain included because persisted legacy references still require them.

## 1. REQUIRED FOR THIS RELEASE (118)

Application, bot, shared database/security runtime, commands and supported operator paths.

| Working-tree state | Path |
|---|---|
| new | `adapters/discord/console-authorization.js` |
| new | `adapters/discord/server-role-sync.js` |
| modified | `adapters/health/health-log.js` |
| modified | `adapters/http/megu-api.js` |
| new | `adapters/http/mutation-origin.js` |
| modified | `adapters/http/pg-session-store.js` |
| new | `adapters/http/team-goals-api.js` |
| modified | `adapters/notifications/dispatcher.js` |
| modified | `adapters/notifications/project-channel-dispatcher.js` |
| modified | `adapters/notifications/project-deadlines.js` |
| modified | `app/account/merge/page.js` |
| modified | `app/components/CustomSelect.js` |
| modified | `app/components/Navbar.js` |
| new | `app/components/Tabs/ProjectsTeamsTab.js` |
| modified | `app/components/customSelect.module.css` |
| new | `app/components/projects/CreateProject.js` |
| new | `app/components/projects/NewProject.js` |
| new | `app/components/projects/ProjectDirectoryNav.js` |
| new | `app/components/projects/ProjectInsights.js` |
| modified | `app/components/projects/ProjectJoinSettings.js` |
| modified | `app/components/projects/ProjectManage.js` |
| modified | `app/components/projects/ProjectWorkspace.js` |
| new | `app/components/projects/projectDirectoryNav.module.css` |
| new | `app/components/projects/projectInsights.module.css` |
| modified | `app/components/projects/projectManage.module.css` |
| modified | `app/components/projects/projectWorkspace.module.css` |
| new | `app/components/teams/CreateTeamGoal.js` |
| new | `app/components/teams/CreateTeamsFromRoles.js` |
| new | `app/components/teams/GoalActionForm.js` |
| new | `app/components/teams/GoalReviewerForm.js` |
| new | `app/components/teams/GoalTermsEditor.js` |
| new | `app/components/teams/GoalTermsFields.js` |
| new | `app/components/teams/ServerRoleMappings.js` |
| new | `app/components/teams/ServerTeamWorkspace.js` |
| new | `app/components/teams/ServerTitleSettings.js` |
| modified | `app/components/teams/TeamDirectory.js` |
| new | `app/components/teams/TeamGoalDetail.js` |
| new | `app/components/teams/TeamGoals.js` |
| modified | `app/components/teams/TeamManage.js` |
| new | `app/components/teams/TeamMemberTitles.js` |
| new | `app/components/teams/TeamMembershipSource.js` |
| modified | `app/components/teams/TeamOverview.js` |
| new | `app/components/teams/TeamRoleMapping.js` |
| new | `app/components/teams/TeamWorkspaceNav.js` |
| new | `app/components/teams/loadTeamGoalMembers.mjs` |
| new | `app/components/teams/serverWorkspace.module.css` |
| new | `app/components/useCreationRequest.js` |
| new | `app/components/useDraftGuard.js` |
| new | `app/components/useWorkspaceResource.js` |
| modified | `app/copy/en.js` |
| modified | `app/copy/th.js` |
| modified | `app/globals.css` |
| new | `app/lib/discord-guild-icon.js` |
| new | `app/projects/new/page.js` |
| modified | `app/projects/page.js` |
| modified | `app/projects/projects.module.css` |
| modified | `app/servers/[guildId]/page.js` |
| modified | `app/servers/page.js` |
| modified | `app/servers/servers.module.css` |
| new | `app/teams/[teamId]/goals/[goalId]/page.js` |
| new | `app/teams/[teamId]/goals/new/page.js` |
| new | `app/teams/[teamId]/goals/page.js` |
| modified | `app/teams/[teamId]/manage/page.js` |
| modified | `app/teams/[teamId]/page.js` |
| new | `app/teams/[teamId]/people/page.js` |
| new | `app/teams/[teamId]/projects/page.js` |
| new | `app/teams/[teamId]/requests/page.js` |
| new | `app/teams/[teamId]/settings/page.js` |
| modified | `app/teams/page.js` |
| new | `app/teams/server/[guildId]/[section]/page.js` |
| new | `app/teams/server/[guildId]/create-from-roles/page.js` |
| new | `app/teams/server/[guildId]/page.js` |
| new | `app/teams/server/[guildId]/role-mappings/page.js` |
| new | `app/teams/server/[guildId]/titles/page.js` |
| modified | `app/teams/teams.module.css` |
| modified | `backend/bot/bot.js` |
| modified | `backend/bot/voice_connection.js` |
| modified | `backend/database/database.js` |
| modified | `backend/web/web.js` |
| modified | `commands/utility/autorole.js` |
| modified | `commands/utility/join.js` |
| modified | `commands/utility/projects.js` |
| modified | `core/account-merge.js` |
| new | `core/companies.js` |
| new | `core/company-access.js` |
| new | `core/company-role-policy.js` |
| new | `core/company-schema.js` |
| modified | `core/db.js` |
| modified | `core/notifications.js` |
| new | `core/pool-config.js` |
| new | `core/postgres-connection.js` |
| modified | `core/project-channel-notifications.js` |
| new | `core/project-directory-filters.js` |
| new | `core/project-insights.js` |
| modified | `core/project-reminders.js` |
| modified | `core/projects.js` |
| modified | `core/schema.js` |
| new | `core/server-role-automatic.js` |
| new | `core/server-role-mappings.js` |
| new | `core/server-role-notifications.js` |
| new | `core/server-role-reconciliation.js` |
| new | `core/server-role-schema.js` |
| new | `core/server-role-sync.js` |
| new | `core/server-role-team-creation.js` |
| new | `core/server-role-titles.js` |
| new | `core/team-goal-lifecycle.js` |
| new | `core/team-goal-measurement.js` |
| new | `core/team-goal-notifications.js` |
| new | `core/team-goal-schema.js` |
| new | `core/team-goals.js` |
| new | `core/team-membership-sources.js` |
| modified | `core/teams.js` |
| modified | `core/users.js` |
| new | `core/workspace-creation.js` |
| modified | `index.js` |
| modified | `scripts/cloud-setup.sh` |
| modified | `scripts/health-log.js` |
| modified | `scripts/instance-audit.js` |

## 2. RELATED TEST / VERIFICATION (88)

Registered tests, browser checks and local migration/rollback operator rehearsals.

| Working-tree state | Path |
|---|---|
| new | `scripts/company-retirement-preflight.js` |
| new | `scripts/company-retirement-rehearsal.js` |
| modified | `tests/account-merge.test.js` |
| modified | `tests/api.test.js` |
| new | `tests/autorole-command.test.js` |
| new | `tests/companies.test.js` |
| new | `tests/company-lifecycle.test.js` |
| new | `tests/company-retirement-durable.test.js` |
| new | `tests/company-retirement-native.test.js` |
| new | `tests/company-retirement-preflight.test.js` |
| new | `tests/company-retirement-rehearsal.test.js` |
| new | `tests/company-role-policy.test.js` |
| new | `tests/company-schema.test.js` |
| new | `tests/console-authorization.test.js` |
| new | `tests/console-role-settings.test.js` |
| new | `tests/creation-request.test.js` |
| new | `tests/custom-select-keyboard.test.js` |
| new | `tests/database-pool.test.js` |
| new | `tests/discord-oauth-session.test.js` |
| new | `tests/mutation-origin.test.js` |
| modified | `tests/payments.test.js` |
| new | `tests/postgres-tls.test.js` |
| modified | `tests/project-channel-dispatcher.test.js` |
| new | `tests/project-completion.test.js` |
| new | `tests/project-directory-filters.test.js` |
| new | `tests/project-directory-position.browser.js` |
| new | `tests/project-insights.browser.js` |
| new | `tests/project-insights.test.js` |
| modified | `tests/project-join.test.js` |
| new | `tests/project-metric-parity.test.js` |
| modified | `tests/projects-contract.test.js` |
| modified | `tests/projects.test.js` |
| new | `tests/role-team-creation-ui.test.js` |
| new | `tests/role-team-creation.browser.js` |
| modified | `tests/run.js` |
| new | `tests/server-role-automatic.browser.js` |
| new | `tests/server-role-automatic.test.js` |
| new | `tests/server-role-bot.test.js` |
| new | `tests/server-role-events.test.js` |
| new | `tests/server-role-management.browser.js` |
| new | `tests/server-role-notifications.test.js` |
| new | `tests/server-role-preview-ui.test.js` |
| new | `tests/server-role-preview.test.js` |
| new | `tests/server-role-reconciliation.test.js` |
| new | `tests/server-role-retirement.test.js` |
| new | `tests/server-role-schema.test.js` |
| new | `tests/server-role-sync-concurrency.test.js` |
| new | `tests/server-role-sync.test.js` |
| new | `tests/server-role-team-creation.test.js` |
| new | `tests/server-role-titles-ui.test.js` |
| new | `tests/server-role-titles.test.js` |
| modified | `tests/server-tabs-ui.test.js` |
| new | `tests/server-workspace-discovery.test.js` |
| modified | `tests/session-store.test.js` |
| new | `tests/team-archive-disclosure.test.js` |
| new | `tests/team-goal-access.test.js` |
| new | `tests/team-goal-actions-ui.test.js` |
| new | `tests/team-goal-concurrency.test.js` |
| new | `tests/team-goal-create-ui.test.js` |
| new | `tests/team-goal-create.browser.js` |
| new | `tests/team-goal-detail-ui.test.js` |
| new | `tests/team-goal-measurement.test.js` |
| new | `tests/team-goal-notifications.test.js` |
| new | `tests/team-goal-reference.browser.js` |
| new | `tests/team-goal-reference.test.js` |
| new | `tests/team-goal-reviewer-ui.test.js` |
| new | `tests/team-goal-schema.test.js` |
| new | `tests/team-goal-terms-ui.test.js` |
| new | `tests/team-goal-workflow.browser.js` |
| new | `tests/team-goals-ui.test.js` |
| new | `tests/team-goals.test.js` |
| new | `tests/team-member-titles-ui.test.js` |
| new | `tests/team-membership-source-ui.test.js` |
| new | `tests/team-membership-source.browser.js` |
| new | `tests/team-membership-sources.test.js` |
| new | `tests/team-restoration.browser.js` |
| new | `tests/team-workspace-ui.test.js` |
| new | `tests/team-workspace.browser.js` |
| modified | `tests/teams-contract.test.js` |
| modified | `tests/teams.test.js` |
| modified | `tests/test-database.js` |
| modified | `tests/test-database.test.js` |
| new | `tests/title-workspace.browser.js` |
| new | `tests/voice-connection.test.js` |
| new | `tests/workspace-creation.test.js` |
| new | `tests/workspace-draft-guard.test.js` |
| new | `tests/workspace-drafts.browser.js` |
| new | `tests/workspace-ux.browser.js` |

## 3. RELEASE DOCUMENTATION (9)

Deployment, audit, handoff, plan, domain and packaging records.

| Working-tree state | Path |
|---|---|
| modified | `.gitignore` |
| new | `COMPANY_IMPLEMENTATION_STATUS.md` |
| new | `COMPANY_TEAMS_PROJECTS_IMPROVEMENT_PLAN.md` |
| modified | `CONTEXT.md` |
| modified | `DATABASE.md` |
| new | `PRE_RELEASE_AUDIT.md` |
| modified | `README.md` |
| new | `RELEASE_MANIFEST.md` |
| new | `docs/adr/0002-company-workspaces-and-role-sources.md` |

## 4. UNRELATED HISTORICAL WORK (5)

Preserved in the original working tree, deliberately absent from the candidate overlay.

| Working-tree state | Path |
|---|---|
| new | `VOICE_DATABASE_RESTART_INCIDENT_PLAN.md` |
| new | `app/companies/[companyId]/page.js` |
| new | `app/companies/[companyId]/people/page.js` |
| new | `app/companies/[companyId]/requests/page.js` |
| new | `app/companies/[companyId]/teams/page.js` |

## 5. LOCAL / GENERATED / TEMPORARY

Exclude `.tmp/`, `.next/`, `node_modules/`, `.impeccable/`, `temp/`, environment files, local logs, browser captures and disposable PostgreSQL data. They are not source overlays and are not copied into the release candidate.

## 6. UNCERTAIN — resolved

No changed path remains unclassified. Mixed history in `backend/bot/bot.js`, `backend/database/database.js`, `core/db.js`, `adapters/health/health-log.js`, `backend/web/web.js`, `index.js`, `tests/run.js` and `.gitignore` was inspected for direct imports/runtime/test contracts and deliberately included as whole-file companions. The four Company prototype pages were inspected and excluded.

## Assembly rule

Use a non-destructive temporary snapshot of tracked `HEAD`, then overlay only categories 1–3. Do not copy categories 4–5. Verify every overlay against this manifest before running the full test/build/browser checks. This manifest itself is category 3.

The assembled snapshot is `.tmp/release-candidate-20260928`. Fresh checks passed: 103/103 registered suites, production build, applicable syntax and tracked-diff whitespace, and 14/14 browser scripts. Four already-listed test fixtures were refined during verification (`workspace-creation`, `server-role-sync`, `team-workspace.browser`, `team-restoration.browser`); they remain category 2. The snapshot's generated OCR cache, `.next` output and browser captures are local verification inputs/outputs, not release files. All 215 category 1–3 paths are staged, including 147 new files; the five category-4 paths remain unstaged. The staged diff passes whitespace and path/artifact checks. No path has been committed, pushed or deployed.
