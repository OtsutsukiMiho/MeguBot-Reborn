'use strict';
// Delayed synthetic APIs exercise real pending states without touching private data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.MEGU_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.MEGU_BROWSER_BASE_URL || 'http://127.0.0.1:5056';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = path.resolve('.impeccable/review/workspace-loading');
const gate = () => { let release; return { promise: new Promise(resolve => { release = resolve; }), release: () => release() }; };
const until = async check => { for (let i = 0; i < 120; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error('Expected request did not start'); };

(async () => {
	fs.mkdirSync(output, { recursive: true });
	const browser = await chromium.launch({ headless: true, executablePath: process.env.MEGU_BROWSER_EXECUTABLE });
	let captures = 0;
	try {
		for (const { lang, theme, width } of [{ lang: 'en', theme: 'light', width: 390 }, { lang: 'th', theme: 'dark', width: 768 }, { lang: 'en', theme: 'dark', width: 1440 }]) {
			const t = require(`../app/copy/${lang}`), c = t.teams, g = t.teamGoals, p = t.projects;
			const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
			await context.addInitScript(({ lang, theme }) => { localStorage.setItem('megu-lang', lang); localStorage.setItem('megu-theme', theme); }, { lang, theme });
			const discovery = gate(), summary = gate(), previewGoals = gate(), teamProjects = gate(), goals = gate(), goalDetail = gate(), projects = gate(), projectDetail = gate();
			const started = [], errors = [];
			let discoveryDone = false, failGoalsOnce = true, actor = 'subject', projectReads = 0;
			const team = { id: 'demo', name: lang === 'th' ? 'ทีมพัฒนาชุมชน' : 'Community development', role: 'owner', color: 'blue', description: 'A team workspace' };
			const goal = { id: 'goal', teamId: 'demo', subjectId: 'subject', reviewerId: 'reviewer', title: 'Finish the community launch', successDescription: 'Deliver the agreed result', version: 1, currentVersion: 1, revision: 2, lifecycle: 'proposed', needsReviewer: true, subjectAcceptedAt: '2026-09-20T00:00:00Z', reviewerAcceptedAt: null, timezone: 'UTC', periodStart: '2026-09-01', periodEnd: '2026-09-30', measurement: { kind: 'milestone', criteria: 'Launch accepted' } };
			await context.route('**/*', async route => {
				const u = new URL(route.request().url());
				if (u.origin !== new URL(base).origin) return route.abort();
				if (!u.pathname.startsWith('/api/')) return route.continue();
				started.push({ path: u.pathname, query: u.search, at: Date.now() });
				let body = {}, status = 200;
				if (u.pathname === '/api/auth/me' || u.pathname === '/api/megu/me') body = { loggedIn: true, user: { id: actor, displayName: actor } };
				else if (u.pathname === '/api/developer/check') body = { isDeveloper: false };
				else if (u.pathname === '/api/megu/teams' && u.searchParams.has('includeArchived')) body = { teams: [team] };
				else if (u.pathname === '/api/megu/teams') body = { teams: [team] };
				else if (u.pathname === '/api/megu/teams/discord-guilds' || u.pathname === '/api/megu/teams/workspace-guilds') { await discovery.promise; discoveryDone = true; body = { guilds: [] }; }
				else if (u.pathname === '/api/megu/teams/demo/summary') { await summary.promise; body = { team, capabilities: { canCreateProject: true, canManageJoinLink: true } }; }
				else if (u.pathname === '/api/megu/teams/demo') body = { team, me: { userId: actor, role: 'owner' }, capabilities: { canCreateProject: true } };
				else if (u.pathname === '/api/megu/teams/demo/members') body = { members: [{ userId: 'subject', displayName: 'Member', role: 'member' }, { userId: 'reviewer', displayName: 'Reviewer', role: 'admin' }, { userId: 'owner', displayName: 'Owner', role: 'owner' }], total: 3, nextOffset: null };
				else if (u.pathname === '/api/megu/teams/demo/goals/goal') { await goalDetail.promise; body = { access: actor === 'reviewer' ? 'proposal' : 'private', goal, capabilities: actor === 'reviewer' ? { canAccept: true } : {}, updates: [], review: null, responses: [] }; }
				else if (u.pathname === '/api/megu/teams/demo/goals') {
					if (u.searchParams.get('limit') === '3') await previewGoals.promise;
					if (u.searchParams.get('limit') === '30') { await goals.promise; if (failGoalsOnce) { failGoalsOnce = false; status = 503; body = { code: 'unavailable' }; } }
					if (status === 200) body = { team: { name: team.name }, goals: [{ ...goal, subjectName: 'Member', access: 'private' }], nextOffset: null };
				}
				else if (u.pathname === '/api/megu/projects') {
					if (u.searchParams.get('limit') === '30' && u.searchParams.get('teamId') === 'demo') await teamProjects.promise;
					if (!u.searchParams.has('teamId')) await projects.promise;
					body = { projects: [{ id: 'project', code: 'ABCDE', title: 'Community project', status: 'active', timezone: 'UTC', topicCount: 0, progress: 0, role: 'owner' }], nextCursor: null, hasAnyProjects: true };
				}
				else if (u.pathname === '/api/megu/projects/ABCDE') { projectReads++; await projectDetail.promise; body = { project: { id: 'project', code: 'ABCDE', title: 'Community project', status: 'active', timezone: 'UTC', progress: 0, topicCount: 0 }, topics: [], members: [], me: { userId: actor, role: 'owner' }, events: [], insights: {} }; }
				else { errors.push(`Unexpected API: ${u.pathname}`); status = 404; }
				return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
			});
			const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
			const capture = async name => { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: horizontal overflow`); await page.screenshot({ path: path.join(output, `${name}-${lang}-${theme}-${width}.png`), fullPage: true }); captures++; };
			const nav = () => width > 780 ? page.getByRole('navigation', { name: c.workspace.label }) : page.getByRole('button', { name: c.workspace.label, exact: true });
			const openSection = async key => { if (width > 780) await nav().getByRole('link', { name: c.workspace[key], exact: true }).click(); else { await nav().click(); await page.getByRole('option', { name: c.workspace[key], exact: true }).click(); } };
			const assertActive = async key => { if (width > 780) assert.equal(await nav().getByRole('link', { name: c.workspace[key], exact: true }).getAttribute('aria-current'), 'page'); else assert.ok((await nav().innerText()).includes(c.workspace[key])); assert.equal(await page.evaluate(() => window.__teamTitle === document.querySelector('main h1')), true, 'Team identity remains mounted'); assert.equal(started.filter(item => item.path.endsWith('/summary')).length, 1, 'Child navigation does not refetch Team summary'); };
			await page.goto(`${base}/teams`, { waitUntil: 'domcontentloaded' });
			await page.getByRole('heading', { name: team.name, exact: true }).waitFor();
			assert.equal(discoveryDone, false, 'Optional Discord discovery must not block the core Team list'); discovery.release();
			await page.goto(`${base}/teams/demo`, { waitUntil: 'domcontentloaded' });
			await until(() => started.some(item => item.path.endsWith('/summary')) && started.some(item => item.path === '/api/megu/projects' && item.query.includes('limit=3')) && started.some(item => item.path.endsWith('/goals') && item.query.includes('limit=3')) && started.some(item => item.path.endsWith('/members') && item.query.includes('limit=4')));
			assert.ok(await nav().isVisible()); await page.getByRole('status', { name: c.workspace.loading }).first().waitFor(); await capture('team-summary-pending');
			const summaryStart = started.find(item => item.path.endsWith('/summary')).at;
			assert.ok(started.filter(item => item.at >= summaryStart && item.at < Date.now()).some(item => item.query.includes('limit=3')), 'Preview requests start while summary is pending');
			for (const suffix of ['projects', 'goals', 'members']) assert.equal(started.filter(item => item.path.endsWith(`/${suffix}`) && item.query.includes(`limit=${suffix === 'members' ? 4 : 3}`)).length, 1, `${suffix} preview starts once`);
			summary.release(); await page.getByRole('heading', { name: team.name, exact: true }).waitFor(); await page.evaluate(() => { window.__teamTitle = document.querySelector('main h1'); });
			await page.getByText('Community project', { exact: true }).first().waitFor(); await page.getByRole('status', { name: g.loading }).first().waitFor(); await capture('team-goal-preview-pending');
			previewGoals.release(); await page.getByText(goal.title, { exact: true }).first().waitFor();
			await openSection('projects'); await page.getByRole('status', { name: c.workspace.loading }).first().waitFor(); assert.ok(await nav().isVisible()); await assertActive('projects'); await capture('team-projects-pending');
			teamProjects.release(); await page.getByText('Community project', { exact: true }).first().waitFor();
			await openSection('goals'); await page.getByRole('status', { name: g.loading }).first().waitFor(); assert.ok(await nav().isVisible()); await assertActive('goals'); await capture('goals-pending');
			goals.release(); await page.getByRole('alert').filter({ hasText: g.failed }).waitFor(); await page.getByRole('button', { name: g.retry, exact: true }).click(); await page.getByText(goal.title, { exact: true }).first().waitFor();
			await page.getByRole('link', { name: new RegExp(goal.title) }).click(); await page.getByRole('status', { name: g.loading }).first().waitFor(); assert.ok(await nav().isVisible()); await capture('goal-detail-pending');
			goalDetail.release(); await page.getByText(g.reviewerAssigned, { exact: false }).first().waitFor(); await page.getByText(g.guidance.waitingReviewer, { exact: true }).waitFor(); await page.getByText('Reviewer', { exact: true }).first().waitFor();
			actor = 'reviewer'; await page.reload(); await page.getByRole('button', { name: g.accept, exact: true }).waitFor(); await capture('reviewer-action');
			await page.goBack(); await page.goForward(); await page.getByRole('button', { name: g.accept, exact: true }).waitFor();
			await page.goto(`${base}/projects`, { waitUntil: 'domcontentloaded' }); await page.getByRole('status', { name: c.workspace.loading }).first().waitFor(); await capture('projects-pending');
			projects.release(); await page.getByText('Community project', { exact: true }).first().waitFor();
			await page.getByRole('link', { name: /Community project/ }).first().click(); await page.getByRole('status', { name: p.loadingMore }).first().waitFor(); await capture('project-detail-pending');
			projectDetail.release(); await page.getByRole('heading', { name: 'Community project', exact: true }).waitFor();
			const beforeTabs = projectReads; await page.getByRole('tab', { name: p.views.topics, exact: true }).click(); assert.equal(await page.getByRole('tab', { name: p.views.topics, exact: true }).getAttribute('aria-selected'), 'true'); assert.equal(projectReads, beforeTabs, 'Project tabs must use already-loaded workspace data');
			assert.deepEqual(errors, []); await context.close();
		}
		console.log(`Workspace loading browser passed: ${captures} delayed EN/TH light/dark captures; core Team list before optional discovery, parallel previews, localized skeletons, Retry, reviewer next action, Project tabs and responsive navigation.`);
	} finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
