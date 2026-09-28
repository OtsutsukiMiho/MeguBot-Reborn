'use strict';
const { PermissionFlagsBits } = require('discord.js');

function deny(message, status = 403) {
	throw Object.assign(new Error(message), { status });
}

// Cache contents locate the guild, never prove current caller authority.
async function authorizeConsole(client, discordCall, { guildId, actorId, permission = 'member' }) {
	if (!/^\d{17,20}$/.test(guildId || '') || !/^\d{17,20}$/.test(actorId || '')) deny('Invalid console identity.', 401);
	if (!['member', 'manage', 'roles'].includes(permission)) deny('Invalid console operation.');
	const guild = client.guilds.cache.get(guildId);
	if (!guild) deny('Discord authority unavailable.', 503);
	let context;
	try {
		context = await discordCall('verifying console authority', async () => {
			await guild.fetch();
			await guild.roles.fetch();
			const caller = await guild.members.fetch({ user: actorId, force: true });
			return { guild, caller, isOwner: guild.ownerId === caller.id };
		}, null);
	} catch (error) {
		if (error.code === 10007) deny('You are not a member of this server.');
		deny('Discord authority unavailable.', 503);
	}
	if (!context) deny('Discord authority unavailable.', 503);
	const { caller, isOwner } = context;
	context.isAdmin = isOwner || caller.permissions.has(PermissionFlagsBits.ManageGuild);
	if (permission === 'manage' && !context.isAdmin) deny('Manage Server permission required.');
	if (permission === 'roles' && !isOwner && !caller.permissions.has(PermissionFlagsBits.ManageRoles)) deny('Manage Roles permission required.');
	return context;
}

async function authorizeRoleMutation(client, discordCall, request) {
	const context = await authorizeConsole(client, discordCall, { ...request, permission: 'roles' });
	const bot = await discordCall('verifying bot role authority', () => context.guild.members.fetch({ user: client.user.id, force: true }), null);
	if (!bot) deny('Bot authority unavailable.', 503);
	if (!bot.permissions.has(PermissionFlagsBits.ManageRoles)) deny('Bot lacks Manage Roles permission.');
	context.bot = bot;
	return context;
}

function canManageRole({ guild, caller, bot, isOwner }, role) {
	return role && role.id !== guild.id && !role.managed
		&& bot.roles.highest.comparePositionTo(role) > 0
		&& (isOwner || caller.roles.highest.comparePositionTo(role) > 0);
}

function assertRole(context, roleId, { everyone = false } = {}) {
	const role = context.guild.roles.cache.get(roleId);
	if (everyone && role?.id === context.guild.id) return role;
	if (!canManageRole(context, role)) deny('Role is protected or above caller/bot hierarchy.');
	return role;
}

async function authorizeTarget(context, discordCall, memberId) {
	if (!/^\d{17,20}$/.test(memberId || '')) deny('Invalid member ID.', 400);
	const member = await discordCall('verifying role target', () => context.guild.members.fetch({ user: memberId, force: true }), null);
	if (!member) deny('Target authority unavailable.', 503);
	if (member.id === context.guild.ownerId || member.id === context.bot.id
		|| context.bot.roles.highest.comparePositionTo(member.roles.highest) <= 0
		|| (!context.isOwner && member.id !== context.caller.id && context.caller.roles.highest.comparePositionTo(member.roles.highest) <= 0)) deny('Target is protected or above caller/bot hierarchy.');
	return member;
}

function batchRoles(context, member, roleIds) {
	if (!Array.isArray(roleIds) || roleIds.some(id => typeof id !== 'string')) deny('Invalid role list.', 400);
	const current = [...member.roles.cache.values()].filter(role => role.id !== context.guild.id);
	const preserved = current.filter(role => !canManageRole(context, role)).map(role => role.id);
	for (const id of roleIds) {
		if (!preserved.includes(id)) assertRole(context, id);
	}
	return [...new Set([...preserved, ...roleIds])];
}

module.exports = { authorizeConsole, authorizeRoleMutation, assertRole, authorizeTarget, batchRoles };
