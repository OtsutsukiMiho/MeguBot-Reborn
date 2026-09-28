'use strict';
const assert = require('node:assert/strict');
const { IntentsBitField, ApplicationFlagsBitField, GatewayIntentBits, Events } = require('discord.js');
const { EventEmitter } = require('node:events');
const { verifyGuildMember, capabilities, createRoleSyncWorker } = require('../adapters/discord/server-role-sync');
const sync = require('../core/server-role-sync'), db = require('../core/db');
(async () => {
	const guildId = '866666666666666666', discordUserId = '822222222222222222', roleId = '877777777777777777';
	let calls = [], failure, bot = false;
	const guild = { name: 'Fixture server', icon: null, ownerId: discordUserId,
		fetch: async () => { calls.push('guild'); }, roles: { fetch: async () => { calls.push('roles'); } },
		members: { fetch: async input => { calls.push(input); if (failure) throw failure; return { id: discordUserId, user: { bot }, roles: { cache: new Map([[roleId, {}]]) }, permissions: { has: () => false } }; } } };
	const client = { isReady: () => true, options: { intents: new IntentsBitField([GatewayIntentBits.GuildMembers]) }, guilds: { cache: new Map([[guildId, guild]]) }, application: { flags: new ApplicationFlagsBitField(ApplicationFlagsBitField.Flags.GatewayGuildMembersLimited), fetch: async () => client.application } };
	const discordCall = async (_label, run, fallback) => { try { return await run(); } catch { return fallback; } };
	let result = await verifyGuildMember(client, discordCall, { guildId, discordUserId, management: true });
	assert.equal(result.available, true); assert.equal(result.discordUserId, discordUserId); assert.equal(result.canManageServer, true); assert.deepEqual(result.roleIds, [roleId]);
	assert.deepEqual(calls, ['guild', 'roles', { user: discordUserId, force: true }]);
	calls = []; result = await verifyGuildMember(client, discordCall, { guildId, discordUserId }); assert.equal(result.canManageServer, false); assert.equal(calls.length, 1);
	failure = { code: 10007 }; result = await verifyGuildMember(client, discordCall, { guildId, discordUserId }); assert.equal(result.available, true); assert.equal(result.isMember, false);
	for (const code of [50001, 50013, 429, 'ETIMEDOUT']) { failure = { code }; assert.equal((await verifyGuildMember(client, discordCall, { guildId, discordUserId })).available, false); }
	failure = null; bot = true; assert.equal((await verifyGuildMember(client, discordCall, { guildId, discordUserId })).isBot, true); bot = false;
	assert.equal((await verifyGuildMember(client, discordCall, { guildId: '899999999999999999', discordUserId })).available, false);
	assert.equal(capabilities(client).available, true);
	client.application.flags = new ApplicationFlagsBitField(); assert.equal(capabilities(client).reason, 'member_intent_unapproved');
	client.options.intents = new IntentsBitField(); assert.equal(capabilities(client).reason, 'member_intent_missing');
	client.isReady = () => false; assert.equal(capabilities(client).reason, 'bot_disconnected');
	const originalRun = sync.runOnce, originalQuery = db.query;
	try {
		let evidence, refreshes = 0;
		sync.runOnce = async ({ verify }) => { evidence = await verify('manager', guildId, { management: true }); return { processed: 1 }; };
		db.query = async () => ({ rows: [{ provider_uid: discordUserId }] });
		client.application.fetch = async () => { refreshes++; return client.application; };
		const worker = createRoleSyncWorker({ client, discordCall });
		process.env.MEGU_TEAM_ROLE_SYNC_ENABLED = ''; assert.equal((await worker.runOnce()).disabled, true); assert.equal(refreshes, 0);
		process.env.MEGU_TEAM_ROLE_SYNC_ENABLED = '1'; await worker.runOnce(); assert.equal(evidence.available, false); assert.equal(refreshes, 0);
		client.isReady = () => true; client.options.intents = new IntentsBitField([GatewayIntentBits.GuildMembers]);
		await worker.runOnce(); assert.equal(evidence.available, false); assert.equal(refreshes, 1);
		client.application.flags = new ApplicationFlagsBitField(ApplicationFlagsBitField.Flags.GatewayGuildMembers);
		await worker.runOnce(); assert.equal(evidence.available, true); assert.equal(evidence.userId, 'manager'); assert.equal(evidence.discordUserId, discordUserId);
		let release, entered; const wait = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
		guild.members.fetch = async () => { entered(); await wait; return { id: discordUserId, user: { bot: false }, roles: { cache: new Map([[roleId, {}]]) }, permissions: { has: () => false } }; };
		const active = worker.runOnce(); await ready; assert.equal((await worker.runOnce()).alreadyRunning, true); worker.stop(); release(); await active;
		assert.equal(evidence.available, false, 'Shutdown discards an in-flight positive observation');
	} finally { sync.runOnce = originalRun; db.query = originalQuery; }
	const emitter = new EventEmitter(); client.on = emitter.on.bind(emitter); client.off = emitter.off.bind(emitter);
	const originals = Object.fromEntries(['enqueueDiscordMember','enqueueGuild','refreshRoleSnapshot','wakeSweeps'].map(name => [name, sync[name]]));
	try {
		const queued = []; for (const name of Object.keys(originals)) sync[name] = async (...args) => { queued.push([name, ...args]); };
		const worker = createRoleSyncWorker({ client, discordCall }); process.env.MEGU_TEAM_ROLE_SYNC_ENABLED = ''; worker.start(); assert.equal(emitter.eventNames().length, 0);
		process.env.MEGU_TEAM_ROLE_SYNC_ENABLED = '1'; worker.start(); worker.start(); assert.equal(emitter.listenerCount(Events.GuildMemberAdd), 1);
		const member = { id: discordUserId, guild: { id: guildId }, roles: { cache: new Map([[roleId, {}]]) } };
		emitter.emit(Events.GuildMemberAdd, member); emitter.emit(Events.GuildMemberRemove, member);
		emitter.emit(Events.GuildMemberUpdate, { ...member, roles: { cache: new Map() } }, member);
		emitter.emit(Events.GuildRoleUpdate, { name: 'Old', permissions: { bitfield: 0n } }, { id: roleId, guild: member.guild, name: 'New', permissions: { bitfield: 0n } });
		emitter.emit(Events.GuildRoleDelete, { id: roleId, guild: member.guild }); emitter.emit(Events.ShardResume, 0); emitter.emit(Events.ShardReady, 0);
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(queued.filter(row => row[0] === 'enqueueDiscordMember').length, 3); assert.deepEqual(queued.find(row => row.length === 4), ['enqueueDiscordMember', guildId, discordUserId, [roleId]]);
		assert.equal(queued.filter(row => row[0] === 'refreshRoleSnapshot').length, 1); assert.equal(queued.filter(row => row[0] === 'enqueueGuild').length, 1, 'Cosmetic role update does not reconcile membership');
		assert.equal(queued.filter(row => row[0] === 'wakeSweeps').length, 2);
		worker.stop(); assert.equal(emitter.eventNames().length, 0); const count = queued.length; emitter.emit(Events.GuildMemberAdd, member); await new Promise(resolve => setImmediate(resolve)); assert.equal(queued.length, count);
	} finally { for (const [name, value] of Object.entries(originals)) sync[name] = value; }
	console.log('Bot role integration passed: guarded fresh member/management reads, exact UID evidence, unknown-member vs outages, intent/application capability gates, default-off, single active batch and shutdown invalidation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
