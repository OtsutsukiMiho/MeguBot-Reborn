'use strict';

const assert = require('node:assert/strict');
const db = require('../core/db');
const { initCoreSchema } = require('../core/schema');
const { installTeamGoalSchema } = require('../core/team-goal-schema');
const { isDisposableTestDatabase } = require('./test-database');
const { rehearse, commitDisposableTrial } = require('../scripts/company-retirement-rehearsal');

(async () => {
	assert.ok(isDisposableTestDatabase(process.env.MEGU_TEST_DATABASE_URL), 'Explicit isolated local *_test database required');
	process.env.MEGU_DATABASE_URL=process.env.MEGU_TEST_DATABASE_URL;
	await initCoreSchema();
	const client = await db.getPool().connect();
	const originalQuery=db.query, originalTransaction=db.transaction;
	try {
		await client.query('BEGIN');
		await require('../core/company-schema').installCompanySchema(client);
		await installTeamGoalSchema(client);
		db.query=(...args)=>client.query(...args);
		db.transaction=async fn=> {
			await client.query('SAVEPOINT service_operation');
			try { const result=await fn(client); await client.query('RELEASE SAVEPOINT service_operation'); return result; }
			catch(error) { await client.query('ROLLBACK TO SAVEPOINT service_operation'); await client.query('RELEASE SAVEPOINT service_operation'); throw error; }
		};
		const teams=require('../core/teams'), projects=require('../core/projects'), notifications=require('../core/notifications');
		const prefix=`retire_${Date.now()}`;
		const id=name=>`${prefix}_${name}`;
		const [owner,member,removed,missing,derived]=['owner','member','removed','missing','derived'].map(id);
		const [company,archived,team,archivedTeam,independent,project,standalone,mapping]=['company','archived','team','archived_team','independent','project','standalone','mapping'].map(id);
		const guild=`81111${Date.now()}`, guildB=`82222${Date.now()}`;
		for(const user of [owner,member,removed,missing,derived]) await client.query('INSERT INTO users(id,display_name) VALUES ($1,$1)',[user]);
		await client.query(`INSERT INTO companies(id,discord_guild_id,name,lifecycle,archived_at) VALUES
		 ($1,$3,'Active','active',NULL),($2,$4,'Archived','archived','2026-09-01')`,[company,archived,guild,guildB]);
		await client.query(`INSERT INTO teams(id,name,created_by,company_id,discord_guild_id) VALUES
		 ($1,'Active',$4,$5,$7),($2,'Archived ancestor',$4,$6,$8),($3,'Independent',$9,NULL,NULL)`,[team,archivedTeam,independent,owner,company,archived,guild,guildB,removed]);
		for(const [teamId,user,role] of [[team,owner,'owner'],[team,member,'member'],[team,removed,'admin'],[team,derived,'member'],[archivedTeam,owner,'owner'],[independent,removed,'owner']]) {
			await client.query('INSERT INTO team_memberships(team_id,user_id,role) VALUES ($1,$2,$3)',[teamId,user,role]);
			if(user!==derived) await require('../core/team-membership-sources').grantManualSource(client,teamId,user,owner,'rehearsal_fixture');
		}
		for(const [companyId,user,revoked] of [[company,owner,false],[company,member,false],[company,removed,true],[company,derived,false],[archived,owner,false]]) {
			await client.query("INSERT INTO company_memberships(company_id,user_id,role,revoked_at) VALUES ($1,$2,'member',CASE WHEN $3 THEN now() ELSE NULL END)",[companyId,user,revoked]);
		}
		await client.query(`INSERT INTO server_role_mappings(id,guild_id,kind,team_id,created_by,owner_consent_by,owner_consent_at,server_consent_by,server_consent_at,enabled)
		 VALUES ($1,$2,'team',$3,$4,$4,now(),$4,now(),true)`,[mapping,guild,team,owner]);
		await client.query("INSERT INTO team_membership_sources(id,team_id,user_id,kind,source_key,mapping_id,cycle,origin) VALUES ($1,$2,$3,'discord_role',$4,$4,1,'approval')",[id('derived_source'),team,derived,mapping]);
		await client.query(`INSERT INTO projects(id,code,owner_user_id,team_id,title,status) VALUES
		 ($1,$3,$5,$6,'Private','active'),($2,$4,$7,NULL,'Standalone','active')`,[project,standalone,id('pcode').toUpperCase(),id('scode').toUpperCase(),owner,team,removed]);
		for(const [projectId,user,role] of [[project,owner,'owner'],[project,member,'member'],[project,removed,'member'],[project,missing,'member'],[standalone,removed,'owner']]) {
			await client.query('INSERT INTO project_memberships(project_id,user_id,role) VALUES ($1,$2,$3)',[projectId,user,role]);
		}
		await client.query("INSERT INTO project_topics(id,project_id,title,topic_no) VALUES ($1,$2,'Topic',1)",[id('topic'),project]);
		await client.query('INSERT INTO project_topic_assignees(project_id,topic_id,user_id) VALUES ($1,$2,$3),($1,$2,$4)',[project,id('topic'),removed,member]);
		for(const [name,teamId,subject,reviewer,lifecycle] of [['cancel',team,removed,owner,'active'],['reviewer',team,member,removed,'active'],['published',team,removed,owner,'reviewed'],['archive',archivedTeam,owner,null,'draft']]) {
			await client.query('INSERT INTO team_goals(id,team_id,subject_id,created_by) VALUES ($1,$2,$3,$4)',[id(name),teamId,subject,owner]);
			await client.query(`INSERT INTO team_goal_versions(goal_id,version,reviewer_id,title,success_description,period_start,period_end,timezone,measurement,lifecycle,created_by,subject_accepted_at,reviewer_accepted_at)
			 VALUES ($1,1,$2,'Private goal','Deliver','2026-09-01','2026-09-30','Asia/Bangkok','{"kind":"milestone"}',$3,$4,now(),CASE WHEN $2::text IS NOT NULL THEN now() END)`,[id(name),reviewer,lifecycle,owner]);
		}
		await client.query('INSERT INTO team_events(id,team_id,actor_user_id,event_type,payload) VALUES ($1,$2,$3,$4,$5)',[id('history'),team,owner,'legacy_created',{ companyId:company }]);
		await client.query('INSERT INTO notification_events(id,user_id,event_type,payload,dedupe_key) VALUES ($1,$2,$3,$4,$1)',[id('notification'),removed,'project_topic_due',{ projectId:project }]);
		await client.query("INSERT INTO notification_deliveries(id,event_id,channel,status) VALUES ($1,$2,'discord','sending')",[id('delivery'),id('notification')]);
		await client.query('INSERT INTO notification_events(id,user_id,event_type,payload,dedupe_key) VALUES ($1,$2,$3,$4,$1)',[id('company_notification'),owner,'company_join_requested',{companyId:company}]);
		await client.query("INSERT INTO notification_deliveries(id,event_id,channel,status) VALUES ($1,$3,'discord','failed'),($2,$3,'email','sent')",[id('company_delivery'),id('sent_delivery'),id('company_notification')]);
		await client.query(`INSERT INTO project_channel_deliveries(id,project_id,event_type,guild_id,channel_id,payload,dedupe_key,status)
		 VALUES ($1,$2,'project_topic_due',$3,$3,'{}',$1,'sending')`,[id('channel_delivery'),project,guild]);
		await client.query(`INSERT INTO project_reminder_jobs(id,project_id,topic_id,threshold_hours,deadline_at,deadline_revision,run_at,status)
		 VALUES ($1,$2,$3,24,now(),0,now(),'queued')`,[id('reminder'),project,id('topic')]);
		await client.query(`INSERT INTO company_join_links(id,company_id,token_hash,expires_at,created_by) VALUES ($1,$2,$3,now()+interval '1 day',$4)`,[id('link'),company,id('hash'),owner]);
		await client.query('INSERT INTO company_join_requests(id,company_id,user_id,company_link_id) VALUES ($1,$2,$3,$4)',[id('request'),company,missing,id('link')]);
		await client.query("INSERT INTO company_ownership_transfers(id,company_id,current_owner_id,proposed_owner_id,expires_at) VALUES ($1,$2,$3,$4,now()+interval '1 day')",[id('transfer'),company,owner,member]);
		const snapshot=async()=> {
			const result={};
			for(const table of ['companies','company_memberships','company_join_links','company_join_requests','company_ownership_transfers','teams','team_memberships','team_membership_sources','team_membership_suppressions','projects','project_memberships','project_topic_assignees','team_events','team_goals','team_goal_versions','team_goal_events','notification_events','notification_deliveries','project_channel_deliveries','project_reminder_jobs','server_role_mappings']) {
				result[table]=(await client.query(`SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) AS data FROM ${table} r WHERE strpos(to_jsonb(r)::text,$1)>0`,[prefix])).rows[0].data;
			}
			return result;
		};
		const before=await snapshot();
		const options={companyIds:[company,archived],actorId:owner};
		await assert.rejects(rehearse({query:async()=>({rows:[{name:'retained',host:'127.0.0.1'}]})},options),{code:'retirement_rehearsal_local_test_only'});
		await assert.rejects(rehearse({query:async()=>({rows:[{name:'remote_test',host:'203.0.113.1'}]})},options),{code:'retirement_rehearsal_local_test_only'});
		await assert.rejects(rehearse(client,{...options,companyIds:[id('unknown')]}),{code:'retirement_company_not_found'});
		await assert.rejects(rehearse(client,{...options,companyIds:[company,company]}),{code:'retirement_input_invalid'});
		await client.query('SAVEPOINT corrupt_owner');
		await client.query('UPDATE company_memberships SET revoked_at=now() WHERE company_id=$1 AND user_id=$2',[company,owner]);
		await assert.rejects(rehearse(client,options),{code:'retirement_owner_ineligible'});
		await client.query('ROLLBACK TO SAVEPOINT corrupt_owner');
		assert.deepEqual(await snapshot(),before,'Failed owner preflight must leave no partial migration');
		await client.query('SAVEPOINT bad_project_owner');
		await client.query('UPDATE projects SET owner_user_id=$2 WHERE id=$1',[project,missing]);
		await assert.rejects(rehearse(client,options),{code:'retirement_owner_ineligible'});
		await client.query('ROLLBACK TO SAVEPOINT bad_project_owner');
		await client.query('SAVEPOINT bad_provenance');
		await client.query("UPDATE team_membership_sources SET revoked_at=now(),revocation_reason='fixture' WHERE team_id=$1 AND user_id=$2",[team,owner]);
		await assert.rejects(rehearse(client,options),{code:'team_manual_membership_required'});
		await client.query('ROLLBACK TO SAVEPOINT bad_provenance');
		const report=await rehearse(client,options,async summary=> {
			assert.equal(summary.detachedTeams,2); assert.equal(summary.archivedTeams,1);
			assert.equal(summary.revokedTeamMembers,1); assert.equal(summary.revokedProjectMembers,2); assert.equal(summary.removedAssignments,1);
			assert.equal(summary.suppressedMembers,2);
			assert.ok((await client.query('SELECT 1 FROM team_membership_suppressions WHERE team_id=$1 AND user_id=$2 AND cleared_at IS NULL',[team,missing])).rowCount,'A denied project-only member must not re-enter via roles');
			assert.equal((await teams.getTeam(team,owner)).team.companyId,null);
			await assert.rejects(teams.getTeam(team,removed),{code:'team_not_found'});
			await assert.rejects(projects.getProjectByCode(id('pcode'),removed),{code:'project_not_found'});
			await assert.rejects(projects.getProjectByCode(id('pcode'),missing),{code:'project_not_found'});
			assert.equal((await projects.getProjectByCode(id('pcode'),member)).project.id,project);
			assert.equal((await teams.getTeam(independent,removed)).team.id,independent);
			assert.equal((await projects.getProjectByCode(id('scode'),removed)).project.id,standalone);
			assert.equal((await teams.getTeam(archivedTeam,owner)).capabilities.canEdit,false);
			assert.equal((await client.query('SELECT kind,revoked_at FROM team_membership_sources WHERE id=$1',[id('derived_source')])).rows[0].kind,'discord_role');
			assert.equal((await client.query('SELECT enabled FROM server_role_mappings WHERE id=$1',[mapping])).rows[0].enabled,true);
			assert.equal((await client.query('SELECT lifecycle FROM team_goal_versions WHERE goal_id=$1',[id('cancel')])).rows[0].lifecycle,'cancelled');
			assert.equal((await client.query('SELECT needs_reviewer FROM team_goal_versions WHERE goal_id=$1',[id('reviewer')])).rows[0].needs_reviewer,true);
			assert.equal((await client.query('SELECT lifecycle FROM team_goal_versions WHERE goal_id=$1',[id('published')])).rows[0].lifecycle,'reviewed');
			assert.equal((await client.query('SELECT lifecycle FROM team_goal_versions WHERE goal_id=$1',[id('archive')])).rows[0].lifecycle,'archived');
			assert.equal(await notifications.recheckClaimed(id('delivery')),false);
			assert.equal((await client.query('SELECT status FROM notification_deliveries WHERE id=$1',[id('company_delivery')])).rows[0].status,'skipped');
			assert.equal((await client.query('SELECT status FROM notification_deliveries WHERE id=$1',[id('sent_delivery')])).rows[0].status,'sent');
			assert.equal((await client.query('SELECT status FROM project_channel_deliveries WHERE id=$1',[id('channel_delivery')])).rows[0].status,'skipped');
			assert.equal((await client.query('SELECT status FROM project_reminder_jobs WHERE id=$1',[id('reminder')])).rows[0].status,'cancelled');
			assert.equal((await client.query('SELECT status FROM company_join_requests WHERE id=$1',[id('request')])).rows[0].status,'rejected');
			assert.ok((await client.query('SELECT cancelled_at FROM company_ownership_transfers WHERE id=$1',[id('transfer')])).rows[0].cancelled_at);
			assert.deepEqual((await client.query('SELECT payload FROM team_events WHERE id=$1',[id('history')])).rows[0].payload,{companyId:company});
		});
		assert.equal(report.rolledBack,true); assert.deepEqual(await snapshot(),before,'Successful rehearsal must restore every persisted fixture exactly');
		await assert.rejects(rehearse(client,options,async()=>{ throw new Error('inspection failed'); }),/inspection failed/);
		assert.deepEqual(await snapshot(),before,'Inspection failure must also roll back');
		assert.deepEqual(await rehearse(client,options),report,'Repeating the rolled-back trial must yield the same impact');
		await assert.rejects(commitDisposableTrial({query:async()=>({rows:[{name:'megu_company_test',host:'127.0.0.1'}]})},options),{code:'retirement_rehearsal_local_test_only'});
		await assert.rejects(commitDisposableTrial({query:async()=>({rows:[{name:'megu_company_rollback_aaaaaaaaaaaaaaaa_test',host:'203.0.113.1'}]})},options),{code:'retirement_rehearsal_local_test_only'});
		if (process.env.MEGU_COMPANY_DURABLE_TARGET) {
			const {Client}=require('pg'),{spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
			const url=new URL(process.env.MEGU_TEST_DATABASE_URL),database=url.pathname.slice(1);
			assert.equal(database,process.env.MEGU_COMPANY_DURABLE_TARGET);assert.match(database,/^megu_company_rollback_[a-f0-9]{16}_test$/);
			const backup=path.resolve('.tmp',`${database}.dump`);fs.mkdirSync(path.dirname(backup),{recursive:true});
			const pgEnv={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:database,PGSSLMODE:'disable'};
			const pgCommand=(name,args)=>{const binary=process.env.MEGU_PG_BIN?path.join(process.env.MEGU_PG_BIN,`${name}${process.platform==='win32'?'.exe':''}`):name;const result=spawnSync(binary,args,{env:pgEnv,encoding:'utf8',timeout:60000,windowsHide:true});assert.equal(result.status,0,`${name} failed (${result.error?.code||'exit'}): ${result.stderr?.slice(-1500)}`);};
			const schema=async()=> (await client.query("SELECT c.conrelid::regclass::text AS relation,c.conname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' ORDER BY relation,c.conname")).rows;
			const beforeSchema=await schema();
			await client.query('COMMIT');
			try {
				pgCommand('pg_dump',['--format=custom','--file',backup]);const digest=createHash('sha256').update(fs.readFileSync(backup)).digest('hex');
				const committed=await commitDisposableTrial(client,options);assert.deepEqual(committed,Object.fromEntries(Object.entries(report).filter(([key])=>key!=='rolledBack')));
				const observer=new Client({connectionString:process.env.MEGU_TEST_DATABASE_URL,ssl:false});await observer.connect();
				try {assert.equal((await observer.query('SELECT company_id FROM teams WHERE id=$1',[team])).rows[0].company_id,null,'A separate connection observes committed retirement');assert.ok((await observer.query('SELECT revoked_at FROM team_memberships WHERE team_id=$1 AND user_id=$2',[team,removed])).rows[0].revoked_at);}finally{await observer.end();}
				pgCommand('pg_restore',['--clean','--if-exists','--exit-on-error','--single-transaction','--dbname',database,backup]);
				assert.deepEqual(await snapshot(),before,'Native backup restores every populated access/history/goals/provenance/delivery fixture after commit');
				assert.deepEqual(await schema(),beforeSchema,'Native recovery restores original constraints and foreign keys');
				console.log(`Durable Company rollback passed: committed retirement observed separately, native backup recovery, exact populated rows/constraints; backup SHA-256 ${digest}.`);
			} finally {if(fs.existsSync(backup))fs.unlinkSync(backup);}
		}
		console.log('Company retirement rehearsal passed: populated access/ownership/archive/goals/provenance/admission/delivery checks and exact success/failure rollback.');
	} finally {
		db.query=originalQuery; db.transaction=originalTransaction;
		await client.query('ROLLBACK'); client.release(); await db.close();
	}
})().catch(error=>{ console.error(error); process.exitCode=1; });
