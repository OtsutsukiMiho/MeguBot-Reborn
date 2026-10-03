'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Collection, PermissionsBitField, PermissionFlagsBits, RoleManager } = require('discord.js');
const consoleAuthorization = require('../adapters/discord/console-authorization');
const web = fs.readFileSync(require.resolve('../backend/web/web.js'), 'utf8');
const botSource = fs.readFileSync(require.resolve('../backend/bot/bot.js'), 'utf8');
const guildId = '100000000000000000', callerId = '200000000000000000', botId = '300000000000000000', targetId = '400000000000000000', ownerId = '500000000000000000';
const low = '600000000000000000', high = '600000000000000001', managed = '600000000000000002';
const types = ['create_guild_role', 'update_guild_role', 'delete_guild_role', 'modify_member_role', 'set_member_roles'];
let checks = 0;

function response() {
	return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } };
}

function fixture() {
	const effects = [], fetches = [], roles = new Collection(), members = new Map();
	const guild = { id: guildId, ownerId, name: 'Server', fetch: async () => { fetches.push('guild'); return guild; } };
	const role = (id, position, extra = {}) => {
		const value = { id, name: id, position, managed: false, members: new Collection(), ...extra,
			comparePositionTo(other) { return RoleManager.prototype.comparePositions.call({ resolve: x => typeof x === 'string' ? roles.get(x) : x }, this, other); },
			edit: async data => { effects.push(['edit', id, data]); return value; },
			delete: async () => { effects.push(['delete', id]); },
		};
		roles.set(id, value); return value;
	};
	const everyone = role(guildId, 0), callerRole = role('700000000000000000', 5), botRole = role('800000000000000000', 10);
	role(low, 2); role(high, 7); role(managed, 1, { managed: true });
	function member(id, highest, permissions = 0n, held = []) {
		const value = { id, user: { username: id }, permissions: new PermissionsBitField(permissions), roles: {
			highest, cache: new Collection([[guildId, everyone], ...held.map(id => [id, roles.get(id)])]),
			add: async value => { effects.push(['add', value.id]); },
			remove: async value => { effects.push(['remove', value.id]); },
			set: async ids => { effects.push(['set', Array.from(ids)]); },
		} };
		members.set(id, value); return value;
	}
	const caller = member(callerId, callerRole, PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageRoles);
	const bot = member(botId, botRole, PermissionFlagsBits.ManageRoles);
	const target = member(targetId, roles.get(low), 0n, [low, managed]);
	member(ownerId, callerRole, 0n);
	const state = { outage: false };
	guild.roles = { cache: roles, fetch: async () => { fetches.push('roles'); if (state.outage) throw new Error('offline'); return roles; }, create: async data => { effects.push(['create', data]); return role('900000000000000000', 1); } };
	guild.members = { me: bot, fetch: async options => {
		assert.equal(options.force, true, 'Every authority/target read must bypass member cache');
		fetches.push(options.user);
		if (!members.has(options.user)) throw Object.assign(new Error('Unknown member'), { code: 10007 });
		return members.get(options.user);
	} };
	const client = { user: { id: botId }, guilds: { cache: new Collection([[guildId, guild]]) } };
	// Match production's block/outage fallback behavior, including swallowed errors.
	const discordCall = async (_label, run, fallback) => { try { return await run(); } catch { return fallback; } };
	async function ipc(msg) {
		const type = msg.type === 'verify_console_roles' ? 'verify_console_authority' : msg.type;
		const start = botSource.indexOf(`else if (msg.type === '${type}'`);
		assert.ok(start >= 0, `Missing handler ${msg.type}`);
		const end = botSource.indexOf('\n\telse if (msg.type', start + 10);
		let reply;
		const handler = vm.runInNewContext(`(async function(msg) { ${botSource.slice(start, end).replace(/^else if/, 'if')} })`, {
			client, discordCall, consoleAuthorization, PermissionFlagsBits, BotLogs: () => {}, COLOR: {},
			process: { send: value => { reply = value; } },
		});
		await handler(msg); return reply;
	}
	return { effects, fetches, guild, roles, caller, callerRole, bot, target, members, state, client, discordCall, ipc };
}

function guards(f) {
	return vm.runInNewContext(`${web.slice(web.indexOf('function requireConsoleGuild('), web.indexOf("app.get(['/health', '/api/health']"))}; ({ requireAdminGuild, requireGuildAccess, requireRoleGuild, verifyConsoleRoles })`, { sendIpcRequest: request => f.ipc(request) });
}

function route(prefix, guardSet, dependencies = {}) {
	if (prefix.includes('/config') && !dependencies.database.compareAndSetGuildRoleVars) {
		const db = dependencies.database;
		db.compareAndSetGuildRoleVars = async (_guild, before, desired) => {
			const current = await db.getAllGuildVars(_guild);
			if (!Object.keys(desired).every(key => JSON.stringify(current[key] ?? null) === JSON.stringify(before[key] ?? null))) return false;
			for (const [key, value] of Object.entries(desired)) await db.setGuildVar(_guild, key, value);
			return true;
		};
	}
	const start = web.indexOf(prefix), end = web.indexOf('\napp.', start + prefix.length);
	assert.ok(start >= 0 && end > start);
	let captured;
	vm.runInNewContext(web.slice(start, end), { ...require('../core/voice-qol-settings'), ...guardSet, ...dependencies, app: {
		post: (...args) => { captured = args.slice(1); }, get: (...args) => { captured = args.slice(1); },
	} });
	return captured;
}

function request(body = {}) {
	return { params: { guildId, memberId: targetId, roleId: low }, body, query: {},
		session: { user: { id: callerId, username: 'Caller' }, adminGuilds: [{ id: guildId }], allGuilds: [{ id: guildId }] } };
}

async function callRoute(handlers, req, res = response()) {
	let allowed = false;
	await handlers[0](req, res, () => { allowed = true; });
	if (allowed) await handlers[1](req, res);
	return res;
}

async function main() {
	for (const type of types) {
		for (const scenario of ['manage-only', 'demoted', 'removed', 'outage', 'no-bot-permission', 'missing-identity']) {
			const f = fixture();
			if (scenario === 'manage-only') f.caller.permissions = new PermissionsBitField(PermissionFlagsBits.ManageGuild);
			if (scenario === 'demoted') f.caller.permissions = new PermissionsBitField();
			if (scenario === 'removed') f.members.delete(callerId);
			if (scenario === 'outage') f.state.outage = true;
			if (scenario === 'no-bot-permission') f.bot.permissions = new PermissionsBitField();
			const result = await f.ipc({ type, guildId, actorId: scenario === 'missing-identity' ? undefined : callerId, memberId: targetId, roleId: low, roleIds: [low], action: 'add' });
			assert.equal(result.success, false, `${type}: ${scenario}`);
			assert.equal(f.effects.length, 0); checks++;
		}
		const f = fixture();
		assert.equal((await f.ipc({ type, guildId, actorId: callerId, memberId: targetId, roleId: low, roleIds: [], action: 'remove' })).success, true, `Authorized ${type}`);
		assert.equal(f.effects.length, 1); assert.deepEqual(f.fetches.slice(0, 3), ['guild', 'roles', callerId]); checks++;
	}
	// F1 reproduction: a Manage Server-only caller assigns an Administrator
	// role to themselves, even though that role is below the bot and caller.
	for (const type of ['modify_member_role', 'set_member_roles']) {
		const f = fixture(); f.roles.get(low).permissions = new PermissionsBitField(PermissionFlagsBits.Administrator);
		f.caller.permissions = new PermissionsBitField(PermissionFlagsBits.ManageGuild);
		assert.equal((await f.ipc({ type, guildId, actorId: callerId, memberId: callerId, roleId: low, roleIds: [low], action: 'add' })).success, false);
		assert.equal(f.effects.length, 0); checks++;
	}
	for (const type of ['modify_member_role', 'set_member_roles', 'update_guild_role', 'delete_guild_role']) {
		const f = fixture();
		assert.equal((await f.ipc({ type, guildId, actorId: callerId, memberId: targetId, roleId: high, roleIds: [high], action: 'add' })).success, false);
		assert.equal(f.effects.length, 0); checks++;
	}
	for (const type of ['modify_member_role', 'set_member_roles']) {
		for (const protectedId of [ownerId, botId, targetId]) {
			const f = fixture(); if (protectedId === targetId) f.target.roles.highest = f.callerRole;
			assert.equal((await f.ipc({ type, guildId, actorId: callerId, memberId: protectedId, roleId: low, roleIds: [low], action: 'add' })).success, false);
			assert.equal(f.effects.length, 0); checks++;
		}
	}
	// Real discord.js position tie ordering, even for Administrator callers.
	{
		const f = fixture(); f.caller.permissions = new PermissionsBitField(PermissionFlagsBits.Administrator);
		f.roles.get(low).position = f.callerRole.position;
		assert.equal((await f.ipc({ type: 'modify_member_role', guildId, actorId: callerId, memberId: targetId, roleId: low, action: 'add' })).success, false); checks++;
	}
	{
		const f = fixture(); f.guild.ownerId = callerId; f.caller.permissions = new PermissionsBitField();
		assert.equal((await f.ipc({ type: 'modify_member_role', guildId, actorId: callerId, memberId: targetId, roleId: high, action: 'add' })).success, true);
		f.roles.get(high).position = f.bot.roles.highest.position;
		assert.equal((await f.ipc({ type: 'modify_member_role', guildId, actorId: callerId, memberId: targetId, roleId: high, action: 'add' })).success, false); checks += 2;
	}
	{
		const f = fixture();
		assert.equal((await f.ipc({ type: 'set_member_roles', guildId, actorId: callerId, memberId: targetId, roleIds: [] })).success, true);
		assert.deepEqual(f.effects[0], ['set', [managed]], 'Batch removes manageable roles and preserves integration roles'); checks++;
	}
	for (const type of ['modify_member_role', 'set_member_roles']) {
		for (const roleId of [guildId, managed]) {
			const f = fixture(); f.target.roles.cache.delete(managed);
			assert.equal((await f.ipc({ type, guildId, actorId: callerId, memberId: targetId, roleId, roleIds: [roleId], action: 'add' })).success, false);
			assert.equal(f.effects.length, 0); checks++;
		}
		const f = fixture(); f.guild.ownerId = callerId; f.target.roles.highest = f.bot.roles.highest;
		assert.equal((await f.ipc({ type, guildId, actorId: callerId, memberId: targetId, roleId: low, roleIds: [low], action: 'add' })).success, false, 'Owner cannot bypass bot target hierarchy'); checks++;
	}
	{
		const f = fixture(); f.caller.permissions = new PermissionsBitField(PermissionFlagsBits.Administrator);
		assert.equal((await f.ipc({ type: 'modify_member_role', guildId, actorId: callerId, memberId: callerId, roleId: low, action: 'add' })).success, true, 'Administrator can manage own lower roles'); checks++;
	}
	// Same populated session remains open; authority changes must take effect immediately.
	for (const name of ['requireAdminGuild', 'requireGuildAccess', 'requireRoleGuild']) {
		const f = fixture(), guard = guards(f)[name], req = request(); let admitted = 0;
		await guard(req, response(), () => admitted++); assert.equal(admitted, 1);
		f.caller.permissions = new PermissionsBitField();
		await guard(req, response(), () => admitted++); assert.equal(admitted, name === 'requireGuildAccess' ? 2 : 1);
		if (name === 'requireGuildAccess') assert.equal(req.guildAccess.isAdmin, false, 'Demoted member loses privileged reads');
		f.members.delete(callerId); await guard(req, response(), () => admitted++);
		assert.equal(admitted, name === 'requireGuildAccess' ? 2 : 1);
		f.state.outage = true; assert.equal((await (async () => { const res = response(); await guard(req, res, () => admitted++); return res; })()).statusCode, 503); checks += 4;
	}
	{
		const f = fixture(); let privateReads = 0;
		const handlers = route("app.get('/api/guilds/:guildId',", guards(f), {
			sendIpcRequest: async () => ({ exists: true, roles: ['private-role'], members: ['private-member'], channels: [] }),
			database: { getAllGuildVars: async () => { privateReads++; return {}; } },
			toBooleanSetting: (value, fallback) => value ?? fallback, parseReactionRolesMap: () => ({}), parseAutomodConfig: () => ({}),
		});
		const req = request();
		assert.equal((await callRoute(handlers, req)).body.isAdmin, true); assert.equal(privateReads, 1);
		f.caller.permissions = new PermissionsBitField();
		const demoted = await callRoute(handlers, req);
		assert.equal(demoted.body.isAdmin, false); assert.equal(demoted.body.roles, undefined); assert.equal(demoted.body.config, undefined); assert.equal(privateReads, 1);
		f.members.delete(callerId); assert.ok((await callRoute(handlers, req)).statusCode >= 400); checks += 3;
	}
	// Exercise the HTTP mutation routes and reject body-supplied caller identities.
	for (const [prefix, body] of [
		["app.post('/api/guilds/:guildId/roles/create'", {}],
		["app.post('/api/guilds/:guildId/roles/:roleId/update'", {}],
		["app.post('/api/guilds/:guildId/roles/:roleId/delete'", {}],
		["app.post(['/api/guilds/:guildId/members/:memberId/roles'", { roleId: low, action: 'add' }],
		["app.post(['/api/guilds/:guildId/members/:memberId/roles'", { roleIds: [] }],
	]) {
		const f = fixture(), handlers = route(prefix, guards(f), { sendIpcRequest: msg => { assert.equal(msg.actorId, callerId); return f.ipc(msg); }, database: { logAuditEvent: async () => {} } });
		assert.equal((await callRoute(handlers, request({ ...body, actorId: ownerId }))).body.success, true);
		f.caller.permissions = new PermissionsBitField(PermissionFlagsBits.ManageGuild);
		assert.equal((await callRoute(handlers, request({ ...body, actorId: ownerId }))).statusCode, 403); checks += 2;
	}
	{
		const f = fixture(); f.caller.permissions = new PermissionsBitField(PermissionFlagsBits.ManageRoles);
		const handlers = route("app.post(['/api/guilds/:guildId/members/:memberId/roles'", guards(f), { sendIpcRequest: msg => f.ipc(msg), database: { logAuditEvent: async () => {} } });
		assert.equal((await callRoute(handlers, request({ roleId: low, action: 'add' }))).body.success, true, 'Manage Roles alone authorizes role operations'); checks++;
	}
	// Role delegation through autorole/reaction settings is part of the same boundary.
	for (const scenario of ['autorole', 'bot-autorole', 'reaction-add', 'reaction-toggle-link']) {
		const f = fixture(), vars = { autorole_ids: [], bot_autorole_ids: [] }, writes = [];
		const mappings = { message: { emoji: { roleId: high, enabled: false } } };
		const database = { getAllGuildVars: async () => ({ ...vars }), getGuildVar: async () => JSON.stringify(mappings), setGuildVar: async (g, key, value) => { writes.push(key); vars[key] = value; }, logAuditEvent: async () => {} };
		const handlers = route(scenario.includes('reaction') ? "app.post('/api/guilds/:guildId/reaction-roles'" : "app.post('/api/guilds/:guildId/config'", guards(f), {
			database, parseReactionRolesMap: JSON.parse, process: {}, BotLogs: () => {}, toBooleanSetting: (value, fallback = true) => value === undefined ? fallback : Boolean(value),
		});
		let body = scenario === 'autorole' ? { autorole_ids: [high] } : { bot_autorole_ids: [high] };
		if (scenario === 'reaction-add') body = { action: 'add', roleId: high, messageId: 'message', emoji: 'emoji' };
		if (scenario === 'reaction-toggle-link') body = { action: 'toggle', messageLink: `https://discord.com/channels/${guildId}/123/message`, emoji: 'emoji' };
		// Valid numeric message link identifies the existing protected entry.
		if (scenario === 'reaction-toggle-link') { mappings['123456789012345678'] = mappings.message; body.messageLink = `https://discord.com/channels/${guildId}/123/123456789012345678`; }
		const res = await callRoute(handlers, request(body));
		assert.equal(res.statusCode, 403, `${scenario} caller hierarchy`); assert.equal(writes.length, 0); checks++;
		f.caller.permissions = new PermissionsBitField(PermissionFlagsBits.ManageGuild);
		assert.equal((await callRoute(handlers, request(body))).statusCode, 403); assert.equal(writes.length, 0); checks++;
	}
	// Clearing a populated human list activates the legacy fallback. Authorize
	// this effective transition even when no stored field gains a new ID.
	for (const scenario of ['privileged-fallback', 'allowed-fallback', 'low-list', 'clear-all', 'bot-hierarchy', 'no-roles-permission', 'scalar-list', 'stale-config']) {
		const f = fixture(), fallback = scenario === 'allowed-fallback' ? low : high;
		const vars = { autorole_id: fallback, autorole_ids: [scenario === 'allowed-fallback' ? high : low], bot_autorole_ids: [] };
		if (scenario === 'scalar-list') { vars.autorole_id = low; vars.autorole_ids = high; }
		let writes = 0;
		if (scenario === 'bot-hierarchy') { f.callerRole.position = 8; f.bot.roles.highest.position = 6; }
		if (scenario === 'no-roles-permission') f.caller.permissions = new PermissionsBitField(PermissionFlagsBits.ManageGuild);
		const handlers = route("app.post('/api/guilds/:guildId/config'", guards(f), {
			database: { getAllGuildVars: async () => ({ ...vars }), setGuildVar: async (_g, key, value) => { writes++; vars[key] = value; }, logAuditEvent: async () => {},
				...(scenario === 'stale-config' ? { compareAndSetGuildRoleVars: async () => false } : {}), },
			process: {}, BotLogs: () => {}, toBooleanSetting: (value, fallback = true) => value === undefined ? fallback : Boolean(value),
		});
		const body = scenario === 'scalar-list' ? { autorole_ids: [high], autorole_id: low }
			: scenario === 'clear-all' ? { autorole_ids: [], autorole_id: null }
			: scenario === 'low-list' ? { autorole_ids: [low], autorole_id: low }
				: scenario === 'stale-config' ? { autorole_ids: [low], autorole_id: high }
				: { autorole_ids: [], autorole_id: fallback };
		const rejected = ['privileged-fallback', 'bot-hierarchy', 'no-roles-permission', 'scalar-list', 'stale-config'].includes(scenario);
		const result = await callRoute(handlers, request(body));
		assert.equal(result.statusCode, scenario === 'stale-config' ? 409 : rejected ? 403 : 200, scenario);
		assert.equal(writes > 0, !rejected, 'Rejected transitions cannot persist settings');
		if (!rejected) assert.equal(result.body.success, true);
		checks += 2;
	}
	// Ordinary Manage Server settings remain usable when role grants are unchanged.
	for (const permission of [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.Administrator]) {
		const f = fixture(), vars = { autorole_id: low, autorole_ids: [low], bot_autorole_ids: [] };
		f.caller.permissions = new PermissionsBitField(permission);
		const handlers = route("app.post('/api/guilds/:guildId/config'", guards(f), {
			database: { getAllGuildVars: async () => ({ ...vars }), setGuildVar: async (_g, key, value) => { vars[key] = value; }, logAuditEvent: async () => {} },
			process: {}, BotLogs: () => {}, toBooleanSetting: (value, fallback = true) => value === undefined ? fallback : Boolean(value),
		});
		assert.equal((await callRoute(handlers, request({ autorole_ids: [low], tts_join_greeting_text: 'Hello' }))).body.success, true);
		assert.equal(vars.tts_join_greeting_text, 'Hello'); checks++;
	}
	for (const action of ['add', 'toggle', 'delete', 'clear_all']) {
		const f = fixture(); let persisted;
		const mappings = { message: { emoji: { roleId: low, enabled: false } } };
		const handlers = route("app.post('/api/guilds/:guildId/reaction-roles'", guards(f), {
			database: { getGuildVar: async () => JSON.stringify(mappings), setGuildVar: async (_g, _key, value) => { persisted = JSON.parse(value); }, logAuditEvent: async () => {} },
			parseReactionRolesMap: JSON.parse, process: {}, BotLogs: () => {},
		});
		assert.equal((await callRoute(handlers, request({ action, roleId: low, messageId: 'message', emoji: 'emoji' }))).body.success, true);
		assert.ok(persisted); checks++;
	}
	for (const scenario of ['deleted-autorole', 'deleted-reaction', 'protected-disable', 'protected-clear']) {
		const f = fixture(), missing = '999999999999999999', vars = { autorole_id: missing, autorole_ids: [missing], bot_autorole_ids: [] };
		const mappings = { message: { emoji: { roleId: scenario === 'deleted-reaction' ? missing : high, enabled: true } } };
		let writes = 0;
		// Cleanup does not grant a role and remains possible after bot demotion.
		f.bot.permissions = new PermissionsBitField();
		const handlers = route(scenario === 'deleted-autorole' ? "app.post('/api/guilds/:guildId/config'" : "app.post('/api/guilds/:guildId/reaction-roles'", guards(f), {
			database: { getAllGuildVars: async () => ({ ...vars }), getGuildVar: async () => JSON.stringify(mappings), setGuildVar: async (_g, key, value) => { writes++; vars[key] = value; }, logAuditEvent: async () => {} },
			parseReactionRolesMap: JSON.parse, process: {}, BotLogs: () => {}, toBooleanSetting: (value, fallback = true) => value === undefined ? fallback : Boolean(value),
		});
		const body = scenario === 'deleted-autorole' ? { autorole_ids: [] } : { action: scenario === 'deleted-reaction' ? 'delete' : scenario === 'protected-clear' ? 'clear_all' : 'toggle', messageId: 'message', emoji: 'emoji' };
		assert.equal((await callRoute(handlers, request(body))).body.success, true, scenario); assert.ok(writes > 0);
		const written = writes; f.caller.permissions = new PermissionsBitField(PermissionFlagsBits.ManageGuild);
		// Recreate the changed autorole fixture to ensure this still requires roles permission.
		if (scenario === 'deleted-autorole') { vars.autorole_id = missing; vars.autorole_ids = [missing]; }
		assert.equal((await callRoute(handlers, request(body))).statusCode, 403); assert.equal(writes, written); checks += 2;
	}
	console.log(`Console authorization passed: ${checks} checks; fresh reads, trusted identity, permissions, hierarchy, five mutation paths and delegated role grants.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
