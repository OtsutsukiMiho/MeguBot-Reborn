const assert = require('node:assert');
const oauth = require('../adapters/discord/oauth.js');

async function main() {
	const ordinary = await oauth.discordResponseError(new Response(
		JSON.stringify({ message: 'You are being rate limited.', retry_after: 2.5, global: false }),
		{ status: 429, headers: { 'retry-after': '9' } },
	), 'Discord token exchange failed');

	assert.strictEqual(ordinary.name, 'DiscordHttpError');
	assert.strictEqual(ordinary.status, 429);
	assert.strictEqual(ordinary.retryAfterMs, 2500, 'Discord JSON retry_after takes precedence');
	assert.strictEqual(ordinary.rateLimitGlobal, false);
	assert.match(ordinary.message, /You are being rate limited/);

	const headerOnly = await oauth.discordResponseError(new Response(
		'Cloudflare did not include a JSON body',
		{ status: 429, headers: { 'x-ratelimit-reset-after': '4.25' } },
	), 'Failed to read Discord profile');
	assert.strictEqual(headerOnly.retryAfterMs, 4250);

	const missingWait = await oauth.discordResponseError(new Response(
		'Too many requests',
		{ status: 429 },
	), 'Failed to read Discord servers');
	assert.strictEqual(missingWait.retryAfterMs, 60_000, 'a malformed 429 still gets a safe pause');

	const blocked = await oauth.discordResponseError(new Response(
		'{"code":40333,"message":"Cloudflare is blocking your request."}',
		{ status: 403 },
	), 'Discord token exchange failed');
	assert.strictEqual(blocked.status, 403);
	assert.match(blocked.message, /40333/);

	console.log('Discord OAuth response handling passed');
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
