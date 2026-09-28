'use strict';

const assert = require('node:assert/strict');
const guildId = '123456789012345678';
const roleId = '223456789012345678';
let enabled = true;
let candidatesRead = false;
const dbPath = require.resolve('../core/db');
const teamsPath = require.resolve('../core/teams');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
	query: async sql => ({ rows: sql.includes('jsonb_agg') ? [{ id: 'mapping', guild_id: guildId, revision: 2, enabled, owner_consent_valid: true, mode: 'approval', roles: [{ id: roleId }] }] : sql.includes('suggestion_dismissals') ? [{ discord_user_id: 'eligible' }] : [{ user_id: 'removed' }] }),
} };
require.cache[teamsPath] = { id: teamsPath, filename: teamsPath, loaded: true, exports: {
	validate: { assertKnownFields: (input, fields) => { if (Object.keys(input).some(key => !fields.includes(key))) throw new Error('request_body_invalid'); } },
	accessById: async () => ({ role: 'owner' }),
	listDiscordCandidates: async (_team, _actor, guild, members) => {
		assert.equal(guild, guildId);
		assert.deepEqual(members.map(member => member.id), ['eligible']);
		candidatesRead = true;
		return { team: { revision: 5 }, candidates: [{ userId: 'removed', discordUserId: 'eligible', linkedAccount: true }] };
	},
} };
const { previewRoleMembers } = require('../core/server-role-mappings');
const dependencies = {
	verify: async (userId, guild, options) => {
		assert.equal(options.management, true);
		return { available: true, userId, guildId: guild, isMember: true, canManageServer: true };
	},
	listCandidates: async options => {
		assert.deepEqual(options, { guildId, roleIds: [roleId], limit: 30, offset: 0 });
		return { available: true, guildId, nextOffset: 30, members: [
			{ id: 'eligible', roles: [roleId] }, { id: 'bot', isBot: true, roles: [roleId] }, { id: 'wrong-role', roles: [] },
		] };
	},
};
(async () => {
	const result = await previewRoleMembers('team', 'owner', {}, dependencies);
	assert.equal(candidatesRead, true);
	assert.equal(result.partial, true);
	assert.equal(result.revision, 2);
	assert.equal(result.teamRevision, 5);
	assert.equal(result.nextOffset, 30);
	assert.equal(result.candidates[0].restoreRequired, true);
	assert.equal(result.candidates[0].dismissed, true);
	for (const offset of [-1, 0.5, 'NaN', 100001]) await assert.rejects(previewRoleMembers('team', 'owner', { offset }, dependencies), /request_body_invalid/);
	await assert.rejects(previewRoleMembers('team', 'owner', {}, { ...dependencies, verify: async () => ({ available: false }) }), /discord_guilds_unavailable/);
	await assert.rejects(previewRoleMembers('team', 'owner', {}, { ...dependencies, verify: async () => ({ available: true, userId: 'owner', guildId, isMember: true, canManageServer: false }) }), /team_forbidden/);
	await assert.rejects(previewRoleMembers('team', 'owner', {}, { ...dependencies, listCandidates: async () => ({ available: true, guildId: 'other', members: [] }) }), /discord_guilds_unavailable/);
	enabled = false;
	await assert.rejects(previewRoleMembers('team', 'owner', {}, dependencies), /role_mapping_consent_required/);
	console.log('server-role-preview: passed (partial roster, role filtering, restoration, permissions, scope, pagination)');
})().catch(error => { console.error(error); process.exitCode = 1; });
