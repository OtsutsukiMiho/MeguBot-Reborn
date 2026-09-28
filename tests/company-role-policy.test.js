'use strict';
const assert = require('node:assert/strict');
const { deriveRoleDecision: decide, validateRoleSelection } = require('../core/company-role-policy');
const guildId = '467655562658578432';
const mapping = { guildId, kind: 'team', mode: 'automatic', enabled: true, roleIds: ['it', 'dev'] };
const observation = { guildId, authoritative: true, present: true, roleIds: ['dev'], bot: false };
const input = { mapping, observation, registered: true };
assert.equal(decide(input).action, 'grant_member_source');
assert.equal(decide({ ...input, mapping: { ...mapping, mode: 'approval' } }).action, 'suggest');
assert.equal(decide({ ...input, mapping: { ...mapping, kind: 'title' } }).action, 'display_title');
assert.equal(decide({ ...input, suppressed: true }).action, 'revoke_source');
assert.equal(decide({ ...input, registered: false }).action, 'none');
assert.equal(decide({ ...input, mapping: { ...mapping, enabled: false } }).action, 'revoke_source');
for (const unavailable of [null, {}, { ...observation, authoritative: false }, { ...observation, guildId: 'other' }, { ...observation, roleIds: undefined }, { ...observation, present: undefined }]) {
	assert.equal(decide({ ...input, observation: unavailable }).action, 'preserve');
}
for (const absent of [{ ...observation, present: false }, { ...observation, roleIds: [] }, { ...observation, bot: true }]) {
	assert.equal(decide({ ...input, observation: absent }).action, 'revoke_source');
}
const roles = [{ id: 'it', guildId }, { id: 'managed', guildId, managed: true }, { id: guildId, guildId }, { id: 'foreign', guildId: 'other' }];
assert.deepEqual(validateRoleSelection(guildId, ['it', 'it'], roles), ['it']);
for (const id of ['managed', guildId, 'foreign', 'missing']) {
	assert.throws(() => validateRoleSelection(guildId, [id], roles), { code: 'discord_role_ineligible' });
}
assert.throws(() => validateRoleSelection(guildId, [], roles), { code: 'role_mapping_roles_required' });
console.log('Company role policy: automatic, approval, titles, suppression, unavailable evidence, and guild isolation passed.');
