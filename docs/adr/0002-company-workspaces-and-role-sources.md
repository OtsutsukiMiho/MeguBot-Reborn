# Discord server workspaces and role membership sources

Status: Prototype Company hierarchy superseded by user clarification, 20 September 2026; server-native implementation and offline verification continued 27 September 2026. Deployment and live pilot are not approved.

## Superseding decision

There is no separate company group. An existing Discord server is the workspace and supplies its identity, membership and administrative authority. Remove the independent claim/roster/ownership lifecycle from the user-facing model and use guild-keyed teamwork routes. Explicit team/project access, role-source provenance, suppression safety and private goal-review boundaries remain required. The earlier decisions below are historical implementation context, not authority to ship a second organization layer. Preserve any persisted data until a verified migration/removal plan exists.

## Current implementation boundary

Fresh startup does not install Company tables or a team Company reference. Discord server identity and freshly verified authority drive the workspace; explicit team/project rosters remain private. Shared core exports and public routes do not expose Company management. Existing legacy storage, if present on another deployment, retains its eligibility/archive/merge/delivery guards until an explicitly reviewed migration; a missing legacy schema with non-null references fails closed.

An authorized read-only census found no Company tables, columns or foreign keys in the configured retained database. This is a snapshot of one database, not permission to assume every deployment is empty. Populated local trials materialize old denials as suppression/revocation and preserve archive/history/ownership/provenance. They prove exact transactional rollback and committed recovery through native PostgreSQL backup/restore in a separate random disposable database, including original rows and constraints. The ordinary rehearsal CLI remains rollback-only; its test-only commit helper refuses shared/retained/remote databases and has no startup caller. No automatic backfill, live detach/drop or Company feature activation is allowed.

The unreachable Company directory/people/workspace components are retired. The shared resource hook and server workspace styles remain in neutral live locations; retired `/companies` pages continue returning not found. Legacy conditional authorization and historical tables are retained for deployments with populated references, rather than silently restoring denied access.

Automatic role membership is implemented behind the server-enforced default-off flag. A freshly verified server manager requests explicit policy-version-1 delegation; only the current native team owner with manual ownership provenance may preview and confirm it. People who assign selected Discord roles can grant Member eligibility, never administrator/owner/reviewer authority or project membership. Holder previews are partial and create no placeholder accounts. Fresh exact identity-bound checks govern every mutation. Disable/switch/unlink queues retirement of this source, preserves manual/other sources and ownership blockers, and never converts grants to manual or restores project access.

The single incumbent bot worker uses durable coalesced jobs, bounded batches, expiring fenced leases and resumable cursors. Relevant events, reconnect and identity changes schedule checks rather than prove access. Local status exposes bounded operational states; configuration-only server management does not expose private rosters, counts or goal content. Generic private outbox notices deduplicate by source/attention cycle and recheck current eligibility, identity, preferences and resolution immediately before dispatch. Uncertain configuration saves replay exact durable receipts.

## Historical prototype context (superseded)

Teams currently group by an optional Discord guild label. The approved plan introduces one company workspace per guild, with many teams and explicit project rosters. Discord roles can represent departments or job titles, but neither implies private project access.

## Historical prototype decisions (superseded)

- Company is the guild-backed parent, team is a working group, project is a private work roster. Independent teams and standalone projects remain supported.
- Company membership, team membership, and project membership are separate requirements. Company owners/admins can inspect structural team metadata, not private projects or goal reviews.
- Once attached, company eligibility is enforced independently of UI flags. Archived companies permit historical reads but deny writes. Lock order is company, team, project.
- Existing connected teams migrate once into unclaimed companies. Existing active team members become company members, never inferred company owners. A completion marker prevents later backfill runs from undoing deliberate revocations.
- Company ownership is claimed through fresh bot-backed verification of a linked Discord guild owner, not a client snapshot or cached OAuth server list.
- Retired team-role mappings preserve source history and their original server snapshot. Only active configuration binds the team's current server; safe detach still requires every derived source to be retired or explicitly retained. Automatic consent/reconciliation is separately gated and defaults off.
- Discord organization titles are display-only. Approval-based role import creates manual grants. Optional automatic mappings create source-specific membership grants, never management permissions or project membership.
- Role verification failures preserve last confirmed grants and block new automatic grants; they are not proof that someone left. Suppressions prevent automatic re-admission after manual removal.
- Automatic reconciliation remains a separately gated release. Its existing-bot worker requires `MEGU_TEAM_ROLE_SYNC_ENABLED=1`, configured `GuildMembers` intent, a ready gateway, and freshly fetched application approval (`GatewayGuildMembers` or `GatewayGuildMembersLimited`). Operators must enable/obtain the Server Members privileged intent in the Discord Developer Portal before a separately approved rollout; no Manage Roles permission is requested. Missing capabilities preserve grants and degrade work. Durable batches use the incumbent pool, maximum five member lookups, fenced 90-second leases, resumable keyset checkpoints, delayed retries, and a 30-second single worker tick. Startup wakes persisted sweep work without discarding unfinished cursors. This is not authorization to activate an unfinished automatic-mode release or run a live pilot.
- Goal reviews remain private to the subject and assigned reviewer. Project progress is not an employee score.

## Compatibility

This refines ADR 0001 while preserving explicit team/project rosters, independent teams and standalone project invitations. Connecting a Discord server does not create another membership hierarchy. Existing Company restrictions are compatibility-only and continue to fail closed where retained references exist. Guild discovery and Discord administration never substitute for private project or goal grants.

## Rollout

Follow COMPANY_TEAMS_PROJECTS_IMPROVEMENT_PLAN.md under its authoritative server-native clarification. Do not enable the retired Company model. Private Goals and automatic role membership have independent server-enforced gates; schema installation is not rollout approval.

1. Complete offline regression/build/browser checks and inspect their actual limitations. Inventory each deployment read-only under explicit authorization; populated legacy references require their reviewed migration, backup and recovery procedure. Never infer another database's emptiness from the recorded census.
2. Before an authorized automatic pilot, verify the existing bot's configured GuildMembers intent, ready gateway and fresh application approval (including limited approval). Operators enable/obtain Server Members privileged intent in the Discord Developer Portal. No Manage Roles permission or role-write operation is required. Use consenting registered identities, one pilot team and explicit current-manager/current-owner delegation.
3. Start with the flag off. Enable only after separate operator approval; monitor bounded status, fresh grants/removals, source cycles, delayed retries, blocked ownership/capacity and generic notices. Confirm private project membership remains explicit and title roles remain display-only.
4. For a normal per-team rollback, preview and confirm pause, approval mode or unlink while the worker is enabled; allow queued source retirement to finish and resolve ownership exceptions explicitly. Approval mode then requires its ordinary owner approval. Global flag-off stops processing and preserves existing grants; it does **not** drain retirement or remove access. For an emergency freeze, turn the flag off and use established manual member controls for urgent removal. Re-enable only with reviewed current consent/configuration and fresh verification.
5. Code rollback preserves additive schema and all source/job/event history. Do not drop columns/tables, erase sources, silently convert role grants or restore project membership. A committed data migration rollback requires a verified backup, stopped writers/delivery and restored counts/access/history before service resumes; the transactional rehearsal alone does not establish that recovery.

Offline evidence is in the authoritative COMPANY_IMPLEMENTATION_STATUS.md. Synthetic browser APIs and injected notification transports are not evidence of deployed sessions, real Discord admission/delivery or a consenting live pilot. Those remain explicit operator gates.
