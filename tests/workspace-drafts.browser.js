'use strict';
// Synthetic API fixtures only; exercises real SPA navigation and browser history.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.MEGU_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.MEGU_BROWSER_BASE_URL||'http://127.0.0.1:5056';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
(async()=>{
	const browser=await chromium.launch({headless:true,executablePath:process.env.MEGU_BROWSER_EXECUTABLE});
	try { for(const lang of ['en','th']) for(const theme of ['light','dark']) {
		const t=require(`../app/copy/${lang}`),p=t.projects;
		const context=await browser.newContext({viewport:{width:1440,height:900}});
		await context.addInitScript(({lang,theme})=>{localStorage.setItem('megu-lang',lang);localStorage.setItem('megu-theme',theme);},{lang,theme});
		const output=path.resolve('.impeccable/review/workspace-drafts');fs.mkdirSync(output,{recursive:true});

		await context.route('**/*',route=>{
			const u=new URL(route.request().url());if(u.origin!==new URL(base).origin)return route.abort();if(!u.pathname.startsWith('/api/'))return route.continue();
			let body={},status=200;
			if(u.pathname==='/api/auth/me'||u.pathname==='/api/megu/me')body={loggedIn:true,user:{id:'owner'}};
			else if(u.pathname==='/api/megu/teams')body={teams:[]};
			else if(u.pathname==='/api/megu/teams/demo')body={team:{id:'demo',name:'Demo team',color:'blue',revision:1},me:{userId:'owner',role:'owner'},capabilities:{canEditTeam:true,canEdit:true}};
			else if(u.pathname==='/api/megu/projects'){
				if(route.request().method()==='POST'){status=500;body={code:'failed'};}
				else body={projects:[],hasAnyProjects:false};
			}
			return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
		});
		const page=await context.newPage();const nativeDialogs=[];
		const keep=async(escape=false)=>{const modal=page.getByRole('dialog',{name:p.unsavedTitle,exact:true});await modal.waitFor();await page.keyboard.press('Tab');assert.ok(await modal.evaluate(node=>node.contains(document.activeElement)),'Focus stays inside discard dialog');await page.keyboard.press('Shift+Tab');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.evaluate(async()=>{scrollTo(0,0);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});await page.screenshot({path:path.join(output,`dialog-${lang}-${theme}-${page.viewportSize().width}.png`),fullPage:true});if(escape)await page.keyboard.press('Escape');else await modal.getByRole('button',{name:p.keepEditing,exact:true}).click();await modal.waitFor({state:'hidden'});};
		page.on('dialog',async dialog=>{nativeDialogs.push(dialog.type());await dialog.dismiss();});
		await page.goto(`${base}/projects`);await page.getByRole('heading',{name:p.title,exact:true}).waitFor();
		await page.getByRole('link',{name:p.newProject,exact:true}).first().click();await page.waitForURL('**/projects/new');
		const title=page.getByRole('textbox',{name:p.name,exact:true});await title.fill('Retained draft');
		await page.locator('a[href="/projects"]').first().click();await keep(true);assert.equal(new URL(page.url()).pathname,'/projects/new');assert.equal(await title.inputValue(),'Retained draft');
		await page.evaluate(()=>history.back());await keep();
		await page.waitForURL('**/projects/new');assert.equal(await title.inputValue(),'Retained draft','Cancelled Back retains the editor');
		await page.getByRole('button',{name:p.create,exact:true}).click();await page.getByRole('alert').filter({hasText:p.errors.failed}).waitFor();
		assert.equal(await title.inputValue(),'Retained draft','Failed save preserves draft');
		await page.getByRole('button',{name:p.cancel,exact:true}).last().click();await keep();assert.equal(await title.inputValue(),'Retained draft');
		await page.getByRole('button',{name:p.cancel,exact:true}).last().click();await page.getByRole('dialog',{name:p.unsavedTitle,exact:true}).getByRole('button',{name:p.discardChanges,exact:true}).click();await page.waitForURL('**/projects');
		const count=nativeDialogs.length;await page.reload();assert.equal(nativeDialogs.length,count,'Discarded drafts leave no stale unload guard');
		assert.deepEqual(nativeDialogs,[],'SPA guards use the established in-app dialog');
		await page.setViewportSize({width:390,height:900});await page.goto(`${base}/teams/demo/settings`);
		await page.getByRole('textbox',{name:t.teams.name,exact:true}).fill('Mobile draft');
		await page.getByRole('button',{name:t.teams.workspace.label,exact:true}).click();
		await page.getByRole('option',{name:t.teams.workspace.projects,exact:true}).click();await keep();
		assert.equal(new URL(page.url()).pathname,'/teams/demo/settings');
		assert.equal(await page.getByRole('textbox',{name:t.teams.name,exact:true}).inputValue(),'Mobile draft');
		await context.close();
	} console.log('Workspace draft browser passed: EN/TH links, mobile workspace switches, cancelled Back, failed saves, cancel/keep/discard and guard cleanup.'); }
	finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
