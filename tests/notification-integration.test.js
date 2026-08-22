require('dotenv').config();
const assert = require('node:assert');
const core = require('../core/index.js');
const { createDispatcher } = require('../adapters/notifications/dispatcher.js');

const created = [];

/**
 * Empty the delivery queue before asserting on what a drain produces.
 *
 * This is the one suite that measures `dispatcher.drain()` itself, and a drain
 * is global: `claimPending` takes the twenty oldest deliveries that are due,
 * across every account. Suites that enqueue without draining — the payment
 * ones do, and so does anyone running `npm run merge:demo` — leave `failed`
 * rows behind that stay due forever, because nothing is retrying them hard
 * enough to reach the eighth attempt that would mark them `skipped`.
 *
 * Twenty of those in front of this suite's two rows and the drain never
 * reaches them, so the assertion below fails with `0 !== 2` and points at the
 * dispatcher, which is working perfectly. Start from a known queue instead.
 */
async function emptyTheQueue() {
	await core.db.query('DELETE FROM notification_deliveries');
	await core.db.query('DELETE FROM notification_events');
}

async function main() {
	await core.initCoreSchema();
	await emptyTheQueue();
	const discord = await core.users.loginWithIdentity({
		provider: 'discord', providerUid: '__notify_discord__', username: 'notify-discord', displayName: 'Notify Test',
	});
	const other = await core.users.loginWithIdentity({
		provider: 'google', providerUid: '__notify_claimed_google__', email: 'claimed@example.test', emailVerified: true,
		username: 'claimed@example.test', displayName: 'Other Account',
	});
	created.push(discord.user.id, other.user.id);

	const conflict = await core.users.linkIdentity(discord.user.id, {
		provider: 'google', providerUid: '__notify_claimed_google__', email: 'claimed@example.test', emailVerified: true,
	});
	assert.strictEqual(conflict.reason, 'claimed-by-another-user');

	const linked = await core.users.linkIdentity(discord.user.id, {
		provider: 'google', providerUid: '__notify_google__', email: 'notify@example.test', emailVerified: true,
		username: 'notify@example.test', displayName: 'Notify Test',
	});
	assert.strictEqual(linked.linked, true);
	assert.strictEqual((await core.users.getNotificationPreferences(discord.user.id)).mode, 'discord', 'linking must preserve the first-provider default');
	await core.users.setNotificationPreferences(discord.user.id, { mode: 'both', locale: 'th' });

	await core.notifications.enqueue({
		userId: discord.user.id,
		eventType: 'integration_test',
		dedupeKey: `integration-notification:${discord.user.id}`,
		payload: { subjectEn: 'Test', subjectTh: 'ทดสอบ', bodyEn: 'Done', bodyTh: 'สำเร็จ', ctaUrl: 'https://megu.test/a/TEST' },
	});
	const before = await core.db.query(
		`SELECT d.channel, d.status FROM notification_deliveries d
		 JOIN notification_events e ON e.id = d.event_id
		 WHERE e.user_id = $1 AND e.event_type = 'integration_test' ORDER BY d.channel`,
		[discord.user.id],
	);
	assert.deepStrictEqual(before.rows, [
		{ channel: 'discord', status: 'pending' }, { channel: 'email', status: 'pending' },
	]);

	const delivered = [];
	const dispatcher = createDispatcher({
		sendDiscord: async notice => delivered.push({ channel: 'discord', ...notice }),
		sendEmail: async notice => delivered.push({ channel: 'email', ...notice }),
	});
	await dispatcher.drain();
	assert.strictEqual(delivered.length, 2);
	assert.ok(delivered.some(item => item.channel === 'discord' && item.recipients[0] === '__notify_discord__'));
	assert.ok(delivered.some(item => item.channel === 'email' && item.to === 'notify@example.test' && item.subject === 'ทดสอบ'));

	const after = await core.db.query(
		`SELECT d.status FROM notification_deliveries d JOIN notification_events e ON e.id = d.event_id
		 WHERE e.user_id = $1 AND e.event_type = 'integration_test'`,
		[discord.user.id],
	);
	assert.ok(after.rows.every(row => row.status === 'sent'));

	assert.strictEqual((await core.users.unlinkIdentity(discord.user.id, 'google')).unlinked, true);
	assert.strictEqual((await core.users.unlinkIdentity(discord.user.id, 'discord')).reason, 'last-identity');
	console.log('notification integration passed — conflict guarded, Both delivered, final identity preserved');
}

async function cleanup() {
	for (const id of created) await core.db.query('DELETE FROM users WHERE id = $1', [id]).catch(() => undefined);
}

main().then(cleanup).then(() => core.db.close()).catch(async error => {
	console.error(error);
	await cleanup().catch(() => undefined);
	await core.db.close().catch(() => undefined);
	process.exitCode = 1;
});
