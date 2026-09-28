'use strict';
// Synthetic local API; actual Next UI and permission-loss states.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.MEGU_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.MEGU_BROWSER_BASE_URL || 'http://127.0.0.1:5056';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
(async () => {
	const browser = await chromium.launch({ headless: true, executablePath: process.env.MEGU_BROWSER_EXECUTABLE });
	const output = path.resolve('.impeccable/review/team-goal-reference'); fs.mkdirSync(output, { recursive: true }); let captures = 0;
	try { for (const lang of ['en', 'th']) for (const theme of ['light', 'dark']) for (const width of [390, 1440]) {
		const t = require(`../app/copy/${lang}`), c = t.teamGoals;
		const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
		await context.addInitScript(({ lang, theme }) => { localStorage.setItem('megu-lang', lang); localStorage.setItem('megu-theme', theme); }, { lang, theme });
		let denied = true, updates = [];
		const goal = { id: 'goal', teamId: 'demo', subjectId: 'subject', reviewerId: 'owner', title: 'Delivery agreement', successDescription: 'Accepted delivery', version: 1, currentVersion: 1, revision: 3, lifecycle: 'active', timezone: 'UTC', periodStart: '2026-09-01', periodEnd: '2026-09-30', measurement: { kind: 'milestone', criteria: 'Accepted' }, achievement: null };
		await context.route('**/*', route => {
			const u = new URL(route.request().url()); if (u.origin !== new URL(base).origin) return route.abort(); if (!u.pathname.startsWith('/api/')) return route.continue();
			let body = {}, status = 200;
			if (u.pathname === '/api/auth/me' || u.pathname === '/api/megu/me') body = { loggedIn: true, user: { id: 'subject' } };
			else if (u.pathname === '/api/megu/teams/demo/goals/goal') body = { access: 'private', goal, updates, responses: [], review: null, capabilities: { canAddEvidence: true } };
			else if (u.pathname === '/api/megu/team-goals/goal/transitions') {
				const payload = route.request().postDataJSON(); assert.equal(payload.expectedRevision, 3); assert.equal(payload.note, 'Accepted evidence'); assert.deepEqual(payload.reference, { projectCode: 'ABCDE', topicId: 'top_123' });
				if (denied) { status = 422; body = { code: 'goal_reference_unavailable' }; }
				else { goal.revision = 4; updates = [{ id: 'update', note: payload.note, links: [], authorName: 'Subject', createdAt: '2026-09-27T00:00:00Z', reference: { access: 'available', projectCode: 'ABCDE', title: 'Authorized delivery project', topicId: 'top_123', topicTitle: 'Accepted topic' } }]; body = { revision: 4 }; }
			} else if (u.pathname !== '/api/developer/check') { status = 404; body = { code: 'not_found' }; }
			return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
		});
		const page = await context.newPage();
		const capture = async state => { await page.evaluate(async () => { scrollTo(0, 0); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: path.join(output, `${state}-${lang}-${theme}-${width}.png`), fullPage: true }); captures++; };
		await page.goto(`${base}/teams/demo/goals/goal`);
		await page.getByRole('textbox', { name: c.note, exact: true }).fill('Accepted evidence');
		const input = page.getByRole('textbox', { name: c.referenceLink, exact: false });
		await input.fill(`${base}/p/ABCDE?topic=top_123`); await page.getByRole('button', { name: c.addEvidence, exact: true }).click();
		await page.getByRole('alert').filter({ hasText: c.referenceDenied }).waitFor();
		assert.equal(await input.inputValue(), `${base}/p/ABCDE?topic=top_123`); assert.equal(await page.getByRole('textbox', { name: c.note, exact: true }).inputValue(), 'Accepted evidence'); await capture('denied');
		denied = false; await page.getByRole('button', { name: c.addEvidence, exact: true }).click();
		await page.getByRole('link', { name: 'Authorized delivery project · Accepted topic', exact: true }).waitFor();
		assert.equal(await page.getByRole('link', { name: 'Authorized delivery project · Accepted topic', exact: true }).getAttribute('href'), '/p/ABCDE?topic=top_123'); await capture('linked');
		updates[0].reference = { access: 'unavailable' }; await page.reload(); await page.getByText(c.referenceUnavailable, { exact: true }).waitFor();
		assert.equal(await page.getByRole('link', { name: /Authorized delivery/ }).count(), 0); assert.ok(!(await page.locator('body').innerText()).includes('Accepted topic')); await capture('redacted');
		await context.close();
	} console.log(`Goal reference browser passed: ${captures} EN/TH theme/mobile/desktop captures, denied-save retention, authorized link and permission-loss redaction.`); }
	finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
