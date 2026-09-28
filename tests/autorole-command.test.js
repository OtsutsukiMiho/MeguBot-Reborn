'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const discord = require('discord.js');
const commandSource = fs.readFileSync(require.resolve('../commands/utility/autorole'), 'utf8');
const botSource = fs.readFileSync(require.resolve('../backend/bot/bot'), 'utf8').replace(/\r\n/g, '\n');
const start = botSource.indexOf('let roleIdsToAssign = [];', botSource.indexOf('const isBot = member.user.bot;'));
const joinBody = botSource.slice(start, botSource.indexOf('\n\t}\n\tcatch (error)', start));
assert.ok(start >= 0 && !joinBody.includes('catch (error)'), 'Actual autorole join body located');
const guildId = '100000000000000009', low = '600000000000000000', high = '600000000000000001', second = '600000000000000002';
const clone = value => JSON.parse(JSON.stringify(value));

function loadCommand(database) {
	const module = { exports: {} };
	vm.runInNewContext(commandSource, { module, require: name => {
		if (name === 'discord.js') return discord;
		if (name.endsWith('/database.js')) return database;
		if (name.endsWith('/bot_functions.js')) return { BotLogs: () => {}, COLOR: {} };
		throw new Error(`Unexpected dependency ${name}`);
	} });
	return module.exports;
}

function request(subcommand, target = 'human', roleId = low) {
	const roles = new Map([[low, { id: low, name: 'low', position: 2 }], [high, { id: high, name: 'high', position: 7 }], [second, { id: second, name: 'second', position: 3 }]]);
	const replies = [];
	return { replies, guild: { id: guildId, name: 'Server', roles: { cache: roles }, members: { me: {
		permissions: new discord.PermissionsBitField(discord.PermissionFlagsBits.ManageRoles), roles: { highest: { position: 10 } },
	} } }, options: { getSubcommand: () => subcommand, getString: () => target, getRole: () => roles.get(roleId) },
		reply: async reply => { replies.push(reply); } };
}

function fixture(initial, { conflict = false } = {}) {
	let state = clone(initial), commits = 0, separateWrites = 0, separateReads = 0;
	const observations = [];
	let pause = async () => {};
	const db = {
		getAllGuildVars: async () => clone(state), logAuditEvent: async () => {},
		// Support the vulnerable implementation too: a join between its first
		// and second write would record the privileged fallback, failing below.
		getGuildVar: async (_g, key) => { separateReads++; return clone(state[key] ?? null); },
		setGuildVar: async (_g, key, value) => { separateWrites++; state[key] = clone(value); await join(); },
		compareAndSetGuildRoleVars: async (_g, before, desired) => {
			commits++;
			await pause();
			if (conflict || !['autorole_id', 'autorole_ids', 'bot_autorole_ids'].every(key => JSON.stringify(state[key] ?? null) === JSON.stringify(before[key] ?? null))) return false;
			state = { ...state, ...clone(desired) };
			return true;
		},
	};
	async function join(isBot = false) {
		const interaction = request('status');
		const grants = [];
		const member = { guild: interaction.guild, id: 'new-member', user: { tag: 'new member' }, roles: { add: async roles => grants.push(...roles.map(role => role.id)) } };
		await vm.runInNewContext(`(async()=>{${joinBody}})()`, { database: db, guildId, isBot, member, PermissionFlagsBits: discord.PermissionFlagsBits, BotLogs: () => {}, COLOR: {} });
		observations.push(grants);
		return grants;
	}
	return { command: loadCommand(db), join, observations, state: () => clone(state), pause: fn => { pause = fn; }, counts: () => ({ commits, separateWrites, separateReads }) };
}

async function main() {
	const initial = { autorole_id: high, autorole_ids: [low], bot_autorole_ids: [second] };
	// The exact auditor schedule: clear begins, then a join while the command
	// is suspended before its logical mutation completes, then another join.
	for (const subcommand of ['clear', 'remove']) {
		const f = fixture(initial), interaction = request(subcommand);
		let entered, release;
		const pending = new Promise(resolve => { entered = resolve; });
		const gate = new Promise(resolve => { release = resolve; });
		f.pause(async () => { entered(); await gate; });
		const clear = f.command.execute(interaction);
		await Promise.race([pending, clear]);
		assert.ok(f.observations.every(ids => !ids.includes(high)), 'Join must not observe privileged fallback between field writes');
		assert.deepEqual(await f.join(), [low], 'Join during mutation sees complete old state');
		release(); await clear;
		assert.deepEqual(await f.join(), [], 'Join after mutation sees complete cleared state');
		assert.ok(f.observations.every(ids => !ids.includes(high)), 'Dormant privileged fallback never activates');
		assert.equal(f.state().autorole_id, null); assert.deepEqual(f.state().bot_autorole_ids, [second]);
		assert.deepEqual(f.counts(), { commits: 1, separateWrites: 0, separateReads: 0 });
		assert.equal(interaction.replies.length, 1);
	}
	for (const subcommand of ['add', 'remove', 'clear']) {
		for (const target of ['human', 'bot', ...(subcommand === 'clear' ? ['all'] : [])]) {
			const f = fixture(initial), interaction = request(subcommand, target, second);
			await f.command.execute(interaction);
			assert.deepEqual(f.counts(), { commits: 1, separateWrites: 0, separateReads: 0 });
			assert.equal(interaction.replies.length, 1);
			if (target === 'bot') { assert.equal(f.state().autorole_id, high); assert.deepEqual(f.state().autorole_ids, [low]); }
			if (target === 'human') assert.deepEqual(f.state().bot_autorole_ids, [second]);
			if (subcommand === 'add' && target === 'human') assert.deepEqual(f.state().autorole_ids, [low, second]);
			if (subcommand === 'clear' && target === 'all') assert.deepEqual(f.state(), { autorole_id: null, autorole_ids: [], bot_autorole_ids: [] });
		}
	}
	for (const subcommand of ['add', 'remove', 'clear']) {
		const f = fixture(initial, { conflict: true }), interaction = request(subcommand);
		await f.command.execute(interaction);
		assert.deepEqual(f.state(), initial); assert.match(interaction.replies[0].content, /changed.*try again/);
	}
	for (const modern of [[], undefined]) {
		const f = fixture({ autorole_id: low, ...(modern ? { autorole_ids: modern } : {}), bot_autorole_ids: [] });
		assert.deepEqual(await f.join(), [low], 'Legitimate legacy fallback remains');
		const status = request('status'); await f.command.execute(status);
		assert.match(status.replies[0].embeds[0].toJSON().fields[0].value, new RegExp(low));
		await f.command.execute(request('add', 'human', second));
		assert.deepEqual(f.state().autorole_ids, [low, second]);
		await f.command.execute(request('remove', 'human', low));
		assert.deepEqual(await f.join(), [second]);
	}
	for (const scenario of ['bot-permission', 'bot-hierarchy']) {
		const f = fixture(initial), interaction = request('add');
		if (scenario === 'bot-permission') interaction.guild.members.me.permissions = new discord.PermissionsBitField();
		else interaction.guild.members.me.roles.highest.position = 2;
		await f.command.execute(interaction); assert.equal(f.counts().commits, 0); assert.deepEqual(f.state(), initial);
	}
	assert.equal(loadCommand({}).data.toJSON().default_member_permissions, String(discord.PermissionFlagsBits.Administrator));
	const web = fs.readFileSync(require.resolve('../backend/web/web'), 'utf8');
	assert.ok(web.includes('database.compareAndSetGuildRoleVars(guildId, oldVars, desiredRoles)'));
	console.log('Autorole command passed: exact clear/remove-last join interleaving; all command writers use shared CAS; target retention, add/remove, fallback, stale rejection and bot safeguards.');
}
module.exports = { loadCommand, request, main };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
