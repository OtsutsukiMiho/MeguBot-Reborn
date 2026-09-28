'use strict';
// All API requests are synthetic; no real membership or Discord writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.MEGU_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.MEGU_BROWSER_BASE_URL || 'http://127.0.0.1:3003';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = path.resolve('.impeccable/review/team-membership-source');
(async () => {
	fs.mkdirSync(output, { recursive: true });
	const browser = await chromium.launch({ headless: true, executablePath: process.env.MEGU_BROWSER_EXECUTABLE });
	const errors = []; let captures = 0;
	try {
		for (const lang of ['en', 'th']) for (const theme of ['light', 'dark']) for (const width of [390, 768, 1440]) {
			const c = require(`../app/copy/${lang}`).teams;
			const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
			await context.addInitScript(({ lang, theme }) => { localStorage.setItem('megu-lang', lang); localStorage.setItem('megu-theme', theme); }, { lang, theme });
			const team = { id: 'demo', name: 'Development', revision: 1, role: 'owner', color: 'blue' };
			const member = { userId: 'member', displayName: lang === 'th' ? 'สมาชิกทีมพัฒนาระบบที่มีชื่อยาวสำหรับทดสอบ' : 'Development member with a long display name', joinedAt: '2026-09-01', role: 'member', avatarUrl: '/megu-mark.svg' };
			let saved = false, fail = true; const writes = [];
			await context.route('**/*', route => {
				const request = route.request(), url = new URL(request.url());
				if (url.origin !== new URL(base).origin) return route.abort();
				if (!url.pathname.startsWith('/api/')) return route.continue();
				let body, status = 200;
				if (url.pathname === '/api/auth/me') body = { loggedIn: true, user: { id: 'owner', displayName: 'Owner' } };
				else if (url.pathname === '/api/developer/check') body = { isDeveloper: false };
				else if (url.pathname === '/api/megu/me') body = { user: { id: 'owner' }, loggedIn: true };
				else if (url.pathname === '/api/megu/teams/demo') body = { team, me: { userId: 'owner', role: 'owner' }, capabilities: { canManageMembers: true } };
				else if (url.pathname.endsWith('/members/member/manual-grant')) {
					writes.push(request.postDataJSON());
					if (fail) { fail = false; status = 503; body = { code: 'temporary_error' }; }
					else { saved = true; team.revision++; body = { retained: true, revision: team.revision }; }
				} else if (url.pathname.endsWith('/members')) body = { members: [{ ...member, membershipSources: { manual: saved, discordRole: true }, canRetainManual: !saved }], total: 1, nextOffset: null };
				else { errors.push(`Unexpected API: ${url.pathname}`); status = 404; body = {}; }
				return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
			});
			const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
			await page.goto(`${base}/teams/demo/people`);
			const trigger = page.getByRole('button', { name: c.retainMember, exact: true });
			await trigger.click();
			const consent = page.getByRole('checkbox', { name: c.retainMemberConsent(member.displayName), exact: true });
			const confirm = page.getByRole('button', { name: c.confirmRetainMember, exact: true });
			assert.ok(await confirm.isDisabled()); assert.ok(!await consent.isChecked());
			await page.getByRole('button', { name: c.cancel, exact: true }).click();
			assert.ok(await trigger.evaluate(element => element === document.activeElement)); assert.equal(writes.length, 0);
			await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
			assert.ok(await consent.evaluate(element => element === document.activeElement));
			await page.keyboard.press('Space'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
			assert.ok(await confirm.evaluate(element => element === document.activeElement));
			await page.evaluate(() => document.fonts.ready);
			assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${lang}/${theme}/${width} overflow`);
			await page.screenshot({ path: path.join(output, `review-${lang}-${theme}-${width}.png`), fullPage: true }); captures++;
			await page.keyboard.press('Enter'); await page.getByRole('alert').filter({ hasText: c.errors.failed }).waitFor();
			assert.ok(await consent.isChecked(), 'Failure preserves consent');
			await confirm.click(); await page.getByText(c.memberRetained, { exact: true }).waitFor();
			assert.ok(await page.getByText(c.memberRetained, { exact: true }).evaluate(element => element === document.activeElement), 'Success preserves the keyboard position in the member row');
			await page.getByText(c.sourceBoth, { exact: true }).waitFor();
			assert.deepEqual(writes, [{ confirmed: true, expectedRevision: 1 }, { confirmed: true, expectedRevision: 1 }]);
			await context.close();
		}
		assert.deepEqual(errors, []);
		console.log(`Membership browser passed: ${captures} EN/TH light/dark responsive captures; consent, cancel focus, failure retry and refreshed sources`);
	} finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
