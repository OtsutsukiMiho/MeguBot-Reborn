'use strict';
// Synthetic local APIs only; no retained writes, activation or Discord calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.MEGU_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.MEGU_BROWSER_BASE_URL||'http://127.0.0.1:5056';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const guild='811111111111111111',role='123456789012345678';
(async()=>{
	const browser=await chromium.launch({headless:true,executablePath:process.env.MEGU_BROWSER_EXECUTABLE});
	const output=path.resolve('.impeccable/review/automatic-role-management');fs.mkdirSync(output,{recursive:true});let captures=0;
	try {for(const lang of ['en','th'])for(const theme of ['light','dark'])for(const width of [390,768,1440]) {
		const t=require(`../app/copy/${lang}`),c=t.roleMappings.sync;
		const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
		await context.addInitScript(({lang,theme})=>{localStorage.setItem('megu-lang',lang);localStorage.setItem('megu-theme',theme);},{lang,theme});
		let owner=false,pending=false,uncertainRequest=true,uncertainConfirm=true,requestRecoveryDenied=true,confirmRecoveryDenied=true,blocked=false,denied=false,capability=true,supported=true;
		let mapping={id:'mapping',revision:1,enabled:true,mode:'approval',roles:[{id:role,name:'Delivery'}]};
		const requests=[],confirmations=[],api=[];
		const team={id:'demo',name:'Delivery team',color:'emerald',description:'Private delivery workspace',revision:1,role:'owner',discordGuild:{id:guild,name:'Delivery server'}};
		const endpoint=`/api/megu/teams/discord-guilds/${guild}/role-mappings/demo`,native='/api/megu/teams/demo/role-mapping';
		await context.route('**/*',route=>{
			const u=new URL(route.request().url());if(u.origin!==new URL(base).origin)return route.abort();if(!u.pathname.startsWith('/api/'))return route.continue();
			api.push(u.pathname);let body={},status=200;
			if(u.pathname==='/api/auth/me'||u.pathname==='/api/megu/me')body={loggedIn:true,user:{id:owner?'owner':'manager'}};
			else if(u.pathname==='/api/megu/teams/demo') {assert.ok(owner,'Manager must never fetch private team');body={team,me:{userId:'owner'},capabilities:{canEdit:true}};}
			else if([endpoint,native].includes(u.pathname)) body={mapping};
			else if([`${endpoint}/sync`,`${native}/sync`].includes(u.pathname)) {
				if(denied){status=403;body={code:'team_forbidden'};}
				else body={supported,policyVersion:1,mappingId:'mapping',revision:mapping.revision,pendingDelegation:pending,canConfirmTransitions:owner,retired:false,capability:{available:capability},jobs:mapping.mode==='automatic'?[{state:blocked?'blocked':'pending',...(owner?{counts:{granted:1,revoked:0,blocked:blocked?1:0,capacityBlocked:0}}:{})}]:[],blockedRevocations:owner&&blocked?[{userId:'project-owner',reason:'project_owner'}]:[]};
			} else if(u.pathname===`${endpoint}/automatic`) {
				const input=route.request().postDataJSON();requests.push(input);assert.equal(input.confirmedDelegation,true);assert.equal(input.delegationVersion,1);
				if(uncertainRequest){uncertainRequest=false;pending=true;mapping.revision=2;return route.abort('failed');}
				assert.deepEqual(input,requests[0],'Uncertain manager retry retains exact body/key');if(requestRecoveryDenied){requestRecoveryDenied=false;status=403;body={code:'team_forbidden'};}else body={id:'mapping',revision:2,status:'awaiting_automatic_owner_consent'};
			} else if(u.pathname===`${native}/sync/preview`) {
				assert.ok(owner);const input=route.request().postDataJSON();assert.equal(input.expectedRevision,mapping.revision);
				body={action:input.action,previewToken:'a'.repeat(64),revision:mapping.revision,delegationVersion:1,impact:{derivedSources:1,finalSources:1,ownershipBlocks:0},...(input.action==='enable'?{memberPreview:{partial:true,nextOffset:null,candidates:[{discordUserId:'registered',userId:'member',displayName:'Registered person'},{discordUserId:'unknown',displayName:'Unregistered person'},{discordUserId:'suppressed',userId:'removed',displayName:'Removed person',restoreRequired:true}]}}:{})};
			} else if(u.pathname===`${native}/sync/confirm`) {
				const input=route.request().postDataJSON();confirmations.push(input);assert.equal(input.previewToken,'a'.repeat(64));assert.equal(input.confirmedDelegation,true);
				if(uncertainConfirm){uncertainConfirm=false;mapping={...mapping,revision:3,mode:'automatic',enabled:true};pending=false;return route.abort('failed');}
				assert.deepEqual(input,confirmations[0],'Uncertain owner retry retains exact body/key');if(confirmRecoveryDenied){confirmRecoveryDenied=false;status=403;body={code:'team_forbidden'};}else body={id:'mapping',revision:3,status:'reconciliation_queued'};
			} else if(u.pathname===`${native}/sync/reconcile`) body={id:'mapping',revision:3,status:'reconciliation_queued'};
			else if(u.pathname!=='/api/developer/check'){status=404;body={code:'unexpected_api'};}
			return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
		});
		const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
		const capture=async state=>{await page.evaluate(async()=>{await document.fonts.ready;scrollTo(0,0);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');assert.ok(await page.getByRole('region',{name:c.title,exact:true}).evaluate(region=>[...region.querySelectorAll('button')].every(button=>{const box=button.getBoundingClientRect();return !box.width || (box.left>=0 && box.right<=innerWidth);})), 'Every sync action fits, including negative-left overflow');await page.screenshot({path:path.join(output,`${state}-${lang}-${theme}-${width}.png`),fullPage:true});captures++;};
		await page.goto(`${base}/teams/server/${guild}/role-mappings`);await page.getByRole('textbox',{name:t.roleMappings.teamLink,exact:true}).fill('demo');await page.getByRole('button',{name:t.roleMappings.openConfiguration,exact:true}).click();
		await page.getByRole('checkbox',{name:c.ack,exact:true}).check();await page.getByRole('button',{name:c.request,exact:true}).click();await page.getByText(c.uncertain,{exact:true}).waitFor();
		assert.equal(await page.getByRole('button',{name:c.request,exact:true}).count(),0,'An uncertain request exposes only its captured retry');await capture('manager-uncertain');supported=false;await page.getByRole('button',{name:c.refresh,exact:true}).click();await page.waitForFunction(label=>[...document.querySelectorAll('button')].some(button=>button.textContent===label&&button.disabled),c.retrySave);assert.ok((await page.locator('body').innerText()).includes(c.uncertain),'Gate changes preserve captured recovery');supported=true;await page.getByRole('button',{name:c.refresh,exact:true}).click();await page.getByRole('button',{name:c.retrySave,exact:true}).click();await page.waitForFunction(label=>[...document.querySelectorAll('button')].some(button=>button.textContent===label&&!button.disabled),c.retrySave);assert.equal(await page.getByRole('button',{name:c.request,exact:true}).count(),0,'Lost authority during recovery cannot discard an uncertain committed receipt');await page.getByRole('button',{name:c.retrySave,exact:true}).click();await page.getByText(c.requested,{exact:true}).waitFor();
		assert.equal(await page.getByRole('button',{name:c.review,exact:true}).count(),0);assert.ok(api.every(url=>!url.startsWith('/api/megu/teams/demo')),'Manager sees configuration only');
		owner=true;await page.goto(`${base}/teams/demo/settings`);await page.getByRole('button',{name:c.review,exact:true}).click();await page.getByText(c.partial,{exact:true}).waitFor();assert.ok(await page.getByRole('button',{name:c.confirm,exact:true}).isDisabled());await capture('owner-preview');
		await page.getByRole('checkbox',{name:c.ack,exact:true}).check();const box=await page.getByRole('checkbox',{name:c.ack,exact:true}).boundingBox();assert.ok(box.width<=24&&box.height<=24);
		await page.getByRole('button',{name:c.confirm,exact:true}).click();await page.getByText(c.uncertain,{exact:true}).waitFor();await page.getByRole('button',{name:c.retrySave,exact:true}).click();await page.waitForFunction(label=>[...document.querySelectorAll('button')].some(button=>button.textContent===label&&!button.disabled),c.retrySave);assert.ok(await page.getByRole('checkbox',{name:c.ack,exact:true}).isDisabled(),'Lost authority does not unfreeze the captured confirmation');await page.getByRole('button',{name:c.retrySave,exact:true}).click();await page.getByText(c.queued,{exact:true}).waitFor();await capture('owner-queued');
		blocked=true;capability=false;await page.getByRole('button',{name:c.refresh,exact:true}).click();await page.getByText(c.blockedHint,{exact:true}).waitFor();await page.getByText(c.unavailable,{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:c.disable,exact:true}).isDisabled(),false,'Safe retirement remains available during Discord outage');await capture('owner-blocked');
		await page.getByRole('button',{name:c.disable,exact:true}).click();await page.getByRole('checkbox',{name:c.retireAck,exact:true}).check();await page.getByRole('button',{name:t.teams.cancel,exact:true}).last().click();await page.getByRole('dialog',{name:t.projects.unsavedTitle,exact:true}).getByRole('button',{name:t.projects.keepEditing,exact:true}).click();assert.equal(await page.getByRole('checkbox',{name:c.retireAck,exact:true}).isChecked(),true);
		denied=true;await page.getByRole('button',{name:c.refresh,exact:true}).click();await page.getByRole('alert').filter({hasText:t.roleMappings.errors.team_forbidden}).waitFor();assert.equal(await page.getByRole('button',{name:c.confirm,exact:true}).count(),0,'Current status access loss hides pending consent');
		assert.deepEqual(errors,[]);await context.close();
	}console.log(`Automatic role browser passed: ${captures} EN/TH light/dark mobile/desktop captures, exact uncertain receipts, separate authority, partial holders, ownership/outage attention, compact consent, draft protection and access loss.`);}
	finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
