# Domain Model: Role Manager & Authorization System

## Current server-workspace direction (20 September 2026)

The user's clarification supersedes the in-progress company model below: a Discord server **is** the parent workspace, with teams and projects beneath it. “Company” is only an analogy, not a separate organization, roster or ownership system. Discord owns server identity and membership; team/project access remains explicit. See the authoritative clarification at the top of COMPANY_TEAMS_PROJECTS_IMPROVEMENT_PLAN.md. Earlier company terminology describes unfinished work awaiting refactoring, not the intended shipped model.

## 1. Ubiquitous Language & Concepts

- **Server Role (`GuildRole`)**: A Discord role entity containing `id`, `name`, `color`, `hoist` (display separately in sidebar), `mentionable`, `position`, `managed` (integration/Nitro status), and `permissions` bitfield.
- **Role Creation (`ROLE_CREATE`)**: Operation allowing an authenticated server admin to create a new role with a name, hex color, hoist, and mentionable status.
- **Role Mutation (`ROLE_UPDATE`)**: Modifying attributes (`name`, `color`, `hoist`, `mentionable`, `permissions`) of an existing unmanaged role positioned lower than MeguBot's highest role.
- **Role Deletion (`ROLE_DELETE`)**: Permanently removing a role from the Discord server (prohibited for `@everyone` and managed integration roles).
- **Member Role Assignment (`ROLE_ASSIGN` / `ROLE_REMOVE`)**: Adding or removing a role from a specific Discord server member.
- **Role Hierarchy (`HierarchySafety`)**: Security invariant enforcing that MeguBot cannot create, edit, delete, or assign roles positioned higher than or equal to its own highest role position.

## 2. Permissions & Presets

- **Admin Preset**: Administrator permissions bitfield.
- **Moderator Preset**: Manage Messages, Kick Members, Ban Members, Moderate Members (Timeout), View Audit Log.
- **Member Preset**: Send Messages, View Channel, Read Message History, Add Reactions, Connect, Speak.
- **Custom**: Bitfield computed from selected capability checkboxes.

## 3. Invariants & Safety Rules

1. `@everyone` role cannot be deleted or renamed.
2. Roles with `managed: true` (Bot/Nitro Booster roles) cannot be modified or deleted via Role Manager.
3. Operations target only roles where `role.position < botMember.roles.highest.position`.
4. All role operations produce a standardized `[Roles]` audit log entry with actor identification and before/after diffs.

## Project Teams & Reusable Rosters

An existing Discord server is the parent workspace; no separate Company hierarchy is introduced. See `docs/adr/0002-company-workspaces-and-role-sources.md`. Fresh startup omits Company storage; deployments retaining `company_id` continue enforcing their eligibility/archive restrictions until reviewed migration. Discord authority never implies private team/project/goal access. Independent teams and standalone projects remain supported.

- **Create team from Discord role**: Create a Megu team from an existing guild-scoped role, without creating or assigning a Discord role. A role may instead be linked to an existing server-connected team.
- **Organization title**: A display-only label such as CEO or Developer, sourced from a configured Discord role; distinct from application access roles.
- **Role membership mapping**: A guild-scoped team configuration producing approval-based suggestions by default. Default-off automatic mode needs explicit versioned current-server-manager delegation and native-team-owner consent, fresh verification, durable source provenance and suppression/ownership-safe retirement. It never enrolls users into projects or grants management/reviewer authority.

- **Team**: A reusable roster that can represent a company, club, organization, or informal group. Teams are intentionally flat; there are no nested departments.
- **Team membership**: Eligibility to be selected for team projects. It never grants access to project content by itself.
- **Project membership**: Access to one private project, with the existing owner, lead, member, or viewer role.
- **Standalone project**: A project without a team. It retains the owner-approved project join-link flow.
- **Team project**: A project attached to exactly one team. Effective access requires both active team membership and active project membership.
- **Team manager**: A team owner or admin. Managers may edit the team and manage ordinary roster membership; only the owner may manage admins, transfer ownership, or archive the team.
- **Add from team**: The explicit act of adding selected active team members to a project roster and assigning initial project roles.
- **Conversion**: The one-way v1 transition from standalone project to team project. All current project members must already belong to the destination team.
- **Archived team**: A reversible read-only team state. Existing authorized readers retain access, while team and project mutations and new notification delivery are denied.
- **Connected team**: A team with an optional Discord server association. The association groups work and enables permission-checked roster discovery; it is not a membership source.
- **Independent team**: A team without a Discord server association. It retains the same reusable-roster and project-access behavior.
- **Discord candidate**: A server member returned by a bounded, authorized Discord preview. Approval mode requires a registered Discord identity and explicit native-team-owner admission; separately consented automatic mode uses fresh source-tracked Member eligibility. Partial previews never prove removal and unregistered holders create no placeholder users.
- **Join-request cycle**: The monotonic version of a reusable join-request row. It allows one owner alert for each legitimate reopened request without alerting again on refresh or retry.

### Team invariants

1. One active team owner exists at a time; ownership changes use two-party acceptance.
2. Removing a team member revokes their memberships and active assignments in that team's projects, but preserves authored reports and history.
3. A team member who rejoins does not regain old project access automatically.
4. Team projects never accept standalone project invitations or project join links.
5. Team ownership does not imply access to every team project; project ownership remains independent.
6. Connecting a Discord server alone never grants team/project membership. Active mappings/derived sources block detachment until safely retired or explicitly retained; restoration never restores project memberships or assignments.
7. Discord roster lookup requires both Megu team-management capability and freshly verified Discord Manage Server capability; cached server metadata is display-only.
8. A server workspace returns only connected teams where the actor is an active team member and projects where the actor has both active team and project membership.
9. New standalone-project and team join requests notify the current owner through that owner's explicit account delivery preference; an unavailable delivery channel never changes the approval queue.
