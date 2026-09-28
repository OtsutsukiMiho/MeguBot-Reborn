'use strict';

const assert=require('node:assert/strict');
const {isDisposableTestDatabase,ensureTestDatabase}=require('./test-database');

(async()=>{
	assert.ok(isDisposableTestDatabase(process.env.MEGU_TEST_DATABASE_URL),'Explicit isolated local *_test database required');
	const url=new URL(process.env.MEGU_TEST_DATABASE_URL);
	url.pathname='/megu_company_native_test';
	await ensureTestDatabase(url.toString());
	process.env.MEGU_DATABASE_URL=url.toString();
	process.env.MEGU_COMPANIES_ENABLED='1';
	const db=require('../core/db');
	const {initCoreSchema}=require('../core/schema');
	await initCoreSchema(); await initCoreSchema();
	const client=await db.getPool().connect();
	const originalQuery=db.query,originalTransaction=db.transaction;
	try{
		await client.query('BEGIN');
		assert.equal((await client.query("SELECT to_regclass('companies') AS relation")).rows[0].relation,null,'Fresh startup must not activate Company storage, even with obsolete flag enabled');
		assert.equal((await client.query("SELECT 1 FROM pg_attribute WHERE attrelid='teams'::regclass AND attname='company_id' AND NOT attisdropped")).rowCount,0);
		db.query=(...args)=>client.query(...args);
		db.transaction=async fn=>{
			await client.query('SAVEPOINT native_operation');
			try{const result=await fn(client);await client.query('RELEASE SAVEPOINT native_operation');return result;}
			catch(error){await client.query('ROLLBACK TO SAVEPOINT native_operation');await client.query('RELEASE SAVEPOINT native_operation');throw error;}
		};
		const teams=require('../core/teams'),projects=require('../core/projects'),merge=require('../core/account-merge');
		const access=require('../core/company-access');
		const prefix=`native_${Date.now()}`;
		const owner=`${prefix}_owner`,member=`${prefix}_member`,other=`${prefix}_other`;
		for(const id of [owner,member,other])await client.query('INSERT INTO users(id,display_name) VALUES ($1,$1)',[id]);
		const created=await teams.createTeam({ownerUserId:owner,name:'Server native',discordGuildId:'811111111111111111',discordGuildName:'Server'});
		const teamId=created.team.id;
		assert.equal(created.team.companyId,null);
		assert.equal((await teams.listTeamsForUser(owner)).teams.length,1);
		assert.equal((await teams.getTeam(teamId,owner)).team.id,teamId);
		await assert.rejects(teams.getTeam(teamId,other),{code:'team_not_found'});
		const link=await teams.createJoinLink(teamId,owner);
		await teams.requestTeamJoin(link.token,member);
		const request=(await teams.listJoinRequests(teamId,owner)).requests[0];
		await teams.reviewJoinRequest(teamId,request.id,owner,{action:'approve',role:'member'});
		const project=await projects.createProject({ownerUserId:owner,teamId,title:'Native private project'});
		assert.equal((await projects.getProjectByCode(project.code,owner)).project.id,project.id);
		await assert.rejects(projects.getProjectByCode(project.code,member),{code:'project_not_found'});
		assert.equal((await projects.listProjectDirectory(owner,{teamId})).projects.length,1);
		assert.equal((await projects.listProjectsForUser(owner)).length,1);
		assert.equal(await access.notificationScopeEligible(client,{event_type:'company_join_requested',payload:{},user_id:owner}),false);
		assert.equal(await access.notificationScopeEligible(client,{event_type:'project_topic_due',payload:{projectId:project.id},user_id:member}),false);
		await require('../core/project-reminders').queueDue({projectId:project.id});
		assert.deepEqual(await require('../core/project-channel-notifications').claimPending(20,{projectId:project.id}),[]);
		assert.equal(await require('../core/project-channel-notifications').recheckClaimed('missing'),false);
		await merge.planMerge(member,other);
		await merge.mergeAccounts({userIdA:member,userIdB:other});
		// Missing storage with retained non-null references is corruption, never
		// authority to bypass the legacy gate.
		await client.query('ALTER TABLE teams ADD COLUMN company_id text');
		assert.equal(await access.hasLegacyCompanySchema(client),false);
		await client.query("UPDATE teams SET company_id='retained-missing-company' WHERE id=$1",[teamId]);
		await assert.rejects(access.hasLegacyCompanySchema(client),{code:'legacy_company_schema_incomplete'});
		console.log('Server-native startup passed: no Company activation, private team/project boundaries, joins, directory, delivery, account merge and incomplete-schema refusal.');
	}finally{
		db.query=originalQuery;db.transaction=originalTransaction;
		await client.query('ROLLBACK');client.release();await db.close();
	}
})().catch(error=>{console.error(error);process.exitCode=1;});
