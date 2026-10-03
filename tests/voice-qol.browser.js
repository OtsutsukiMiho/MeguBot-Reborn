'use strict';
// Local synthetic guild APIs only: no Discord or retained-data writes.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.MEGU_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.MEGU_BROWSER_BASE_URL || 'http://127.0.0.1:5056';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const guild = '811111111111111111', voice = '822222222222222222', text = '833333333333333333', otherGuild = '844444444444444444';
(async () => {
	const browser = await chromium.launch({ headless: true, executablePath: process.env.MEGU_BROWSER_EXECUTABLE });
	const output = path.resolve('.impeccable/review/voice-qol'); fs.mkdirSync(output, { recursive: true });
	let captures = 0;
	try {
		for (const [lang, theme, width] of [['en', 'light', 390], ['th', 'dark', 768], ['en', 'dark', 1440], ['th', 'light', 1440]]) {
			const copy = require('../app/copy/' + lang), c = copy.serverTabs.tts;
			const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
			await context.addInitScript(({ lang, theme }) => { if (!localStorage.getItem('megu-lang')) localStorage.setItem('megu-lang', lang); if (!localStorage.getItem('megu-theme')) localStorage.setItem('megu-theme', theme); }, { lang, theme });
			let config = { tts_vc_batch_window_ms: 3200, tts_waiting_room_channel_id: null, tts_vc_welcome_enabled: false, tts_vc_leave_enabled: false, tts_afk_bringback_enabled: false, tts_speaker_names_enabled: false, tts_antispam_enabled: false };
			const saves = [];
			await context.route('**/*', route => {
				const url = new URL(route.request().url()); if (url.origin !== new URL(base).origin) return route.abort();
				if (!url.pathname.startsWith('/api/')) return route.continue();
				let body = {};
				if (url.pathname === '/api/auth/me' || url.pathname === '/api/megu/me') body = { loggedIn: true, user: { id: 'manager', username: 'Manager' } };
				else if (url.pathname === '/api/guilds') body = { success: true, guilds: [{ id: guild, name: 'Voice pilot server', isBotInGuild: true, isAdmin: true }] };
				else if (url.pathname === `/api/guilds/${guild}`) body = { success: true, id: guild, name: 'Voice pilot server', isAdmin: true, config, channels: [{ id: voice, name: 'Waiting room', type: 2 }, { id: text, name: 'Text channel', type: 0 }], roles: [], members: [] };
				else if (url.pathname === `/api/guilds/${otherGuild}`) body = { success: true, id: otherGuild, name: 'Other server', isAdmin: true, config: { tts_vc_batch_window_ms: 500, tts_waiting_room_channel_id: null, tts_vc_welcome_enabled: false, tts_vc_leave_enabled: false }, channels: [], roles: [], members: [] };
				else if (url.pathname === `/api/guilds/${guild}/config`) { config = route.request().postDataJSON(); saves.push(config); body = { success: true, config }; }
				return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
			});
			const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
			await page.goto(`${base}/servers/${guild}?tab=tts`);
			const input = page.getByRole('spinbutton', { name: c.batchWindow, exact: true });
			await input.waitFor(); assert.equal(await input.inputValue(), '3.2'); assert.ok(await input.isDisabled());
			await page.getByText(c.batchDisabled, { exact: true }).waitFor();
			const select = page.getByRole('button', { name: c.waitingChannel, exact: true });
			await select.focus(); await select.press('ArrowDown');
			const list = page.getByRole('listbox', { name: c.waitingChannel, exact: true }); await list.waitFor();
			assert.equal(await list.getByRole('option').count(), 2, 'Only disabled plus supported voice channel, never text');
			await list.press('End'); assert.ok(await list.getAttribute('aria-activedescendant')); await list.press('Enter');
			assert.ok(await select.evaluate(el => el === document.activeElement), 'Selection returns focus');
			assert.ok(await input.isEnabled()); await input.fill('0.4'); assert.equal(await input.getAttribute('aria-invalid'), 'true');
			await page.getByText(c.batchInvalid, { exact: true }).waitFor();
			await input.fill('3.2'); await page.getByRole('button', { name: copy.servers.saveChanges, exact: true }).click();
			await page.getByRole('region', { name: copy.servers.unsavedTitle, exact: true }).waitFor({ state: 'hidden' });
			assert.equal(saves.length, 1); assert.equal(saves[0].tts_vc_batch_window_ms, 3200); assert.equal(saves[0].tts_waiting_room_channel_id, voice);
			await page.reload(); await input.waitFor(); assert.equal(await input.inputValue(), '3.2'); assert.ok(await input.isEnabled());
			await select.click(); await list.press('Escape'); assert.ok(await select.evaluate(el => el === document.activeElement));
			await input.scrollIntoViewIfNeeded(); await page.evaluate(() => document.fonts.ready);
			assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
			await page.screenshot({ path: path.join(output, `${lang}-${theme}-${width}.png`), fullPage: true }); captures++;
			await select.click(); await list.press('Home'); await list.press('Enter');
			assert.ok(await input.isDisabled()); assert.equal(await input.inputValue(), '3.2', 'Disabling waiting room retains the window');
			await page.getByRole('button', { name: copy.servers.saveChanges, exact: true }).click();
			await page.getByRole('region', { name: copy.servers.unsavedTitle, exact: true }).waitFor({ state: 'hidden' });
			assert.equal(saves.at(-1).tts_waiting_room_channel_id, null); assert.equal(saves.at(-1).tts_vc_batch_window_ms, 3200);
			await page.goto(`${base}/servers/${otherGuild}?tab=tts`); await input.waitFor();
			assert.equal(await input.inputValue(), '0.5', 'Server switching cannot inherit another guild window'); assert.ok(await input.isDisabled());
			await page.goto(`${base}/servers/${guild}?tab=tts`); await input.waitFor(); assert.equal(await input.inputValue(), '3.2');
			const otherLang = lang === 'en' ? 'th' : 'en', otherCopy = require('../app/copy/' + otherLang).serverTabs.tts;
			await page.evaluate(locale => localStorage.setItem('megu-lang', locale), otherLang); await page.reload();
			const translated = page.getByRole('spinbutton', { name: otherCopy.batchWindow, exact: true }); await translated.waitFor();
			assert.equal(await translated.inputValue(), '3.2'); assert.ok(await translated.isDisabled());
			assert.deepEqual(errors, []); await context.close();
		}
		console.log(`PASS: ${captures} rendered EN/TH light/dark mobile/tablet/desktop states; disabled retained value, voice-only selection, active-option/focus return, invalid input, save/reload and no overflow`);
	} finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
