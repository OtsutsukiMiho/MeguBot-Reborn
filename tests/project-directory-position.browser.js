'use strict';
// Local browser with synthetic API responses; no database writes.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.MEGU_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.MEGU_BROWSER_BASE_URL||'http://127.0.0.1:5056';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
(async()=>{
	const browser=await chromium.launch({headless:true,executablePath:process.env.MEGU_BROWSER_EXECUTABLE});
	try { for(const lang of ['en','th']) for(const width of [390,1280]) {
		const p=require(`../app/copy/${lang}`).projects;
		const context=await browser.newContext({viewport:{width,height:720}});
		const output=path.resolve('.impeccable/review/project-directory-position');fs.mkdirSync(output,{recursive:true});
		await context.addInitScript(lang=>localStorage.setItem('megu-lang',lang),lang);
		const requests=[];
		await context.route('**/*',route=>{
			const u=new URL(route.request().url());if(u.origin!==new URL(base).origin)return route.abort();
			if(!u.pathname.startsWith('/api/'))return route.continue();
			let body={};
			if(u.pathname==='/api/auth/me'||u.pathname==='/api/megu/me')body={loggedIn:true,user:{id:'owner'}};
			else if(u.pathname==='/api/megu/teams')body={teams:[]};
			else if(u.pathname==='/api/megu/projects'){
				requests.push(Object.fromEntries(u.searchParams));
				const second=!!u.searchParams.get('cursor');
				body={hasAnyProjects:true,projects:[{id:second?'second':'first',code:second?'SECOND':'FIRST',title:second?'Second project':'First project',status:'active',topicCount:second?2:0,progress:second?16:0}],nextCursor:second?null:'next-page'};
			}
			return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
		});
		const page=await context.newPage();await page.goto(`${base}/projects?team=standalone`);
		await page.getByText('First project',{exact:true}).waitFor();
		assert.equal(await page.getByText(p.noTopicsTitle,{exact:true}).count(),1);assert.equal(await page.getByText('0%',{exact:true}).count(),0);
		assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
		await page.evaluate(async()=>{scrollTo(0,0);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
		await page.screenshot({path:path.join(output,`empty-${lang}-${width}.png`),fullPage:true});
		await page.getByRole('button',{name:p.loadMoreProjects,exact:true}).click();
		await page.getByText('Second project',{exact:true}).waitFor();
		assert.equal(await page.getByText('16%',{exact:true}).count(),1);
		await page.evaluate(async()=>{scrollTo(0,0);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
		await page.screenshot({path:path.join(output,`populated-${lang}-${width}.png`),fullPage:true});
		assert.equal(await page.getByText('First project',{exact:true}).count(),1,'Load more retains existing rows');
		assert.equal(new URL(page.url()).searchParams.get('cursor'),'next-page');
		await page.reload();await page.getByText('Second project',{exact:true}).waitFor();
		assert.equal(requests.at(-1).cursor,'next-page');assert.equal(requests.at(-1).teamId,'standalone');
		await page.goBack();await page.getByText('First project',{exact:true}).waitFor();
		assert.equal(new URL(page.url()).searchParams.has('cursor'),false);
		await page.goForward();await page.getByText('Second project',{exact:true}).waitFor();
		const filtered=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/megu/projects'&&new URL(response.url()).searchParams.get('q')==='Second');
		await page.getByRole('textbox',{name:p.search,exact:true}).fill('Second');
		await page.waitForFunction(()=>new URL(location.href).searchParams.get('q')==='Second'&&!new URL(location.href).searchParams.has('cursor'));
		await filtered;
		assert.equal(requests.at(-1).cursor,undefined,'Changing filters restarts pagination');
		await context.close();
	} console.log('Directory position browser passed: EN/TH append, reload, Back/Forward, scope and filter reset.'); }
	finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
