'use strict';
const { createHash, randomBytes } = require('node:crypto');
const db = require('./db'), sources = require('./team-membership-sources'), sync = require('./server-role-sync');
const { accessById, validate } = require('./teams');
const { validateRoleSelection } = require('./company-role-policy');
const { newId } = require('./ids');
const POLICY_VERSION = 1;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const digest = value => createHash('sha256').update(value).digest('hex');
const requestHash = input => digest(JSON.stringify(Object.keys(input).sort().map(key => [key, input[key]])));
function enabled() { if (!sync.enabled()) fail('role_mapping_automatic_not_supported'); }
function inputContract(input, fields) {
	validate.assertKnownFields(input, fields);
	if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) fail('revision_conflict');
}
function requestContract(input) {
	if (!/^[a-zA-Z0-9_-]{16,100}$/.test(input.requestKey || '')) fail('idempotency_key_invalid');
}
function consent(input) { if (input.delegationVersion !== POLICY_VERSION || input.confirmedDelegation !== true) fail('role_mapping_delegation_confirmation_required'); }
async function mapping(client, teamId, lock = false) {
	const found = (await client.query(`SELECT *,sync_preview_expires_at>clock_timestamp() AS sync_preview_valid FROM server_role_mappings WHERE team_id=$1 AND kind='team' AND retired_at IS NULL ${lock ? 'FOR UPDATE' : ''}`, [teamId])).rows[0];
	if (!found) fail('role_mapping_not_found'); return found;
}
async function identityProof(client, evidence, userId, guildId, management) {
	if (!evidence?.available || evidence.partial === true) fail('discord_guilds_unavailable');
	const identity = (await client.query("SELECT provider_uid FROM identities WHERE user_id=$1 AND provider='discord' FOR SHARE", [userId])).rows[0];
	if (!identity || evidence.userId !== userId || evidence.guildId !== guildId || evidence.discordUserId !== identity.provider_uid || evidence.isMember !== true || evidence.isBot !== false || (management && evidence.canManageServer !== true)) fail('team_forbidden');
}
async function receipt(client, teamId, actorId, requestKey, hash) {
	const event = (await client.query("SELECT actor_user_id,payload FROM team_events WHERE team_id=$1 AND event_type IN ('role_sync_requested','role_sync_transition') AND payload->>'requestKey'=$2 ORDER BY created_at,id LIMIT 1", [teamId, requestKey])).rows[0];
	if (!event) return null;
	if (event.actor_user_id !== actorId || event.payload.requestHash !== hash) fail('idempotency_conflict');
	return event.payload.result;
}
async function record(client, teamId, actorId, type, input, result, mappingId) {
	await client.query('INSERT INTO team_events(id,team_id,actor_user_id,event_type,payload) VALUES ($1,$2,$3,$4,$5)', [newId('tev'), teamId, actorId, type, JSON.stringify({ mappingId, requestKey: input.requestKey, requestHash: requestHash(input), policyVersion: POLICY_VERSION, result })]);
}

// A server manager may request delegation for a known team, never read its
// private roster or enroll anyone. Only its current native owner can confirm.
async function requestAutomatic(guildId, teamId, actorId, input, { verify, getCapabilities, listRoles }) {
	enabled(); inputContract(input, ['expectedRevision','requestKey','delegationVersion','confirmedDelegation']); requestContract(input); consent(input);
	if (!(await getCapabilities?.())?.available) fail('role_sync_capability_unavailable');
	const proof = await verify?.(actorId, guildId, { management: true });
	const discovery = await listRoles?.(guildId);
	if (!discovery?.available || discovery.guildId !== guildId || !Array.isArray(discovery.roles)) fail('discord_guilds_unavailable');
	return db.transaction(async client => {
		await client.query("SELECT pg_advisory_xact_lock(hashtext('team-goals-identity'))");
		const team = (await client.query('SELECT id FROM teams WHERE id=$1 AND discord_guild_id=$2 AND archived_at IS NULL FOR UPDATE', [teamId, guildId])).rows[0];
		if (!team) fail('team_not_found'); await identityProof(client, proof, actorId, guildId, true);
		const replay = await receipt(client, teamId, actorId, input.requestKey, requestHash(input)); if (replay) return replay;
		const current = await mapping(client, teamId, true);
		if (current.revision !== input.expectedRevision) fail('revision_conflict');
		if (current.mode !== 'approval' && current.enabled) fail('role_mapping_automatic_not_supported');
		const roles = (await client.query('SELECT role_id FROM server_role_mapping_roles WHERE mapping_id=$1', [current.id])).rows.map(row => row.role_id);
		validateRoleSelection(guildId, roles, discovery.roles);
		await client.query(`UPDATE server_role_mappings SET sync_action='enable',sync_requested_by=$2,sync_requested_at=now(),sync_request_revision=revision+1,
		 sync_preview_hash=NULL,sync_preview_owner=NULL,sync_preview_team_revision=NULL,sync_preview_expires_at=NULL,revision=revision+1,updated_at=now() WHERE id=$1`, [current.id, actorId]);
		const result = { id: current.id, revision: current.revision + 1, status: 'awaiting_automatic_owner_consent', delegationVersion: POLICY_VERSION };
		await record(client, teamId, actorId, 'role_sync_requested', input, result, current.id); return result;
	});
}

async function previewTransition(teamId, actorId, input, deps = {}) {
	enabled(); inputContract(input, ['expectedRevision','action','offset']);
	const offset = input.offset == null ? 0 : input.offset;
	if (!Number.isInteger(offset) || offset < 0 || offset > 100000) fail('request_body_invalid');
	if (!['enable','disable','approval','unlink'].includes(input.action)) fail('request_body_invalid');
	const team = await accessById({ query: db.query }, teamId, actorId, { allowArchived: false });
	if (team.role !== 'owner') fail('team_forbidden');
	const snapshot = await mapping({ query: db.query }, teamId);
	if (snapshot.revision !== input.expectedRevision) fail('revision_conflict');
	let proof, authority, discovery, memberPreview = null, memberPreviewTeamRevision;
	if (input.action === 'enable') {
		if ((snapshot.mode !== 'approval' && snapshot.enabled) || snapshot.sync_action !== 'enable' || snapshot.sync_request_revision !== snapshot.revision) fail('role_mapping_consent_required');
		if (!(await deps.getCapabilities?.())?.available) fail('role_sync_capability_unavailable');
		proof = await deps.verify?.(actorId, snapshot.guild_id, { management: false });
		authority = await deps.verify?.(snapshot.sync_requested_by, snapshot.guild_id, { management: true });
		discovery = await deps.listRoles?.(snapshot.guild_id);
		if (!discovery?.available || discovery.guildId !== snapshot.guild_id || !Array.isArray(discovery.roles)) fail('discord_guilds_unavailable');
		const roleIds = (await db.query('SELECT role_id FROM server_role_mapping_roles WHERE mapping_id=$1 ORDER BY role_id', [snapshot.id])).rows.map(row => row.role_id);
		const roster = await deps.listCandidates?.({ guildId: snapshot.guild_id, roleIds, limit: 30, offset });
		if (!roster?.available || roster.guildId !== snapshot.guild_id || !Array.isArray(roster.members)) fail('discord_guilds_unavailable');
		const eligible = roster.members.slice(0, 30).filter(member => member.isBot === false && Array.isArray(member.roles) && member.roles.some(id => roleIds.includes(id)));
		const resolved = await require('./teams').listDiscordCandidates(teamId, actorId, snapshot.guild_id, eligible);
		memberPreviewTeamRevision = resolved.team.revision;
		memberPreview = { partial: true, candidates: resolved.candidates, nextOffset: Number.isSafeInteger(roster.nextOffset) && roster.nextOffset > offset && roster.nextOffset <= 100000 ? roster.nextOffset : null };
	} else if (snapshot.mode !== 'automatic') fail('role_mapping_automatic_not_supported');
	return db.transaction(async client => {
		await client.query("SELECT pg_advisory_xact_lock(hashtext('team-goals-identity'))");
		const locked = await accessById(client, teamId, actorId, { lock: true, allowArchived: false });
		if (locked.role !== 'owner') fail('team_forbidden');
		if (memberPreview && locked.revision !== memberPreviewTeamRevision) fail('revision_conflict');
		const current = await mapping(client, teamId, true);
		if (current.revision !== input.expectedRevision || current.sync_requested_by !== snapshot.sync_requested_by) fail('revision_conflict');
		const roles = (await client.query('SELECT role_id,name_snapshot FROM server_role_mapping_roles WHERE mapping_id=$1 ORDER BY role_id', [current.id])).rows;
		if (input.action === 'enable') {
			await sources.requireManualMembership(client, teamId, actorId);
			await identityProof(client, proof, actorId, current.guild_id, false); await identityProof(client, authority, current.sync_requested_by, current.guild_id, true);
			validateRoleSelection(current.guild_id, roles.map(row => row.role_id), discovery.roles);
		}
		const impact = (await client.query(`SELECT count(*)::int AS sources,
		 count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM team_membership_sources other WHERE other.team_id=s.team_id AND other.user_id=s.user_id AND other.source_key<>s.source_key AND other.revoked_at IS NULL))::int AS final_sources,
		 count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM team_membership_sources other WHERE other.team_id=s.team_id AND other.user_id=s.user_id AND other.source_key<>s.source_key AND other.revoked_at IS NULL)
		 AND (EXISTS(SELECT 1 FROM team_memberships m WHERE m.team_id=s.team_id AND m.user_id=s.user_id AND m.role='owner' AND m.revoked_at IS NULL) OR EXISTS(SELECT 1 FROM projects p WHERE p.team_id=s.team_id AND p.owner_user_id=s.user_id)))::int AS ownership_blocks
		 FROM team_membership_sources s WHERE s.mapping_id=$1 AND s.revoked_at IS NULL`, [current.id])).rows[0];
		const token = randomBytes(32).toString('hex');
		await client.query(`UPDATE server_role_mappings SET sync_action=$2,sync_preview_hash=$3,sync_preview_owner=$4,sync_preview_team_revision=$5,sync_preview_expires_at=now()+interval '15 minutes' WHERE id=$1`, [current.id, input.action, digest(token), actorId, locked.revision]);
		return { mappingId: current.id, revision: current.revision, teamRevision: locked.revision, action: input.action, delegationVersion: POLICY_VERSION, previewToken: token,
		 roles: roles.map(row => ({ id: row.role_id, name: row.name_snapshot })), impact: { derivedSources: impact.sources, finalSources: impact.final_sources, ownershipBlocks: impact.ownership_blocks },
			 additions: input.action === 'enable' ? 'verified_registered_role_holders_only' : 'none', memberPreview, projectAccessRestored: false, manualMembershipsPreserved: true, retirementIsQueued: input.action !== 'enable' };
	});
}

async function confirmTransition(teamId, actorId, input, deps = {}) {
	enabled(); inputContract(input, ['expectedRevision','action','previewToken','requestKey','delegationVersion','confirmedDelegation']); requestContract(input);
	if (!['enable','disable','approval','unlink'].includes(input.action) || !/^[a-f0-9]{64}$/.test(input.previewToken || '')) fail('request_body_invalid');
	if (input.action === 'enable') consent(input);
	const team = await accessById({ query: db.query }, teamId, actorId, { allowArchived: false }); if (team.role !== 'owner') fail('team_forbidden');
	// A committed receipt needs current native ownership, not another provider
	// round trip. This recovers uncertain saves even after Discord goes down.
	const committed = await db.transaction(async client => {
		await client.query("SELECT pg_advisory_xact_lock(hashtext('team-goals-identity'))");
		const locked = await accessById(client, teamId, actorId, { lock: true, allowArchived: false }); if (locked.role !== 'owner') fail('team_forbidden');
		return receipt(client, teamId, actorId, input.requestKey, requestHash(input));
	});
	if (committed) return committed;
	const snapshot = (await db.query("SELECT * FROM server_role_mappings WHERE team_id=$1 AND kind='team' ORDER BY retired_at NULLS FIRST,created_at DESC LIMIT 1", [teamId])).rows[0];
	let proof, authority, discovery;
	if (input.action === 'enable') {
		if (!(await deps.getCapabilities?.())?.available) fail('role_sync_capability_unavailable');
		proof = await deps.verify?.(actorId, snapshot?.guild_id, { management: false }); authority = await deps.verify?.(snapshot?.sync_requested_by, snapshot?.guild_id, { management: true });
		discovery = await deps.listRoles?.(snapshot?.guild_id);
		if (!discovery?.available || discovery.guildId !== snapshot?.guild_id || !Array.isArray(discovery.roles)) fail('discord_guilds_unavailable');
	}
	return db.transaction(async client => {
		await client.query("SELECT pg_advisory_xact_lock(hashtext('team-goals-identity'))");
		const locked = await accessById(client, teamId, actorId, { lock: true, allowArchived: false }); if (locked.role !== 'owner') fail('team_forbidden');
		const replay = await receipt(client, teamId, actorId, input.requestKey, requestHash(input)); if (replay) return replay;
		const current = await mapping(client, teamId, true);
		if (current.revision !== input.expectedRevision || current.sync_action !== input.action || current.sync_preview_owner !== actorId || current.sync_preview_hash !== digest(input.previewToken) || current.sync_preview_team_revision !== locked.revision || current.sync_preview_valid !== true) fail('revision_conflict');
		if (input.action === 'enable') {
			if ((current.mode !== 'approval' && current.enabled) || current.sync_request_revision !== current.revision || current.sync_requested_by !== snapshot.sync_requested_by) fail('role_mapping_consent_required');
			await sources.requireManualMembership(client, teamId, actorId); await identityProof(client, proof, actorId, current.guild_id, false); await identityProof(client, authority, current.sync_requested_by, current.guild_id, true);
			const roles = (await client.query('SELECT role_id FROM server_role_mapping_roles WHERE mapping_id=$1', [current.id])).rows.map(row => row.role_id); validateRoleSelection(current.guild_id, roles, discovery.roles);
			await client.query(`UPDATE server_role_mappings SET mode='automatic',enabled=true,delegation_version=1,owner_consent_by=$2,owner_consent_at=now(),server_consent_by=sync_requested_by,server_consent_at=sync_requested_at WHERE id=$1`, [current.id, actorId]);
		} else {
			if (current.mode !== 'automatic') fail('role_mapping_automatic_not_supported');
			await client.query(`UPDATE server_role_mappings SET enabled=false,mode=CASE WHEN $2='approval' THEN 'approval' ELSE mode END,retired_at=CASE WHEN $2='unlink' THEN now() ELSE retired_at END,
			 owner_consent_by=CASE WHEN $2='approval' THEN NULL ELSE owner_consent_by END,owner_consent_at=CASE WHEN $2='approval' THEN NULL ELSE owner_consent_at END WHERE id=$1`, [current.id, input.action]);
		}
		await client.query('UPDATE server_role_mappings SET revision=revision+1,sync_preview_hash=NULL,sync_preview_owner=NULL,sync_preview_team_revision=NULL,sync_preview_expires_at=NULL,updated_at=now() WHERE id=$1', [current.id]);
		await sync.enqueueWithClient(client, current.id);
		const result = { id: current.id, revision: current.revision + 1, action: input.action, status: input.action === 'enable' ? 'reconciliation_queued' : 'retirement_queued' };
		await record(client, teamId, actorId, 'role_sync_transition', input, result, current.id); return result;
	});
}

async function getStatus(teamId, actorId, { guildId = null, verify, getCapabilities } = {}) {
	const mappings = require('./server-role-mappings');
	if (guildId) await mappings.getServerTeamMapping(guildId,teamId,actorId,{verify}); else await mappings.getTeamMapping(teamId,actorId);
	const current = (await db.query(`SELECT id,mode,enabled,retired_at,revision,sync_action,sync_request_revision,delegation_version FROM server_role_mappings
	 WHERE team_id=$1 AND kind='team' AND ($2::text IS NULL OR guild_id=$2) ORDER BY retired_at NULLS FIRST,created_at DESC,id DESC LIMIT 1`,[teamId,guildId])).rows[0];
	const capability = sync.enabled() ? await getCapabilities?.() || {available:false,reason:'capability_verification_unavailable'} : {available:false,reason:'sync_disabled'};
	const native = guildId ? null : await accessById({query:db.query},teamId,actorId);
	const result = { supported: sync.enabled(), capability, policyVersion: POLICY_VERSION, mappingId: current?.id || null, revision: current?.revision || 0,
		canConfirmTransitions: native?.role === 'owner' && !native.archivedAt,
		pendingDelegation: current?.sync_action === 'enable' && current.sync_request_revision === current.revision && (current.mode !== 'automatic' || !current.enabled), retired: Boolean(current?.retired_at), jobs: [], blockedRevocations: [] };
	if (!current) return result;
	const jobs = (await db.query(`SELECT state,last_success_at,last_error,counts FROM server_role_sync_jobs WHERE mapping_id=$1
	 ORDER BY CASE state WHEN 'blocked' THEN 0 WHEN 'degraded' THEN 1 WHEN 'running' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END,updated_at DESC,id DESC LIMIT 20`,[current.id])).rows;
	result.jobs = jobs.map(job=>({state:job.state,lastSuccessAt:job.last_success_at,error:job.last_error,...(!guildId?{counts:Object.fromEntries(['granted','revoked','blocked','capacityBlocked'].map(key=>[key,Number(job.counts[key]||0)]))}:{})}));
	if (!guildId) {
		const rows = (await db.query(`SELECT user_id,metadata->'blockedRevocation' AS blockage FROM team_membership_sources
		 WHERE mapping_id=$1 AND revoked_at IS NULL AND metadata ? 'blockedRevocation' ORDER BY user_id LIMIT 51`,[current.id])).rows;
		result.blockedRevocations = rows.slice(0,50).map(row=>({userId:row.user_id,reason:row.blockage.reason,observedAt:row.blockage.observedAt})); result.moreBlockedRevocations = rows.length>50;
	}
	return result;
}

async function requestReconciliation(teamId, actorId, input, { guildId = null, verify } = {}) {
	enabled(); inputContract(input, ['expectedRevision','requestKey']); requestContract(input);
	if (guildId) await require('./server-role-mappings').getServerTeamMapping(guildId,teamId,actorId,{verify});
	const proof = guildId ? await verify?.(actorId,guildId,{management:true}) : null;
	const recorded = {...input,operation:'reconcile'};
	return db.transaction(async client => {
		await client.query("SELECT pg_advisory_xact_lock(hashtext('team-goals-identity'))");
		if (guildId) {
			const team = (await client.query('SELECT discord_guild_id,archived_at FROM teams WHERE id=$1 FOR UPDATE',[teamId])).rows[0];
			if (!team || team.discord_guild_id !== guildId || team.archived_at) fail('team_not_found');
			await identityProof(client,proof,actorId,guildId,true);
		} else {
			const team = await accessById(client,teamId,actorId,{lock:true,allowArchived:false});
			if (team.role !== 'owner') fail('team_forbidden');
		}
		const replay = await receipt(client,teamId,actorId,input.requestKey,requestHash(recorded)); if (replay) return replay;
		const current = (await client.query(`SELECT id,revision,mode,retired_at FROM server_role_mappings WHERE team_id=$1 AND kind='team'
		 AND ($2::text IS NULL OR guild_id=$2) ORDER BY retired_at NULLS FIRST,created_at DESC,id DESC LIMIT 1 FOR UPDATE`,[teamId,guildId])).rows[0];
		if (!current) fail('role_mapping_not_found');
		if (current.revision !== input.expectedRevision) fail('revision_conflict');
		if (current.mode !== 'automatic' && !current.retired_at) fail('role_mapping_automatic_not_supported');
		await sync.enqueueWithClient(client,current.id);
		const result = {id:current.id,revision:current.revision,status:'reconciliation_queued'};
		await record(client,teamId,actorId,'role_sync_requested',recorded,result,current.id); return result;
	});
}

module.exports = { POLICY_VERSION, requestAutomatic, previewTransition, confirmTransition, getStatus, requestReconciliation };
