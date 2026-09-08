'use strict';

const assert = require('node:assert/strict');
const { requestServerAction } = require('../core/server-dashboard-request');

(async () => {
	const success = await requestServerAction(async () => ({ ok: true, json: async () => ({ success: true, id: 'confirmed' }) }), '/send', {}, { failure: 'failed' });
	assert.equal(success.ok, true);
	assert.equal(success.data.id, 'confirmed', 'confirmed responses must expose reconciliable server data');

	const rejection = await requestServerAction(async () => ({ ok: false, json: async () => ({ success: false, error: 'Permission changed' }) }), '/send', {}, { failure: 'failed' });
	assert.deepStrictEqual({ ok: rejection.ok, error: rejection.error, ambiguous: rejection.ambiguous }, { ok: false, error: 'Permission changed', ambiguous: false }, 'API rejections must preserve the server reason without claiming success');

	const networkFailure = await requestServerAction(async () => { throw new TypeError('connection lost'); }, '/send', {}, { failure: 'failed', deliveryUnknown: 'Check Discord before trying again.' });
	assert.deepStrictEqual({ ok: networkFailure.ok, error: networkFailure.error, ambiguous: networkFailure.ambiguous }, { ok: false, error: 'Check Discord before trying again.', ambiguous: true }, 'ambiguous delivery failures must not invite an automatic retry');

	console.log('server dashboard requests: confirmed, rejected, and ambiguous outcomes stay distinct');
})().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
