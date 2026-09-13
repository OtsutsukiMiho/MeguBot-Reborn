# Domain Model: Role Manager & Authorization System

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

- **Team**: A reusable roster that can represent a company, club, organization, or informal group. Teams are intentionally flat; there are no nested departments.
- **Team membership**: Eligibility to be selected for team projects. It never grants access to project content by itself.
- **Project membership**: Access to one private project, with the existing owner, lead, member, or viewer role.
- **Standalone project**: A project without a team. It retains the owner-approved project join-link flow.
- **Team project**: A project attached to exactly one team. Effective access requires both active team membership and active project membership.
- **Team manager**: A team owner or admin. Managers may edit the team and manage ordinary roster membership; only the owner may manage admins, transfer ownership, or archive the team.
- **Add from team**: The explicit act of adding selected active team members to a project roster and assigning initial project roles.
- **Conversion**: The one-way v1 transition from standalone project to team project. All current project members must already belong to the destination team.
- **Archived team**: A reversible read-only team state. Existing authorized readers retain access, while team and project mutations and new notification delivery are denied.

### Team invariants

1. One active team owner exists at a time; ownership changes use two-party acceptance.
2. Removing a team member revokes their memberships and active assignments in that team's projects, but preserves authored reports and history.
3. A team member who rejoins does not regain old project access automatically.
4. Team projects never accept standalone project invitations or project join links.
5. Team ownership does not imply access to every team project; project ownership remains independent.
