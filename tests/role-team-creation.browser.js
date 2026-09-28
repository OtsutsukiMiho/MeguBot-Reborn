'use strict';
// Opt-in local browser fixture. Every API is synthetic; no Discord or membership writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.MEGU_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.MEGU_BROWSER_BASE_URL || 'http://127.0.0.1:3002';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const output = path.resolve('.impeccable/review/role-team-creation');
const guildId = '123456789012345678';

(async () => {
	fs.mkdirSync(output, { recursive: true });
	const browser = await chromium.launch({ headless: true, ...(process.env.MEGU_BROWSER_EXECUTABLE ? { executablePath: process.env.MEGU_BROWSER_EXECUTABLE } : {}) });
	const errors = []; let captures = 0;
	try {
		for (const lang of ['en', 'th']) for (const theme of ['light', 'dark']) for (const width of [390, 768, 1440]) {
			const t = require(`../app/copy/${lang}`), c = t.roleTeamCreation;
			const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
			await context.addInitScript(({ lang, theme }) => { localStorage.setItem('megu-lang', lang); localStorage.setItem('megu-theme', theme); }, { lang, theme });
			const owner = { userId: 'demo-owner', discordUserId: '223456789012345678', displayName: lang === 'th' ? 'เจ้าของทีมสาธิต' : 'Demo department owner', avatarUrl: '/megu-mark.svg' };
			const roles = [{ id: '323456789012345678', guildId, name: lang === 'th' ? 'ทีมพัฒนาระบบ' : 'Development', color: 5793266 }, { id: '323456789012345679', guildId, name: lang === 'th' ? 'ทีมบัญชี' : 'Accounting', color: 16753920 }];
			const attempts = []; let previewCalls = 0;
			await context.route('**/*', route => {
				const request = route.request(), url = new URL(request.url());
				if (url.origin !== new URL(base).origin) return route.abort();
				if (!url.pathname.startsWith('/api/')) return route.continue();
				let body, status = 200;
				if (url.pathname === '/api/auth/me') body = { loggedIn: true, user: { id: owner.userId, displayName: owner.displayName } };
				else if (url.pathname === '/api/developer/check') body = { isDeveloper: false };
				else if (url.pathname === '/api/megu/me') body = { loggedIn: true, user: { id: owner.userId }, notificationPreferences: { mode: 'off' } };
				else if (url.pathname.endsWith('/roles')) body = { guildId, roles };
				else if (url.pathname.endsWith('/owners')) body = { guild: { id: guildId, name: lang === 'th' ? 'เซิร์ฟเวอร์สาธิต' : 'Demo server' }, partial: true, candidates: [owner], nextOffset: null };
				else if (url.pathname.endsWith('/preview')) { previewCalls++; body = { preview: 'a'.repeat(64), teams: request.postDataJSON().teams.map(team => ({ ...team, roleName: roles.find(role => role.id === team.roleId).name, ownerName: owner.displayName })) }; }
				else if (url.pathname.endsWith('/create')) {
					attempts.push(request.postDataJSON());
					if (attempts.length === 1) { status = 503; body = { code: 'temporary_error' }; }
					else body = { guildId, teams: attempts[0].teams.map((team, i) => ({ id: `demo-team-${i}`, name: team.name })) };
				} else { errors.push(`Unexpected API ${url.pathname}`); status = 404; body = {}; }
				return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
			});
			const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
			await page.goto(`${base}/teams/server/${guildId}/create-from-roles`);
			await page.getByRole('button', { name: c.addRole, exact: true }).waitFor();
			assert.ok(await page.evaluate(() => document.activeElement === document.body), 'Initial load must not steal focus');
			for (const role of roles) {
				await page.getByRole('button', { name: c.addRole, exact: true }).click();
				await page.getByRole('option', { name: new RegExp(role.name) }).click();
				await page.getByRole('button', { name: `${c.owner}: ${role.name}`, exact: true }).click();
				await page.getByRole('option', { name: new RegExp(owner.displayName) }).click();
			}
			await page.getByLabel(c.teamName, { exact: true }).first().fill(lang === 'th' ? 'ทีมพัฒนาระบบภายใน' : 'Internal development team');
			await page.getByRole('link', { name: t.serverTitles.back, exact: true }).click();
			const dialog = page.getByRole('alertdialog');
			await dialog.waitFor();
			assert.ok(await dialog.evaluate(element => element.matches(':modal')), 'Native modal makes all background surfaces inert');
			assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
			assert.ok(await dialog.evaluate(element => { const box = element.getBoundingClientRect(); return Math.abs(box.y + box.height / 2 - innerHeight / 2) < 2; }), 'Confirmation stays centered despite shared styles');
			for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); assert.ok(await dialog.evaluate(element => element.contains(document.activeElement)), 'Tab stays inside confirmation'); }
			await page.evaluate(() => { window.scrollTo(0, 0); return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
			await page.screenshot({ path: path.join(output, `discard-${lang}-${theme}-${width}.png`), fullPage: true, animations: 'disabled' }); captures++;
			await page.keyboard.press('Escape');
			assert.equal(await page.evaluate(() => document.body.style.overflow), '');
			assert.ok(await page.getByRole('link', { name: t.serverTitles.back, exact: true }).evaluate(element => element === document.activeElement), 'Escape restores trigger focus');
			for (const state of ['draft', 'preview']) {
				if (state === 'preview') { await page.getByRole('button', { name: c.preview, exact: true }).click(); await page.getByRole('heading', { name: c.previewTitle }).waitFor(); }
				await page.evaluate(() => document.fonts.ready);
				await page.evaluate(() => { window.scrollTo(0, 0); return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
				assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${state}/${lang}/${width} overflow`);
				await page.screenshot({ path: path.join(output, `${state}-${lang}-${theme}-${width}.png`), fullPage: true, animations: 'disabled' }); captures++;
			}
			assert.equal(previewCalls, 1);
			await page.getByRole('button', { name: c.create, exact: true }).click();
			await page.getByRole('alert').filter({ hasText: c.uncertain }).waitFor();
			assert.equal(await page.getByRole('button', { name: c.edit, exact: true }).count(), 0, 'Ambiguous creation cannot edit the submitted request');
			assert.ok(await page.getByLabel(c.teamName, { exact: true }).first().isDisabled());
			await page.getByRole('button', { name: t.projects.retry, exact: true }).click();
			await page.getByRole('heading', { name: c.created, exact: true }).waitFor();
			assert.equal(attempts.length, 2); assert.deepEqual(attempts[0], attempts[1], 'Retry preserves payload, preview and idempotency key');
			await context.close();
		}
		assert.deepEqual(errors, []);
		console.log(`Role team browser passed: ${captures} EN/TH light/dark captures at 390/768/1440; owner selection, draft retention, preview, frozen uncertain request and same-key retry`);
	} finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
