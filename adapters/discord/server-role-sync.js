'use strict';
const { GatewayIntentBits, ApplicationFlagsBitField, PermissionFlagsBits, Events } = require('discord.js');
const db = require('../../core/db');
const sync = require('../../core/server-role-sync');

// Shared with the incumbent IPC verifier: cache absence is unavailable; only a
// fresh unknown-member response proves departure. Never mutate Discord roles.
async function verifyGuildMember(client, discordCall, { guildId, discordUserId, management = false }) {
	if (!/^\d{17,20}$/.test(guildId || '') || !/^\d{17,20}$/.test(discordUserId || '')) return { available: false };
	const guild = client.guilds.cache.get(guildId);
	if (!guild) return { available: false };
	try {
		const result = await discordCall('verifying workspace membership', async () => {
			try {
				if (management) { await guild.fetch(); await guild.roles.fetch(); }
				const member = await guild.members.fetch({ user: discordUserId, force: true });
				return { isMember: true, isBot: member.user.bot === true, roleIds: [...member.roles.cache.keys()], canManageServer: management && (guild.ownerId === member.id || member.permissions.has(PermissionFlagsBits.ManageGuild)) };
			} catch (error) { if (error.code === 10007) return { isMember: false, isBot: false }; throw error; }
		}, null);
		return result ? { available: true, guildId, discordUserId, name: guild.name, icon: guild.icon || null, ...result } : { available: false };
	} catch { return { available: false }; }
}

function capabilities(client) {
	if (!client.isReady()) return { available: false, reason: 'bot_disconnected' };
	if (!client.options.intents.has(GatewayIntentBits.GuildMembers)) return { available: false, reason: 'member_intent_missing' };
	if (!client.application?.flags?.has(ApplicationFlagsBitField.Flags.GatewayGuildMembers) && !client.application?.flags?.has(ApplicationFlagsBitField.Flags.GatewayGuildMembersLimited)) return { available: false, reason: 'member_intent_unapproved' };
	return { available: true };
}

async function refreshCapabilities(client, discordCall) {
	if (!client.isReady() || !client.options.intents.has(GatewayIntentBits.GuildMembers)) return capabilities(client);
	let timeout;
	const application = await Promise.race([
		Promise.resolve().then(() => discordCall('checking workspace member intent', () => client.application.fetch(), null)).catch(() => null),
		new Promise(resolve => { timeout = setTimeout(() => resolve(null), 12_000); }),
	]).finally(() => clearTimeout(timeout));
	return application ? capabilities(client) : { available: false, reason: 'capability_verification_unavailable' };
}

function createRoleSyncWorker({ client, discordCall, log = () => undefined }) {
	let running = false, timer = null, kickoff = null, stopped = true, epoch = 0, needsWake = true;
	const listeners = [];
	function listen(event, handler) {
		const wrapped = (...args) => { if (!stopped && sync.enabled()) Promise.resolve().then(() => handler(...args)).catch(() => log('Role work scheduling failed; periodic verification will recover.')); };
		client.on(event, wrapped); listeners.push([event, wrapped]);
	}
	async function runOnce() {
		if (running) return { processed: 0, alreadyRunning: true };
		if (!sync.enabled()) return { processed: 0, disabled: true };
		running = true;
		const currentEpoch = epoch;
		try {
			if (needsWake) { await sync.wakeSweeps(); needsWake = false; }
			// Refresh privileged application approval through the same guarded REST
			// path as all bot calls. A failed refresh never enables new grants.
			const available = (await refreshCapabilities(client, discordCall)).available;
			return await sync.runOnce({ verify: async (userId, guildId, { management }) => {
				if (epoch !== currentEpoch || !available || !capabilities(client).available) return { available: false };
				const identity = (await db.query("SELECT provider_uid FROM identities WHERE user_id=$1 AND provider='discord'", [userId])).rows[0];
				if (!identity) return { available: false };
				const evidence = await verifyGuildMember(client, discordCall, { guildId, discordUserId: identity.provider_uid, management });
				return epoch === currentEpoch ? { ...evidence, userId } : { available: false };
			} });
		} finally { running = false; }
	}
	function start() {
		if (!stopped || !sync.enabled()) return stop;
		stopped = false;
		needsWake = true;
		listen(Events.GuildMemberAdd, member => sync.enqueueDiscordMember(member.guild.id, member.id));
		listen(Events.GuildMemberRemove, member => sync.enqueueDiscordMember(member.guild.id, member.id));
		listen(Events.GuildMemberUpdate, (before, after) => {
			const oldRoles = new Set(before.roles.cache.keys()), newRoles = new Set(after.roles.cache.keys());
			const changed = [...oldRoles].filter(id => !newRoles.has(id)).concat([...newRoles].filter(id => !oldRoles.has(id)));
			if (changed.length) return sync.enqueueDiscordMember(after.guild.id, after.id, changed);
		});
		listen(Events.GuildRoleUpdate, async (before, after) => {
			if (before.name !== after.name) await sync.refreshRoleSnapshot(after.guild.id, after.id, after.name);
			if (before.permissions?.bitfield !== after.permissions?.bitfield) await sync.enqueueGuild(after.guild.id);
		});
		listen(Events.GuildRoleDelete, role => sync.enqueueGuild(role.guild.id));
		listen(Events.GuildCreate, guild => sync.enqueueGuild(guild.id));
		listen(Events.ShardReady, () => sync.wakeSweeps());
		listen(Events.ShardResume, () => sync.wakeSweeps());
		const tick = () => { if (!stopped) runOnce().catch(() => log('Role reconciliation failed; durable work retained for retry.')); };
		timer = setInterval(tick, 30_000); kickoff = setTimeout(tick, 10_000); timer.unref?.(); kickoff.unref?.();
		return stop;
	}
	function stop() {
		stopped = true; epoch++; clearInterval(timer); clearTimeout(kickoff); timer = null; kickoff = null;
		for (const [event, handler] of listeners.splice(0)) client.off(event, handler);
	}
	return { runOnce, start, stop };
}

module.exports = { verifyGuildMember, capabilities, refreshCapabilities, createRoleSyncWorker };
