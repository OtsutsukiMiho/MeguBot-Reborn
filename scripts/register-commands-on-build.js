#!/usr/bin/env node
// Register the slash commands once per deploy, as part of `npm run build`.
//
// Registering on every boot was the wrong place for it: a service that wakes
// from hibernate all day would send the same request all day (see
// DISCORD-RATE-LIMITS.md). But leaving it to someone remembering `npm run
// deploy` after each release meant a new command could sit in the code for
// days while Discord still showed the old list. A build happens once per
// deploy and never on a wake, so it is where one request belongs.
//
// It only runs on the host. A build on a laptop has the test bot's token in
// `.env`, and registering that bot's commands globally on every local build is
// traffic nobody asked for. Render sets RENDER=true; anywhere else can opt in
// with MEGU_REGISTER_COMMANDS=1, and MEGU_REGISTER_COMMANDS=0 turns it off.
//
// It never fails the build. A release that cannot reach Discord should still
// ship; the old command list stays in place until the next deploy. If Discord
// is blocking the IP, deploy-commands.js recognises it and stops after the one
// refused request.

require('dotenv').config();

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const flag = String(process.env.MEGU_REGISTER_COMMANDS || '').trim();
const onHost = process.env.RENDER === 'true';

if (flag === '0' || (!onHost && flag !== '1')) {
	const why = flag === '0' ? 'MEGU_REGISTER_COMMANDS=0' : 'not on the host';
	console.log(`[build] Skipping slash command registration (${why}). Use \`npm run deploy\` to register by hand.`);
	process.exit(0);
}

if (!process.env.BOT_TOKEN) {
	console.log('[build] Skipping slash command registration: BOT_TOKEN is not available during the build.');
	process.exit(0);
}

const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'deploy-commands.js')], { stdio: 'inherit' });

if (result.status !== 0) {
	console.log(`[build] Slash command registration did not finish (exit ${result.status}). The build carries on with the previous command list.`);
}
