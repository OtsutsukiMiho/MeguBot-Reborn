# ADR 0001: Separate team eligibility from project access

Status: accepted

## Context

Project collaborators need a reusable organization-level roster, while projects must remain private and existing standalone invite links must continue to work. Copying every team member into every project would expose project names and content too broadly and make roster changes silently alter access.

## Decision

A project has zero or one `team_id`. Team membership and project membership remain separate records.

- Standalone projects have `team_id = NULL` and keep their existing owner-approved project join links.
- Team projects require an active membership in both `team_memberships` and `project_memberships` for effective access.
- Team owner/admin may create team projects. The creator becomes that project's owner.
- Members are added to a project explicitly from the active team roster and receive an independent project role.
- Removing a team member transactionally revokes their memberships and active assignments in all projects of that team, without deleting historical reports.
- Archiving a team keeps authorized reads available but blocks team/project mutations and pending notification delivery.
- Standalone-to-team conversion is explicit and one-way in v1. It requires every active project member to already belong to the destination team and revokes standalone invitation paths.

## Consequences

Authorization must join both membership tables for team projects in HTTP, Discord, background notification, and directory paths. The extra check is deliberate: team membership alone cannot leak project metadata, and project membership cannot outlive removal from its team. Rejoining a team does not reactivate historical project memberships.

This model adds a project-roster selection step, but preserves least privilege and leaves project-specific roles, history, lifecycle, and ownership unchanged.
