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
			const projects=[];
			await context.route('**/*',route=>{
				const request=route.request(),url=new URL(request.url());
				if(url.origin!==new URL(base).origin)return route.abort();
				if(!url.pathname.startsWith('/api/'))return route.continue();
				let body;
				if(url.pathname==='/api/auth/me')body={loggedIn:true,user:{id:'owner',displayName:'Owner'}};
				else if(url.pathname==='/api/developer/check')body={isDeveloper:false};
				else if(url.pathname==='/api/megu/me')body={loggedIn:true,user:{id:'owner'}};
				else if(['/api/megu/teams/demo','/api/megu/teams/demo/summary'].includes(url.pathname))body={team,me:{userId:'owner',role:'owner'},capabilities:{canCreateProject:true,canManageJoinLink:true}};
				else if(url.pathname==='/api/megu/projects'){
					assert.equal(url.searchParams.get('teamId'),'demo');assert.equal(url.searchParams.get('limit'),'30');
					projects.push(url.searchParams.get('cursor'));
					body={projects:[{id:'p',code:'DEMO',title:url.searchParams.get('cursor')?'Second page project':'No topics project',status:'active',topicCount:0,progress:0,role:'owner'}],nextCursor:url.searchParams.get('cursor')?null:'next-page'};
				}else{errors.push(`Unexpected API: ${url.pathname}`);return route.fulfill({status:404,contentType:'application/json',body:'{}'});}
				return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
			});
			const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
			await page.goto(`${base}/teams/demo`);await page.getByRole('heading',{name:team.name,exact:true}).waitFor();
			assert.deepEqual(projects,[],'Overview must not fetch project rows');
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
			assert.ok(await page.getByText(c.workspace.noTopics,{exact:true}).count());
			assert.equal(await page.getByText('0%',{exact:true}).count(),0);
			assert.ok(await page.getByRole('link',{name:c.createProject,exact:true}).getAttribute('href')==='/projects/new?team=demo');
			assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Responsive workspace must not overflow');
			await page.screenshot({path:path.join(output,`projects-${lang}-${theme}-${width}.png`),fullPage:true});captures++;
			await page.getByRole('link',{name:c.workspace.nextPage,exact:true}).click();await page.getByText('Second page project',{exact:true}).waitFor();
			assert.ok(page.url().includes('cursor=next-page'));await page.reload();await page.getByText('Second page project',{exact:true}).waitFor();
			await page.goBack();await page.getByText('No topics project',{exact:true}).waitFor();
			await page.goBack();await page.getByRole('heading',{name:c.workspace.overview,exact:true}).waitFor();
			await page.screenshot({path:path.join(output,`overview-${lang}-${theme}-${width}.png`),fullPage:true});captures++;
			await context.close();
		}
		assert.deepEqual(errors,[]);console.log(`Team workspace browser passed: ${captures} EN/TH light/dark captures, responsive navigation, bounded projects, deep-link reload and Back pagination.`);
	}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
