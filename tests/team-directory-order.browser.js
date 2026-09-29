'use strict';
const assert = require('node:assert/strict');
const { chromium } = require(process.env.MEGU_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.MEGU_BROWSER_BASE_URL || 'http://127.0.0.1:5056';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));

(async () => {
	const browser = await chromium.launch({ headless: true, executablePath: process.env.MEGU_BROWSER_EXECUTABLE });
	try {
		for (const width of [390, 1440]) {
			const context = await browser.newContext({ viewport: { width, height: 900 } });
			await context.route('**/*', route => {
				const url = new URL(route.request().url());
				if (url.origin !== new URL(base).origin) return route.abort();
				if (!url.pathname.startsWith('/api/')) return route.continue();
				let body = {};
				const guilds = [
					{ id: '1', name: 'Aardvark empty' }, { id: '2', name: 'Zephyr active' },
					{ id: '3', name: 'Beta active' }, { id: '4', name: 'Alpha empty' },
				];
				if (url.pathname === '/api/megu/me' || url.pathname === '/api/auth/me') body = { loggedIn: true, user: { id: 'owner', displayName: 'Owner' } };
				else if (url.pathname === '/api/developer/check') body = { isDeveloper: false };
				else if (url.pathname === '/api/megu/teams') body = { teams: [
					{ id: 'zephyr', name: 'Zephyr team', role: 'owner', memberCount: 1, projectCount: 0, discordGuild: guilds[1] },
					{ id: 'beta', name: 'Beta team', role: 'member', memberCount: 2, projectCount: 1, discordGuild: guilds[2] },
				] };
				else if (url.pathname === '/api/megu/teams/discord-guilds' || url.pathname === '/api/megu/teams/workspace-guilds') body = { guilds };
				return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
			});
			const page = await context.newPage();
			await page.goto(`${base}/teams`);
			await page.getByText('Alpha empty', { exact: true }).waitFor();
			const headings = await page.locator('main section[aria-labelledby^="team-group-"] > header h2').allTextContents();
			assert.deepEqual(headings, ['Beta active', 'Zephyr active', 'Aardvark empty', 'Alpha empty']);
			assert.equal(await page.getByText('No teams are connected to this server yet', { exact: true }).count(), 2);
			assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
			await context.close();
		}
		console.log('Team directory order passed: populated server groups first, deterministic names, empty server groups retained at mobile and desktop.');
	} finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
