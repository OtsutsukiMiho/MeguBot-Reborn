'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const schema = read('core', 'schema.js');
const teams = read('core', 'teams.js');
const projects = read('core', 'projects.js');
const reminders = read('core', 'project-reminders.js');
const channelNotifications = read('core', 'project-channel-notifications.js');
const api = read('adapters', 'http', 'megu-api.js');
const directory = read('app', 'projects', 'page.js');
const manage = read('app', 'components', 'projects', 'ProjectManage.js');
const picker = read('app', 'components', 'projects', 'ProjectTeamPicker.js');
const teamManage = read('app', 'components', 'teams', 'TeamManage.js');
const navbar = read('app', 'components', 'Navbar.js');

for (const table of ['teams', 'team_memberships', 'team_join_links', 'team_join_requests', 'team_ownership_transfers', 'team_events']) {
	assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
}
assert.match(schema, /team_id\s+TEXT REFERENCES teams\(id\) ON DELETE RESTRICT/);
assert.match(schema, /team_memberships_one_owner_key/);
assert.match(teams, /TEAM_ROLES = \['owner', 'admin', 'member'\]/);
assert.match(teams, /team_project_owner_transfer_required/);
assert.match(teams, /DELETE FROM project_topic_assignees/);
assert.match(teams, /UPDATE project_memberships pm SET revoked_at=now\(\)/);
assert.match(teams, /link_rotated/);
assert.match(teams, /affected_project_count/);
assert.match(teams, /team_join_request_limit/);
assert.match(projects, /p\.team_id IS NULL OR tm\.user_id IS NOT NULL/);
assert.match(projects, /team_project_invite_disabled/);
assert.match(projects, /project_team_members_unresolved/);
assert.match(projects, /async function addTeamMembers/);
assert.match(projects, /async function convertProjectToTeam/);
assert.match(reminders, /team_archived_at/);
assert.match(reminders, /team_memberships tm/);
assert.match(channelNotifications, /team_archived_at/);
for (const route of [
	"api.get('/teams'", "api.post('/teams'", "api.get('/teams/join/:token'",
	"api.get('/teams/:id/members'", "api.post('/teams/:id/join-link'",
	"api.get('/teams/:id/join-requests'", "api.post('/projects/:code/team'",
	"api.post('/projects/:code/members'",
]) assert.ok(api.includes(route), `Missing route: ${route}`);
assert.match(directory, /p\.scopes\.standalone/);
assert.match(directory, /teamId: mode === 'team'/);
assert.match(directory, /NEXT_PUBLIC_MEGU_PROJECT_TEAMS_ENABLED/);
assert.match(manage, /project\.teamId && <ProjectTeamPicker/);
assert.match(picker, /type="checkbox"/);
assert.match(picker, /members\?limit=100&q=/);
assert.match(picker, /unresolvedMembers/);
assert.match(teamManage, /role="alertdialog"/);
assert.match(teamManage, /removeConfirmImpact/);
assert.doesNotMatch(navbar, /href="\/account" className=\{`tab-btn/);
assert.match(navbar, /className="user-identity-link"/);
assert.match(navbar, /aria-current=\{pathname\.startsWith\('\/account'\)/);

console.log('teams contract passed — reusable rosters, dual access, team project UX, and account navigation are wired');
