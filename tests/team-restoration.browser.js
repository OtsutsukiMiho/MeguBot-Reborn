'use strict';
// Opt-in synthetic browser fixture: no real accounts, Discord or membership writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.MEGU_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.MEGU_BROWSER_BASE_URL || 'http://127.0.0.1:3002';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = path.resolve('.impeccable/review/team-restoration');

(async () => {
	fs.mkdirSync(output, { recursive: true });
	const browser = await chromium.launch({ headless: true, ...(process.env.MEGU_BROWSER_EXECUTABLE ? { executablePath: process.env.MEGU_BROWSER_EXECUTABLE } : {}) });
	const errors = []; let captures = 0;
	try {
		for (const lang of ['en', 'th']) for (const theme of ['light', 'dark']) for (const width of [390, 768, 1440]) {
			const t = require(`../app/copy/${lang}`), c = t.teams, r = t.roleMappings;
			const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
			await context.addInitScript(({ lang, theme }) => { localStorage.setItem('megu-lang', lang); localStorage.setItem('megu-theme', theme); }, { lang, theme });
			const person = { userId: 'returning', discordUserId: '223456789012345678', displayName: lang === 'th' ? 'สมาชิกทีมพัฒนาระบบที่ขอกลับเข้าร่วมอีกครั้ง' : 'Returning development team member with a long name', avatarUrl: '/megu-mark.svg', linkedAccount: true, restoreRequired: true, requestId: 'request' };
			const team = { id: 'demo', name: lang === 'th' ? 'ทีมพัฒนาสาธิต' : 'Demo development team', color: 'blue', role: 'owner', revision: 1, discordGuild: { id: '123456789012345678', name: 'Demo server' } };
			const writes = []; let approved = false, roleApproved = false, failOnce = true;
			await context.route('**/*', route => {
				const request = route.request(), url = new URL(request.url());
				if (url.origin !== new URL(base).origin) return route.abort();
				if (!url.pathname.startsWith('/api/')) return route.continue();
				let body, status = 200;
				if (url.pathname === '/api/auth/me') body = { loggedIn: true, user: { id: 'owner', displayName: 'Demo owner' } };
				else if (url.pathname === '/api/developer/check') body = { isDeveloper: false };
				else if (url.pathname === '/api/megu/me') body = { loggedIn: true, user: { id: 'owner' }, notificationPreferences: { mode: 'off' } };
				else if (url.pathname === '/api/megu/teams/demo') body = { team, me: { userId: 'owner', role: 'owner' }, capabilities: { canManageJoinLink: true, canManageMembers: true, canBrowseDiscordMembers: true } };
				else if (url.pathname.endsWith('/join-requests/request')) {
					writes.push(request.postDataJSON());
					if (failOnce) { failOnce = false; status = 503; body = { code: 'temporary_error' }; }
					else { approved = true; body = { status: 'approved' }; }
				} else if (url.pathname.endsWith('/join-requests')) body = { teamRevision: 1, requests: approved ? [] : [{ ...person, id: 'request', requestedAt: '2026-09-22T00:00:00Z' }], link: null };
				else if (url.pathname.endsWith('/discord-candidates')) body = { candidates: [person], roles: [], total: 1, nextOffset: null };
				else if (url.pathname.endsWith('/member-titles')) body = { members: [] };
				else if (url.pathname.endsWith('/role-mapping/members')) {
					if (request.method() === 'POST') { writes.push(request.postDataJSON()); roleApproved = true; body = { status: 'approved' }; }
					else body = { revision: 1, teamRevision: 1, partial: true, candidates: [{ ...person, teamRole: roleApproved ? 'member' : null }], nextOffset: null };
				} else if (url.pathname.endsWith('/role-mapping')) body = { mapping: { id: 'mapping', enabled: true, revision: 1, mode: 'approval', roles: [{ id: 'role', name: 'Development' }] } };
				else if (url.pathname.endsWith('/role-mapping/sync')) body = { supported: false, reason: 'sync_disabled' };
				else if (url.pathname.endsWith('/members')) body = { members: [], total: 0, nextOffset: null };
				else { errors.push(`Unexpected API ${url.pathname}`); status = 404; body = {}; }
				return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
			});
			const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
			async function capture(state) {
				await page.evaluate(() => document.fonts.ready);
				await page.evaluate(() => { window.scrollTo(0, 0); return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
				assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${state}/${lang}/${width} overflows`);
				await page.screenshot({ path: path.join(output, `${state}-${lang}-${theme}-${width}.png`), fullPage: true, animations: 'disabled' }); captures++;
			}
			await page.goto(`${base}/teams/demo/people`);
			await page.getByRole('button', { name: c.reviewMemberRestore, exact: true }).click();
			await page.waitForURL('**/teams/demo/join-requests');
			const approve = page.getByRole('button', { name: c.restoreMember, exact: true });
			await approve.waitFor(); assert.ok(await approve.isDisabled());
			assert.equal(writes.length, 0, 'Discovery never restores someone without reviewing the request');
			await capture('requests');
			const consent = page.getByRole('checkbox', { name: c.memberRestoreConsent, exact: true });
			for (let tabs = 0; tabs < 40 && !await consent.evaluate(element => element === document.activeElement); tabs++) await page.keyboard.press('Tab');
			assert.ok(await consent.evaluate(element => element === document.activeElement), 'Consent is reachable through natural Tab navigation');
			await page.keyboard.press('Space');
			assert.ok(await consent.isChecked()); assert.ok(await approve.isEnabled());
			await page.keyboard.press('Tab');
			assert.ok(await approve.evaluate(element => element === document.activeElement), 'Forward Tab reaches Restore after consenting');
			await page.keyboard.press('Enter'); await page.getByRole('alert').filter({ hasText: c.errors.failed }).waitFor();
			assert.ok(await consent.isChecked(), 'A network failure preserves the explicit choice for retry');
			await approve.click(); await page.getByText(c.noRequests, { exact: true }).waitFor();
			assert.equal(writes.length, 2); assert.deepEqual(writes[0], writes[1]); assert.equal(writes[0].confirmRestore, true);
			assert.equal(writes[0].expectedRevision, 1);
			await page.goto(`${base}/teams/demo/settings`);
			await page.getByRole('button', { name: r.preview, exact: true }).click();
			await page.getByRole('button', { name: r.reviewRestore, exact: true }).click();
			assert.ok(await page.getByRole('button', { name: r.reviewRestore, exact: true }).evaluate(element => element === document.activeElement), 'Disclosure retains its trigger focus');
			await page.getByText(r.restoreHint, { exact: true }).waitFor();
			await capture('role-restore');
			await page.getByRole('button', { name: c.cancel, exact: true }).click();
			assert.equal(writes.length, 2, 'Cancel does not restore');
			assert.ok(await page.getByRole('button', { name: r.reviewRestore, exact: true }).evaluate(element => element === document.activeElement), 'Cancel restores disclosure focus');
			await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
			assert.ok(await page.getByRole('button', { name: c.cancel, exact: true }).evaluate(element => element === document.activeElement));
			await page.keyboard.press('Tab');
			assert.ok(await page.getByRole('button', { name: `${r.confirmRestore}: ${person.displayName}`, exact: true }).evaluate(element => element === document.activeElement), 'Disclosed action follows Cancel in natural Tab order');
			await page.keyboard.press('Enter');
			await page.getByText(r.memberApproved(person.displayName), { exact: true }).waitFor();
			assert.equal(writes[2].restoreRemoved, true);
			assert.equal(writes[2].expectedTeamRevision, 1);
			await context.close();
		}
		assert.deepEqual(errors, []);
		console.log(`Team restoration browser passed: ${captures} captures; EN/TH, light/dark, 390/768/1440; discovery routing, keyboard consent, failed retry, role restore/cancel`);
	} finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
