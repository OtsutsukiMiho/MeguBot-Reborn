'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const express = require('express');
const cookieParser = require('cookie-parser');
const { isDisposableTestDatabase } = require('./test-database');
process.env.PG_POOL_MAX = '4';
const db = require('../core/db');
const { initCoreSchema } = require('../core/schema');
const teams = require('../core/teams');
const projects = require('../core/projects');
const keys = [], users = [], prefix = `creation_${Date.now()}`;
const key = () => { const value = randomUUID(); keys.push(value); return value; };
const receipts = async value => Number((await db.query('SELECT count(*) AS n FROM workspace_creations WHERE request_key=$1', [value])).rows[0].n);

function failingService(kind, requestKey) {
	const file = require.resolve('../core/' + (kind === 'team' ? 'teams' : 'projects'));
	const local = createRequire(file), module = { exports: {} };
	vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, process, Buffer,
		require: name => name === './db.js' ? { ...db, transaction: run => db.transaction(client => run({
			query(sql, values) {
				if (sql.startsWith('INSERT INTO workspace_creations') && values[0] === requestKey) throw new Error('Injected receipt persistence failure');
				return client.query(sql, values);
			},
		})) } : local(name),
	});
	return module.exports[kind === 'team' ? 'createTeam' : 'createProject'];
}

async function main() {
	assert.ok(isDisposableTestDatabase(process.env.MEGU_DATABASE_URL), 'Explicit canonical disposable local database required');
	await initCoreSchema();
	const owner = prefix + '_owner', other = prefix + '_other'; users.push(owner, other);
	for (const id of users) await db.query('INSERT INTO users(id,display_name) VALUES ($1,$1)', [id]);
	let server;
	try {
		for (const kind of ['team', 'project']) {
			const create = kind === 'team' ? teams.createTeam : projects.createProject;
			const field = kind === 'team' ? 'name' : 'title';
			const input = { ownerUserId: owner, [field]: `${prefix}_${kind}`, requestKey: key() };
			// Force two different native connections to wait behind the same receipt lock.
			const gate = await db.getPool().connect(); await gate.query('BEGIN');
			await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`workspace-creation:${input.requestKey}`]);
			const first = create(input), concurrent = create({ ...input });
			try {
				let waiters = 0;
				for (let i = 0; i < 50 && waiters < 2; i++) {
					waiters = Number((await db.query("SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND pid<>pg_backend_pid()" )).rows[0].n);
					if (waiters < 2) await new Promise(resolve => setTimeout(resolve, 10));
				}
				assert.equal(waiters, 2, 'Two independent requests actually overlap at the transaction boundary');
			} finally { await gate.query('COMMIT'); gate.release(); }
			const [a, b] = await Promise.all([first, concurrent]);
			assert.deepEqual(a, b); assert.equal(await receipts(input.requestKey), 1);
			const entity = kind === 'team' ? a.team : a;
			assert.deepEqual(await create({ ...input, [field]: '  ' + input[field] + '  ' }), a, 'Normalized logical payload safely replays');
			await assert.rejects(create({ ...input, [field]: 'Different' }), { code: 'idempotency_conflict' });
			await assert.rejects(create({ ...input, ownerUserId: other }), { code: 'idempotency_conflict' });
			const second = await create({ ...input, requestKey: key() });
			assert.notEqual((kind === 'team' ? second.team : second).id, entity.id);
			const table = kind === 'team' ? 'teams' : 'projects', column = kind === 'team' ? 'name' : 'title';
			assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column}=$1`, [input[field]])).rows[0].n, 2);
			assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${kind}_memberships WHERE ${kind}_id=$1`, [entity.id])).rows[0].n, 1);
			assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${kind}_events WHERE ${kind}_id=$1 AND event_type=$2`, [entity.id, kind + '_created'])).rows[0].n, 1);
			if (kind === 'team') assert.equal((await db.query('SELECT count(*)::int AS n FROM team_membership_sources WHERE team_id=$1', [entity.id])).rows[0].n, 1);
			const invalid = { ...input, [field]: '', requestKey: key() };
			await assert.rejects(create(invalid)); assert.equal(await receipts(invalid.requestKey), 0);
			await create({ ...invalid, [field]: `${prefix}_${kind}_corrected` });
			const rollback = { ...input, [field]: `${prefix}_${kind}_rollback`, requestKey: key() };
			await assert.rejects(failingService(kind, rollback.requestKey)(rollback), /Injected receipt persistence failure/);
			assert.equal(await receipts(rollback.requestKey), 0);
			assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column}=$1`, [rollback[field]])).rows[0].n, 0, 'Entity and children roll back if receipt fails');
			await create(rollback);
			await db.query(`UPDATE ${kind}_memberships SET revoked_at=now() WHERE ${kind}_id=$1 AND user_id=$2`, [entity.id, owner]);
			await assert.rejects(create(input), { code: kind + '_not_found' });
			assert.equal(await receipts(input.requestKey), 1, 'Authorization denial neither recreates nor erases successful receipt');
		}
		const sharedKey = key(); await teams.createTeam({ ownerUserId: owner, name: prefix + '_kind', requestKey: sharedKey });
		await assert.rejects(projects.createProject({ ownerUserId: owner, title: prefix + '_kind', requestKey: sharedKey }), { code: 'idempotency_conflict' });
		const guildInput = { ownerUserId: owner, name: prefix + '_guild', discordGuildId: '811111111111111111', discordGuildName: 'Old server', requestKey: key() };
		const guildTeam = await teams.createTeam(guildInput);
		assert.deepEqual(await teams.createTeam({ ...guildInput, discordGuildName: 'Renamed server', discordGuildIcon: 'new.png' }), guildTeam, 'Server enrichment does not redefine logical intent');
		const privateTeam = (await teams.createTeam({ ownerUserId: other, name: prefix + '_private' })).team;
		const denied = { ownerUserId: owner, title: prefix + '_denied', teamId: privateTeam.id, requestKey: key() };
		await assert.rejects(projects.createProject(denied), { code: 'team_not_found' }); assert.equal(await receipts(denied.requestKey), 0);
		await db.transaction(async client => {
			await client.query("INSERT INTO team_memberships(team_id,user_id,role) VALUES ($1,$2,'admin')", [privateTeam.id, owner]);
			await require('../core/team-membership-sources').grantManualSource(client, privateTeam.id, owner, other, 'test');
		});
		await projects.createProject(denied);
		const app = express(); app.use(express.json()); app.use(cookieParser());
		app.use((req, res, next) => {
			req.session = { meguUserId: req.headers['x-test-user'] };
			const json = res.json.bind(res);
			res.json = data => { if (req.headers['x-test-lose-ack'] && res.statusCode === 201) { res.destroy(); return res; } return json(data); };
			next();
		});
		let managed = [];
		app.use('/api/megu', require('../adapters/http/megu-api').router({ listManagedDiscordGuilds: async () => ({ available: true, guilds: managed }) }));
		app.use((error, req, res, next) => res.status(500).json({ code: error.code || 'failed' }));
		server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
		const post = (kind, payload, actor = owner, lose = false) => fetch(`http://127.0.0.1:${server.address().port}/api/megu/${kind}`, { method: 'POST', headers: {
			'Content-Type': 'application/json', ...(actor ? { 'x-test-user': actor } : {}), ...(lose ? { 'x-test-lose-ack': '1' } : {}),
		}, body: JSON.stringify(payload) });
		for (const kind of ['teams', 'projects']) {
			const payload = { [kind === 'teams' ? 'name' : 'title']: `${prefix}_http_${kind}`, requestKey: key() };
			assert.equal((await post(kind, payload, null)).status, 401); assert.equal(await receipts(payload.requestKey), 0);
			assert.equal((await post(kind, { ...payload, requestKey: undefined })).status, 422);
			await assert.rejects(post(kind, payload, owner, true), /fetch failed/);
			assert.equal(await receipts(payload.requestKey), 1, 'Lost HTTP acknowledgement follows committed receipt');
			const replay = await post(kind, payload); assert.equal(replay.status, 201);
			assert.deepEqual(await replay.json(), await (await post(kind, payload)).json());
			assert.equal((await post(kind, payload, other)).status, 409);
		}
		// Auditor's exact failure: real commit, dropped acknowledgement, fresh hook,
		// same browser-session storage, identical intent -> original receipt/entity.
		const { harness, storage } = require('./creation-request.test');
		for (const kind of ['teams', 'projects']) {
			const store = storage(), endpoint = '/api/megu/' + kind;
			const payload = { [kind === 'teams' ? 'name' : 'title']: prefix + '_reload_' + kind };
			const transport = lose => (url, options) => fetch(`http://127.0.0.1:${server.address().port}` + url, { ...options, headers: { ...options.headers, 'x-test-user': owner, ...(lose ? { 'x-test-lose-ack': '1' } : {}) } });
			const original = harness(endpoint, { store, actorId: owner, transport: transport(true) });
			await assert.rejects(original.render().submit(payload), /fetch failed/);
			keys.push(original.sent[0].requestKey);
			assert.equal(await receipts(original.sent[0].requestKey), 1);
			const remounted = harness(endpoint, { store, actorId: owner, transport: transport(false) });
			const result = await remounted.render().submit(payload);
			assert.equal(remounted.sent[0].requestKey, original.sent[0].requestKey);
			const receipt = (await db.query('SELECT result FROM workspace_creations WHERE request_key=$1', [original.sent[0].requestKey])).rows[0].result;
			assert.deepEqual(kind === 'teams' ? result : result.project, receipt);
			const table = kind === 'teams' ? 'teams' : 'projects', column = kind === 'teams' ? 'name' : 'title';
			assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column}=$1`, [payload[column]])).rows[0].n, 1);
			assert.equal(Object.keys(store).length, 0);
		}
		const guildPayload = { name: prefix + '_auth', discordGuildId: guildInput.discordGuildId, requestKey: key() };
		assert.equal((await post('teams', guildPayload)).status, 403); assert.equal(await receipts(guildPayload.requestKey), 0);
		managed = [{ id: guildInput.discordGuildId, name: 'Allowed' }]; assert.equal((await post('teams', guildPayload)).status, 201);
		managed = []; assert.equal((await post('teams', guildPayload)).status, 403, 'Managed Discord authority is rechecked even for committed replays');
		const discordUserId = Date.now() + '123456';
		await db.query("INSERT INTO identities(id,user_id,provider,provider_uid) VALUES ($1,$2,'discord',$3)", [prefix + '_discord', owner, discordUserId]);
		const command = require('../commands/utility/projects');
		const interactionId = Date.now() + '999999', commandTitle = prefix + '_discord'; keys.push('discord-project-' + interactionId);
		const interaction = { id: interactionId, user: { id: discordUserId }, locale: 'en',
			options: { getSubcommandGroup: () => null, getSubcommand: () => 'create', getString: field => field === 'title' ? commandTitle : null },
			deferReply: async () => {}, editReply: async () => {},
		};
		await Promise.all([command.execute(interaction), command.execute({ ...interaction })]);
		assert.equal((await db.query('SELECT count(*)::int AS n FROM projects WHERE title=$1', [commandTitle])).rows[0].n, 1, 'Repeated actual Discord interaction uses the same creation receipt');
		assert.equal(await receipts('discord-project-' + interactionId), 1);
		const nextInteractionId = Date.now() + '888888'; keys.push('discord-project-' + nextInteractionId);
		await command.execute({ ...interaction, id: nextInteractionId });
		assert.equal((await db.query('SELECT count(*)::int AS n FROM projects WHERE title=$1', [commandTitle])).rows[0].n, 2, 'A deliberate new Discord interaction creates a distinct project');
		const survivor = prefix + '_merge_survivor', source = prefix + '_merge_source'; users.push(survivor, source);
		await db.query("INSERT INTO users(id,display_name,created_at) VALUES ($1,$1,'2020-01-01'),($2,$2,'2021-01-01')", [survivor, source]);
		const sourceKeys = [];
		for (const kind of ['team', 'project']) {
			const input = { ownerUserId: source, [kind === 'team' ? 'name' : 'title']: prefix + '_merge_' + kind, requestKey: key() };
			sourceKeys.push([kind, input]);
			await (kind === 'team' ? teams.createTeam : projects.createProject)(input);
		}
		const merged = await require('../core/account-merge').mergeAccounts({ userIdA: survivor, userIdB: source });
		assert.equal(merged.survivorId, survivor);
		for (const [kind, input] of sourceKeys) {
			assert.equal((await db.query('SELECT actor_id FROM workspace_creations WHERE request_key=$1', [input.requestKey])).rows[0].actor_id, source, 'Merge cannot rebind a creation key');
			await assert.rejects((kind === 'team' ? teams.createTeam : projects.createProject)({ ...input, ownerUserId: survivor }), { code: 'idempotency_conflict' });
			await assert.rejects((kind === 'team' ? teams.createTeam : projects.createProject)(input), { code: 'creation_actor_unavailable' });
		}
		console.log('Workspace creation passed: overlapping native transactions, atomic rollback, immutable actor/kind/payload receipts, ownership/source/event retention, validation/auth recovery and real HTTP lost acknowledgements for both flows.');
	} finally {
		if (server) await new Promise(resolve => server.close(resolve));
		await db.query('DELETE FROM workspace_creations WHERE request_key=ANY($1::text[])', [keys]);
		await db.query('DELETE FROM projects WHERE owner_user_id=ANY($1::text[])', [users]);
		await db.query('DELETE FROM teams WHERE created_by=ANY($1::text[])', [users]);
		await db.query('DELETE FROM account_merges WHERE survivor_user_id=ANY($1::text[])', [users]);
		await db.query('DELETE FROM user_aliases WHERE old_user_id=ANY($1::text[]) OR user_id=ANY($1::text[])', [users]);
		await db.query('DELETE FROM users WHERE id=ANY($1::text[])', [users]);
		await db.close();
	}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
