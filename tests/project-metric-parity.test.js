'use strict';
const assert=require('node:assert/strict');
const db=require('../core/db');
const {initCoreSchema}=require('../core/schema');
const {isDisposableTestDatabase}=require('./test-database');
(async()=>{
	assert.ok(isDisposableTestDatabase(process.env.MEGU_TEST_DATABASE_URL));
	process.env.MEGU_DATABASE_URL=process.env.MEGU_TEST_DATABASE_URL;await initCoreSchema();
	const client=await db.getPool().connect(),originalQuery=db.query,originalTransaction=db.transaction;
	try {
		await client.query('BEGIN');
		let pending=Promise.resolve(),directoryRead;
		db.query=(...args)=>{
			if(typeof args[0]==='string'&&args[0].includes('AS progress_sum')&&args[0].includes('LIMIT $8'))directoryRead=args;
			const result=pending.then(()=>client.query(...args));pending=result.catch(()=>{});return result;
		};db.transaction=fn=>fn(client);
		const teams=require('../core/teams'),projects=require('../core/projects');
		const user=`metric_${Date.now()}`;await client.query('INSERT INTO users(id,display_name) VALUES ($1,$1)',[user]);
		const {team}=await teams.createTeam({ownerUserId:user,name:'Metric parity'});
		const project=await projects.createProject({ownerUserId:user,title:'Metric parity',teamId:team.id,timezone:'Asia/Bangkok'});
		const topics=[];
		for(let i=0;i<3;i++)topics.push((await projects.createTopic(project.code,user,{title:`Topic ${i}`,expectedRevision:i})).topic);
		await client.query("UPDATE project_topics SET workflow='in_progress',progress=10,weight=100 WHERE id=$1",[topics[0].id]);
		await client.query("UPDATE project_topics SET workflow='in_progress',progress=21,weight=1 WHERE id=$1",[topics[1].id]);
		await client.query("UPDATE project_topics SET workflow='in_progress',progress=99,archived_at=now() WHERE id=$1",[topics[2].id]);
		const verify=async(expected,count)=>{
			const detail=await projects.getProjectByCode(project.code,user);
			const directory=await projects.listProjectDirectory(user,{teamId:team.id,limit:1});
			const legacyDirectory=await projects.listProjectsForUser(user);
			const teamDetail=await teams.getTeam(team.id,user);
			for(const value of [detail.project,directory.projects[0],legacyDirectory.find(p=>p.id===project.id),teamDetail.projects[0]]) {
				assert.equal(value.progress,expected??0);assert.equal(value.topicCount,count);
			}
			assert.equal(detail.insights.reportedProgress,expected);
		};
		await verify(16,2);
		assert.equal(directoryRead[1][7],2,'One requested row plus one pagination sentinel');
		const plan=(await client.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${directoryRead[0]}`,directoryRead[1])).rows[0]['QUERY PLAN'][0];
		assert.equal(plan.Plan['Node Type'],'Limit');assert.ok(plan.Plan['Actual Rows']<=2);
		console.log(`Disposable directory plan: bounded Limit, ${plan['Execution Time']} ms; fixture evidence only.`);
		await client.query('UPDATE project_topics SET archived_at=now() WHERE project_id=$1',[project.id]);
		await verify(null,0);
		const outsider=`metric_out_${Date.now()}`;await client.query('INSERT INTO users(id,display_name) VALUES ($1,$1)',[outsider]);
		assert.deepEqual((await projects.listProjectDirectory(outsider,{teamId:team.id})).projects,[]);
		await assert.rejects(teams.getTeam(team.id,outsider),error=>error.code==='team_not_found');
		console.log('Project metric parity passed: header/Insights/directory/team arithmetic mean, archive exclusions, rounding, empty denominators and private scope.');
	} finally { db.query=originalQuery;db.transaction=originalTransaction;await client.query('ROLLBACK');client.release();await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
