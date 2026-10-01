'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { deliverNotice, assertDelivered } = require('../adapters/notifications/discord-delivery');
const uid = '123456789012345678';
const reference = { deliveryId: 'ndl_test', channel: 'discord', attempt: 1 };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function harness(overrides = {}) {
	const sent = [], prepared = [];
	const user = { send: async notice => { sent.push(notice); } };
	const options = { users: { cache: new Map([[uid, user]]), fetch: async () => user },
		discordCall: async (_label, call, fallback) => { try { return await call(); } catch { return fallback; } },
		isBlocked: () => false, noticeComponents: (cta, defer) => [cta, defer], wait: async () => {},
		prepareWorkflow: async (ref, destination) => { prepared.push([ref, destination]); return { body: 'Fresh safe title', ctaUrl: 'https://megu.test/p/CODE?view=topics&topic=t', ctaLabel: 'Open topic' }; }, ...overrides };
	return { sent, prepared, options, user };
}
function loadDispatcher(notifications) {
	const filename = path.resolve(__dirname, '../adapters/notifications/dispatcher.js');
	const module = { exports: {} };
	vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: id => {
		if (id === '../../core/index.js') return { notifications };
		if (id === '../email/resend.js') return { send: async () => {} };
		return require(path.resolve(path.dirname(filename), id));
	} }, { filename });
	return module.exports.createDispatcher;
}
async function main() {
	for (const reply of [null, undefined, {}, { delivered: 0 }, { delivered: -1 }, { delivered: '1' }, { delivered: 1, blocked: true }]) {
		assert.throws(() => assertDelivered(reply), 'zero/unknown/blocked is never success');
	}
	assert.equal(assertDelivered({ delivered: 1, blocked: false }).delivered, 1);
	assert.throws(() => assertDelivered({ delivered: 0, outcome: 'permanent_refusal' }), e => e.permanent === true);
	assert.throws(() => assertDelivered({ delivered: 0, outcome: 'ineligible' }), e => e.ineligible === true);
	const msg = { recipients: [uid, uid], message: 'Original', cta: { label: 'Pay', url: 'https://megu.test/pay' }, defer: { label: 'Later' } };
	const normal = harness();
	assert.equal((await deliverNotice(msg, normal.options)).delivered, 1);
	assert.equal(normal.sent.length, 1);
	assert.equal(normal.sent[0].content, 'Original');
	assert.deepEqual(normal.sent[0].components, [msg.cta, msg.defer], 'existing payment/security/reminder buttons survive');
	const workflow = harness();
	assert.equal((await deliverNotice({ ...msg, workflowDelivery: reference }, workflow.options)).delivered, 1);
	assert.equal(workflow.prepared.length, 1);
	assert.equal(workflow.sent[0].content, 'Fresh safe title\nhttps://megu.test/p/CODE?view=topics&topic=t');
	assert.equal(workflow.sent[0].components[0].label, 'Open topic');
	assert.equal(workflow.sent[0].components[1], null);
	assert.deepEqual(workflow.sent[0].allowedMentions, { parse: [] });
	for (const code of [50007, 50013, 429, 'ETIMEDOUT', undefined]) {
		const h = harness(); h.user.send = async () => { throw Object.assign(new Error('simulated'), { code }); };
		const result = await deliverNotice(msg, h.options);
		assert.equal(result.delivered, 0);
		assert.equal(result.outcome, code === 50007 ? 'permanent_refusal' : 'transient_failure');
	}
	assert.equal((await deliverNotice(msg, harness({ isBlocked: () => true }).options)).delivered, 0);
	assert.equal((await deliverNotice(msg, harness({ users: { cache: new Map(), fetch: async () => { throw new Error('unavailable'); } } }).options)).outcome, 'transient_failure');
	assert.equal((await deliverNotice({ ...msg, workflowDelivery: reference }, harness({ users: { cache: new Map(), fetch: async () => null }, prepareWorkflow: async () => null }).options)).outcome, 'ineligible', 'identity loss stays terminal even if user lookup also fails');
	assert.equal((await deliverNotice({ ...msg, workflowDelivery: reference }, harness({ prepareWorkflow: async () => { throw new Error('DB unavailable'); } }).options)).outcome, 'transient_failure');
	// A real await in user fetch: access revoked while the IPC/Discord lookup waits.
	const gate = deferred(), fetched = deferred(); let eligible = true;
	const delayed = harness({ prepareWorkflow: async () => eligible ? { body: 'Private', ctaUrl: 'https://megu.test', ctaLabel: 'Open' } : null });
	delayed.options.users = { cache: new Map(), fetch: async () => { fetched.resolve(); await gate.promise; return delayed.user; } };
	const pending = deliverNotice({ ...msg, workflowDelivery: reference }, delayed.options);
	await fetched.promise; eligible = false; gate.resolve();
	assert.equal((await pending).outcome, 'ineligible');
	assert.equal(delayed.sent.length, 0, 'no stale private title sent after lookup wait');
	// Exercise the actual web IPC function without starting the web service.
	const web = fs.readFileSync(path.resolve(__dirname, '../backend/web/web.js'), 'utf8').replace(/\r\n/g, '\n');
	const start = web.indexOf('async function sendDiscordNotice('), end = web.indexOf('\n}\n', start) + 2;
	let ipcReply, ipcMessage;
	const sendWeb = vm.runInNewContext(`(${web.slice(start, end)})`, {
		require: () => ({ assertDelivered }), sendIpcRequest: async m => { ipcMessage = m; return ipcReply; },
	});
	ipcReply = { delivered: 0 }; await assert.rejects(sendWeb(msg));
	ipcReply = { delivered: 1 }; await sendWeb({ ...msg, workflowDelivery: reference });
	assert.deepEqual(ipcMessage.workflowDelivery, reference);
	// Execute the actual bot branch using injected Discord guards, no connection.
	const bot = fs.readFileSync(path.resolve(__dirname, '../backend/bot/bot.js'), 'utf8').replace(/\r\n/g, '\n');
	const branchStart = bot.indexOf("else if (msg.type === 'payment_notice') {");
	const branchEnd = bot.indexOf("else if (msg.type === 'validate_project_channel'", branchStart);
	const h = harness(); let response;
	await vm.runInNewContext(`(async () => { if (false) {} ${bot.slice(branchStart, branchEnd)} })()`, {
		msg: { ...msg, type: 'payment_notice', reqId: 'test', workflowDelivery: reference }, client: { users: h.options.users },
		discordCall: h.options.discordCall, discordBlock: { blocked: h.options.isBlocked }, noticeComponents: h.options.noticeComponents,
		setTimeout, process: { send: value => { response = value; } },
		require: id => id.includes('discord-delivery') ? { deliverNotice } : { prepareWorkflowDelivery: h.options.prepareWorkflow },
	});
	assert.equal(response.delivered, 1); assert.equal(response.reqId, 'test'); assert.equal(h.sent.length, 1);
	// Shared dispatcher consumers all require acknowledgement, and retain their payload/buttons.
	for (const eventType of ['payment_due', 'payment_due_host', 'account_merged', 'project_deadline_reminder', 'project_blocked', 'project_topic_assigned']) {
		for (const outcome of ['success', 'zero', 'refusal', 'transient', 'ineligible']) {
			const sent = [], failed = [], skipped = [], notices = [];
			const delivery = { id: 'test', event_type: eventType, channel: 'discord', discord_uid: uid, attempts: 0, payload: {} };
			const content = { body: 'body', ctaUrl: 'https://megu.test', ctaLabel: 'Open', defer: { id: 'later' }, secondaryLabel: 'Later' };
			const notifications = { claimPending: async () => [delivery], recheckClaimed: async () => true, render: () => content,
				markSent: async id => sent.push(id), markFailed: async (...args) => failed.push(args), markSkipped: async id => skipped.push(id) };
			await loadDispatcher(notifications)({ sendDiscord: async notice => {
				notices.push(notice);
				if (outcome === 'transient') throw new Error('bot IPC unavailable');
				return { delivered: outcome === 'success' ? 1 : 0, blocked: false, outcome: outcome === 'refusal' ? 'permanent_refusal' : outcome };
			} }).drain();
			assert.equal(sent.length, outcome === 'success' ? 1 : 0, eventType);
			assert.equal(skipped.length, ['refusal', 'ineligible'].includes(outcome) ? 1 : 0);
			assert.equal(failed.length, ['zero', 'transient'].includes(outcome) ? 1 : 0);
			assert.equal(Boolean(notices[0].workflowDelivery), eventType === 'project_topic_assigned');
			assert.equal(notices[0].message, 'body\nhttps://megu.test');
		}
	}
	// Independent channel delivery; email gets a second freshness check at its boundary.
	const sent = [], channels = [], notifications = {
		claimPending: async () => [{ id: 'd', event_type: 'project_topic_returned', channel: 'discord', discord_uid: uid, attempts: 0 }, { id: 'e', event_type: 'project_topic_returned', channel: 'email', email: 'test@example.test', attempts: 0 }],
		recheckClaimed: async () => true, render: () => ({ body: 'stale' }), prepareWorkflowDelivery: async () => ({ body: 'fresh', subject: 'Fresh' }),
		markSent: async id => sent.push(id), markFailed: async () => {}, markSkipped: async () => {},
	};
	await loadDispatcher(notifications)({ sendDiscord: async () => ({ delivered: 0 }), sendEmail: async m => { channels.push(m); } }).drain();
	assert.deepEqual(sent, ['e']); assert.equal(channels[0].body, 'fresh');
	channels.length = 0; sent.length = 0;
	await loadDispatcher({ ...notifications, prepareWorkflowDelivery: async () => null })({ sendDiscord: async () => ({ delivered: 0 }), sendEmail: async m => { channels.push(m); } }).drain();
	assert.equal(channels.length, 0); assert.equal(sent.length, 0, 'email identity/access loss at final boundary never sends');
	// A zero acknowledgement must also preserve the direct, non-account payment reminder.
	const filename = path.resolve(__dirname, '../adapters/notifications/payment-due.js');
	const paymentModule = { exports: {} }; let recorded = 0;
	vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: paymentModule, setTimeout, setInterval, clearTimeout, clearInterval,
		require: id => id === '../../core/index.js' ? {
			reminders: { paymentDueNow: async () => ({ notices: [{ discordUid: uid, displayName: 'fixture', payUrl: 'https://megu.test/pay' }], hostDigests: [] }), composeDueNotice: () => 'Pay', markSent: async () => { recorded++; } },
		} : { assertDelivered },
	}, { filename });
	await paymentModule.exports.createPaymentDueSweep({ sendDiscord: async () => ({ delivered: 0 }) }).runOnce();
	assert.equal(recorded, 0);
	await paymentModule.exports.createPaymentDueSweep({ sendDiscord: async () => ({ delivered: 1 }) }).runOnce();
	assert.equal(recorded, 1);
	const block = deferred(); let claims = 0;
	const dispatcher = loadDispatcher({ ...notifications, claimPending: async () => { claims++; await block.promise; return []; } })({ sendDiscord: async () => {} });
	const first = dispatcher.drain(); await dispatcher.drain(); block.resolve(); await first;
	assert.equal(claims, 1, 'overlapping dispatcher ticks do not double-claim');
	console.log('PASS: Discord acknowledgement, refusal/transient outcomes, shared consumers, actual IPC wiring, transport-time revocation, independent channels and overlapping drains');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
