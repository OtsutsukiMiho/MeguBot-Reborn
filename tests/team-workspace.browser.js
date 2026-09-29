'use strict';
// Synthetic API responses only. No retained database or Discord mutations.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.MEGU_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.MEGU_BROWSER_BASE_URL||'http://127.0.0.1:5056';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const output=path.resolve('.impeccable/review/team-workspace');
(async()=>{
	fs.mkdirSync(output,{recursive:true});
	const browser=await chromium.launch({headless:true,executablePath:process.env.MEGU_BROWSER_EXECUTABLE});
	const errors=[];let captures=0;
	try{
		for(const lang of ['en','th'])for(const theme of ['light','dark'])for(const width of [390,768,1440]){
			const copy=require(`../app/copy/${lang}`),c=copy.teams;
			const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
			await context.addInitScript(({lang,theme})=>{localStorage.setItem('megu-lang',lang);localStorage.setItem('megu-theme',theme);},{lang,theme});
			const team={id:'demo',name:lang==='th'?'ทีมพัฒนาระบบและบริการสำหรับชุมชน':'Community development',description:c.peopleHint,role:'owner',color:'blue',discordGuild:{id:'811111111111111111',name:'Megu server'}};
			const projects=[];let summaryReads=0,dense=false,canCreateProject=true,canManageJoinLink=true;
			const longProjectTitle=lang==='th'?'โครงการปรับปรุงพื้นที่ทำงานร่วมกันสำหรับชุมชนและทีมอาสาสมัคร':'Community workspace accessibility and launch coordination';
			const longGoalTitle=lang==='th'?'จัดส่งงานเปิดตัวชุมชนพร้อมตรวจสอบการเข้าถึงและเอกสารสำหรับทุกทีม':'Finish the community launch with accessible guidance for every team';
			let goals=[{id:'goal',title:'Finish the community launch',subjectName:'Owner',subjectId:'owner',access:'private',lifecycle:'submitted',periodStart:'2026-09-01',periodEnd:'2026-09-30'}];
			await context.route('**/*',route=>{
				const request=route.request(),url=new URL(request.url());
				if(url.origin!==new URL(base).origin)return route.abort();
				if(!url.pathname.startsWith('/api/'))return route.continue();
				let body;
				if(url.pathname==='/api/auth/me')body={loggedIn:true,user:{id:'owner',displayName:'Owner'}};
				else if(url.pathname==='/api/developer/check')body={isDeveloper:false};
				else if(url.pathname==='/api/megu/me')body={loggedIn:true,user:{id:'owner'}};
			else if(['/api/megu/teams/demo','/api/megu/teams/demo/summary'].includes(url.pathname)){if(url.pathname.endsWith('/summary'))summaryReads++;body={team,me:{userId:'owner',role:team.role},capabilities:{canCreateProject,canManageJoinLink}};}
				else if(url.pathname==='/api/megu/teams/demo/goals')body={team:{name:team.name},goals,nextOffset:null};
			else if(url.pathname==='/api/megu/teams/demo/goals/goal')body={access:'administration',goal:{id:'goal',version:1,currentVersion:1,lifecycle:'submitted',periodStart:'2026-09-01',periodEnd:'2026-09-30',needsReviewer:false},capabilities:{}};
				else if(url.pathname==='/api/megu/teams/demo/members')body={members:[{userId:'owner',displayName:'Owner',role:'owner'}],total:1,nextOffset:null};
				else if(url.pathname==='/api/megu/projects'){
					assert.equal(url.searchParams.get('teamId'),'demo');assert.ok(['3','30'].includes(url.searchParams.get('limit')));
					if(url.searchParams.get('limit')==='30')projects.push(url.searchParams.get('cursor'));
					body=dense?{projects:[{id:'p',code:'DEMO',title:longProjectTitle,status:'active',topicCount:5,progress:60,role:'owner'},{id:'p2',code:'OTHER',title:'Planning the next cycle',status:'active',topicCount:0,progress:0,role:'member'}],nextCursor:null}:{projects:[{id:'p',code:'DEMO',title:url.searchParams.get('cursor')?'Second page project':'No topics project',status:'active',topicCount:url.searchParams.get('cursor')?5:0,progress:url.searchParams.get('cursor')?60:0,role:'owner'}],nextCursor:url.searchParams.get('cursor')?null:'next-page'};
				}else{errors.push(`Unexpected API: ${url.pathname}`);return route.fulfill({status:404,contentType:'application/json',body:'{}'});}
				return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
			});
			const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
			await page.goto(`${base}/teams/demo`);await page.getByRole('heading',{name:team.name,exact:true}).waitFor();
			await page.evaluate(()=>{window.__teamTitle=document.querySelector('main h1');});
			assert.deepEqual(projects,[],'Overview preview must not fetch the full project directory');
			assert.ok(await page.getByRole('link',{name:'Megu server'}).count() || await page.getByText('Megu server',{exact:true}).count());
			if(width>780){await page.getByRole('navigation',{name:c.workspace.label}).getByRole('link',{name:c.workspace.projects,exact:true}).click();}
			else{
				const selector=page.getByRole('button',{name:c.workspace.label,exact:true});
				await selector.click();
				const listbox=page.getByRole('listbox',{name:c.workspace.label,exact:true});
				await page.keyboard.press('ArrowDown');
				assert.equal(await listbox.getAttribute('aria-activedescendant'),await page.getByRole('option',{name:c.workspace.projects,exact:true}).getAttribute('id'));
				await page.keyboard.press('Escape');
				assert.ok(await selector.evaluate(element=>element===document.activeElement),'Escape restores trigger focus');
				await selector.click();
				await page.keyboard.press('ArrowDown');
				await page.keyboard.press('Enter');
				assert.equal(await selector.getAttribute('aria-expanded'),'false');
			}
			await page.waitForURL('**/teams/demo/projects');await page.getByText('No topics project',{exact:true}).waitFor();
			assert.equal(await page.evaluate(()=>window.__teamTitle===document.querySelector('main h1')),true,'Team identity stays mounted on child navigation');
			assert.equal(summaryReads,1,'Team summary is not refetched on child navigation');
			assert.ok(await page.getByText(c.workspace.noTopics,{exact:true}).count());
			assert.equal(await page.getByText('0%',{exact:true}).count(),0);
			assert.ok(await page.getByRole('link',{name:c.createProject,exact:true}).getAttribute('href')==='/projects/new?team=demo');
			assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Responsive workspace must not overflow');
			await page.screenshot({path:path.join(output,`projects-${lang}-${theme}-${width}.png`),fullPage:true});captures++;
			await page.getByRole('link',{name:c.workspace.nextPage,exact:true}).click();await page.getByText('Second page project',{exact:true}).waitFor();
			assert.equal(await page.getByRole('progressbar',{name:c.workspace.progressLabel}).getAttribute('aria-valuenow'),'60');
			assert.ok(page.url().includes('cursor=next-page'));await page.reload();await page.getByText('Second page project',{exact:true}).waitFor();
			await page.goBack();await page.getByText('No topics project',{exact:true}).waitFor();
			await page.goBack();await page.getByRole('heading',{name:c.overviewCopy.workspaceNow,exact:true}).waitFor();
			await page.screenshot({path:path.join(output,`overview-${lang}-${theme}-${width}.png`),fullPage:true});captures++;
			await page.goto(`${base}/teams/demo/goals`);await page.getByText('Finish the community launch',{exact:true}).waitFor();
			const goalCard=page.getByRole('link',{name:/Finish the community launch/});assert.equal(await goalCard.count(),1);
			await goalCard.getByText(copy.teamGoals.listHint.submitted,{exact:true}).click();await page.waitForURL('**/teams/demo/goals/goal');await page.getByText(copy.teamGoals.currentStatus,{exact:true}).waitFor();
			await page.goBack();assert.equal(new URL(page.url()).pathname,'/teams/demo/goals','Back returns to the Goals list');await page.getByText('Finish the community launch',{exact:true}).waitFor();
			assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Goal directory must not overflow');
			await page.screenshot({path:path.join(output,`goals-${lang}-${theme}-${width}.png`),fullPage:true});captures++;
			goals=[];await page.reload();await page.getByText(copy.teamGoals.empty,{exact:true}).waitFor();
			await page.screenshot({path:path.join(output,`goals-empty-${lang}-${theme}-${width}.png`),fullPage:true});captures++;
			if((lang==='en'&&theme==='light'&&[390,1440].includes(width))||(lang==='th'&&theme==='dark'&&width===768)){
				dense=true;await page.goto(`${base}/teams/demo/projects`);await page.getByText(longProjectTitle,{exact:true}).waitFor();
				assert.equal(await page.getByRole('link',{name:c.workspace.nextPage,exact:true}).count(),0,'No pagination when there is no next page');
				const projectCard=page.getByRole('link',{name:new RegExp(longProjectTitle)});assert.equal(await projectCard.getAttribute('href'),'/p/DEMO');
				assert.equal(await page.getByRole('progressbar',{name:c.workspace.progressLabel}).getAttribute('aria-valuenow'),'60');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
				await page.screenshot({path:path.join(output,`projects-multiple-${lang}-${theme}-${width}.png`),fullPage:true});captures++;
				await projectCard.focus();assert.ok(await projectCard.evaluate(element=>element===document.activeElement));
				goals=[{id:'goal',title:longGoalTitle,subjectName:'A very long participant name for layout testing',subjectId:'owner',access:'private',lifecycle:'submitted',periodStart:'2026-09-01',periodEnd:'2026-09-30'},
					{id:'goal2',title:'Plan the next quarter',subjectName:'Alex',subjectId:'reviewer',access:'private',lifecycle:'active',needsReviewer:true,periodStart:'2026-10-01',periodEnd:'2026-12-31'}];
				await page.goto(`${base}/teams/demo/goals`);await page.getByText(longGoalTitle,{exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
				await page.screenshot({path:path.join(output,`goals-multiple-${lang}-${theme}-${width}.png`),fullPage:true});captures++;
				const longGoalCard=page.getByRole('link',{name:new RegExp(longGoalTitle)});await longGoalCard.focus();assert.ok(await longGoalCard.evaluate(element=>element===document.activeElement));
				await page.keyboard.press('Enter');await page.waitForURL('**/teams/demo/goals/goal');await page.getByText(copy.teamGoals.currentStatus,{exact:true}).waitFor();
				team.role='member';canCreateProject=false;canManageJoinLink=false;await page.goto(`${base}/teams/demo/projects`);await page.getByText(longProjectTitle,{exact:true}).waitFor();
				assert.equal(await page.getByRole('link',{name:c.createProject,exact:true}).count(),0,'Read-only member cannot see project creation');
				await page.screenshot({path:path.join(output,`projects-readonly-${lang}-${theme}-${width}.png`),fullPage:true});captures++;
			}
			await context.close();
		}
		assert.deepEqual(errors,[]);console.log(`Team workspace browser passed: ${captures} EN/TH light/dark captures, responsive navigation, bounded projects, deep-link reload and Back pagination.`);
	}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
