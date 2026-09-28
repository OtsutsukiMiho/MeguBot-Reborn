'use strict';

function error(code) { return Object.assign(new Error(code), { code }); }

/** Pure policy shared by preview and reconciliation. Discord failures are not
 * negative membership evidence. Persistence must still lock/recheck revisions.
 */
function deriveRoleDecision({ mapping, observation, suppressed = false, registered = false }) {
	if (!mapping || !['team', 'title'].includes(mapping.kind)) throw error('role_mapping_kind_invalid');
	if (!['approval', 'automatic'].includes(mapping.mode)) throw error('role_mapping_mode_invalid');
	if (!Array.isArray(mapping.roleIds) || mapping.roleIds.length === 0) throw error('role_mapping_roles_required');
	if (!mapping.enabled) return { action: 'revoke_source', reason: 'mapping_disabled' };
	if (suppressed) return { action: 'revoke_source', reason: 'manually_suppressed' };
	if (!registered) return { action: 'none', reason: 'sign_in_required' };
	if (!observation || observation.guildId !== mapping.guildId || observation.authoritative !== true) {
		return { action: 'preserve', reason: 'verification_unavailable' };
	}
	if (observation.bot === true) return { action: 'revoke_source', reason: 'bot_excluded' };
	if (observation.present !== true && observation.present !== false) {
		return { action: 'preserve', reason: 'verification_unavailable' };
	}
	if (observation.present && !Array.isArray(observation.roleIds)) {
		return { action: 'preserve', reason: 'verification_unavailable' };
	}
	const matches = observation.present && mapping.roleIds.some(id => observation.roleIds.includes(id));
	if (!matches) return { action: 'revoke_source', reason: 'role_not_held' };
	if (mapping.kind === 'title') return { action: 'display_title', reason: 'role_held' };
	if (mapping.mode === 'approval') return { action: 'suggest', reason: 'approval_required' };
	return { action: 'grant_member_source', reason: 'role_held' };
}

function validateRoleSelection(guildId, selectedIds, roles) {
	if (!/^\d{17,20}$/.test(guildId || '')) throw error('discord_guild_invalid');
	if (!Array.isArray(selectedIds) || selectedIds.length === 0 || selectedIds.length > 50) throw error('role_mapping_roles_required');
	const ids = [...new Set(selectedIds)];
	const lookup = new Map(roles.map(role => [role.id, role]));
	for (const id of ids) {
		const role = lookup.get(id);
		if (!role || role.guildId !== guildId || id === guildId || role.managed) throw error('discord_role_ineligible');
	}
	return ids;
}

module.exports = { deriveRoleDecision, validateRoleSelection };
