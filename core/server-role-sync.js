'use strict';
const db = require('./db');
const { newId } = require('./ids');

function enabled() { return process.env.MEGU_TEAM_ROLE_SYNC_ENABLED === '1' && process.env.MEGU_PROJECT_TEAMS_ENABLED !== '0' && process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED !== '0'; }

// Callers hold the ordinary identity/team locks when changing configuration.
// Events contain no membership proof: they only invalidate/coalesce queued work.
async function enqueueWithClient(client, mappingId, userId = null) {
	if (!enabled()) return false;
	return (await client.query(`INSERT INTO server_role_sync_jobs(id,mapping_id,user_id,mapping_revision)
	 SELECT $1,id,$3,revision FROM server_role_mappings WHERE id=$2 AND kind='team'
	 ON CONFLICT(mapping_id,(COALESCE(user_id,''))) DO UPDATE SET mapping_revision=EXCLUDED.mapping_revision,
	 generation=server_role_sync_jobs.generation+1,cursor_user_id=NULL,state='pending',lease_token=NULL,lease_until=NULL,
	 next_attempt_at=now(),attempts=0,counts='{}'::jsonb,last_error=NULL,updated_at=now() RETURNING id`, [newId('rsj'), mappingId, userId])).rows.length > 0;
}

async function enqueue(mappingId, userId = null) { return db.transaction(client => enqueueWithClient(client, mappingId, userId)); }

const COALESCE_WORK = `ON CONFLICT(mapping_id,(COALESCE(user_id,''))) DO UPDATE SET mapping_revision=EXCLUDED.mapping_revision,
 generation=server_role_sync_jobs.generation+1,cursor_user_id=NULL,state='pending',lease_token=NULL,lease_until=NULL,
 next_attempt_at=now(),attempts=0,counts='{}'::jsonb,last_error=NULL,updated_at=now() RETURNING id`;

async function enqueueIdentityWithClient(client, userId) {
	if (!enabled()) return 0;
	const memberJobs = (await client.query(`INSERT INTO server_role_sync_jobs(id,mapping_id,user_id,mapping_revision)
	 SELECT 'rsj_identity_'||md5(json_build_array(m.id,$1::text)::text),m.id,$1,m.revision FROM server_role_mappings m WHERE m.kind='team'
	 AND ((m.enabled AND m.mode='automatic' AND m.retired_at IS NULL) OR EXISTS(SELECT 1 FROM team_membership_sources s WHERE s.mapping_id=m.id AND s.user_id=$1 AND s.revoked_at IS NULL)) ${COALESCE_WORK}`, [userId])).rows.length;
	const authorityJobs = (await client.query(`INSERT INTO server_role_sync_jobs(id,mapping_id,mapping_revision)
	 SELECT 'rsj_sweep_'||m.id,m.id,m.revision FROM server_role_mappings m WHERE m.kind='team' AND m.server_consent_by=$1 AND m.enabled AND m.mode='automatic' AND m.retired_at IS NULL ${COALESCE_WORK}`, [userId])).rows.length;
	return memberJobs + authorityJobs;
}

async function enqueueDiscordMember(guildId, discordUserId, changedRoleIds = null) {
	if (!enabled() || !/^\d{17,20}$/.test(guildId || '') || !/^\d{17,20}$/.test(discordUserId || '')) return 0;
	if (changedRoleIds !== null && (!Array.isArray(changedRoleIds) || changedRoleIds.length > 500 || changedRoleIds.some(id => !/^\d{17,20}$/.test(id)))) throw new Error('role_sync_input_invalid');
	return db.transaction(async client => {
		await client.query("SELECT pg_advisory_xact_lock(hashtext('team-goals-identity'))");
		const identity = (await client.query("SELECT user_id FROM identities WHERE provider='discord' AND provider_uid=$1", [discordUserId])).rows[0];
		if (!identity) return 0;
		const memberJobs = (await client.query(`INSERT INTO server_role_sync_jobs(id,mapping_id,user_id,mapping_revision)
		 SELECT 'rsj_event_'||md5(json_build_array(m.id,$2::text)::text),m.id,$2,m.revision FROM server_role_mappings m WHERE m.kind='team' AND m.guild_id=$1
		 AND (((m.enabled AND m.mode='automatic' AND m.retired_at IS NULL) AND ($3::text[] IS NULL OR EXISTS(SELECT 1 FROM server_role_mapping_roles r WHERE r.mapping_id=m.id AND r.role_id=ANY($3))))
		 OR EXISTS(SELECT 1 FROM team_membership_sources s WHERE s.mapping_id=m.id AND s.user_id=$2 AND s.revoked_at IS NULL)) ${COALESCE_WORK}`, [guildId, identity.user_id, changedRoleIds])).rows.length;
		// A consenting manager's role/departure change affects the whole mapping,
		// even when the changed role is not a selected membership role.
		const authorityJobs = (await client.query(`INSERT INTO server_role_sync_jobs(id,mapping_id,mapping_revision)
		 SELECT 'rsj_sweep_'||m.id,m.id,m.revision FROM server_role_mappings m WHERE m.kind='team' AND m.guild_id=$1 AND m.server_consent_by=$2 AND m.enabled AND m.mode='automatic' AND m.retired_at IS NULL ${COALESCE_WORK}`, [guildId, identity.user_id])).rows.length;
		return memberJobs + authorityJobs;
	});
}

async function enqueueGuild(guildId) {
	if (!enabled() || !/^\d{17,20}$/.test(guildId || '')) return 0;
	return (await db.query(`INSERT INTO server_role_sync_jobs(id,mapping_id,mapping_revision)
	 SELECT 'rsj_sweep_'||m.id,m.id,m.revision FROM server_role_mappings m WHERE m.kind='team' AND m.guild_id=$1
	 AND ((m.enabled AND m.mode='automatic' AND m.retired_at IS NULL) OR EXISTS(SELECT 1 FROM team_membership_sources s WHERE s.mapping_id=m.id AND s.revoked_at IS NULL)) ${COALESCE_WORK}`, [guildId])).rows.length;
}

async function refreshRoleSnapshot(guildId, roleId, name) {
	if (!enabled() || !/^\d{17,20}$/.test(guildId || '') || !/^\d{17,20}$/.test(roleId || '') || typeof name !== 'string' || !name.trim() || name.length > 100) return 0;
	return (await db.query(`UPDATE server_role_mapping_roles r SET name_snapshot=$3 FROM server_role_mappings m
	 WHERE r.mapping_id=m.id AND m.guild_id=$1 AND m.retired_at IS NULL AND r.role_id=$2 AND r.name_snapshot<>$3`, [guildId, roleId, name])).rowCount;
}

async function scheduleMissingSweeps() {
	if (!enabled()) return 0;
	return (await db.query(`INSERT INTO server_role_sync_jobs(id,mapping_id,mapping_revision)
	 SELECT 'rsj_sweep_'||m.id,m.id,m.revision FROM server_role_mappings m WHERE m.kind='team'
	 AND ((m.enabled AND m.mode='automatic' AND m.retired_at IS NULL) OR EXISTS(SELECT 1 FROM team_membership_sources s WHERE s.mapping_id=m.id AND s.revoked_at IS NULL))
	 ON CONFLICT(mapping_id,(COALESCE(user_id,''))) DO NOTHING RETURNING id`)).rows.length;
}

async function wakeSweeps() {
	if (!enabled()) return 0;
	await scheduleMissingSweeps();
	return (await db.query("UPDATE server_role_sync_jobs SET next_attempt_at=now() WHERE user_id IS NULL AND state IN ('idle','blocked','degraded') AND lease_token IS NULL RETURNING id")).rows.length;
}

async function claim() {
	if (!enabled()) return null;
	return db.transaction(async client => {
		const job = (await client.query(`SELECT j.*,m.guild_id,m.server_consent_by,m.owner_consent_by,m.enabled,m.mode,m.retired_at,m.revision AS current_revision
		 FROM server_role_sync_jobs j JOIN server_role_mappings m ON m.id=j.mapping_id
		 WHERE j.next_attempt_at<=clock_timestamp() AND (j.lease_until IS NULL OR j.lease_until<=clock_timestamp())
		 ORDER BY j.next_attempt_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`)).rows[0];
		if (!job) return null;
		const reset = job.state === 'idle' || job.state === 'blocked' || job.mapping_revision !== job.current_revision;
		const token = newId('rsl');
		return (await client.query(`UPDATE server_role_sync_jobs SET state='running',lease_token=$2,lease_until=clock_timestamp()+interval '90 seconds',
		 mapping_revision=$3,cursor_user_id=CASE WHEN $4 THEN NULL ELSE cursor_user_id END,counts=CASE WHEN $4 THEN '{}'::jsonb ELSE counts END,
		 attempts=attempts+1,updated_at=now() WHERE id=$1 RETURNING *`, [job.id, token, job.current_revision, reset])).rows.map(row => ({ ...job, ...row }))[0];
	});
}

async function candidates(job, limit) {
	if (job.user_id) return [job.user_id];
	return (await db.query(`SELECT user_id FROM (
	 (SELECT user_id FROM identities WHERE provider='discord' AND $4 AND ($2::text IS NULL OR user_id>$2) ORDER BY user_id LIMIT $3)
	 UNION
	 (SELECT DISTINCT user_id FROM team_membership_sources WHERE mapping_id=$1 AND revoked_at IS NULL AND ($2::text IS NULL OR user_id>$2) ORDER BY user_id LIMIT $3)
	 ) users ORDER BY user_id LIMIT $3`, [job.mapping_id, job.cursor_user_id, limit + 1, Boolean(job.enabled && job.mode === 'automatic' && !job.retired_at)])).rows.map(row => row.user_id);
}

async function verifyBounded(verify, userId, guildId, management = false) {
	if (!userId || typeof verify !== 'function') return { available: false };
	let timer;
	try { return await Promise.race([Promise.resolve().then(() => verify(userId, guildId, { management })), new Promise(resolve => { timer = setTimeout(() => resolve({ available: false }), 12_000); })]); }
	catch { return { available: false }; }
	finally { clearTimeout(timer); }
}

async function checkpoint(job, { cursor, counts, state = 'pending', error = null, delaySeconds = 0, success = false }) {
	return db.transaction(async client => {
		await client.query("SELECT pg_advisory_xact_lock(hashtext('team-goals-identity'))");
		const saved = (await client.query(`UPDATE server_role_sync_jobs SET cursor_user_id=$4,counts=$5,state=$6,last_error=$7,
	 lease_token=NULL,lease_until=NULL,next_attempt_at=clock_timestamp()+($8::int*interval '1 second'),
	 attention_cycle=CASE WHEN $6 IN ('degraded','blocked') AND NOT attention_open THEN attention_cycle+1 ELSE attention_cycle END,
	 attention_open=CASE WHEN $6 IN ('degraded','blocked') THEN true WHEN $9 THEN false ELSE attention_open END,
	 last_success_at=CASE WHEN $9 THEN now() ELSE last_success_at END,updated_at=now()
	 WHERE id=$1 AND generation=$2 AND lease_token=$3 AND lease_until>clock_timestamp() RETURNING id,attention_cycle`,
	 [job.id, job.generation, job.lease_token, cursor, JSON.stringify(counts), state, error, delaySeconds, success])).rows[0];
		if (saved && (state === 'degraded' || (state === 'blocked' && counts.capacityBlocked))) await require('./server-role-notifications').enqueueAttention(client, { mappingId: job.mapping_id, jobId: saved.id, attentionCycle: saved.attention_cycle });
		return Boolean(saved);
	});
}

// One bounded batch per call; no HTTP request scans a server. No new pool/bot.
async function runOnce({ verify, limit = 5 } = {}) {
	if (!enabled()) return { processed: 0, disabled: true };
	if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error('role_sync_limit_invalid');
	await scheduleMissingSweeps();
	const job = await claim();
	if (!job) return { processed: 0 };
	const counts = { ...job.counts };
	let cursor = job.cursor_user_id, processed = 0;
	try {
		const users = await candidates(job, limit);
		const needsProof = job.enabled && job.mode === 'automatic' && !job.retired_at;
		const authority = needsProof ? await verifyBounded(verify, job.server_consent_by, job.guild_id, true) : null;
		for (const userId of users.slice(0, limit)) {
			const observation = needsProof ? await verifyBounded(verify, userId, job.guild_id) : null;
			const result = await require('./server-role-reconciliation').reconcileMappingMember({ mappingId: job.mapping_id, userId, expectedRevision: job.mapping_revision, observation, authority, job });
			if (result.state === 'stale') {
				await checkpoint(job, { cursor, counts, state: 'pending', delaySeconds: 5, error: result.reason });
				return { processed, stale: true };
			}
			if (['sync_disabled', 'verification_unavailable', 'server_authority_unavailable', 'owner_provenance_unavailable', 'mapping_roles_unavailable', 'legacy_eligibility_unavailable', 'source_membership_inconsistent'].includes(result.reason)) {
				await checkpoint(job, { cursor, counts, state: 'degraded', error: result.reason, delaySeconds: Math.min(900, 30 * 2 ** Math.min(job.attempts, 5)) });
				return { processed, degraded: true };
			}
			counts[result.state] = (counts[result.state] || 0) + 1;
			if (result.reason === 'team_member_limit') counts.capacityBlocked = (counts.capacityBlocked || 0) + 1;
			cursor = userId; processed++;
		}
		const done = job.user_id || users.length <= limit;
		await checkpoint(job, { cursor: done ? null : cursor, counts, state: done ? (counts.blocked ? 'blocked' : 'idle') : 'pending',
		 delaySeconds: done ? (job.user_id && !counts.blocked ? 2147483647 : 900) : 0, success: Boolean(done && !counts.blocked), error: counts.blocked ? 'revocation_or_capacity_blocked' : null });
		return { processed, done: Boolean(done), counts };
	} catch {
		await checkpoint(job, { cursor, counts, state: 'degraded', error: 'reconciliation_failed', delaySeconds: Math.min(900, 30 * 2 ** Math.min(job.attempts, 5)) });
		return { processed, degraded: true };
	}
}

async function mergeJobs(client, survivorId, mergedId) {
	// Coalesce affected identities into a full fresh sweep; no stale lease survives.
	const mappings = (await client.query('DELETE FROM server_role_sync_jobs WHERE user_id=ANY($1::text[]) RETURNING mapping_id', [[survivorId, mergedId]])).rows;
	for (const { mapping_id: mappingId } of new Map(mappings.map(row => [row.mapping_id, row])).values()) {
		await client.query(`INSERT INTO server_role_sync_jobs(id,mapping_id,mapping_revision)
		 SELECT $1,id,revision FROM server_role_mappings WHERE id=$2
		 ON CONFLICT(mapping_id,(COALESCE(user_id,''))) DO UPDATE SET generation=server_role_sync_jobs.generation+1,
		 cursor_user_id=NULL,state='pending',lease_token=NULL,lease_until=NULL,next_attempt_at=now(),counts='{}'::jsonb,last_error=NULL`, [newId('rsj'), mappingId]);
	}
}

module.exports = { enabled, enqueueWithClient, enqueue, enqueueIdentityWithClient, enqueueDiscordMember, enqueueGuild, refreshRoleSnapshot, scheduleMissingSweeps, wakeSweeps, runOnce, mergeJobs };
