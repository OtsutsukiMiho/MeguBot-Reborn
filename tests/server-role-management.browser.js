'use strict';
// Synthetic local API fixtures; no retained database or Discord writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.MEGU_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.MEGU_BROWSER_BASE_URL||'http://127.0.0.1:5056';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const guild='811111111111111111',r1='123456789012345678',r2='123456789012345679';
(async()=>{
	const browser=await chromium.launch({headless:true,executablePath:process.env.MEGU_BROWSER_EXECUTABLE});
	const output=path.resolve('.impeccable/review/server-role-management');fs.mkdirSync(output,{recursive:true});let captures=0;
	try { for(const lang of ['en','th'])for(const theme of ['light','dark'])for(const width of [390,1440]) {
		const t=require(`../app/copy/${lang}`),c=t.roleMappings;
		const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
		await context.addInitScript(({lang,theme})=>{localStorage.setItem('megu-lang',lang);localStorage.setItem('megu-theme',theme);},{lang,theme});
		let mapping={id:'mapping',revision:1,enabled:true,mode:'approval',roles:[{id:r1,name:'Role one'}]},conflict=true,forbidden=false;
		const api=[];
		await context.route('**/*',route=>{
			const u=new URL(route.request().url());if(u.origin!==new URL(base).origin)return route.abort();if(!u.pathname.startsWith('/api/'))return route.continue();
			api.push(u.pathname);let body={},status=200;
			if(u.pathname==='/api/auth/me'||u.pathname==='/api/megu/me')body={loggedIn:true,user:{id:'manager'}};
			else if(u.pathname===`/api/megu/teams/discord-guilds/${guild}/roles`)body={guildId:guild,roles:[{id:r1,name:'Role one'},{id:r2,name:'Role two'}]};
			else if(u.pathname===`/api/megu/teams/discord-guilds/${guild}/role-mappings/demo/sync`)body={supported:false,capability:{available:false,reason:'sync_disabled'},jobs:[],blockedRevocations:[]};
			else if(u.pathname===`/api/megu/teams/discord-guilds/${guild}/role-mappings/demo`) {
				if(forbidden){status=403;body={code:'team_forbidden'};}
				else if(route.request().method()==='POST') {
					const proposal=route.request().postDataJSON();assert.deepEqual(proposal.roleIds,[r1,r2]);assert.equal(proposal.confirmSharedRoles,false);
					if(conflict){assert.equal(proposal.expectedRevision,1);conflict=false;mapping={...mapping,revision:2};status=409;body={code:'revision_conflict'};}
					else{assert.equal(proposal.expectedRevision,2);mapping={...mapping,revision:3,enabled:false,roles:[{id:r1,name:'Role one'},{id:r2,name:'Role two'}]};body={id:'mapping',revision:3,enabled:false,mode:'approval'};}
				}else body={mapping};
			}
			else if(u.pathname!=='/api/developer/check'){status=404;body={code:'unexpected_private_api'};}
			return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
		});
		const page=await context.newPage();
		const capture=async state=>{await page.evaluate(async()=>{scrollTo(0,0);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,`${state}-${lang}-${theme}-${width}.png`),fullPage:true});captures++;};
		await page.goto(`${base}/teams/server/${guild}/role-mappings`);
		await page.getByRole('textbox',{name:c.teamLink,exact:true}).fill(`${base}/teams/demo/settings`);
		await page.getByRole('button',{name:c.openConfiguration,exact:true}).click();await page.getByText(c.approved,{exact:true}).waitFor();
		assert.equal(await page.getByRole('button',{name:c.approve,exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:c.preview,exact:true}).count(),0);
		const edit=async()=>{await page.getByRole('button',{name:c.configure,exact:true}).click();await page.getByRole('button',{name:c.addRole,exact:true}).click();await page.getByRole('option',{name:`Role two (${r2})`,exact:true}).click();};
		await edit();
		const checkbox=page.getByRole('checkbox',{name:c.shared,exact:true}),size=await checkbox.boundingBox();
		assert.ok(size.width<=24&&size.height<=24,'Shared-role confirmation stays a compact checkbox');
		await capture('editor');
		await page.getByRole('button',{name:c.propose,exact:true}).click();await page.getByRole('alert').filter({hasText:c.errors.revision_conflict}).waitFor();
		assert.equal(await page.getByRole('button',{name:c.removeRole(r2),exact:true}).count(),1,'Conflicted proposal retains role choices');
		await page.getByRole('button',{name:t.teams.cancel,exact:true}).click();await page.getByRole('dialog',{name:t.projects.unsavedTitle,exact:true}).getByRole('button',{name:t.projects.keepEditing,exact:true}).click();
		assert.equal(await page.getByRole('button',{name:c.removeRole(r2),exact:true}).count(),1);
		await page.getByRole('button',{name:t.teams.cancel,exact:true}).click();await page.getByRole('dialog',{name:t.projects.unsavedTitle,exact:true}).getByRole('button',{name:t.projects.discardChanges,exact:true}).click();
		await page.getByRole('button',{name:c.reloadConfiguration,exact:true}).click();await edit();
		await page.getByRole('button',{name:c.propose,exact:true}).click();await page.getByText(c.saved,{exact:true}).waitFor();await page.getByText(c.pending,{exact:true}).waitFor();await capture('pending');
		forbidden=true;await page.getByRole('button',{name:c.reloadConfiguration,exact:true}).click();await page.getByRole('alert').filter({hasText:c.errors.team_forbidden}).waitFor();await capture('access-loss');
		assert.equal(await page.getByRole('button',{name:c.configure,exact:true}).count(),0);
		forbidden=false;mapping={...mapping,mode:'automatic'};await page.getByRole('button',{name:t.projects.retry,exact:true}).click();await page.getByText(c.automaticBlocked,{exact:true}).waitFor();
		assert.equal(await page.getByRole('button',{name:c.configure,exact:true}).isDisabled(),true);await capture('automatic-blocked');
		assert.ok(api.every(url=>!/^\/api\/megu\/teams\/demo(?:\/|$)/.test(url)),'No private team APIs are read by server management');
		await context.close();
	}console.log(`Server role management browser passed: ${captures} EN/TH theme/mobile/desktop captures, known-team lookup, conflict retention, explicit discard, owner-consent reset, access loss and unsupported-mode block; no private team reads.`);}
	finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
