'use strict';

require('dotenv').config();
const assert = require('node:assert/strict');
const core = require('../core');

const createdUsers = [];
const createdTeams = [];
const createdProjects = [];

async function expectCode(promise, code) {
	await assert.rejects(promise, error => error?.code === code);
}

async function user(label) {
	const login = await core.users.loginWithIdentity({
		provider: 'discord', providerUid: `__team_${label}_${Date.now()}_${Math.random()}__`,
		username: `team-${label}`, displayName: `Team ${label}`,
	});
	createdUsers.push(login.user.id);
	return login.user.id;
}

async function main() {
	await core.initCoreSchema();
	const owner = await user('Owner');
	const admin = await user('Admin');
	const member = await user('Member');
	const outsider = await user('Outsider');

	const created = await core.teams.createTeam({ ownerUserId: owner, name: 'Launch crew', description: 'Reusable project roster', color: 'emerald' });
	const team = created.team;
	createdTeams.push(team.id);
	assert.equal(team.role, 'owner');
	assert.equal(created.capabilities.canCreateProject, true);

	const link = await core.teams.createJoinLink(team.id, owner);
	assert.ok(link.token.length >= 32);
	assert.equal((await core.teams.previewJoinToken(link.token)).team.name, 'Launch crew');
	assert.equal((await core.teams.requestTeamJoin(link.token, admin)).status, 'pending');
	let requests = await core.teams.listJoinRequests(team.id, owner);
	await core.teams.reviewJoinRequest(team.id, requests.requests[0].id, owner, { action: 'approve', role: 'admin' });
	assert.equal((await core.teams.getTeam(team.id, admin)).me.role, 'admin');

	assert.equal((await core.teams.requestTeamJoin(link.token, member)).status, 'pending');
	requests = await core.teams.listJoinRequests(team.id, admin);
	await expectCode(core.teams.reviewJoinRequest(team.id, requests.requests[0].id, admin, { action: 'approve', role: 'admin' }), 'team_forbidden');
	await core.teams.reviewJoinRequest(team.id, requests.requests[0].id, admin, { action: 'approve', role: 'member' });

	const project = await core.projects.createProject({ ownerUserId: admin, teamId: team.id, title: 'Team launch', timezone: 'Asia/Bangkok' });
	createdProjects.push(project.id);
	assert.equal(project.teamId, team.id);
	await expectCode(core.projects.getProjectByCode(project.code, member), 'project_not_found');
	await expectCode(core.projects.createProject({ ownerUserId: member, teamId: team.id, title: 'Forbidden project' }), 'team_forbidden');
	await expectCode(core.projects.createProject({ ownerUserId: outsider, teamId: team.id, title: 'Hidden project' }), 'team_not_found');

	await core.projects.addTeamMembers(project.code, admin, { members: [{ userId: member, role: 'member' }], expectedRevision: 0 });
	assert.equal((await core.projects.getProjectByCode(project.code, member)).me.role, 'member');
	await expectCode(core.projects.addTeamMembers(project.code, admin, { members: [{ userId: outsider, role: 'member' }], expectedRevision: 1 }), 'team_member_invalid');
	await expectCode(core.projects.createJoinLink(project.code, admin), 'team_project_invite_disabled');
	const managerRoster = await core.teams.listTeamMembers(team.id, owner);
	assert.deepEqual(managerRoster.members.find(person => person.userId === member).removalImpact, { projectCount: 1, assignmentCount: 0 });
	const memberRoster = await core.teams.listTeamMembers(team.id, member);
	assert.equal(memberRoster.members.find(person => person.userId === admin).removalImpact, undefined, 'ordinary members do not learn another member’s project footprint');
	assert.deepEqual(memberRoster.members.find(person => person.userId === member).removalImpact, { projectCount: 1, assignmentCount: 0 });

	let teamView = await core.teams.getTeam(team.id, owner);
	const removed = await core.teams.removeTeamMember(team.id, member, owner, { expectedRevision: teamView.team.revision });
	assert.equal(removed.impact.projectCount, 1);
	await expectCode(core.projects.getProjectByCode(project.code, member), 'project_not_found');
	await core.teams.requestTeamJoin(link.token, member);
	requests = await core.teams.listJoinRequests(team.id, owner);
	await core.teams.reviewJoinRequest(team.id, requests.requests.find(request => request.userId === member).id, owner, { action: 'approve' });
	await expectCode(core.projects.getProjectByCode(project.code, member), 'project_not_found');

	teamView = await core.teams.getTeam(team.id, owner);
	await expectCode(core.teams.removeTeamMember(team.id, admin, owner, { expectedRevision: teamView.team.revision }), 'team_project_owner_transfer_required');
	await core.teams.archiveTeam(team.id, owner, { expectedRevision: teamView.team.revision });
	assert.equal((await core.projects.getProjectByCode(project.code, admin)).project.team.archivedAt != null, true);
	await expectCode(core.projects.updateProject(project.code, admin, { title: 'Blocked while archived', expectedRevision: 1 }), 'team_archived');
	teamView = await core.teams.getTeam(team.id, owner);
	await core.teams.restoreTeam(team.id, owner, { expectedRevision: teamView.team.revision });
	teamView = await core.teams.getTeam(team.id, owner);
	const teamTransfer = await core.teams.proposeOwnershipTransfer(team.id, owner, { proposedOwnerId: member, expectedRevision: teamView.team.revision });
	await expectCode(core.teams.acceptOwnershipTransfer(team.id, teamTransfer.transfer.id, admin), 'team_forbidden');
	await core.teams.acceptOwnershipTransfer(team.id, teamTransfer.transfer.id, member);
	assert.equal((await core.teams.getTeam(team.id, member)).me.role, 'owner');
	assert.equal((await core.teams.getTeam(team.id, owner)).me.role, 'admin');

	const destination = await core.teams.createTeam({ ownerUserId: owner, name: 'Destination', color: 'violet' });
	createdTeams.push(destination.team.id);
	const standalone = await core.projects.createProject({ ownerUserId: owner, title: 'Existing standalone' });
	createdProjects.push(standalone.id);
	await core.db.query("INSERT INTO project_memberships (project_id,user_id,role) VALUES ($1,$2,'member')", [standalone.id, outsider]);
	const oldJoin = await core.projects.createJoinLink(standalone.code, owner);
	await expectCode(core.projects.convertProjectToTeam(standalone.code, owner, { teamId: destination.team.id, expectedRevision: 0 }), 'project_team_members_unresolved');
	const destinationLink = await core.teams.createJoinLink(destination.team.id, owner);
	await core.teams.requestTeamJoin(destinationLink.token, outsider);
	requests = await core.teams.listJoinRequests(destination.team.id, owner);
	await core.teams.reviewJoinRequest(destination.team.id, requests.requests[0].id, owner, { action: 'approve' });
	const converted = await core.projects.convertProjectToTeam(standalone.code, owner, { teamId: destination.team.id, expectedRevision: 0 });
	assert.equal(converted.project.teamId, destination.team.id);
	await expectCode(core.projects.requestProjectJoin(oldJoin.token, member), 'team_project_invite_disabled');
	assert.equal((await core.projects.getProjectByCode(standalone.code, outsider)).me.role, 'member');

	const directory = await core.projects.listProjectDirectory(outsider, { teamId: destination.team.id });
	assert.deepEqual(directory.projects.map(item => item.id), [standalone.id]);
	assert.equal((await core.teams.getTeam(destination.team.id, member).catch(error => error)).code, 'team_not_found');

	console.log('teams passed — joins, role boundaries, dual project access, removal, archive, and conversion hold together');
}

async function cleanup() {
	for (const id of createdProjects) await core.db.query('DELETE FROM projects WHERE id=$1', [id]).catch(() => undefined);
	for (const id of createdTeams) await core.db.query('DELETE FROM teams WHERE id=$1', [id]).catch(() => undefined);
	for (const id of createdUsers) await core.db.query('DELETE FROM users WHERE id=$1', [id]).catch(() => undefined);
}

main().then(cleanup).then(() => core.db.close()).catch(async error => {
	console.error(error);
	await cleanup().catch(() => undefined);
	await core.db.close().catch(() => undefined);
	process.exitCode = 1;
});
