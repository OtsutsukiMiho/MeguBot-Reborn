'use strict';
// Opt-in browser regression: run against a built local Next frontend; all API traffic is mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.MEGU_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.MEGU_BROWSER_BASE_URL || 'http://127.0.0.1:3002';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Browser fixture must use a local frontend');
const output = path.resolve('.impeccable/review/discord-titles');
const guildId = '123456789012345678';
const roles = [{ id: '223456789012345678', name: 'CEO' }, { id: '223456789012345679', name: 'Development' }, { id: '223456789012345680', name: 'Accounting' }];
const members = [
	{ userId: 'owner', displayName: 'Demo owner', role: 'owner', joinedAt: '2026-09-01', avatarUrl: '/megu-mark.svg' },
	{ userId: 'developer', displayName: 'Demo developer with a longer display name', role: 'member', joinedAt: '2026-09-02', avatarUrl: '/megu-mark.svg' },
];

(async () => {
	fs.mkdirSync(output, { recursive: true });
	const browser = await chromium.launch({ headless: true, ...(process.env.MEGU_BROWSER_EXECUTABLE ? { executablePath: process.env.MEGU_BROWSER_EXECUTABLE } : {}) });
	const errors = []; let captures = 0;
	try {
		for (const lang of ['en', 'th']) for (const theme of ['light', 'dark']) for (const width of [390, 768, 1440]) {
			const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
			await context.addInitScript(({ lang, theme }) => { localStorage.setItem('megu-lang', lang); localStorage.setItem('megu-theme', theme); }, { lang, theme });
			let config = { guildId, guild: { id: guildId, name: lang === 'th' ? 'เซิร์ฟเวอร์สาธิต' : 'Demo server', icon: null }, revision: 2, enabled: true, roles: roles.slice(0, 2) };
			const writes = [];
			await context.route('**/*', async route => {
				const request = route.request(); const url = new URL(request.url());
				if (url.origin !== new URL(base).origin) return route.abort();
				if (!url.pathname.startsWith('/api/')) return route.continue();
				let body; let status = 200;
				if (url.pathname === '/api/auth/me') body = { loggedIn: true, user: members[0] };
				else if (url.pathname === '/api/developer/check') body = { isDeveloper: false };
				else if (url.pathname === '/api/megu/me') body = { loggedIn: true, user: members[0], notificationPreferences: { mode: 'off' } };
				else if (url.pathname.endsWith('/title-roles')) {
					if (request.method() === 'POST') {
						const input = request.postDataJSON(); writes.push(input);
						if (input.expectedRevision !== config.revision) { status = 409; body = { code: 'revision_conflict' }; }
						else { config = { ...config, revision: config.revision + 1, roles: roles.filter(role => input.roleIds.includes(role.id)), enabled: input.roleIds.length > 0 }; body = config; }
					} else body = config;
				} else if (url.pathname.endsWith('/roles')) body = { guildId, roles };
				else if (url.pathname === '/api/megu/teams/demo') body = { team: { id: 'demo', name: lang === 'th' ? 'ทีมพัฒนาสาธิต' : 'Demo development team', color: 'blue', role: 'owner', revision: 1, discordGuild: config.guild }, me: { userId: 'owner', role: 'owner' }, capabilities: { canManageAdmins: true, canManageMembers: true } };
				else if (url.pathname === '/api/megu/teams/demo/members') body = { members, total: 2, nextOffset: null };
				else if (url.pathname.endsWith('/member-titles')) body = { members: url.searchParams.getAll('userId').map(userId => ({ userId, titles: [{ roleId: userId === 'owner' ? roles[0].id : roles[1].id, name: userId === 'owner' ? 'CEO' : lang === 'th' ? 'นักพัฒนาและผู้ดูแลระบบภายในองค์กร' : 'Development and internal systems' }] })) };
				else { errors.push(`Unexpected fixture API: ${url.pathname}`); status = 404; body = {}; }
				return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
			});
			const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
			const c = require(`../app/copy/${lang}`).serverTitles;
			const p = require(`../app/copy/${lang}`).projects;
			for (const [surface, route] of [['settings', `/teams/server/${guildId}/titles`], ['people', '/teams/demo/people']]) {
				await page.goto(base + route); await page.getByRole('heading', { level: 1 }).waitFor();
				if (surface === 'settings') await page.getByRole('button', { name: `${c.remove}: CEO`, exact: true }).waitFor();
				else await page.getByRole('list', { name: c.badgesLabel }).first().waitFor();
				await page.evaluate(() => document.fonts.ready);
				assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${surface}/${lang}/${theme}/${width}: horizontal overflow`);
				await page.screenshot({ path: path.join(output, `${surface}-${lang}-${theme}-${width}.png`), fullPage: true, animations: 'disabled' }); captures++;
				if (surface === 'settings') {
					await page.getByRole('button', { name: `${c.remove}: CEO`, exact: true }).click();
					await page.getByRole('button', { name: c.reset, exact: true }).click();
					const keep = page.getByRole('alertdialog').getByRole('button', { name: p.keepEditing, exact: true });
					await keep.waitFor();
					assert.ok(await keep.evaluate(element => element === document.activeElement), 'Keep editing receives keyboard focus');
					assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Confirmation does not overflow');
					await page.screenshot({ path: path.join(output, `confirmation-${lang}-${theme}-${width}.png`), fullPage: true, animations: 'disabled' }); captures++;
					await page.keyboard.press('Escape');
					assert.ok(await page.getByRole('button', { name: c.reset, exact: true }).evaluate(element => element === document.activeElement), 'Escape restores trigger focus');
					await page.getByRole('link', { name: c.back, exact: true }).click();
					await page.getByRole('alertdialog').getByRole('button', { name: p.keepEditing, exact: true }).click();
					assert.ok(page.url().endsWith('/titles'), 'Cancelling Back retains the draft page');
					await page.getByRole('button', { name: c.reset, exact: true }).click();
					await page.getByRole('alertdialog').getByRole('button', { name: p.discardChanges, exact: true }).click();
					await page.getByRole('button', { name: `${c.remove}: CEO`, exact: true }).waitFor();
				}
			}
			if (lang === 'en' && theme === 'dark' && width === 1440) {
				await page.goto(`${base}/teams/server/${guildId}/titles`);
				const save = page.getByRole('button', { name: c.save, exact: true });
				await page.getByRole('button', { name: `${c.remove}: CEO`, exact: true }).waitFor();
				assert.equal(await save.isDisabled(), true);
				await page.getByRole('button', { name: c.addRole, exact: true }).click();
				await page.getByRole('option', { name: /Accounting/ }).click();
				await save.click(); await page.getByText(c.saved, { exact: true }).waitFor();
				assert.equal(writes.length, 1); assert.equal(writes[0].expectedRevision, 2); assert.equal(writes[0].roleIds.length, 3);
				await page.getByRole('button', { name: `${c.remove}: CEO`, exact: true }).click();
				config.revision++;
				await save.click(); await page.getByText(c.changed, { exact: true }).first().waitFor();
				assert.equal(await save.isDisabled(), true, 'Stale draft must not be resubmitted');
				await page.getByRole('button', { name: c.reset, exact: true }).click();
				await page.getByRole('alertdialog').getByRole('button', { name: require('../app/copy/en').projects.keepEditing, exact: true }).click();
				assert.equal(await page.getByRole('button', { name: `${c.remove}: CEO`, exact: true }).count(), 0, 'Cancelling discard keeps the draft');
				await page.getByRole('button', { name: c.reset, exact: true }).click();
				await page.getByRole('alertdialog').getByRole('button', { name: require('../app/copy/en').projects.discardChanges, exact: true }).click();
				await page.getByRole('button', { name: `${c.remove}: CEO`, exact: true }).waitFor();
			}
			await context.close();
		}
		assert.deepEqual(errors, []);
		console.log(`Title browser fixtures passed: ${captures} captures, EN/TH light/dark at 390/768/1440, save/stale/discard interaction; no real API writes`);
	} finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
