'use strict';

require('dotenv').config();
const assert = require('node:assert/strict');
const core = require('../core');
const { proposeTeamMapping, approveTeamMapping, approveRoleMember, getTeamMapping, setRoleSuggestionDismissed } = require('../core/server-role-mappings');

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
	const guildId = '467655562658578432';
	const owner = await user('Owner');
	const admin = await user('Admin');
	const member = await user('Member');
	const outsider = await user('Outsider');
	const candidateLogin = await core.users.loginWithIdentity({
		provider: 'discord', providerUid: '567890123456789012', username: 'team-candidate', displayName: 'Team Candidate',
	});
	const candidate = candidateLogin.user.id;
	createdUsers.push(candidate);
	await core.users.linkIdentity(owner, {
		provider: 'google', providerUid: `__team_owner_email_${Date.now()}__`, email: `team-owner-${Date.now()}@example.test`, emailVerified: true,
		username: 'team-owner@example.test', displayName: 'Team Owner',
	});
	await core.users.setNotificationPreferences(owner, { mode: 'both', locale: 'en' });

	// A server is the workspace: even the retired company flag must not
	// require a second organization claim or admission for new teams.
	const previousCompanyFlag = process.env.MEGU_COMPANIES_ENABLED;
	try {
		process.env.MEGU_COMPANIES_ENABLED = '1';
		const direct = await core.teams.createTeam({ ownerUserId: owner, name: 'Server-native team', discordGuildId: '998877665544332211', discordGuildName: 'Server workspace' });
		createdTeams.push(direct.team.id);
		assert.equal(direct.team.companyId, null);
		assert.equal(direct.team.discordGuild.id, '998877665544332211');
		const mappingGuild = '998877665544332211';
		const roleId = '123456789012345679';
		const mappingDeps = {
			verify: async (userId, guildId) => ({ available: true, userId, guildId, isMember: true, isBot: false, canManageServer: true }),
			listRoles: async guildId => ({ available: true, guildId, roles: [{ id: roleId, guildId, name: 'Development', managed: false }] }),
		};
		const proposal = await proposeTeamMapping(mappingGuild, direct.team.id, outsider, { roleIds: [roleId], expectedRevision: 0 }, mappingDeps);
		assert.equal(proposal.enabled, false);
		assert.equal(proposal.status, 'awaiting_owner_consent');
		await expectCode(core.teams.getTeam(direct.team.id, outsider), 'team_not_found');
		await expectCode(proposeTeamMapping(mappingGuild, direct.team.id, outsider, { roleIds: [roleId], expectedRevision: 0 }, mappingDeps), 'revision_conflict');
		await core.db.query('UPDATE server_role_mappings SET owner_consent_by=$2,owner_consent_at=now(),enabled=true WHERE id=$1', [proposal.id, owner]);
		const changedProposal = await proposeTeamMapping(mappingGuild, direct.team.id, outsider, { roleIds: [roleId], expectedRevision: 1 }, mappingDeps);
		assert.equal(changedProposal.revision, 2);
		const storedProposal = (await core.db.query('SELECT owner_consent_by,enabled FROM server_role_mappings WHERE id=$1', [proposal.id])).rows[0];
		assert.equal(storedProposal.owner_consent_by, null);
		assert.equal(storedProposal.enabled, false);
		await expectCode(approveTeamMapping(direct.team.id, outsider, { expectedRevision: 2 }, mappingDeps), 'team_not_found');
		await expectCode(approveTeamMapping(direct.team.id, owner, { expectedRevision: 2 }, { ...mappingDeps, listRoles: async guildId => ({ available: true, guildId, roles: [] }) }), 'discord_role_ineligible');
		await expectCode(approveTeamMapping(direct.team.id, owner, { expectedRevision: 2 }, { ...mappingDeps, verify: async (userId, guildId) => ({ available: true, userId, guildId, isMember: true, canManageServer: false }) }), 'team_forbidden');
		const approvedMapping = await approveTeamMapping(direct.team.id, owner, { expectedRevision: 2 }, mappingDeps);
		assert.equal(approvedMapping.enabled, true);
		assert.equal(approvedMapping.revision, 3);
		assert.equal((await getTeamMapping(direct.team.id, owner)).mapping.enabled, true);
		await core.db.query('UPDATE server_role_mappings SET owner_consent_by=$2 WHERE id=$1', [proposal.id, outsider]);
		assert.equal((await getTeamMapping(direct.team.id, owner)).mapping.enabled, false, 'Consent from someone who is not the current owner cannot appear approved');
		await core.db.query('UPDATE server_role_mappings SET owner_consent_by=$2 WHERE id=$1', [proposal.id, owner]);
		const memberDeps = { verify: async (userId, guildId) => ({ available: true, userId, guildId, isMember: true, isBot: false, roleIds: [roleId] }) };
		const dismissal = { discordUserId: '567890123456789012', dismissed: true, expectedRevision: 3 };
		await expectCode(setRoleSuggestionDismissed(direct.team.id, outsider, dismissal, mappingDeps), 'team_not_found');
		await expectCode(setRoleSuggestionDismissed(direct.team.id, owner, { ...dismissal, expectedRevision: 2 }, mappingDeps), 'revision_conflict');
		await expectCode(setRoleSuggestionDismissed(direct.team.id, owner, { ...dismissal, dismissed: 'true' }, mappingDeps), 'request_body_invalid');
		await expectCode(setRoleSuggestionDismissed(direct.team.id, owner, dismissal, { verify: async () => ({ available: false }) }), 'discord_guilds_unavailable');
		await expectCode(setRoleSuggestionDismissed(direct.team.id, owner, dismissal, memberDeps), 'team_forbidden');
		await setRoleSuggestionDismissed(direct.team.id, owner, dismissal, mappingDeps);
		await setRoleSuggestionDismissed(direct.team.id, owner, dismissal, mappingDeps);
		assert.equal((await core.db.query("SELECT count(*)::int AS n FROM team_events WHERE team_id=$1 AND event_type='role_suggestion_dismissed'", [direct.team.id])).rows[0].n, 1, 'Repeated dismissal is idempotent');
		await expectCode(approveRoleMember(direct.team.id, owner, { userId: candidate, expectedRevision: 3 }, memberDeps), 'role_suggestion_dismissed');
		assert.equal((await core.db.query('SELECT count(*)::int AS n FROM team_memberships WHERE team_id=$1 AND user_id=$2', [direct.team.id, candidate])).rows[0].n, 0, 'Dismissal never creates membership');
		await setRoleSuggestionDismissed(direct.team.id, owner, { ...dismissal, dismissed: false }, mappingDeps);
		await setRoleSuggestionDismissed(direct.team.id, owner, { ...dismissal, dismissed: false }, mappingDeps);
		assert.equal((await core.db.query("SELECT count(*)::int AS n FROM team_events WHERE team_id=$1 AND event_type='role_suggestion_reset'", [direct.team.id])).rows[0].n, 1, 'Repeated reset is idempotent');
		await expectCode(approveRoleMember(direct.team.id, owner, { userId: candidate, expectedRevision: 3 }, { verify: async (userId, guildId) => ({ available: true, userId, guildId, isMember: true, roleIds: [] }) }), 'role_member_ineligible');
		const imported = await approveRoleMember(direct.team.id, owner, { userId: candidate, expectedRevision: 3 }, memberDeps);
		assert.equal(imported.role, 'member');
		const importedSource = (await core.db.query('SELECT kind,origin,metadata FROM team_membership_sources WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL', [direct.team.id, candidate])).rows[0];
		assert.equal(importedSource.kind, 'manual'); assert.equal(importedSource.origin, 'role_approved'); assert.equal(importedSource.metadata.mappingRevision, 3);
		assert.equal((await core.db.query('SELECT count(*)::int AS n FROM project_memberships WHERE user_id=$1', [candidate])).rows[0].n, 0, 'Role approval never grants project access');
		await core.db.query("UPDATE team_memberships SET role='admin' WHERE team_id=$1 AND user_id=$2", [direct.team.id, candidate]);
		assert.equal((await approveRoleMember(direct.team.id, owner, { userId: candidate, expectedRevision: 3 }, memberDeps)).role, 'admin', 'Repeated approval never downgrades an existing role');
		const directBeforeRemoval = await core.teams.getTeam(direct.team.id, owner);
		await core.teams.removeTeamMember(direct.team.id, candidate, owner, { expectedRevision: directBeforeRemoval.team.revision });
		assert.equal(await require('../core/team-membership-sources').isMembershipSuppressed(core.db, direct.team.id, candidate), true);
		await expectCode(approveRoleMember(direct.team.id, owner, { userId: candidate, expectedRevision: 3 }, memberDeps), 'role_member_restore_confirmation_required');
		await expectCode(approveRoleMember(direct.team.id, owner, { userId: candidate, expectedRevision: 3, restoreRemoved: true, expectedTeamRevision: directBeforeRemoval.team.revision }, memberDeps), 'revision_conflict');
		assert.equal((await approveRoleMember(direct.team.id, owner, { userId: candidate, expectedRevision: 3, restoreRemoved: true, expectedTeamRevision: directBeforeRemoval.team.revision + 1 }, memberDeps)).role, 'member');
		assert.equal(await require('../core/team-membership-sources').isMembershipSuppressed(core.db, direct.team.id, candidate), false);
		assert.equal((await core.db.query('SELECT cleared_by FROM team_membership_suppressions WHERE team_id=$1 AND user_id=$2', [direct.team.id, candidate])).rows[0].cleared_by, owner);
		await core.teams.removeTeamMember(direct.team.id, candidate, owner, { expectedRevision: (await core.teams.getTeam(direct.team.id, owner)).team.revision });
		await core.db.query('DELETE FROM team_memberships WHERE team_id=$1 AND user_id=$2', [direct.team.id, candidate]);
		const suppressedCandidate = (await core.teams.listDiscordCandidates(direct.team.id, owner, mappingGuild, [{ id: '567890123456789012', displayName: 'Candidate' }])).candidates[0];
		assert.equal(suppressedCandidate.restoreRequired, true, 'Suppression remains visible without an effective membership row');
		await expectCode(approveRoleMember(direct.team.id, owner, { userId: candidate, expectedRevision: 3 }, memberDeps), 'role_member_restore_confirmation_required');
		await approveRoleMember(direct.team.id, owner, { userId: candidate, expectedRevision: 3, restoreRemoved: true, expectedTeamRevision: (await core.teams.getTeam(direct.team.id, owner)).team.revision }, memberDeps);
		await expectCode(approveTeamMapping(direct.team.id, owner, { expectedRevision: 2 }, mappingDeps), 'revision_conflict');
		await expectCode(core.teams.getTeam(direct.team.id, outsider), 'team_not_found');
		await expectCode(proposeTeamMapping(mappingGuild, direct.team.id, outsider, { roleIds: [roleId], expectedRevision: 2 }, { ...mappingDeps, verify: async () => ({ available: false }) }), 'discord_guilds_unavailable');
		await expectCode(proposeTeamMapping(mappingGuild, direct.team.id, outsider, { roleIds: [roleId], expectedRevision: 2 }, { ...mappingDeps, verify: async (userId, guildId) => ({ available: true, userId, guildId, isMember: true, canManageServer: false }) }), 'team_forbidden');
		const independent = await core.teams.createTeam({ ownerUserId: owner, name: 'Connect existing team' });
		createdTeams.push(independent.team.id);
		const attached = await core.teams.connectDiscordGuild(independent.team.id, owner, { guildId: '998877665544332211', guildName: 'Server workspace', expectedRevision: 0 });
		assert.equal(attached.team.companyId, null);
		assert.equal(attached.team.discordGuild.id, '998877665544332211');
		await expectCode(proposeTeamMapping(mappingGuild, independent.team.id, outsider, { roleIds: [roleId], expectedRevision: 0 }, mappingDeps), 'role_mapping_shared_confirmation_required');
		const sharedProposal = await proposeTeamMapping(mappingGuild, independent.team.id, outsider, { roleIds: [roleId], expectedRevision: 0, confirmSharedRoles: true }, mappingDeps);
		assert.equal(sharedProposal.enabled, false, 'Shared-role confirmation is not owner consent');
		await expectCode(core.teams.disconnectDiscordGuild(independent.team.id, owner, { expectedRevision: 1 }), 'team_role_mapping_connected');
		await expectCode(core.teams.connectDiscordGuild(independent.team.id, owner, { guildId, guildName: 'Another server', expectedRevision: 1 }), 'team_role_mapping_connected');
		assert.equal((await core.teams.getTeam(independent.team.id, owner)).team.revision, 1, 'Rejected scope changes leave the team unchanged');
		const firstPage = await core.teams.listGuildWorkspace('998877665544332211', owner, { section: 'teams', limit: 1 });
		assert.equal(firstPage.teams.length, 1);
		assert.equal(firstPage.nextOffset, 1);
		assert.deepEqual(firstPage.projects, []);
		const secondPage = await core.teams.listGuildWorkspace('998877665544332211', owner, { section: 'teams', limit: 1, offset: firstPage.nextOffset });
		assert.equal(secondPage.teams.length, 1);
		assert.notEqual(secondPage.teams[0].id, firstPage.teams[0].id);
		assert.equal(secondPage.nextOffset, null);
		assert.deepEqual((await core.teams.listGuildWorkspace('998877665544332211', outsider, { section: 'teams', limit: 1 })).teams, []);
		for (const options of [{ section: 'all' }, { section: 'teams', limit: 101 }, { section: 'projects', offset: -1 }, { section: 'teams', offset: 'NaN' }]) {
			await expectCode(core.teams.listGuildWorkspace('998877665544332211', owner, options), 'workspace_page_invalid');
		}
	} finally {
		if (previousCompanyFlag === undefined) delete process.env.MEGU_COMPANIES_ENABLED;
		else process.env.MEGU_COMPANIES_ENABLED = previousCompanyFlag;
	}

	const created = await core.teams.createTeam({ ownerUserId: owner, name: 'Launch crew', description: 'Reusable project roster', color: 'emerald' });
	const team = created.team;
	createdTeams.push(team.id);
	assert.equal(team.role, 'owner');
	assert.equal(created.capabilities.canCreateProject, true);
	const connected = await core.teams.connectDiscordGuild(team.id, owner, { guildId, guildName: 'The Megu Server', guildIcon: 'icon-hash', expectedRevision: 0 });
	assert.equal(connected.team.discordGuild.id, guildId);
	assert.equal((await core.teams.listTeamsForUser(owner, { discordGuildId: guildId })).teams[0].id, team.id);

	const link = await core.teams.createJoinLink(team.id, owner);
	assert.ok(link.token.length >= 32);
	assert.equal((await core.teams.previewJoinToken(link.token)).team.name, 'Launch crew');
	assert.equal((await core.teams.requestTeamJoin(link.token, admin)).status, 'pending');
	assert.equal((await core.teams.requestTeamJoin(link.token, admin)).status, 'pending', 'reloading a pending request is idempotent');
	let teamAlerts = await core.db.query("SELECT e.*,count(d.id)::int AS deliveries FROM notification_events e LEFT JOIN notification_deliveries d ON d.event_id=e.id WHERE e.event_type='team_join_requested' AND e.user_id=$1 GROUP BY e.id", [owner]);
	assert.equal(teamAlerts.rows.length, 1, 'a duplicate pending request queues one semantic event');
	assert.equal(teamAlerts.rows[0].deliveries, 2, 'Both preference fans out to Discord and verified email');
	let requests = await core.teams.listJoinRequests(team.id, owner);
	await core.teams.reviewJoinRequest(team.id, requests.requests[0].id, owner, { action: 'approve', role: 'admin' });
	assert.equal((await core.teams.getTeam(team.id, admin)).me.role, 'admin');

	assert.equal((await core.teams.requestTeamJoin(link.token, member)).status, 'pending');
	requests = await core.teams.listJoinRequests(team.id, admin);
	await expectCode(core.teams.reviewJoinRequest(team.id, requests.requests[0].id, admin, { action: 'approve', role: 'admin' }), 'team_forbidden');
	await core.teams.reviewJoinRequest(team.id, requests.requests[0].id, admin, { action: 'approve', role: 'member' });

	// A manual decision is required before role-dependent membership can own work.
	await core.db.query("UPDATE team_membership_sources SET revoked_at=now(),revocation_reason='test_role_only' WHERE team_id=$1 AND user_id=$2 AND kind='manual'", [team.id, member]);
	let retentionRevision = (await core.teams.getTeam(team.id, owner)).team.revision;
	const retentionInput = { confirmed: true, expectedRevision: retentionRevision };
	const sourceMember = (await core.teams.listTeamMembers(team.id, owner)).members.find(row => row.userId === member);
	assert.deepEqual(sourceMember.membershipSources, { manual: false, discordRole: false });
	assert.equal(sourceMember.canRetainManual, true);
	await expectCode(core.teams.proposeOwnershipTransfer(team.id, owner, { proposedOwnerId: member, expectedRevision: retentionRevision }), 'team_manual_membership_required');
	await expectCode(core.teams.retainManualMember(team.id, member, owner, { ...retentionInput, confirmed: 'true' }), 'team_manual_confirmation_required');
	await expectCode(core.teams.retainManualMember(team.id, member, member, retentionInput), 'team_forbidden');
	await expectCode(core.teams.retainManualMember(team.id, member, outsider, retentionInput), 'team_not_found');
	await expectCode(core.teams.retainManualMember(team.id, owner, admin, retentionInput), 'team_forbidden');
	await expectCode(core.teams.retainManualMember(team.id, member, owner, { ...retentionInput, expectedRevision: -1 }), 'revision_conflict');
	const retentionRace = await Promise.allSettled([
		core.teams.retainManualMember(team.id, member, admin, retentionInput),
		core.teams.retainManualMember(team.id, member, owner, retentionInput),
	]);
	assert.equal(retentionRace.filter(result => result.status === 'fulfilled').length, 1, 'Concurrent retention has one winner');
	assert.equal(retentionRace.find(result => result.status === 'rejected').reason.code, 'revision_conflict');
	const retained = retentionRace.find(result => result.status === 'fulfilled').value;
	assert.equal(retained.alreadyManual, false);
	assert.equal(retained.revision, retentionRevision + 1);
	assert.equal((await core.teams.retainManualMember(team.id, member, owner, { confirmed: true, expectedRevision: retained.revision })).alreadyManual, true);
	assert.equal((await core.db.query("SELECT count(*)::int n FROM team_events WHERE team_id=$1 AND event_type='team_member_retained_manually'", [team.id])).rows[0].n, 1);
	assert.equal((await core.db.query('SELECT count(*)::int n FROM project_memberships WHERE user_id=$1', [member])).rows[0].n, 0, 'Retention grants no project access');
	assert.equal((await core.teams.listTeamMembers(team.id, owner)).members.find(row => row.userId === member).canRetainManual, false);

	assert.equal((await core.teams.requestTeamJoin(link.token, candidate)).status, 'pending');
	const candidates = await core.teams.listDiscordCandidates(team.id, owner, guildId, [
		{ id: '567890123456789012', displayName: 'Team Candidate', avatarUrl: 'https://cdn.discordapp.com/a.png', roles: ['987654321098765432'] },
		{ id: '678901234567890123', displayName: 'No Megu account', roles: [] },
	]);
	assert.equal(candidates.candidates[0].linkedAccount, true);
	assert.ok(candidates.candidates[0].requestId, 'a linked Discord requester can be approved through the existing flow');
	assert.equal(candidates.candidates[1].linkedAccount, false);

	await core.db.query("UPDATE team_membership_sources SET revoked_at=now(),revocation_reason='test_owner_guard' WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL", [team.id, admin]);
	await expectCode(core.projects.createProject({ ownerUserId: admin, teamId: team.id, title: 'Role-dependent owner' }), 'team_manual_membership_required');
	await core.db.query("UPDATE team_membership_sources SET revoked_at=NULL,revocation_reason=NULL WHERE team_id=$1 AND user_id=$2 AND revocation_reason='test_owner_guard'", [team.id, admin]);
	const project = await core.projects.createProject({ ownerUserId: admin, teamId: team.id, title: 'Team launch', timezone: 'Asia/Bangkok' });
	createdProjects.push(project.id);
	assert.equal(project.teamId, team.id);
	assert.deepEqual((await core.projects.listProjectDirectory(admin, { guildId })).projects.map(item => item.id), [project.id]);
	assert.deepEqual((await core.projects.listProjectDirectory(admin, { guildId: '999999999999999999' })).projects, []);
	assert.deepEqual((await core.projects.listProjectDirectory(owner, { guildId })).projects, [], 'Team ownership does not bypass the project roster in server filters');
	await expectCode(core.projects.listProjectDirectory(admin, { guildId: 'invalid' }), 'discord_guild_invalid');
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
	const memberWorkspace = await core.teams.listGuildWorkspace(guildId, member);
	assert.deepEqual(memberWorkspace.teams.map(item => item.id), [team.id]);
	assert.deepEqual(memberWorkspace.projects.map(item => item.id), [project.id]);
	assert.deepEqual((await core.teams.listGuildWorkspace(guildId, outsider)).projects, [], 'server membership never reveals an inaccessible project');

	let teamView = await core.teams.getTeam(team.id, owner);
	const removed = await core.teams.removeTeamMember(team.id, member, owner, { expectedRevision: teamView.team.revision });
	assert.equal(removed.impact.projectCount, 1);
	assert.equal(await require('../core/team-membership-sources').isMembershipSuppressed(core.db, team.id, member), true);
	assert.equal((await core.db.query('SELECT count(*)::int n FROM team_membership_sources WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL', [team.id, member])).rows[0].n, 0, 'Manual removal revokes all source records atomically');
	await expectCode(core.projects.getProjectByCode(project.code, member), 'project_not_found');
	await core.teams.requestTeamJoin(link.token, member);
	teamAlerts = await core.db.query("SELECT e.payload FROM notification_events e WHERE e.event_type='team_join_requested' AND e.user_id=$1 AND e.payload->>'teamRequestId'=(SELECT id FROM team_join_requests WHERE team_id=$2 AND user_id=$3) ORDER BY e.created_at", [owner, team.id, member]);
	assert.deepEqual(teamAlerts.rows.map(row => Number(row.payload.requestCycle)), [1, 2], 'a legitimate reopened cycle gets one new alert');
	requests = await core.teams.listJoinRequests(team.id, owner);
	const returningRequest = requests.requests.find(request => request.userId === member);
	assert.equal(returningRequest.restoreRequired, true);
	await expectCode(core.teams.reviewJoinRequest(team.id, returningRequest.id, owner, { action: 'approve' }), 'team_member_restore_confirmation_required');
	await expectCode(core.teams.reviewJoinRequest(team.id, returningRequest.id, outsider, { action: 'approve', confirmRestore: true }), 'team_not_found');
	await expectCode(core.teams.reviewJoinRequest(team.id, returningRequest.id, owner, { action: 'approve', confirmRestore: 'true' }), 'request_body_invalid');
	assert.equal(await require('../core/team-membership-sources').isMembershipSuppressed(core.db, team.id, member), true, 'Failed or unauthorized approvals do not clear suppression');
	await expectCode(core.teams.reviewJoinRequest(team.id, returningRequest.id, owner, { action: 'approve', confirmRestore: true, expectedRevision: requests.teamRevision - 1 }), 'revision_conflict');
	await expectCode(core.teams.reviewJoinRequest(team.id, returningRequest.id, owner, { action: 'approve', confirmRestore: true }), 'revision_conflict');
	await core.teams.reviewJoinRequest(team.id, returningRequest.id, owner, { action: 'approve', confirmRestore: true, expectedRevision: requests.teamRevision });
	assert.equal(await require('../core/team-membership-sources').isMembershipSuppressed(core.db, team.id, member), false);
	const restoredSource = (await core.db.query('SELECT kind,cycle,origin FROM team_membership_sources WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL', [team.id, member])).rows[0];
	assert.deepEqual(restoredSource, { kind: 'manual', cycle: 3, origin: 'join_approved' });
	await expectCode(core.projects.getProjectByCode(project.code, member), 'project_not_found');

	teamView = await core.teams.getTeam(team.id, owner);
	await expectCode(core.teams.removeTeamMember(team.id, admin, owner, { expectedRevision: teamView.team.revision }), 'team_project_owner_transfer_required');
	await core.teams.archiveTeam(team.id, owner, { expectedRevision: teamView.team.revision });
	assert.equal((await core.projects.getProjectByCode(project.code, admin)).project.team.archivedAt != null, true);
	await expectCode(core.projects.updateProject(project.code, admin, { title: 'Blocked while archived', expectedRevision: 1 }), 'team_archived');
	teamView = await core.teams.getTeam(team.id, owner);
	await core.teams.restoreTeam(team.id, owner, { expectedRevision: teamView.team.revision });
	teamView = await core.teams.getTeam(team.id, owner);
	const transferLink = await core.teams.createJoinLink(team.id, owner);
	await core.teams.requestTeamJoin(transferLink.token, candidate);
	const teamTransfer = await core.teams.proposeOwnershipTransfer(team.id, owner, { proposedOwnerId: member, expectedRevision: teamView.team.revision });
	await expectCode(core.teams.acceptOwnershipTransfer(team.id, teamTransfer.transfer.id, admin), 'team_forbidden');
	await core.db.query("UPDATE team_membership_sources SET revoked_at=now(),revocation_reason='test_owner_guard' WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL", [team.id, member]);
	await expectCode(core.teams.acceptOwnershipTransfer(team.id, teamTransfer.transfer.id, member), 'team_manual_membership_required');
	assert.equal((await core.teams.getTeam(team.id, owner)).me.role, 'owner', 'Failed acceptance preserves ownership');
	await core.db.query("UPDATE team_membership_sources SET revoked_at=NULL,revocation_reason=NULL WHERE team_id=$1 AND user_id=$2 AND revocation_reason='test_owner_guard'", [team.id, member]);
	await core.teams.acceptOwnershipTransfer(team.id, teamTransfer.transfer.id, member);
	assert.equal((await core.teams.getTeam(team.id, member)).me.role, 'owner');
	assert.equal((await core.teams.getTeam(team.id, owner)).me.role, 'admin');
	const transferAlerts = await core.db.query("SELECT e.user_id,e.payload,d.status FROM notification_events e LEFT JOIN notification_deliveries d ON d.event_id=e.id WHERE e.event_type='team_join_requested' AND e.payload->>'teamRequestId'=(SELECT id FROM team_join_requests WHERE team_id=$1 AND user_id=$2)", [team.id, candidate]);
	assert.ok(transferAlerts.rows.some(row => row.user_id === member), 'pending requests are re-notified to the new owner');
	assert.ok(transferAlerts.rows.filter(row => row.user_id === owner).every(row => row.status === 'skipped'), 'old-owner pending deliveries are suppressed');

	const destination = await core.teams.createTeam({ ownerUserId: owner, name: 'Destination', color: 'violet' });
	createdTeams.push(destination.team.id);
	const standalone = await core.projects.createProject({ ownerUserId: owner, title: 'Existing standalone' });
	createdProjects.push(standalone.id);
	await core.db.query("INSERT INTO project_memberships (project_id,user_id,role) VALUES ($1,$2,'member')", [standalone.id, outsider]);
	const oldJoin = await core.projects.createJoinLink(standalone.code, owner);
	const projectRequester = await user('ProjectRequester');
	assert.equal((await core.projects.requestProjectJoin(oldJoin.token, projectRequester)).status, 'pending');
	const projectAlert = await core.db.query("SELECT e.payload,count(d.id)::int AS deliveries FROM notification_events e LEFT JOIN notification_deliveries d ON d.event_id=e.id WHERE e.event_type='project_join_requested' AND e.user_id=$1 GROUP BY e.id,e.payload", [owner]);
	assert.equal(projectAlert.rows.length, 1);
	assert.equal(projectAlert.rows[0].deliveries, 2);
	assert.equal(Number(projectAlert.rows[0].payload.requestCycle), 1);
	await expectCode(core.projects.convertProjectToTeam(standalone.code, owner, { teamId: destination.team.id, expectedRevision: 0 }), 'project_team_members_unresolved');
	const destinationLink = await core.teams.createJoinLink(destination.team.id, owner);
	await core.teams.requestTeamJoin(destinationLink.token, outsider);
	requests = await core.teams.listJoinRequests(destination.team.id, owner);
	await core.teams.reviewJoinRequest(destination.team.id, requests.requests[0].id, owner, { action: 'approve' });
	await core.db.query("UPDATE team_membership_sources SET revoked_at=now(),revocation_reason='test_owner_guard' WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL", [destination.team.id, owner]);
	await expectCode(core.projects.convertProjectToTeam(standalone.code, owner, { teamId: destination.team.id, expectedRevision: 0 }), 'team_manual_membership_required');
	assert.equal((await core.projects.getProjectByCode(standalone.code, owner)).project.teamId, null);
	await core.db.query("UPDATE team_membership_sources SET revoked_at=NULL,revocation_reason=NULL WHERE team_id=$1 AND user_id=$2 AND revocation_reason='test_owner_guard'", [destination.team.id, owner]);
	const converted = await core.projects.convertProjectToTeam(standalone.code, owner, { teamId: destination.team.id, expectedRevision: 0 });
	assert.equal(converted.project.teamId, destination.team.id);
	await core.notifications.claimPending();
	const obsoleteProjectAlerts = await core.db.query("SELECT d.status FROM notification_events e JOIN notification_deliveries d ON d.event_id=e.id WHERE e.event_type='project_join_requested' AND e.payload->>'projectId'=$1", [standalone.id]);
	assert.ok(obsoleteProjectAlerts.rows.every(row => row.status === 'skipped'), 'conversion makes queued project join alerts obsolete');
	await expectCode(core.projects.requestProjectJoin(oldJoin.token, member), 'team_project_invite_disabled');
	assert.equal((await core.projects.getProjectByCode(standalone.code, outsider)).me.role, 'member');

	const directory = await core.projects.listProjectDirectory(outsider, { teamId: destination.team.id });
	assert.deepEqual(directory.projects.map(item => item.id), [standalone.id]);
	assert.equal((await core.teams.getTeam(destination.team.id, member).catch(error => error)).code, 'team_not_found');

	// Concurrent/replayed approvals must not clear a later removal decision.
	const raceTeam = (await core.teams.createTeam({ ownerUserId: owner, name: 'Restoration race' })).team;
	createdTeams.push(raceTeam.id);
	const raceLink = await core.teams.createJoinLink(raceTeam.id, owner);
	await core.teams.requestTeamJoin(raceLink.token, member);
	const raceRequest = (await core.teams.listJoinRequests(raceTeam.id, owner)).requests[0];
	await core.teams.reviewJoinRequest(raceTeam.id, raceRequest.id, owner, { action: 'approve' });
	let raceRevision = (await core.teams.getTeam(raceTeam.id, owner)).team.revision;
	await Promise.all([
		core.teams.removeTeamMember(raceTeam.id, member, owner, { expectedRevision: raceRevision }),
		core.teams.reviewJoinRequest(raceTeam.id, raceRequest.id, owner, { action: 'approve', confirmRestore: true }),
	]);
	assert.equal(await require('../core/team-membership-sources').isMembershipSuppressed(core.db, raceTeam.id, member), true, 'Replayed approval cannot clear a later removal, regardless of lock order');
	await expectCode(core.teams.getTeam(raceTeam.id, member), 'team_not_found');
	await core.teams.requestTeamJoin(raceLink.token, member);
	await core.teams.reviewJoinRequest(raceTeam.id, raceRequest.id, owner, { action: 'reject', confirmRestore: true });
	assert.equal(await require('../core/team-membership-sources').isMembershipSuppressed(core.db, raceTeam.id, member), true, 'Declining never clears suppression');
	await core.teams.requestTeamJoin(raceLink.token, member);
	raceRevision = (await core.teams.getTeam(raceTeam.id, owner)).team.revision;
	const concurrent = await Promise.allSettled([
		core.teams.reviewJoinRequest(raceTeam.id, raceRequest.id, owner, { action: 'approve', confirmRestore: true, expectedRevision: raceRevision }),
		core.teams.reviewJoinRequest(raceTeam.id, raceRequest.id, owner, { action: 'approve' }),
	]);
	assert.equal(concurrent[0].status, 'fulfilled');
	if (concurrent[1].status === 'rejected') assert.equal(concurrent[1].reason.code, 'team_member_restore_confirmation_required');
	assert.equal(await require('../core/team-membership-sources').isMembershipSuppressed(core.db, raceTeam.id, member), false);
	assert.equal((await core.db.query('SELECT count(*)::int n FROM team_membership_sources WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL', [raceTeam.id, member])).rows[0].n, 1);
	assert.equal((await core.db.query("SELECT count(*)::int n FROM team_events WHERE team_id=$1 AND event_type='team_join_approved' AND jsonb_array_length(payload->'clearedSuppressions')>0", [raceTeam.id])).rows[0].n, 1, 'Exactly one restoration decision is audited');
	// Project ownership must recheck manual eligibility at acceptance, not only proposal.
	const guardedProject = await core.projects.createProject({ ownerUserId: owner, teamId: destination.team.id, title: 'Ownership guard' });
	createdProjects.push(guardedProject.id);
	await core.projects.addTeamMembers(guardedProject.code, owner, { members: [{ userId: outsider, role: 'member' }], expectedRevision: 0 });
	const revokeTarget = () => core.db.query("UPDATE team_membership_sources SET revoked_at=now(),revocation_reason='test_owner_guard' WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL", [destination.team.id, outsider]);
	const restoreTarget = () => core.db.query("UPDATE team_membership_sources SET revoked_at=NULL,revocation_reason=NULL WHERE team_id=$1 AND user_id=$2 AND revocation_reason='test_owner_guard'", [destination.team.id, outsider]);
	await revokeTarget();
	await expectCode(core.projects.proposeOwnershipTransfer(guardedProject.code, owner, { proposedOwnerId: outsider, expectedRevision: 1 }), 'team_manual_membership_required');
	await restoreTarget();
	const guardedTransfer = await core.projects.proposeOwnershipTransfer(guardedProject.code, owner, { proposedOwnerId: outsider, expectedRevision: 1 });
	await revokeTarget();
	await expectCode(core.projects.acceptOwnershipTransfer(guardedProject.code, guardedTransfer.transfer.id, outsider), 'team_manual_membership_required');
	assert.equal((await core.projects.getProjectByCode(guardedProject.code, owner)).me.role, 'owner');
	await restoreTarget();
	await core.projects.acceptOwnershipTransfer(guardedProject.code, guardedTransfer.transfer.id, outsider);
	assert.equal((await core.projects.getProjectByCode(guardedProject.code, outsider)).me.role, 'owner');
	console.log('teams passed — joins, role boundaries, ownership guards, removal/restoration races, archive, and conversion');
}

async function cleanup() {
	for (const id of createdTeams) await core.db.query('DELETE FROM server_role_mappings WHERE team_id=$1', [id]);
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
