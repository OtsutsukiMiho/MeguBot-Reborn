'use strict';
// Built client with synthetic APIs only: no retained writes or external sends.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.MEGU_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.MEGU_BROWSER_BASE_URL||'http://127.0.0.1:5056';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const output=path.resolve('.impeccable/review/workspace-ux');
(async()=>{
	fs.mkdirSync(output,{recursive:true});
	const browser=await chromium.launch({headless:true,executablePath:process.env.MEGU_BROWSER_EXECUTABLE});
	let captures=0; const errors=[];
	try { for(const lang of ['en','th'])for(const theme of ['light','dark'])for(const width of [390,768,1440]){
		const t=require(`../app/copy/${lang}`),c=t.teams;
		const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
		await context.addInitScript(({lang,theme})=>{localStorage.setItem('megu-lang',lang);localStorage.setItem('megu-theme',theme);},{lang,theme});
		let team={id:'demo',name:lang==='th'?'ทีมพัฒนาระบบสำหรับชุมชน':'Community development',description:'Team description',role:'owner',revision:1,color:'blue',archivedAt:null};
		let failLoad=true,failSave=true,linkActive=false,failLifecycle=true;
		const writes=[];
		let projectTransfer=null;
		let pendingCreation=null,creationReady=null;
		const capabilities={canEdit:true,canCreateProject:true,canManageJoinLink:true,canManageMembers:true,canManageAdmins:true,canTransferOwnership:true,canArchive:true};
		await context.route('**/*',route=>{
			const request=route.request(),url=new URL(request.url()),method=request.method();
			if(url.origin!==new URL(base).origin)return route.abort();
			if(!url.pathname.startsWith('/api/'))return route.continue();
			let body,status=200;
			if(url.pathname==='/api/auth/me')body={loggedIn:true,user:{id:'owner',displayName:'Owner'}};
			else if(url.pathname==='/api/developer/check')body={isDeveloper:false};
			else if(url.pathname==='/api/megu/me')body={loggedIn:true,user:{id:'owner'},notificationPreferences:{mode:'off'}};
			else if(url.pathname==='/api/megu/teams' && method==='GET'){if(failLoad){status=503;body={code:'unavailable'};}else body={teams:[team]};}
			else if(url.pathname==='/api/megu/teams' && method==='POST'){writes.push({method,path:url.pathname,payload:request.postDataJSON()});pendingCreation=route;creationReady?.();creationReady=null;return;}
			else if(url.pathname==='/api/megu/teams/created/summary')body={team:{...team,id:'created',name:'Creation draft'},me:{userId:'owner',role:'owner'},capabilities};
			else if(['/api/megu/teams/discord-guilds','/api/megu/teams/workspace-guilds'].includes(url.pathname))body={guilds:[]};
			else if(url.pathname==='/api/megu/teams/demo' && method==='PATCH'){
				const payload=request.postDataJSON();writes.push({method,payload});assert.equal(payload.expectedRevision,team.revision);
				if(failSave){status=503;body={code:'unavailable'};}else{team={...team,...payload,revision:team.revision+1};body={team};}
			}else if(['/api/megu/teams/demo','/api/megu/teams/demo/summary'].includes(url.pathname))body={team,me:{userId:'owner',role:'owner'},capabilities};
			else if(url.pathname==='/api/megu/teams/demo/members')body={members:[{userId:'owner',role:'owner',displayName:'Owner',joinedAt:'2026-09-20T00:00:00Z'},{userId:'candidate',role:'member',displayName:'Candidate',joinedAt:'2026-09-20T00:00:00Z'}],total:2,nextOffset:null};
			else if(url.pathname==='/api/megu/teams/demo/join-requests')body={requests:[],link:linkActive?{active:true}:null,teamRevision:team.revision};
			else if(url.pathname==='/api/megu/teams/demo/join-link'){writes.push({method,payload:request.postDataJSON()});linkActive=method!=='DELETE';body=linkActive?{token:'synthetic-invite'}:{ok:true};}
			else if(['/api/megu/teams/demo/archive','/api/megu/teams/demo/ownership-transfer'].includes(url.pathname)){
				const payload=request.postDataJSON();writes.push({method,path:url.pathname,payload});assert.equal(payload.expectedRevision,team.revision);
				if(failLifecycle){status=503;body={code:'unavailable'};}else body={ok:true};
			}
			else if(url.pathname==='/api/megu/projects')body={projects:[],nextCursor:null};
			else if(url.pathname==='/api/megu/projects/DEMO')body={project:{id:'p',code:'DEMO',title:'Private project',description:'Project description',revision:1,status:'active',timezone:'UTC',startsAt:null,deadlineAt:null},me:{userId:'owner',role:'owner'},members:[{userId:'owner',role:'owner',displayName:'Owner'},{userId:'candidate',role:'contributor',displayName:'Candidate'}],ownershipTransfer:projectTransfer};
			else if(url.pathname==='/api/megu/projects/DEMO/ownership-transfer'){const payload=request.postDataJSON();writes.push({method,path:url.pathname,payload});assert.deepEqual(payload,{proposedOwnerId:'candidate',expectedRevision:1});projectTransfer={id:'transfer',proposedOwnerId:'candidate',proposedOwnerName:'Candidate'};body={ok:true};}
			else { errors.push(`Unexpected API: ${method} ${url.pathname}`);return route.fulfill({status:404,contentType:'application/json',body:'{}'}); }
			return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
		});
		const page=await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
		const capture=async state=>{await page.evaluate(async()=>{scrollTo(0,0);await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${state}: horizontal overflow ${lang}/${width}`);await page.screenshot({path:path.join(output,`${state}-${lang}-${theme}-${width}.png`),fullPage:true});captures++;};
		await page.goto(`${base}/teams`);await page.locator('main').getByRole('alert').waitFor();
		failLoad=false;await page.getByRole('button',{name:c.workspace.retry,exact:true}).click();await page.getByRole('heading',{name:team.name,exact:true}).waitFor();
		if(width<=1100){
			const button=page.getByRole('button',{name:t.nav.openMenu,exact:true});await button.click();
			const menu=page.locator('#main-navigation');await menu.getByRole('link',{name:t.nav.projects,exact:true}).waitFor();await capture('mobile-navigation');
			await page.keyboard.press('Escape');assert.equal(await button.getAttribute('aria-expanded'),'false');assert.equal(await button.evaluate(el=>el===document.activeElement),true);
			await button.click();await menu.getByRole('link',{name:t.nav.teams,exact:true}).click();assert.equal(await button.getAttribute('aria-expanded'),'false');
		}else{assert.equal(await page.locator('.nav-menu-toggle').isVisible(),false);assert.equal(await page.locator('.nav-mobile-signout').isVisible(),false);assert.equal(await page.getByRole('button',{name:t.nav.signOut,exact:true}).count(),1);}
		await page.goto(`${base}/teams/demo/people`);await page.getByRole('button',{name:c.ux.invitePeople,exact:true}).click();await page.waitForURL('**/teams/demo/requests');
		await page.getByText(c.ux.requestsHint,{exact:true}).waitFor();await capture('invite-empty');
		await page.getByRole('button',{name:c.createJoinLink,exact:true}).click();await page.getByText(c.ux.inviteReady,{exact:true}).waitFor();
		const invite=page.getByRole('textbox',{name:c.joinTitle,exact:true});assert.equal(await invite.inputValue(),`${base}/teams/join/synthetic-invite`);
		await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw new Error('synthetic clipboard denial');};});
		await page.getByRole('button',{name:c.copyLink,exact:true}).click();await page.getByText(c.ux.copyFailed,{exact:true}).waitFor();await capture('invite-copy-recovery');
		await page.goto(`${base}/teams/demo/settings`);const name=page.getByRole('textbox',{name:c.name,exact:true});await name.fill('Edited team');await page.getByRole('button',{name:c.save,exact:true}).click();await page.locator('main').getByRole('alert').waitFor();assert.equal(await name.inputValue(),'Edited team');
		failSave=false;await page.getByRole('button',{name:c.save,exact:true}).click();await page.getByText(c.ux.saved,{exact:true}).waitFor();await capture('team-saved');
		assert.equal(writes.filter(write=>write.method==='PATCH').length,2);assert.equal(writes.filter(write=>write.method==='POST').length,1);
		if(Number(process.env.MEGU_UX_BATCH||4)>=2){
			team.discordGuild={id:'811111111111111111',name:'Community server'};
			await page.goto(`${base}/teams/demo`);await page.getByRole('heading',{name:c.ux.shortcuts,exact:true}).waitFor();
			const hierarchy=page.getByRole('navigation',{name:c.ux.context,exact:true});assert.equal(await hierarchy.getByRole('link',{name:'Community server',exact:true}).getAttribute('href'),'/teams/server/811111111111111111/teams');
			assert.equal(await page.getByRole('link',{name:c.ux.configureDiscord,exact:true}).getAttribute('href'),'/teams/demo/settings#discord-roles');await capture('overview-context');
			await page.locator('main').getByRole('link',{name:c.workspace.projects,exact:true}).last().click();await page.waitForURL('**/teams/demo/projects');await page.getByText(c.ux.noProjectsHint,{exact:true}).waitFor();await capture('projects-empty');
			team.discordGuild=null;
		}
		if(Number(process.env.MEGU_UX_BATCH||4)>=3){
			await page.goto(`${base}/teams/demo/settings?section=lifecycle`);await page.getByRole('heading',{name:c.ownershipTitle,exact:true}).waitFor();
			const before=writes.length;await page.getByRole('button',{name:c.archive,exact:true}).click();const review=page.getByRole('group',{name:c.ux.archiveConfirm,exact:true});await review.waitFor();assert.equal(writes.length,before);await capture('archive-review');
			await review.getByRole('button',{name:c.ux.keepEditing,exact:true}).click();assert.equal(writes.length,before);
			await page.getByRole('button',{name:c.newOwner,exact:true}).click();await page.getByRole('option',{name:'Candidate'}).click();await page.getByRole('button',{name:c.proposeTransfer,exact:true}).click();
			const transferReview=page.getByRole('group',{name:c.ux.reviewTransfer,exact:true});await transferReview.waitFor();await capture('transfer-review');assert.equal(writes.length,before);
			await transferReview.getByRole('button',{name:c.ux.confirmAction,exact:true}).click();await page.locator('main').getByRole('alert').waitFor();assert.ok(await transferReview.isVisible());
			failLifecycle=false;await transferReview.getByRole('button',{name:c.ux.confirmAction,exact:true}).click();await page.getByText(c.ux.lifecycleSaved,{exact:true}).waitFor();assert.equal(writes.at(-1).payload.proposedOwnerId,'candidate');assert.deepEqual(writes.at(-1).payload,writes.at(-2).payload);
			await page.goto(`${base}/p/DEMO/manage`);await page.getByRole('navigation',{name:t.projects.manage,exact:true}).getByRole('button',{name:t.projects.manageTabs.lifecycle,exact:true}).click();
			await page.getByRole('button',{name:t.projects.stateActions.completed,exact:true}).click();await page.getByText(t.projects.confirmStateTitle(t.projects.state.completed),{exact:true}).waitFor();
			await page.getByRole('button',{name:t.projects.newOwner,exact:true}).click();await page.getByRole('option',{name:/Candidate/}).click();const projectBefore=writes.length;await page.getByRole('button',{name:t.projects.proposeTransfer,exact:true}).click();
			const projectReview=page.getByRole('group',{name:t.projects.ux.reviewTransfer,exact:true});await projectReview.waitFor();assert.equal(await page.getByText(t.projects.confirmStateTitle(t.projects.state.completed),{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:t.projects.stateActions.completed,exact:true}).isDisabled(),true);assert.equal(writes.length,projectBefore);assert.equal(await projectReview.evaluate(el=>getComputedStyle(el).borderLeftWidth),'1px');await capture('project-transfer-review');
			await projectReview.getByRole('button',{name:t.projects.ux.confirmTransfer,exact:true}).click();await page.getByText(t.projects.ux.transferSaved,{exact:true}).waitFor();assert.equal(writes.length,projectBefore+1);
		}
		if(Number(process.env.MEGU_UX_BATCH||4)>=4){
			await page.goto(`${base}/teams`);await page.getByRole('button',{name:c.newTeam,exact:true}).click();const draft=page.getByRole('textbox',{name:c.name,exact:true});await draft.fill('Creation draft');
			await page.getByRole('button',{name:c.cancel,exact:true}).click();const dialog=page.getByRole('dialog',{name:t.projects.unsavedTitle,exact:true});await dialog.waitFor();await capture('creation-discard-review');
			await dialog.getByRole('button',{name:t.projects.keepEditing,exact:true}).click();assert.equal(await draft.inputValue(),'Creation draft');
			await page.getByRole('button',{name:c.cancel,exact:true}).click();await dialog.getByRole('button',{name:t.projects.discardChanges,exact:true}).click();await page.getByRole('button',{name:c.newTeam,exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:c.newTeam,exact:true}).evaluate(el=>el===document.activeElement),true);
			await page.getByRole('button',{name:c.newTeam,exact:true}).click();await draft.fill('Creation draft');const firstCreation=new Promise(resolve=>{creationReady=resolve;});await page.getByRole('button',{name:c.create,exact:true}).click();await firstCreation;await page.waitForFunction(()=>document.querySelector('input[maxlength="120"]')?.disabled);
			assert.equal(await page.getByRole('button',{name:c.cancel,exact:true}).isDisabled(),true);await page.locator('form').dispatchEvent('submit');assert.equal(writes.filter(write=>write.path==='/api/megu/teams').length,1);await capture('creation-saving');
			await pendingCreation.fulfill({status:422,contentType:'application/json',body:JSON.stringify({code:'team_name_invalid'})});await page.locator('main').getByRole('alert').waitFor();assert.equal(await draft.inputValue(),'Creation draft');await capture('creation-failed');
			pendingCreation=null;const nextCreation=new Promise(resolve=>{creationReady=resolve;});await page.getByRole('button',{name:c.create,exact:true}).click();await nextCreation;assert.ok(pendingCreation);await pendingCreation.fulfill({contentType:'application/json',body:JSON.stringify({team:{id:'created'}})});await page.waitForURL('**/teams/created');await page.getByRole('heading',{name:'Creation draft',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);assert.equal(writes.filter(write=>write.path==='/api/megu/teams').length,2);
		}
		await context.close();
	} assert.deepEqual(errors,[]); console.log(`Workspace UX browser passed: ${captures} EN/TH light/dark mobile/tablet/desktop captures; navigation, invite recovery, context/shortcuts, captured team/project transfer review, archive cancellation, save feedback and creation draft/submission/cancel safeguards.`);
	}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
