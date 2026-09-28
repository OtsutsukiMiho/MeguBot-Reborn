'use strict';

const assert = require('node:assert/strict');
const { isDisposableTestDatabase } = require('./test-database');
const core = require('../core');
const { teams,projects,db,notifications } = core;
// Legacy fixtures exercise retained compatibility storage, not a public service.
const c = require('../core/companies');
const userIds = [];
let companyId;
const teamIds = [];
const projectIds = [];
const verify = async (userId,guildId) => ({ available: true,userId,guildId,isMember: true,isBot: false });
const fails = (promise,code) => assert.rejects(promise,{ code });

async function main() {
	const url = process.env.MEGU_TEST_DATABASE_URL || process.env.MEGU_DATABASE_URL;
	assert.ok(isDisposableTestDatabase(url),'Isolated local *_test database required');
	process.env.MEGU_DATABASE_URL = url;
	process.env.MEGU_COMPANIES_ENABLED = '1';
	await core.initCoreSchema();
	await db.transaction(require('../core/company-schema').installCompanySchema);
	const suffix = String(Date.now());
	for (const name of ['Owner','Admin','Worker','Outsider']) {
		const login = await core.users.loginWithIdentity({ provider: 'discord',providerUid: `company-lifecycle-${name}-${suffix}`,displayName: name,username: name });
		userIds.push(login.user.id);
	}
	const [owner,admin,worker,outsider] = userIds;
	const guildId = `9998${suffix}`;
	const claim = await c.claimCompany(owner,{ guildId },async (userId,id) => ({ available: true,userId,guildId:id,isOwner:true,botPresent:true,name:'Company lifecycle' }));
	companyId = claim.company.id;
	const rev = async () => (await c.getCompany(companyId,owner)).company.revision;
	let link = await c.createJoinLink(companyId,owner,{ expectedRevision:await rev() });
	assert.equal((await c.previewJoinToken(link.token)).company.id,companyId);
	await c.requestJoin(link.token,admin);
	await c.requestJoin(link.token,admin);
	let pending = (await c.listJoinRequests(companyId,owner)).requests[0];
	assert.equal((await db.query("SELECT count(*)::int AS n FROM notification_events WHERE event_type='company_join_requested' AND payload->>'companyId'=$1",[companyId])).rows[0].n,1);
	await fails(c.reviewJoinRequest(companyId,pending.id,owner,{ action:'approve',role:'admin',requestCycle:pending.requestCycle },async () => ({ available:false })),'discord_verification_unavailable');
	await fails(c.getCompany(companyId,admin),'company_not_found');
	await fails(c.reviewJoinRequest(companyId,pending.id,owner,{ action:'approve',requestCycle:pending.requestCycle },async (userId,id) => ({ available:true,userId,guildId:id,isMember:false })),'company_discord_membership_required');
	await c.reviewJoinRequest(companyId,pending.id,owner,{ action:'approve',role:'admin',requestCycle:pending.requestCycle },verify);
	assert.equal((await c.getCompany(companyId,admin)).company.role,'admin');
	await c.requestJoin(link.token,outsider);
	pending = (await c.listJoinRequests(companyId,owner)).requests[0];
	await fails(c.reviewJoinRequest(companyId,pending.id,admin,{ action:'approve',role:'admin',requestCycle:pending.requestCycle },verify),'company_forbidden');
	// An alert already claimed before a request is rejected is skipped at dispatch.
	const deliveries = await notifications.claimPending(100);
	const alert = deliveries.find(item => item.payload.companyRequestId === pending.id && item.user_id === owner);
	assert.ok(alert);
	await c.reviewJoinRequest(companyId,pending.id,owner,{ action:'reject',requestCycle:pending.requestCycle },verify);
	assert.equal(await notifications.recheckClaimed(alert.id),false);
	const created = await c.createCompanyTeam(companyId,owner,{ name:'Engineering',ownerUserId:owner,expectedRevision:await rev() });
	teamIds.push(created.team.id);
	const teamId = created.team.id;
	await fails(teams.getTeam(teamId,admin),'team_not_found');
	const teamLink = await teams.createJoinLink(teamId,owner);
	const firstRequest = await teams.requestTeamJoin(teamLink.token,worker);
	assert.equal(firstRequest.companyApprovalRequired,true);
	const teamRequest = (await teams.listJoinRequests(teamId,owner)).requests[0];
	await fails(teams.reviewJoinRequest(teamId,teamRequest.id,owner,{ action:'approve',role:'member' }),'company_membership_required');
	pending = (await c.listJoinRequests(companyId,owner)).requests.find(item => item.userId===worker);
	await c.reviewJoinRequest(companyId,pending.id,admin,{ action:'approve',requestCycle:pending.requestCycle },verify);
	await fails(teams.getTeam(teamId,worker),'team_not_found');
	await teams.reviewJoinRequest(teamId,teamRequest.id,owner,{ action:'approve',role:'member' });
	await fails(c.listMembers(companyId,worker),'company_forbidden');
	const project = await projects.createProject({ ownerUserId:owner,teamId,title:'Private engineering work' });
	projectIds.push(project.id);
	await projects.addTeamMembers(project.code,owner,{ members:[{ userId:worker,role:'member' }],expectedRevision:0 });
	const topic = await projects.createTopic(project.code,owner,{ title:'Deliver',assigneeUserIds:[] });
	await projects.setTopicAssignees(project.code,topic.topic.id,owner,{ userIds:[worker],primaryUserId:worker,expectedRevision:0 });
	const removed = await c.removeMember(companyId,worker,admin,{ expectedRevision:await rev() });
	assert.deepEqual(removed.impact,{ teams:1,projects:1,assignments:1 });
	await fails(projects.getProjectByCode(project.code,worker),'project_not_found');
	await teams.requestTeamJoin(teamLink.token,worker);
	pending = (await c.listJoinRequests(companyId,owner)).requests.find(item => item.userId===worker);
	await c.reviewJoinRequest(companyId,pending.id,owner,{ action:'approve',requestCycle:pending.requestCycle },verify);
	const repeatTeamRequest = (await teams.listJoinRequests(teamId,owner)).requests.find(item => item.userId===worker);
	await fails(teams.reviewJoinRequest(teamId,repeatTeamRequest.id,owner,{ action:'approve',role:'member' }),'team_member_restore_confirmation_required');
	await fails(teams.reviewJoinRequest(teamId,repeatTeamRequest.id,owner,{ action:'approve',role:'member',confirmRestore:true }),'revision_conflict');
	await teams.reviewJoinRequest(teamId,repeatTeamRequest.id,owner,{ action:'approve',role:'member',confirmRestore:true,
		expectedRevision:(await teams.listJoinRequests(teamId,owner)).teamRevision });
	await fails(projects.getProjectByCode(project.code,worker),'project_not_found');
	assert.equal((await db.query('SELECT count(*)::int AS n FROM project_topic_assignees WHERE user_id=$1',[worker])).rows[0].n,0);
	const ownTeam = await c.createCompanyTeam(companyId,owner,{ name:'Owned team',ownerUserId:worker,expectedRevision:await rev() });
	teamIds.push(ownTeam.team.id);
	await fails(c.removeMember(companyId,worker,owner,{ expectedRevision:await rev() }),'company_work_owner_transfer_required');
	await fails(c.removeMember(companyId,owner,admin,{ expectedRevision:await rev() }),'company_owner_transfer_required');
	const transfer = await c.proposeOwnershipTransfer(companyId,owner,{ proposedOwnerId:admin,expectedRevision:await rev() });
	await fails(c.resolveOwnershipTransfer(companyId,transfer.transfer.id,worker,{ action:'accept' }),'company_transfer_not_found');
	await c.resolveOwnershipTransfer(companyId,transfer.transfer.id,admin,{ action:'accept' });
	assert.equal((await c.getCompany(companyId,owner)).company.role,'admin');
	assert.equal((await c.getCompany(companyId,admin)).company.role,'owner');
	await fails(c.setArchived(companyId,owner,{ archived:true,expectedRevision:await rev() }),'company_forbidden');
	await c.setArchived(companyId,admin,{ archived:true,expectedRevision:await rev() });
	await fails(c.previewJoinToken(link.token),'company_invitation_not_found');
	await fails(teams.requestTeamJoin(teamLink.token,outsider),'company_archived');
	assert.equal((await projects.getProjectByCode(project.code,owner)).project.id,project.id);
	await c.setArchived(companyId,admin,{ archived:false,expectedRevision:await rev() });
	await fails(c.previewJoinToken(link.token),'company_invitation_not_found');
	link = await c.createJoinLink(companyId,admin,{ expectedRevision:await rev() });
	await c.requestJoin(link.token,outsider);
	pending = (await c.listJoinRequests(companyId,admin)).requests[0];
	const stale = pending;
	link = await c.createJoinLink(companyId,admin,{ expectedRevision:await rev() });
	await c.requestJoin(link.token,outsider);
	await fails(c.reviewJoinRequest(companyId,stale.id,admin,{ action:'approve',requestCycle:stale.requestCycle },verify),'company_revision_conflict');
	const legacyCreated = await teams.createTeam({ ownerUserId:admin,name:'Compatibility team',discordGuildId:guildId,discordGuildName:'Guild' });
	teamIds.push(legacyCreated.team.id);
	assert.equal(legacyCreated.team.companyId,null, 'New server-linked teams must not inherit the retired Company admission layer');
	assert.equal(legacyCreated.team.discordGuild.id,guildId);
	await c.setArchived(companyId,admin,{ archived:true,expectedRevision:await rev() });
	assert.equal((await teams.getTeam(legacyCreated.team.id,admin)).capabilities.canEdit,true, 'Retired Company lifecycle cannot freeze a new server-native team');
	console.log('Legacy company lifecycle safeguards passed; new server-native teams remain independent of that hierarchy.');
}

async function cleanup() {
	if (companyId) {
		await db.query("DELETE FROM notification_events WHERE payload->>'companyId'=$1",[companyId]);
		await db.query('DELETE FROM company_join_requests WHERE company_id=$1',[companyId]);
		await db.query('DELETE FROM company_join_links WHERE company_id=$1',[companyId]);
		await db.query('DELETE FROM company_ownership_transfers WHERE company_id=$1',[companyId]);
	}
	await db.query('DELETE FROM projects WHERE id=ANY($1::text[])',[projectIds]);
	await db.query('DELETE FROM teams WHERE id=ANY($1::text[])',[teamIds]);
	if (companyId) {
		await db.query('DELETE FROM company_events WHERE company_id=$1',[companyId]);
		await db.query('DELETE FROM company_memberships WHERE company_id=$1',[companyId]);
		await db.query('DELETE FROM companies WHERE id=$1',[companyId]);
	}
	await db.query('DELETE FROM users WHERE id=ANY($1::text[])',[userIds]);
}
main().then(cleanup).then(() => db.close()).catch(async error => {
	console.error(error);
	await cleanup().catch(cleanupError => console.error('Cleanup failed:',cleanupError.message));
	await db.close(); process.exitCode=1;
});
