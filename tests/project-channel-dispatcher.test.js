'use strict';

const assert = require('node:assert/strict');
const core = require('../core/index.js');
const { createProjectChannelDispatcher } = require('../adapters/notifications/project-channel-dispatcher.js');

const service = core.projectChannelNotifications;
const originals = {
	claimPending: service.claimPending,
	markSent: service.markSent,
	markFailed: service.markFailed,
};

async function main() {
	const queue = [
		{ id: 'delivery-ok', guild_id: '10000000000000001', channel_id: '20000000000000001', payload: { message: 'Ready', ctaLabel: 'Open', ctaUrl: 'https://megu.test/p/AAAAAAA' }, attempts: 0 },
		{ id: 'delivery-rate-limited', guild_id: '10000000000000001', channel_id: '20000000000000002', payload: { message: 'Blocked' }, attempts: 2 },
	];
	const sends = [];
	const sent = [];
	const failed = [];
	const logs = [];
	service.claimPending = async () => queue.splice(0);
	service.markSent = async id => sent.push(id);
	service.markFailed = async (id, error, attempts) => failed.push({ id, message: error.message, attempts });

	const dispatcher = createProjectChannelDispatcher({
		sendChannel: async notice => {
			sends.push(notice);
			if (notice.channelId.endsWith('2')) throw new Error('Mock Discord rate limit');
		},
		log: message => logs.push(message),
	});
	await Promise.all([dispatcher.drain(), dispatcher.drain()]);
	assert.strictEqual(sends.length, 2, 'overlapping drains never double-claim the same queue');
	assert.deepStrictEqual(sent, ['delivery-ok']);
	assert.deepStrictEqual(failed, [{ id: 'delivery-rate-limited', message: 'Mock Discord rate limit', attempts: 2 }]);
	assert.match(logs[0], /delivery-rate-limited.*rate limit/);
	assert.deepStrictEqual(sends[0].cta, { label: 'Open', url: 'https://megu.test/p/AAAAAAA' });

	// If Discord accepted a message but persisting the acknowledgement fails, the
	// delivery remains retryable. The leased store test covers reclaim after the
	// worker dies; this verifies the adapter does not falsely report it as sent.
	service.claimPending = async () => [{ id: 'delivery-lost-ack', guild_id: '10000000000000001', channel_id: '20000000000000003', payload: { message: 'Accepted externally' }, attempts: 1 }];
	service.markSent = async () => { throw new Error('Mock acknowledgement store unavailable'); };
	service.markFailed = async (id, error, attempts) => failed.push({ id, message: error.message, attempts });
	const lostAck = createProjectChannelDispatcher({ sendChannel: async notice => sends.push(notice) });
	await lostAck.drain();
	assert.deepStrictEqual(failed.at(-1), { id: 'delivery-lost-ack', message: 'Mock acknowledgement store unavailable', attempts: 1 });

	console.log('project channel dispatcher passed — overlap, rate limits and lost acknowledgements retain explicit retry state');
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
}).finally(() => Object.assign(service, originals));
