'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.MEGU_PLAYWRIGHT_MODULE||'playwright'),{projectInsights}=require('../core/project-insights');
const base=process.env.MEGU_BROWSER_BASE_URL||'http://127.0.0.1:5056';assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
(async()=>{
	const browser=await chromium.launch({headless:true,executablePath:process.env.MEGU_BROWSER_EXECUTABLE});
	const output=path.resolve('.impeccable/review/project-insights');fs.mkdirSync(output,{recursive:true});let captures=0;
	try{for(const lang of ['en','th'])for(const theme of ['light','dark'])for(const width of [390,768,1440]){
		const p=require(`../app/copy/${lang}`).projects,copy=p.insights,context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
		await context.addInitScript(({lang,theme})=>{localStorage.setItem('megu-lang',lang);localStorage.setItem('megu-theme',theme);},{lang,theme});
		const date='2026-09-27T00:00:00Z',topics=[{id:'delivery',number:1,title:'Accepted delivery',workflow:'completed',progress:100,revision:1,assignees:[],completedAt:'2026-09-25T00:00:00Z',completionDeadlineAt:'2026-09-25T16:59:59Z'},{id:'work',number:2,title:'Current delivery',workflow:'in_progress',progress:49.2,revision:1,assignees:[],blocked:true,deadlineAt:'2026-09-20T16:59:59Z'},{id:'legacy',number:3,title:'Historical completion',workflow:'completed',progress:100,revision:1,assignees:[]}];let empty=false;
		await context.route('**/*',route=>{
			const u=new URL(route.request().url());if(u.origin!==new URL(base).origin)return route.abort();if(!u.pathname.startsWith('/api/'))return route.continue();let body={};
			if(u.pathname==='/api/auth/me'||u.pathname==='/api/megu/me')body={loggedIn:true,user:{id:'reader'}};
			else if(u.pathname==='/api/megu/projects/ABCDE'){const selected=empty?[]:topics,insights=projectInsights(selected,date);body={project:{id:'project',code:'ABCDE',title:'Delivery project',status:'active',timezone:'Asia/Bangkok',progress:insights.reportedProgress,topicCount:selected.length,team:{id:'demo',name:'Delivery team'}},topics:selected,members:[],me:{userId:'reader',role:'viewer'},events:[],insights};}
			return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
		});
		const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
		const capture=async state=>{await page.evaluate(async()=>{await document.fonts.ready;scrollTo(0,0);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,`${state}-${lang}-${theme}-${width}.png`),fullPage:true});captures++;};
		await page.goto(`${base}/p/ABCDE?view=insights&attention=blocked&assigned=me&q=missing`);await page.getByRole('heading',{name:copy.title,exact:true}).waitFor();
		const progress=projectInsights(topics,date).reportedProgress;assert.equal(await page.getByRole('progressbar',{name:p.progress,exact:true}).getAttribute('aria-valuenow'),String(progress));assert.ok((await page.locator('body').innerText()).includes(`${progress}%`));await page.getByText(copy.excluded(1,0),{exact:true}).waitFor();await capture('insights');
		const completed=page.locator('section').filter({has:page.getByRole('heading',{name:copy.completed,exact:true})}).last();await completed.locator('summary').click();await completed.getByRole('button',{name:'#1 Accepted delivery',exact:true}).click();
		await page.getByRole('dialog',{name:'Accepted delivery',exact:true}).waitFor();let url=new URL(page.url());assert.equal(url.searchParams.get('topic'),'delivery');assert.equal(url.searchParams.get('view'),'topics');for(const key of ['attention','assigned','q'])assert.equal(url.searchParams.get(key),null,'Source drilldown clears filters');await capture('source-topic');
		await page.reload();await page.getByRole('dialog',{name:'Accepted delivery',exact:true}).waitFor();
		const close=page.getByRole('button',{name:p.closeDetails,exact:true});
		if(width===390)assert.ok(await close.evaluate(button=>{const box=button.getBoundingClientRect(),hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);return hit?.closest('button')===button;}),'Mobile Close is unobscured by the navbar');
		await close.click();await page.getByRole('dialog',{name:'Accepted delivery',exact:true}).waitFor({state:'hidden'});assert.equal(new URL(page.url()).searchParams.get('topic'),null,'Pointer Close clears selection');
		empty=true;await page.goto(`${base}/p/ABCDE?view=insights`);await page.getByRole('heading',{name:copy.title,exact:true}).waitFor();assert.equal(await page.getByRole('progressbar',{name:p.progress,exact:true}).count(),0);assert.ok((await page.locator('body').innerText()).includes(copy.empty));assert.equal(await page.getByRole('heading',{name:copy.completed,exact:true}).count(),0);await capture('empty');assert.deepEqual(errors,[]);await context.close();
	}console.log(`Project Insights browser passed: ${captures} EN/TH light/dark 390/768/1440 captures; header parity, unknown-history denominator, source-topic filter reset/URL/reload, and no false percentage for empty topics.`);}
	finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
