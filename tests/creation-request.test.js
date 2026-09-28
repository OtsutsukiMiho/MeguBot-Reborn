'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

function storage() {
	const values = {};
	Object.defineProperties(values, {
		getItem: { value: key => values[key] ?? null },
		setItem: { value: (key, value) => { values[key] = value; } },
		removeItem: { value: key => { delete values[key]; } },
	});
	return values;
}
function harness(url, { store = storage(), actorId = 'actor-a', scope = 'directory', transport, now = Date.now() } = {}) {
	const hooks = [], sent = []; let cursor = 0, receive, effects = [];
	const react = {
		useRef(value) { const i = cursor++; return hooks[i] ||= { current: value }; },
		useState(value) { const i = cursor++; if (!(i in hooks)) hooks[i] = value; return [hooks[i], next => { hooks[i] = next; }]; },
		useEffect(run, deps) { const i = cursor++; if (!hooks[i] || deps.some((value, index) => value !== hooks[i][index])) { hooks[i] = deps; effects.push(run); } },
	};
	const module = { exports: {} };
	const source = fs.readFileSync(require.resolve('../app/components/useCreationRequest'), 'utf8')
		.replace("import { useEffect, useRef, useState } from 'react';", 'const { useEffect, useRef, useState } = react;')
		.replace('export default function', 'function') + '\nmodule.exports = useCreationRequest;';
	vm.runInNewContext(source, { module, react, crypto, sessionStorage: store, Date: { now: () => now }, fetch: (target, options) => {
		assert.equal(target, url); assert.equal(options.credentials, 'same-origin');
		const payload = JSON.parse(options.body);
		assert.ok(Object.keys(store).some(key => JSON.parse(store[key]).requestKey === payload.requestKey), 'Attempt must persist before sending');
		sent.push(payload);
		if (transport) return transport(target, options);
		return new Promise((resolve, reject) => { receive = { resolve, reject }; });
	} });
	return { store, sent, render() {
		cursor = 0; let value = module.exports(url, { actorId, scope });
		if (effects.length) { const queued = effects; effects = []; queued.forEach(run => run()); cursor = 0; value = module.exports(url, { actorId, scope }); }
		return value;
	}, respond(status, data) { receive.resolve({ ok: status < 400, status, json: async () => data }); }, lose() { receive.reject(new Error('response lost')); } };
}
async function main() {
	for (const kind of ['teams', 'projects']) {
		const url = '/api/megu/' + kind, payload = kind === 'teams' ? { name: 'Original', description: '' } : { title: 'Original', description: '', teamId: null };
		const h = harness(url); let view = h.render();
		const first = view.submit(payload);
		assert.equal(await view.submit(payload), null, 'Immediate double-submit sends once');
		assert.equal(h.render().frozen, true);
		// Reload while fetch is still unresolved; navigation back is the same fresh mount.
		const during = harness(url, { store: h.store });
		assert.equal(during.render().restored.title || during.render().restored.name, 'Original');
		const duringRetry = during.render().submit(payload);
		assert.equal(during.sent[0].requestKey, h.sent[0].requestKey);
		during.lose(); await assert.rejects(duringRetry); h.lose(); await assert.rejects(first);
		for (const status of [401, 403, 409, 422]) {
			const retry = h.render().submit({ ...payload, description: 'External edit' });
			h.respond(status, { code: 'denied' }); await assert.rejects(retry);
			assert.deepEqual(h.sent.at(-1), h.sent[0], 'Mounted ambiguity remains frozen');
		}
		const remount = harness(url, { store: h.store });
		const retry = remount.render().submit(payload);
		assert.equal(remount.sent[0].requestKey, h.sent[0].requestKey, 'Lost acknowledgement then remount retains original key');
		remount.respond(201, { id: 'original' }); await retry;
		assert.equal(Object.keys(h.store).length, 0, 'Success retires persisted attempt');
		assert.equal(await remount.render().submit(payload), null, 'Success stays immediately latched');
		const fresh = harness(url, { store: h.store }), second = fresh.render().submit(payload);
		assert.notEqual(fresh.sent[0].requestKey, h.sent[0].requestKey);
		fresh.respond(422, { code: 'validation_failed' }); await assert.rejects(second);
		assert.equal(Object.keys(h.store).length, 0); assert.equal(fresh.render().frozen, false);
		const corrected = fresh.render().submit({ ...payload, description: 'Corrected' }); fresh.respond(201, {}); await corrected;
		for (const status of [401, 403, 409]) {
			const denied = harness(url), request = denied.render().submit(payload);
			denied.respond(status, {}); await assert.rejects(request); assert.equal(Object.keys(denied.store).length, 0);
		}
		const ambiguous = harness(url), request = ambiguous.render().submit(payload);
		ambiguous.respond(503, {}); await assert.rejects(request);
		const changed = harness(url, { store: ambiguous.store }), newRequest = changed.render().submit({ ...payload, description: 'New intent' });
		assert.notEqual(changed.sent[0].requestKey, ambiguous.sent[0].requestKey); changed.lose(); await assert.rejects(newRequest);
		for (const options of [{ actorId: 'actor-b' }, { scope: 'parent-b' }]) {
			const isolated = harness(url, { store: ambiguous.store, ...options });
			assert.equal(isolated.render().restored, null);
			if (options.actorId) assert.ok(!Object.keys(ambiguous.store).some(key => JSON.parse(ambiguous.store[key]).actorId === 'actor-a'), 'Account switch removes prior actor draft from this browser session');
			const pending = isolated.render().submit(payload); assert.notEqual(isolated.sent[0].requestKey, changed.sent[0].requestKey); isolated.lose(); await assert.rejects(pending);
		}
		const otherKind = harness('/api/megu/' + (kind === 'teams' ? 'projects' : 'teams'), { store: ambiguous.store });
		assert.equal(otherKind.render().restored, null);
		const expired = harness(url, { store: ambiguous.store, now: Date.now() + 8 * 86400000 });
		assert.equal(expired.render().restored, null); assert.equal(Object.keys(ambiguous.store).length, 0);
		const expiredRequest = expired.render().submit(payload); assert.notEqual(expired.sent[0].requestKey, changed.sent[0].requestKey); expired.lose(); await assert.rejects(expiredRequest);
		assert.equal(expired.render().abandon(), true); assert.equal(Object.keys(ambiguous.store).length, 0);
		const unavailable = harness(url, { store: { getItem() { throw Error('blocked'); } } });
		await assert.rejects(unavailable.render().submit(payload)); assert.equal(unavailable.sent.length, 0);
		const writeBlocked = harness(url, { store: { getItem() { return null; }, setItem() { throw Error('quota'); } } });
		await assert.rejects(writeBlocked.render().submit(payload)); assert.equal(writeBlocked.sent.length, 0); assert.equal(writeBlocked.render().frozen, false, 'A failed pre-send persistence must not freeze an editable form');
	}
	// A project under the SAME actual team must recover across both entry routes.
	for (const [from, to] of [['directory', 'team-a'], ['team-a', 'directory']]) {
		const payload = { title: 'Same team intent', teamId: 'team-a' }, url = '/api/megu/projects';
		const origin = harness(url, { scope: from }), request = origin.render().submit(payload);
		origin.lose(); await assert.rejects(request);
		const restored = harness(url, { store: origin.store, scope: to });
		assert.equal(restored.render().restored.teamId, 'team-a');
		const retry = restored.render().submit(payload); assert.equal(restored.sent[0].requestKey, origin.sent[0].requestKey);
		restored.lose(); await assert.rejects(retry);
		const otherParent = harness(url, { store: origin.store, scope: 'team-b' });
		assert.equal(otherParent.render().restored, null);
		const other = otherParent.render().submit({ ...payload, teamId: 'team-b' });
		assert.notEqual(otherParent.sent[0].requestKey, origin.sent[0].requestKey); otherParent.respond(201, {}); await other;
		const parentB = harness(url, { store: origin.store, scope: 'team-b' }), unresolvedB = parentB.render().submit({ ...payload, teamId: 'team-b' });
		parentB.lose(); await assert.rejects(unresolvedB);
		const directory = harness(url, { store: origin.store });
		const chooseA = directory.render().submit(payload);
		assert.equal(directory.sent[0].requestKey, origin.sent[0].requestKey, 'Choosing original parent recovers its key even when another draft was restored');
		directory.lose(); await assert.rejects(chooseA);
		assert.equal(harness(url, { store: origin.store, scope: 'team-a' }).render().restored.teamId, 'team-a', 'Other parent success cannot erase unresolved original intent');
	}
	const project = fs.readFileSync(require.resolve('../app/components/projects/CreateProject'), 'utf8');
	assert.match(project, /if \(pending.current\) return/); assert.match(project, /if \(pending.current \|\| frozen\) return/);
	for (const tag of ['input', 'textarea', 'fieldset']) assert.match(project, new RegExp('<' + tag + ' disabled=\\{frozen\\}'));
	assert.match(project, /disabled=\{lockTeam \|\| frozen\}/);
	for (const file of ['../app/components/projects/CreateProject', '../app/components/teams/TeamDirectory']) {
		const source = fs.readFileSync(require.resolve(file), 'utf8');
		assert.match(source, /const leave = \(\) => \{ if \(abandon\(\)\) onCancel\(\); \}/);
		assert.match(source, /requestDraftNavigation\(leave\)/);
	}
	console.log('Creation client recovery PASS: persist-before-fetch, reload/navigation, frozen retries, actor/kind/parent isolation, replacement, success/denial cleanup, expiry and storage failure.');
}
module.exports = { harness, storage };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
