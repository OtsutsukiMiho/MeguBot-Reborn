'use strict';
// Own random local database: never commits retirement in the shared test DB.
const assert=require('node:assert/strict'),{Client}=require('pg'),{randomBytes}=require('node:crypto'),{spawnSync}=require('node:child_process'),path=require('node:path');
const {isDisposableTestDatabase}=require('./test-database');
(async()=>{
	const source=process.env.MEGU_TEST_DATABASE_URL;assert.ok(isDisposableTestDatabase(source));
	const url=new URL(source);assert.ok(['127.0.0.1','localhost','::1','[::1]'].includes(url.hostname));
	const database=`megu_company_rollback_${randomBytes(8).toString('hex')}_test`;url.pathname='/postgres';
	const admin=new Client({connectionString:url.toString(),ssl:false});await admin.connect();let created=false;
	try {
		await admin.query(`CREATE DATABASE "${database}"`);created=true;url.pathname=`/${database}`;
		const run=spawnSync(process.execPath,[path.join(__dirname,'company-retirement-rehearsal.test.js')],{env:{...process.env,MEGU_TEST_DATABASE_URL:url.toString(),MEGU_DATABASE_URL:url.toString(),MEGU_COMPANY_DURABLE_TARGET:database},encoding:'utf8',timeout:120000,windowsHide:true});
		if(run.status!==0){process.stderr.write((run.stderr||run.stdout||'Durable rehearsal process failed').slice(-4500));throw new Error(`durable_retirement_rehearsal_failed:${run.error?.code||run.status}`);}
		for(const line of run.stdout.split(/\r?\n/))if(line.startsWith('Durable Company rollback passed:'))console.log(line);
	} finally {if(created)await admin.query(`DROP DATABASE "${database}"`);await admin.end();}
})().catch(error=>{console.error(error);process.exitCode=1;});
