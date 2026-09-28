'use strict';

const { newId } = require('./ids');

async function installTeamMembershipSourceSchema(client) {
	await client.query("SELECT pg_advisory_xact_lock(hashtextextended('team-membership-source-schema',0))");
	const firstInstall = !(await client.query("SELECT to_regclass('team_membership_sources') AS existing")).rows[0].existing;
	await client.query('CREATE UNIQUE INDEX IF NOT EXISTS server_role_mappings_id_team_key ON server_role_mappings(id,team_id)');
	await client.query(`CREATE TABLE IF NOT EXISTS team_membership_sources (
		id TEXT PRIMARY KEY,
		team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
		kind TEXT NOT NULL CHECK (kind IN ('manual','discord_role')),
		source_key TEXT NOT NULL,
		mapping_id TEXT,
		cycle INTEGER NOT NULL CHECK (cycle > 0),
		granted_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
		origin TEXT NOT NULL,
		metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
		granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		revoked_at TIMESTAMPTZ,
		revocation_reason TEXT,
		FOREIGN KEY(mapping_id,team_id) REFERENCES server_role_mappings(id,team_id) ON DELETE RESTRICT,
		CHECK ((kind='manual' AND source_key='manual' AND mapping_id IS NULL)
		 OR (kind='discord_role' AND mapping_id IS NOT NULL AND source_key=mapping_id)),
		CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL))
	)`);
	await client.query('CREATE UNIQUE INDEX IF NOT EXISTS team_membership_sources_active_key ON team_membership_sources(team_id,user_id,source_key) WHERE revoked_at IS NULL');
	await client.query('CREATE INDEX IF NOT EXISTS team_membership_sources_user_idx ON team_membership_sources(user_id,team_id)');
	await client.query('CREATE INDEX IF NOT EXISTS team_membership_sources_mapping_idx ON team_membership_sources(mapping_id,user_id,revoked_at) WHERE mapping_id IS NOT NULL');
	// This migration runs exactly once, in the schema transaction. Repeating it
	// would convert future derived memberships into permanent manual grants.
	if (firstInstall) await client.query(`INSERT INTO team_membership_sources(id,team_id,user_id,kind,source_key,cycle,origin,granted_at)
	 SELECT 'tms_'||md5(json_build_array(team_id,user_id)::text),team_id,user_id,'manual','manual',1,'legacy_backfill',joined_at
	 FROM team_memberships WHERE revoked_at IS NULL`);
	const firstSuppressionInstall = !(await client.query("SELECT to_regclass('team_membership_suppressions') AS existing")).rows[0].existing;
	await client.query(`CREATE TABLE IF NOT EXISTS team_membership_suppressions (
		id TEXT PRIMARY KEY,
		team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
		created_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
		reason TEXT NOT NULL,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		cleared_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
		cleared_at TIMESTAMPTZ,
		CHECK ((cleared_at IS NULL) = (cleared_by IS NULL))
	)`);
	// Multiple active history rows after an account merge are intentional. Any
	// one blocks re-entry; only a human restoration clears all of them together.
	await client.query('CREATE INDEX IF NOT EXISTS team_membership_suppressions_active_idx ON team_membership_suppressions(team_id,user_id) WHERE cleared_at IS NULL');
	await client.query('CREATE INDEX IF NOT EXISTS team_membership_suppressions_user_idx ON team_membership_suppressions(user_id,team_id)');
	if (firstSuppressionInstall) await client.query(`INSERT INTO team_membership_suppressions(id,team_id,user_id,reason,created_at)
	 SELECT 'tsp_'||md5(json_build_array(team_id,user_id)::text),team_id,user_id,'legacy_removed',revoked_at
	 FROM team_memberships WHERE revoked_at IS NOT NULL`);
}

// Call within the membership writer's existing transaction, with the team row locked.
async function grantManualSource(client, teamId, userId, actorId, origin, metadata = {}) {
	if (await isMembershipSuppressed(client, teamId, userId)) throw Object.assign(new Error('team_member_restore_confirmation_required'), { code: 'team_member_restore_confirmation_required' });
	const member = (await client.query('SELECT 1 FROM team_memberships WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL', [teamId, userId])).rows[0];
	if (!member) throw Object.assign(new Error('team_member_not_found'), { code: 'team_member_not_found' });
	await client.query(`INSERT INTO team_membership_sources(id,team_id,user_id,kind,source_key,cycle,granted_by,origin,metadata)
	 SELECT $1,$2,$3,'manual','manual',COALESCE(MAX(cycle),0)+1,$4,$5,$6 FROM team_membership_sources WHERE team_id=$2 AND user_id=$3 AND source_key='manual'
	 ON CONFLICT(team_id,user_id,source_key) WHERE revoked_at IS NULL DO NOTHING`,
	[newId('tms'), teamId, userId, actorId, origin, JSON.stringify(metadata)]);
}

// Ownership must not depend on a Discord role that can disappear. Call after
// checking access and while holding the same team lock as membership writers.
async function requireManualMembership(client, teamId, userId) {
	const found = await client.query(`SELECT 1 FROM team_memberships m
	 WHERE m.team_id=$1 AND m.user_id=$2 AND m.revoked_at IS NULL
	 AND EXISTS (SELECT 1 FROM team_membership_sources s WHERE s.team_id=m.team_id AND s.user_id=m.user_id AND s.kind='manual' AND s.revoked_at IS NULL)
	 AND NOT EXISTS (SELECT 1 FROM team_membership_suppressions s WHERE s.team_id=m.team_id AND s.user_id=m.user_id AND s.cleared_at IS NULL)`, [teamId, userId]);
	if (!found.rows.length) throw Object.assign(new Error('team_manual_membership_required'), { code: 'team_manual_membership_required' });
}

async function revokeMembershipSources(client, teamId, userId, reason) {
	await client.query('UPDATE team_membership_sources SET revoked_at=now(),revocation_reason=$3 WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL', [teamId, userId, reason]);
}

// Internal source retirement, never manual removal: preserve other sources and
// do not suppress role restoration. Use the same effective revocation as teams.
async function retireMappingSource(client, teamId, userId, mappingId, actorId, reason) {
	await client.query('SELECT id FROM teams WHERE id=$1 FOR UPDATE', [teamId]);
	const source = (await client.query("SELECT id,cycle,metadata FROM team_membership_sources WHERE team_id=$1 AND user_id=$2 AND mapping_id=$3 AND kind='discord_role' AND revoked_at IS NULL FOR UPDATE", [teamId, userId, mappingId])).rows[0];
	if (!source) return { state: 'none' };
	const other = await client.query('SELECT 1 FROM team_membership_sources WHERE team_id=$1 AND user_id=$2 AND source_key<>$3 AND revoked_at IS NULL LIMIT 1', [teamId, userId, mappingId]);
	let impact = null;
	if (!other.rows.length) {
		try { impact = await require('./teams').revokeTeamEligibilityWithClient(client, teamId, userId, actorId); }
		catch (error) {
			if (!['team_owner_transfer_required', 'team_project_owner_transfer_required'].includes(error.code)) throw error;
			await client.query("UPDATE team_membership_sources SET metadata=metadata||jsonb_build_object('blockedRevocation',jsonb_build_object('reason',$2::text,'observedAt',now())) WHERE id=$1", [source.id, error.code]);
			await require('./server-role-notifications').enqueueAttention(client, { mappingId, sourceId: source.id, cycle: source.cycle });
			return { state: 'blocked', reason: error.code };
		}
	}
	await client.query('UPDATE team_membership_sources SET revoked_at=now(),revocation_reason=$2 WHERE id=$1', [source.id, reason]);
	if (impact?.removed) await require('./server-role-notifications').enqueueMembership(client, { teamId, mappingId, userId, sourceId: source.id, cycle: source.cycle, change: 'revoked' });
	if (!impact?.removed) await client.query('UPDATE teams SET revision=revision+1,updated_at=now() WHERE id=$1', [teamId]);
	await client.query("INSERT INTO team_events(id,team_id,actor_user_id,event_type,payload) VALUES ($1,$2,$3,'role_source_retired',$4)", [newId('tev'), teamId, actorId, JSON.stringify({ userId, mappingId, reason, automatic: true, effectiveMembershipRevoked: Boolean(impact?.removed), ...(impact?.impact || {}) })]);
	return { state: other.rows.length ? 'preserved' : 'revoked', ...(impact?.impact || {}) };
}

async function isMembershipSuppressed(client, teamId, userId) {
	return (await client.query('SELECT 1 FROM team_membership_suppressions WHERE team_id=$1 AND user_id=$2 AND cleared_at IS NULL LIMIT 1', [teamId, userId])).rows.length > 0;
}

// Callers hold the team lock and revoke effective membership in this transaction.
async function suppressMembership(client, teamId, userId, actorId, reason) {
	await revokeMembershipSources(client, teamId, userId, reason);
	await client.query(`INSERT INTO team_membership_suppressions(id,team_id,user_id,created_by,reason)
	 SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS (
	 SELECT 1 FROM team_membership_suppressions WHERE team_id=$2 AND user_id=$3 AND cleared_at IS NULL)`,
	[newId('tsp'), teamId, userId, actorId, reason]);
}

// A verified manager's explicit restoration is the only clearing path. Account
// merges preserve every row, never manufacture a human clearing decision.
async function restoreSuppressedMembership(client, teamId, userId, actorId, confirmed, { errorCode = 'team_member_restore_confirmation_required', expectedRevision, teamRevision } = {}) {
	if (!await isMembershipSuppressed(client, teamId, userId)) return [];
	if (confirmed !== true) throw Object.assign(new Error(errorCode), { code: errorCode });
	if (expectedRevision !== teamRevision) throw Object.assign(new Error('revision_conflict'), { code: 'revision_conflict' });
	return (await client.query('UPDATE team_membership_suppressions SET cleared_at=now(),cleared_by=$3 WHERE team_id=$1 AND user_id=$2 AND cleared_at IS NULL RETURNING id', [teamId, userId, actorId])).rows.map(row => row.id);
}

async function mergeMembershipSources(client, survivorId, mergedId) {
	// Keep both histories, but collapse duplicate active eligibility. Never infer
	// a manual grant merely because effective membership survived an account merge.
	await client.query(`UPDATE team_membership_sources old SET revoked_at=now(),revocation_reason='account_merge_duplicate'
	 WHERE old.user_id=$2 AND old.revoked_at IS NULL AND EXISTS (
	 SELECT 1 FROM team_membership_sources kept WHERE kept.user_id=$1 AND kept.team_id=old.team_id AND kept.source_key=old.source_key AND kept.revoked_at IS NULL)`, [survivorId, mergedId]);
	await client.query('UPDATE team_membership_sources SET user_id=$1 WHERE user_id=$2', [survivorId, mergedId]);
}

module.exports = { installTeamMembershipSourceSchema, grantManualSource, revokeMembershipSources, retireMappingSource, mergeMembershipSources, isMembershipSuppressed, suppressMembership, restoreSuppressedMembership, requireManualMembership };
