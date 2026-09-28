'use strict';
// Actual Next forms with synthetic APIs; no retained data or Discord writes.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.MEGU_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.MEGU_BROWSER_BASE_URL || 'http://127.0.0.1:5056';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
(async () => {
	const browser = await chromium.launch({ headless: true, executablePath: process.env.MEGU_BROWSER_EXECUTABLE });
	const output = path.resolve('.impeccable/review/team-goal-create'); fs.mkdirSync(output, { recursive: true });
	let captures = 0;
	try { for (const lang of ['en', 'th']) for (const theme of ['light', 'dark']) for (const width of [390, 1440]) {
		const t = require(`../app/copy/${lang}`), c = t.teamGoals;
		const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
		await context.addInitScript(({ lang, theme }) => { localStorage.setItem('megu-lang', lang); localStorage.setItem('megu-theme', theme); }, { lang, theme });
		let scenario = 'server', requests = [], committed = 0;
		await context.route('**/*', async route => {
			const u = new URL(route.request().url()); if (u.origin !== new URL(base).origin) return route.abort();
			if (!u.pathname.startsWith('/api/')) return route.continue();
			let body = {}, status = 200;
			if (u.pathname === '/api/auth/me' || u.pathname === '/api/megu/me') body = { loggedIn: true, user: { id: 'subject' } };
			else if (u.pathname === '/api/megu/teams/demo') body = { team: { id: 'demo', name: 'Delivery team', archivedAt: null }, me: { userId: 'subject', role: 'member' } };
			else if (u.pathname === '/api/megu/teams/demo/members') body = { members: [{ userId: 'subject', displayName: 'Subject', role: 'member' }, { userId: 'owner', displayName: 'Owner', role: 'owner' }], nextCursor: null };
			else if (u.pathname === '/api/megu/teams/demo/goals' && route.request().method() === 'POST') {
				requests.push(route.request().postDataJSON());
				if (requests.length === 1) {
					committed++;
					if (scenario === 'transport') return route.abort('failed');
					if (scenario === 'malformed') body = {};
					else { status = 503; body = { code: 'response_unavailable' }; }
				} else if (requests.length === 2) { status = 403; body = { code: 'goal_forbidden' }; }
				else { assert.deepEqual(requests.at(-1), requests[0], 'Every retry retains the original payload and key'); body = { id: 'created', version: 1, revision: 0, lifecycle: 'draft' }; status = 201; }
			} else if (u.pathname !== '/api/developer/check') { status = 404; body = { code: 'goal_not_found' }; }
			return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
		});
		const page = await context.newPage(), dialogs = []; page.on('dialog', dialog => { dialogs.push(dialog.type()); dialog.dismiss(); });
		for (scenario of ['server', 'malformed', 'transport']) {
			requests = []; committed = 0;
			await page.goto(`${base}/teams/demo/goals/new`);
			await page.getByRole('textbox', { name: c.name, exact: true }).fill('Accepted delivery');
			await page.getByRole('textbox', { name: c.success, exact: true }).fill('Deliver work accepted by the customer');
			await page.getByLabel(c.starts, { exact: true }).fill('2026-09-01');
			await page.getByLabel(c.ends, { exact: true }).fill('2026-09-30');
			await page.getByRole('textbox', { name: c.unit, exact: true }).fill('deliveries');
			await page.getByRole('spinbutton', { name: c.baseline, exact: true }).fill('0');
			await page.getByRole('spinbutton', { name: c.target, exact: true }).fill('10');
			await page.getByRole('button', { name: c.saveDraft, exact: true }).click();
			await page.getByRole('alert').filter({ hasText: c.createUncertain }).waitFor();
			assert.equal(await page.getByRole('textbox', { name: c.name, exact: true }).isDisabled(), true);
			assert.equal(await page.getByRole('textbox', { name: c.name, exact: true }).inputValue(), 'Accepted delivery');
			assert.match(requests[0].requestKey, /^[a-zA-Z0-9_-]{16,100}$/);
			await page.getByRole('button', { name: c.retryCreate, exact: true }).click();
			await page.waitForFunction(text => document.querySelector('form')?.getAttribute('aria-busy') === 'false' && document.body.innerText.includes(text), c.createUncertain);
			assert.equal(requests.length, 2); assert.deepEqual(requests[1], requests[0], 'Lost access cannot discard an uncertain attempt');
			await page.evaluate(async () => { scrollTo(0, 0); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
			assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
			await page.screenshot({ path: path.join(output, `${scenario}-${lang}-${theme}-${width}.png`), fullPage: true }); captures++;
			await page.getByRole('button', { name: c.retryCreate, exact: true }).click();
			await page.waitForURL('**/teams/demo/goals/created');
			await page.getByRole('alert').filter({ hasText: c.unavailable }).waitFor();
			assert.equal(committed, 1); assert.equal(requests.length, 3); assert.deepEqual(requests[2], requests[0]);
			await page.goto(`${base}/teams/demo/goals`); assert.deepEqual(dialogs, [], 'Successful creation releases stale draft protection');
		}
		await context.close();
	} console.log(`Goal creation browser passed: ${captures} EN/TH theme/mobile/desktop captures; server, malformed and transport uncertainty; frozen payload, access-loss retry, one creation and guard cleanup.`); }
	finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
