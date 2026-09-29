'use strict';
// Browser acceptance against synthetic APIs; backend lifecycle/privacy has real DB coverage.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.MEGU_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.MEGU_BROWSER_BASE_URL||'http://127.0.0.1:5056';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
(async()=>{
	const browser=await chromium.launch({headless:true,executablePath:process.env.MEGU_BROWSER_EXECUTABLE});
	const output=path.resolve('.impeccable/review/team-goal-workflow');fs.mkdirSync(output,{recursive:true});let captures=0;
	try {for(const lang of ['en','th'])for(const theme of ['light','dark'])for(const width of [390,768,1440]) {
		const t=require(`../app/copy/${lang}`),c=t.teamGoals,context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
		await context.addInitScript(({lang,theme})=>{localStorage.setItem('megu-lang',lang);localStorage.setItem('megu-theme',theme);},{lang,theme});
		let actor='subject',access='private',deny=false,reviewConflict=true,review=null,updates=[],responses=[];
		const goal={id:'goal',teamId:'demo',subjectId:'subject',reviewerId:'reviewer',title:'Private delivery agreement',successDescription:'Evidence of accepted delivery',version:1,currentVersion:1,revision:1,lifecycle:'draft',timezone:'Asia/Bangkok',periodStart:'2026-09-01',periodEnd:'2026-09-30',measurement:{kind:'numeric',direction:'increase',baseline:0,target:10,current:null,unit:'items'},achievement:null};
		const capabilities=()=>access!=='private'?{}:goal.lifecycle==='draft'?{canPropose:actor==='subject'}:goal.lifecycle==='proposed'?{canAccept:actor==='subject'?!goal.subjectAcceptedAt:actor==='reviewer'?!goal.reviewerAcceptedAt:false}:goal.lifecycle==='active'?{canAddEvidence:actor==='subject',canSubmit:actor==='subject'&&Boolean(goal.reviewerId)}:goal.lifecycle==='submitted'?{canReview:actor==='reviewer',canReturn:actor==='reviewer'}:goal.lifecycle==='reviewed'?{canRespond:actor==='subject'}:{};
		await context.route('**/*',route=>{
			const u=new URL(route.request().url());if(u.origin!==new URL(base).origin)return route.abort();if(!u.pathname.startsWith('/api/'))return route.continue();let body={},status=200;
			if(u.pathname==='/api/auth/me'||u.pathname==='/api/megu/me')body={loggedIn:true,user:{id:actor}};
			else if(u.pathname==='/api/megu/teams/demo/summary')body={team:{id:'demo',name:'Community development',role:'member'},me:{userId:actor,role:'member'},capabilities:{}};
			else if(u.pathname==='/api/megu/teams/demo/members')body={members:[{userId:'subject',displayName:'Subject'},{userId:'reviewer',displayName:'Reviewer'}],nextOffset:null};
			else if(u.pathname==='/api/megu/teams/demo/goals/goal') {
				if(deny){status=404;body={code:'goal_not_found'};}
				else body=access==='private'?{access,goal,updates,review,responses,capabilities:capabilities()}:{access,goal:{id:goal.id,version:1,currentVersion:1,lifecycle:goal.lifecycle,periodStart:goal.periodStart,periodEnd:goal.periodEnd},capabilities:{}};
			} else if(u.pathname==='/api/megu/team-goals/goal/transitions') {
				const input=route.request().postDataJSON();assert.equal(input.expectedRevision,goal.revision);assert.equal(input.version,goal.version);
				if(input.action==='review'&&reviewConflict){reviewConflict=false;goal.revision++;status=409;body={code:'revision_conflict'};}
				else {
					goal.revision++;
					if(input.action==='propose')goal.lifecycle='proposed';
					else if(input.action==='accept'){if(actor==='subject')goal.subjectAcceptedAt='2026-09-27T00:00:00Z';else goal.reviewerAcceptedAt='2026-09-27T00:00:00Z';if(goal.subjectAcceptedAt&&(!goal.reviewerId||goal.reviewerAcceptedAt))goal.lifecycle='active';}
					else if(input.action==='evidence'){assert.equal(input.value,10);assert.deepEqual(input.links,[]);updates=[{id:'evidence',note:input.note,value:input.value,links:[],authorName:'Subject',createdAt:'2026-09-27T00:00:00Z'}];goal.measurement.current=10;goal.achievement=100;}
					else if(input.action==='submit'){goal.selfReview=input.selfReview;goal.lifecycle='submitted';}
					else if(input.action==='return'){assert.equal(input.reason,'Add acceptance context');goal.lifecycle='active';}
					else if(input.action==='review'){assert.equal(input.explanation,'Accepted delivery evidence');assert.equal(input.nextStep,'Maintain acceptance notes');review={outcome:input.outcome,explanation:input.explanation,nextStep:input.nextStep,authorName:'Reviewer',publishedAt:'2026-09-27T01:00:00Z'};goal.lifecycle='reviewed';}
					else if(input.action==='respond'){assert.equal(input.acknowledged,true);responses=[{id:'response',authorName:'Subject',createdAt:'2026-09-27T02:00:00Z',response:input.response,acknowledged:true}];}
					else throw new Error(`Unexpected transition ${input.action}`);
					body={revision:goal.revision};
				}
			} else if(u.pathname!=='/api/developer/check'){status=404;body={code:'unexpected_api'};}
			return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
		});
		const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
		const capture=async state=>{await page.evaluate(async()=>{await document.fonts.ready;scrollTo(0,0);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,`${state}-${lang}-${theme}-${width}.png`),fullPage:true});captures++;};
		const reload=async()=>{await page.goto(`${base}/teams/demo/goals/goal`);await page.getByRole('heading',{name:access==='private'?goal.title:c.administration,exact:true}).waitFor();};
		const action=async name=>{await page.getByRole('button',{name:c.action,exact:true}).click();await page.getByRole('option',{name,exact:true}).click();};
		const labelledField=async(role,name)=>{const field=page.getByRole(role,{name});assert.equal(await field.count(),1,`${name} identifies exactly one ${role} field`);return field;};
		await reload();await page.getByRole('button',{name:c.propose,exact:true}).click();await page.getByText(c.subjectPending,{exact:true}).waitFor();await capture('agreement');
		await page.getByRole('button',{name:c.accept,exact:true}).click();await page.getByText(c.subjectAccepted,{exact:true}).waitFor();assert.equal(goal.lifecycle,'proposed');actor='reviewer';await reload();await page.getByRole('button',{name:c.accept,exact:true}).click();await page.getByText(c.state.active,{exact:true}).first().waitFor();
		actor='subject';await reload();const evidenceNote=await labelledField('textbox',c.note);await evidenceNote.fill('Accepted evidence');const reportedValue=await labelledField('spinbutton',c.current);await reportedValue.fill('10');await page.getByRole('button',{name:c.addEvidence,exact:true}).click();await page.getByText('Accepted evidence',{exact:true}).waitFor();await capture('evidence');
		const submit=async()=>{await action(c.submitReview);const selfReview=await labelledField('textbox',c.selfReview);await selfReview.fill('Delivered all accepted items');await page.getByRole('button',{name:c.submitReview,exact:true}).click();await page.getByText(c.state.submitted,{exact:true}).first().waitFor();};
		await submit();actor='reviewer';await reload();await action(c.returnGoal);const returnReason=await labelledField('textbox',c.reason);await returnReason.fill('Add acceptance context');await page.getByRole('button',{name:c.returnGoal,exact:true}).click();await page.getByText(c.returnedStatus,{exact:true}).waitFor();await capture('returned');
		actor='subject';await reload();await page.getByRole('link',{name:c.addEvidence,exact:true}).waitFor();await capture('returned-action');await submit();actor='reviewer';await reload();const explanation=await labelledField('textbox',c.explanation);const nextStep=await labelledField('textbox',c.nextStep);await explanation.fill('Accepted delivery evidence');await nextStep.fill('Maintain acceptance notes');await page.getByRole('checkbox',{name:c.publishConfirm,exact:true}).check();await page.getByRole('button',{name:c.publishReview,exact:true}).click();await page.getByRole('button',{name:c.useLatest,exact:true}).waitFor();const preservedExplanation=await labelledField('textbox',c.explanation);assert.equal(await preservedExplanation.inputValue(),'Accepted delivery evidence');assert.equal(await page.getByRole('button',{name:c.publishReview,exact:true}).isDisabled(),true);await capture('review-conflict');
		await page.getByRole('button',{name:c.useLatest,exact:true}).click();assert.equal(await page.getByRole('checkbox',{name:c.publishConfirm,exact:true}).isChecked(),false);await page.getByRole('checkbox',{name:c.publishConfirm,exact:true}).check();await page.getByRole('button',{name:c.publishReview,exact:true}).click();await page.getByText(c.state.reviewed,{exact:true}).first().waitFor();assert.equal(await page.getByRole('button',{name:c.publishReview,exact:true}).count(),0);await capture('published');
		actor='subject';await reload();const response=await labelledField('textbox',c.response);await response.fill('Acknowledged with thanks');await page.getByRole('checkbox',{name:c.acknowledge,exact:true}).check();await page.getByRole('button',{name:c.respond,exact:true}).click();await page.getByText(c.acknowledged,{exact:true}).waitFor();
		access='administration';actor='admin';await reload();const text=await page.locator('body').innerText();for(const privateText of [goal.title,'Accepted evidence','Accepted delivery evidence','Acknowledged with thanks'])assert.ok(!text.includes(privateText),'Administration excludes private terms/evidence/review/response');await capture('administration');
		access='private';actor='subject';goal.reviewerId=null;goal.lifecycle='proposed';goal.subjectAcceptedAt=null;goal.reviewerAcceptedAt=null;goal.selfReview=null;goal.measurement.current=null;goal.achievement=null;review=null;updates=[];responses=[];await reload();await page.getByText(c.personalOnly,{exact:true}).waitFor();await page.getByText(c.subjectPending,{exact:true}).waitFor();await capture('personal-tracking');await page.getByRole('button',{name:c.accept,exact:true}).click();await page.getByText(c.state.active,{exact:true}).first().waitFor();assert.equal(await page.getByRole('button',{name:c.accept,exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:c.submitReview,exact:true}).count(),0,'Personal tracking requires a reviewer before final review');
		goal.lifecycle='archived';goal.version=goal.currentVersion;await reload();await page.getByText(c.state.archived,{exact:true}).waitFor();await capture('archived');goal.currentVersion++;await reload();await page.locator('details').filter({hasText:c.historyHint}).locator('summary').click();assert.equal(await page.getByRole('link',{name:c.nextVersion,exact:true}).count(),1);await capture('history');deny=true;await page.reload();await page.getByText(c.unavailable,{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:goal.title,exact:true}).count(),0);assert.deepEqual(errors,[]);await context.close();
	}console.log(`Goal workflow browser passed: ${captures} EN/TH light/dark 390/768/1440 captures; separate acceptances, evidence, self-review/return, stale publication recovery, immutable published UI, response, administration privacy, personal tracking and access loss.`);}
	finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
