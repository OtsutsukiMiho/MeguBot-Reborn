'use strict';
const { transaction } = require('./db');
const { newId } = require('./ids');
const { deriveRoleDecision } = require('./company-role-policy');
const sources = require('./team-membership-sources');

// Internal worker entry point: observations come from fresh bounded bot lookups,
// never gateway/cache rosters. Events schedule a lookup rather than supply proof.
async function reconcileMappingMember({ mappingId, userId, expectedRevision, observation, authority, job }) {
	if (process.env.MEGU_TEAM_ROLE_SYNC_ENABLED !== '1' || process.env.MEGU_PROJECT_TEAMS_ENABLED === '0' || process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED === '0') return { state: 'preserved', reason: 'sync_disabled' };
	if (typeof mappingId !== 'string' || typeof userId !== 'string' || !Number.isSafeInteger(expectedRevision)) throw new Error('role_sync_input_invalid');
	return transaction(async client => {
		await client.query("SELECT pg_advisory_xact_lock(hashtext('team-goals-identity'))");
		const route = (await client.query("SELECT team_id FROM server_role_mappings WHERE id=$1 AND kind='team'", [mappingId])).rows[0];
		if (!route) return { state: 'stale', reason: 'mapping_changed' };
		const team = (await client.query('SELECT id,archived_at FROM teams WHERE id=$1 FOR UPDATE', [route.team_id])).rows[0];
		const mapping = (await client.query('SELECT * FROM server_role_mappings WHERE id=$1 FOR UPDATE', [mappingId])).rows[0];
		if (!mapping || mapping.revision !== expectedRevision) return { state: 'stale', reason: 'mapping_changed' };
		if (job && !(await client.query(`SELECT 1 FROM server_role_sync_jobs WHERE id=$1 AND mapping_id=$2 AND mapping_revision=$3 AND generation=$4 AND lease_token=$5 AND lease_until>clock_timestamp() FOR UPDATE`, [job.id, mappingId, expectedRevision, job.generation, job.lease_token])).rows.length) return { state: 'stale', reason: 'lease_changed' };
		const actorId = mapping.owner_consent_by || mapping.created_by;
		const retire = reason => sources.retireMappingSource(client, team.id, userId, mapping.id, actorId, reason);
		const owner = (await client.query("SELECT user_id FROM team_memberships WHERE team_id=$1 AND role='owner' AND revoked_at IS NULL", [team.id])).rows[0];
		if (!mapping.enabled || mapping.retired_at || mapping.mode !== 'automatic' || mapping.delegation_version !== 1 || team.archived_at || owner?.user_id !== mapping.owner_consent_by) return retire('mapping_no_longer_authorized');
		try { await sources.requireManualMembership(client, team.id, owner.user_id); }
		catch (error) { if (error.code === 'team_manual_membership_required') return { state: 'preserved', reason: 'owner_provenance_unavailable' }; throw error; }
		const identity = (await client.query("SELECT provider_uid FROM identities WHERE user_id=$1 AND provider='discord' FOR SHARE", [userId])).rows[0];
		if (!identity) return retire('discord_identity_removed');
		const serverIdentity = (await client.query("SELECT provider_uid FROM identities WHERE user_id=$1 AND provider='discord' FOR SHARE", [mapping.server_consent_by])).rows[0];
		if (!authority?.available || authority.partial === true || authority.userId !== mapping.server_consent_by || authority.guildId !== mapping.guild_id || authority.discordUserId !== serverIdentity?.provider_uid || authority.isMember !== true || authority.isBot !== false || authority.canManageServer !== true) return { state: 'preserved', reason: 'server_authority_unavailable' };
		if (!observation?.available || observation.partial === true || observation.userId !== userId || observation.guildId !== mapping.guild_id || observation.discordUserId !== identity.provider_uid || (observation.isMember === true && typeof observation.isBot !== 'boolean')) return { state: 'preserved', reason: 'verification_unavailable' };
		const roleIds = (await client.query('SELECT role_id FROM server_role_mapping_roles WHERE mapping_id=$1 ORDER BY role_id', [mapping.id])).rows.map(row => row.role_id);
		if (!roleIds.length) return { state: 'preserved', reason: 'mapping_roles_unavailable' };
		const suppressed = await sources.isMembershipSuppressed(client, team.id, userId);
		const decision = deriveRoleDecision({ mapping: { kind: 'team', mode: 'automatic', enabled: true, guildId: mapping.guild_id, roleIds }, registered: true, suppressed,
			observation: { authoritative: true, guildId: observation.guildId, present: observation.isMember, bot: observation.isBot, roleIds: observation.roleIds } });
		if (decision.action === 'revoke_source') return retire(decision.reason);
		if (decision.action !== 'grant_member_source') return { state: 'preserved', reason: decision.reason };
		// Preserve retained Company restrictions; this never creates that eligibility.
		try { await require('./company-access').requireTeamCompanyAccess(client, team.id, userId, { write: true }); }
		catch (error) { if (['team_not_found', 'company_archived'].includes(error.code)) return { state: 'preserved', reason: 'legacy_eligibility_unavailable' }; throw error; }
		const existing = (await client.query('SELECT role,revoked_at FROM team_memberships WHERE team_id=$1 AND user_id=$2 FOR UPDATE', [team.id, userId])).rows[0];
		const active = (await client.query('SELECT id FROM team_membership_sources WHERE team_id=$1 AND user_id=$2 AND source_key=$3 AND revoked_at IS NULL', [team.id, userId, mapping.id])).rows[0];
		// An inconsistent retained source is not permission to resurrect membership.
		if (active) return existing && !existing.revoked_at ? { state: 'unchanged' } : { state: 'preserved', reason: 'source_membership_inconsistent' };
		if (!existing || existing.revoked_at) {
			const count = (await client.query('SELECT count(*)::int AS n FROM team_memberships WHERE team_id=$1 AND revoked_at IS NULL', [team.id])).rows[0].n;
			if (count >= 500) return { state: 'blocked', reason: 'team_member_limit' };
			await client.query("INSERT INTO team_memberships(team_id,user_id,role) VALUES ($1,$2,'member') ON CONFLICT(team_id,user_id) DO UPDATE SET role='member',revoked_at=NULL", [team.id, userId]);
		}
		const matchedRoleIds = roleIds.filter(id => observation.roleIds.includes(id));
		const source = (await client.query(`INSERT INTO team_membership_sources(id,team_id,user_id,kind,source_key,mapping_id,cycle,origin,metadata)
		 SELECT $1,$2,$3,'discord_role',$4,$4,COALESCE(MAX(cycle),0)+1,'automatic_role_sync',$5 FROM team_membership_sources WHERE team_id=$2 AND user_id=$3 AND source_key=$4 RETURNING id,cycle`,
		 [newId('tms'), team.id, userId, mapping.id, JSON.stringify({ mappingRevision: mapping.revision, roleIds: matchedRoleIds })])).rows[0];
		if (!existing || existing.revoked_at) await require('./server-role-notifications').enqueueMembership(client, { teamId: team.id, mappingId: mapping.id, userId, sourceId: source.id, cycle: source.cycle, change: 'granted' });
		await client.query('UPDATE teams SET revision=revision+1,updated_at=now() WHERE id=$1', [team.id]);
		await client.query("INSERT INTO team_events(id,team_id,actor_user_id,event_type,payload) VALUES ($1,$2,$3,'role_source_granted',$4)", [newId('tev'), team.id, actorId, JSON.stringify({ userId, mappingId, mappingRevision: mapping.revision, roleIds: matchedRoleIds, automatic: true })]);
		return { state: 'granted', restored: Boolean(existing?.revoked_at) };
	});
}

module.exports = { reconcileMappingMember };
