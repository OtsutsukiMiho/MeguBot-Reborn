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
const teamDirectory = read('app', 'components', 'teams', 'TeamDirectory.js');
const directoryNav = read('app', 'components', 'projects', 'ProjectDirectoryNav.js');
const serverWorkspace = read('app', 'components', 'Tabs', 'ProjectsTeamsTab.js');
const serverPage = read('app', 'servers', '[guildId]', 'page.js');
const notifications = read('core', 'notifications.js');
const dispatcher = read('adapters', 'notifications', 'dispatcher.js');
const bot = read('backend', 'bot', 'bot.js');
const navbar = read('app', 'components', 'Navbar.js');
const roleMappingUi = read('app', 'components', 'teams', 'TeamRoleMapping.js');
assert.match(roleMappingUi, /<CustomSelect/);
assert.match(roleMappingUi, /team\.role === 'owner'/);
assert.match(roleMappingUi, /expectedRevision: mapping\?\.revision/);
assert.match(roleMappingUi, /confirmSharedRoles: shared/);
for (const lang of ['en', 'th']) {
	const copy = require(`../app/copy/${lang}`).roleMappings;
	for (const [, key] of roleMappingUi.matchAll(/\bc\.(\w+)/g)) assert.ok(copy[key] != null, `Missing ${lang} role-mapping copy: ${key}`);
	for (const [, key] of roleMappingUi.matchAll(/\bs\.(\w+)/g)) assert.ok(copy.sync[key] != null, `Missing ${lang} automatic role copy: ${key}`);
}
const focusedWorkspace = read('app', 'components', 'teams', 'ServerTeamWorkspace.js');
const focusedRoute = read('app', 'teams', 'server', '[guildId]', '[section]', 'page.js');
assert.match(focusedWorkspace, /workspace\/\$\{section\}\?limit=30&offset=/, 'Each page fetches only its section');
assert.doesNotMatch(focusedWorkspace, /window\.history|popstate/, 'Next routing owns navigation and Back behavior');
assert.match(focusedWorkspace, /resource\.data\.nextOffset/);
assert.match(focusedRoute, /\['teams', 'projects'\]\.includes\(section\)/);
assert.match(focusedRoute, /Number\.isSafeInteger\(offset\)/);
assert.match(focusedRoute, /key=\{`\$\{guildId\}:\$\{section\}:\$\{offset\}`\}/, 'Page changes cannot display stale section data');

for (const table of ['teams', 'team_memberships', 'team_join_links', 'team_join_requests', 'team_ownership_transfers', 'team_events']) {
	assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
}
assert.match(schema, /team_id\s+TEXT REFERENCES teams\(id\) ON DELETE RESTRICT/);
assert.match(schema, /discord_guild_id TEXT/);
assert.match(schema, /request_cycle INTEGER NOT NULL DEFAULT 1/);
assert.match(schema, /originating_link_id TEXT REFERENCES project_join_links/);
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
	"api.get('/teams/discord-guilds'", "api.post('/teams/:id/discord-guild'",
	"api.get('/teams/:id/discord-candidates'", "api.get('/teams/discord-guilds/:guildId/workspace'",
]) assert.ok(api.includes(route), `Missing route: ${route}`);
assert.match(directory, /p\.scopes\.standalone/);
const createProject = read('app', 'components', 'projects', 'CreateProject.js');
const newProject = read('app', 'components', 'projects', 'NewProject.js');
assert.match(createProject, /teamId: mode === 'team'/);
assert.match(createProject, /disabled=\{lockTeam \|\| frozen\}/);
assert.doesNotMatch(createProject, /eligibleTeams\[0\]/, 'Team selection must be explicit');
assert.match(newProject, /teamId && !team/, 'An inaccessible requested team must not fall back to standalone');
assert.match(directory, /\/projects\/new/);
assert.doesNotMatch(directory, /<CreateProject/, 'Creation is separate from browsing');
assert.match(directory, /NEXT_PUBLIC_MEGU_PROJECT_TEAMS_ENABLED/);
assert.match(manage, /project\.teamId && <ProjectTeamPicker/);
assert.match(picker, /type="checkbox"/);
assert.match(picker, /members\?limit=100&q=/);
assert.match(picker, /unresolvedMembers/);
assert.match(teamManage, /role="alertdialog"/);
assert.match(teamManage, /removeConfirmImpact/);
assert.match(teamManage, /DiscordConnection/);
assert.match(teamManage, /DiscordRoster/);
assert.match(teamManage, /notificationPreference/);
assert.match(teamDirectory, /ProjectDirectoryNav current="teams"/);
assert.match(teamDirectory, /independentTeams/);
assert.match(teamDirectory, /\.\.\.guilds, \.\.\.workspaceGuilds/, 'Discovery includes ordinary-member servers without broadening creation permissions');
assert.match(teamDirectory, /<CreateTeam c=\{c\} guilds=\{guilds\}/, 'Creation retains the managed-server list');
assert.match(teamDirectory, /\/teams\/server\/\$\{encodeURIComponent\(group.guild.id\)\}\/teams/, 'A member can open the server workspace from an existing team group');
assert.match(directoryNav, /aria-current/);
assert.match(serverPage, /ProjectsTeamsTab/);
assert.match(serverWorkspace, /serverWorkspaceTitle/);
assert.match(serverWorkspace, /\/teams\/server\//, 'Bot dashboard links directly to the focused server workspace');
assert.doesNotMatch(serverWorkspace, /fetch\(|workspace\.teams|workspace\.projects/, 'Bot dashboard must not duplicate the workspace roster');
assert.match(bot, /get_team_guild_roster/);
assert.match(notifications, /project_join_requested/);
assert.match(notifications, /team_join_requested/);
assert.match(notifications, /async function recheckClaimed/);
assert.match(dispatcher, /recheckClaimed/);
assert.doesNotMatch(navbar, /href="\/account" className=\{`tab-btn/);
assert.match(navbar, /className="user-identity-link"/);
assert.match(navbar, /aria-current=\{pathname\.startsWith\('\/account'\)/);

console.log('teams contract passed — reusable rosters, dual access, team project UX, and account navigation are wired');
