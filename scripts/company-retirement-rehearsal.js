'use strict';

const { Client } = require('pg');
const { postgresConnectionOptions } = require('../core/postgres-connection.js');
const { isDisposableTestDatabase } = require('../tests/test-database');
const { newId } = require('../core/ids');
const sources = require('../core/team-membership-sources');
const goals = require('../core/team-goal-lifecycle');

function fail(code) { throw Object.assign(new Error(code), { code }); }

async function apply(client, companyIds, actorId) {
	// Same lock as core/schema.js; no startup caller or production apply path.
	await client.query('SELECT pg_advisory_xact_lock($1)', [1296385877]);
	const companies = (await client.query('SELECT * FROM companies WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [companyIds])).rows;
	if (companies.length !== companyIds.length) fail('retirement_company_not_found');
	if (!(await client.query('SELECT 1 FROM users WHERE id=$1', [actorId])).rowCount) fail('retirement_actor_not_found');
	const teams = (await client.query('SELECT * FROM teams WHERE company_id=ANY($1::text[]) ORDER BY id FOR UPDATE', [companyIds])).rows;
	const teamIds = teams.map(row => row.id);
	const projects = (await client.query('SELECT id,owner_user_id,team_id FROM projects WHERE team_id=ANY($1::text[]) ORDER BY id FOR UPDATE', [teamIds])).rows;
	const projectIds = projects.map(row => row.id);
	const companyById = new Map(companies.map(row => [row.id, row]));
	const eligibility = (await client.query('SELECT company_id,user_id FROM company_memberships WHERE company_id=ANY($1::text[]) AND revoked_at IS NULL FOR UPDATE', [companyIds])).rows;
	const eligible = (companyId, userId) => eligibility.some(row => row.company_id === companyId && row.user_id === userId);
	const memberships = (await client.query('SELECT * FROM team_memberships WHERE team_id=ANY($1::text[]) ORDER BY team_id,user_id FOR UPDATE', [teamIds])).rows;
	for (const team of teams) {
		if (team.discord_guild_id !== companyById.get(team.company_id).discord_guild_id) fail('retirement_guild_mismatch');
		const owner = memberships.find(row => row.team_id === team.id && row.role === 'owner' && !row.revoked_at);
		if (!owner || !eligible(team.company_id, owner.user_id)) fail('retirement_owner_ineligible');
		await sources.requireManualMembership(client, team.id, owner.user_id);
	}
	for (const project of projects) {
		const team = teams.find(row => row.id === project.team_id);
		if (!eligible(team.company_id, project.owner_user_id)) fail('retirement_owner_ineligible');
		await sources.requireManualMembership(client, team.id, project.owner_user_id);
		if (!(await client.query("SELECT 1 FROM project_memberships WHERE project_id=$1 AND user_id=$2 AND role='owner' AND revoked_at IS NULL", [project.id, project.owner_user_id])).rowCount) fail('retirement_project_owner_ineligible');
	}
	const summary = { detachedTeams: 0, archivedTeams: 0, revokedTeamMembers: 0, suppressedMembers: 0, revokedProjectMembers: 0, removedAssignments: 0 };
	for (const team of teams) {
		const deniedUsers = (await client.query(`SELECT user_id FROM company_memberships WHERE company_id=$1 AND revoked_at IS NOT NULL
		 UNION SELECT m.user_id FROM team_memberships m WHERE m.team_id=$2 AND NOT EXISTS
		 (SELECT 1 FROM company_memberships cm WHERE cm.company_id=$1 AND cm.user_id=m.user_id AND cm.revoked_at IS NULL)
		 UNION SELECT m.user_id FROM project_memberships m JOIN projects p ON p.id=m.project_id WHERE p.team_id=$2 AND NOT EXISTS
		 (SELECT 1 FROM company_memberships cm WHERE cm.company_id=$1 AND cm.user_id=m.user_id AND cm.revoked_at IS NULL)
		 ORDER BY user_id`, [team.company_id, team.id])).rows;
		for (const member of deniedUsers) {
			const revoked = await client.query('UPDATE team_memberships SET revoked_at=now() WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL', [team.id, member.user_id]);
			summary.revokedTeamMembers += revoked.rowCount;
			await sources.suppressMembership(client, team.id, member.user_id, actorId, 'legacy_company_retired');
			await goals.reconcileMember(client, team.id, member.user_id, actorId);
			summary.suppressedMembers++;
		}
		const company = companyById.get(team.company_id);
		if (company.lifecycle === 'archived' && !team.archived_at) {
			await client.query('UPDATE teams SET archived_at=$2 WHERE id=$1', [team.id, company.archived_at]);
			await goals.archiveForTeam(client, team.id, actorId);
			summary.archivedTeams++;
		}
		await client.query('INSERT INTO team_events(id,team_id,actor_user_id,event_type,payload) VALUES ($1,$2,$3,$4,$5)',
			[newId('tev'), team.id, actorId, 'legacy_company_retired', { companyId: company.id, previousArchivedAt: team.archived_at, inheritedArchive: company.lifecycle === 'archived' }]);
	}
	// Materialize all previously denied project rosters/assignments, including
	// project members absent from the team roster. Never restore a project grant.
	const denied = `p.team_id=t.id AND t.company_id=ANY($1::text[]) AND
		(NOT EXISTS (SELECT 1 FROM company_memberships cm WHERE cm.company_id=t.company_id AND cm.user_id=m.user_id AND cm.revoked_at IS NULL)
		OR NOT EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.team_id=t.id AND tm.user_id=m.user_id AND tm.revoked_at IS NULL))`;
	summary.revokedProjectMembers = (await client.query(`UPDATE project_memberships m SET revoked_at=now() FROM projects p,teams t
		WHERE m.project_id=p.id AND m.revoked_at IS NULL AND ${denied}`, [companyIds])).rowCount;
	summary.removedAssignments = (await client.query(`DELETE FROM project_topic_assignees m USING projects p,teams t
		WHERE m.project_id=p.id AND ${denied}`, [companyIds])).rowCount;
	// Pending team approvals must be reviewed again under server-native rules.
	// Stable team links remain valid unless their inherited team is archived.
	await client.query("UPDATE team_join_requests SET status='rejected',reviewed_at=now(),reviewed_by=$2,rejection_reason='legacy_company_retired' WHERE team_id=ANY($1::text[]) AND status='pending'", [teamIds, actorId]);
	await client.query('UPDATE team_join_links SET revoked_at=now() WHERE team_id=ANY($1::text[]) AND revoked_at IS NULL AND team_id IN (SELECT id FROM teams WHERE archived_at IS NOT NULL)', [teamIds]);
	await client.query('UPDATE team_ownership_transfers SET cancelled_at=now() WHERE team_id=ANY($1::text[]) AND accepted_at IS NULL AND cancelled_at IS NULL', [teamIds]);
	await client.query('UPDATE project_ownership_transfers SET cancelled_at=now() WHERE project_id=ANY($1::text[]) AND accepted_at IS NULL AND cancelled_at IS NULL', [projectIds]);
	await client.query('UPDATE company_join_links SET revoked_at=now() WHERE company_id=ANY($1::text[]) AND revoked_at IS NULL', [companyIds]);
	await client.query("UPDATE company_join_requests SET status='rejected',reviewed_at=now(),reviewed_by=$2,rejection_reason='legacy_company_retired' WHERE company_id=ANY($1::text[]) AND status='pending'", [companyIds, actorId]);
	await client.query('UPDATE company_ownership_transfers SET cancelled_at=now() WHERE company_id=ANY($1::text[]) AND accepted_at IS NULL AND cancelled_at IS NULL', [companyIds]);
	// Keep event payloads/history immutable; skip in-flight work before detach so
	// a formerly gated notification cannot become eligible just by migration.
	await client.query(`UPDATE notification_deliveries d SET status='skipped',locked_at=NULL,last_error='Legacy Company retirement'
		FROM notification_events e WHERE e.id=d.event_id AND d.status IN ('pending','sending','failed')
		AND (e.payload->>'companyId'=ANY($1::text[]) OR e.payload->>'teamId'=ANY($2::text[])
		OR e.payload->>'projectId'=ANY($3::text[]) OR EXISTS
		(SELECT 1 FROM unnest($1::text[]) c(id) WHERE strpos(e.payload::text,'/companies/'||c.id)>0))`, [companyIds, teamIds, projectIds]);
	await client.query("UPDATE project_channel_deliveries SET status='skipped',locked_at=NULL,last_error='Legacy Company retirement' WHERE project_id=ANY($1::text[]) AND status IN ('pending','sending','failed')", [projectIds]);
	await client.query("UPDATE project_reminder_jobs SET status='cancelled',completed_at=now() WHERE project_id=ANY($1::text[]) AND status IN ('pending','queued')", [projectIds]);
	summary.detachedTeams = (await client.query('UPDATE teams SET company_id=NULL,revision=revision+1,updated_at=now() WHERE id=ANY($1::text[])', [teamIds])).rowCount;
	await client.query('SET CONSTRAINTS ALL IMMEDIATE');
	return summary;
}

// Requires an existing transaction. The savepoint rolls back both successful
// and failed trials, including fixture inspection failures. No commit API.
async function rehearse(client, { companyIds, actorId }, inspect = async () => {}) {
	if (!Array.isArray(companyIds) || !companyIds.length || companyIds.length>100 || new Set(companyIds).size!==companyIds.length
		|| companyIds.some(id => typeof id!=='string' || !id || id.length>100) || typeof actorId!=='string' || !actorId || actorId.length>100) fail('retirement_input_invalid');
	const location = (await client.query('SELECT current_database() AS name,host(inet_server_addr()) AS host')).rows[0];
	if (!location.name.endsWith('_test') || !['127.0.0.1', '::1'].includes(location.host)) fail('retirement_rehearsal_local_test_only');
	await client.query('SAVEPOINT company_retirement_rehearsal');
	try {
		await client.query("SET LOCAL lock_timeout='5s'");
		await client.query("SET LOCAL statement_timeout='30s'");
		await client.query('SET LOCAL row_security=off');
		const summary = await apply(client, companyIds, actorId);
		await inspect(summary);
		return { ...summary, rolledBack: true };
	} finally {
		await client.query('ROLLBACK TO SAVEPOINT company_retirement_rehearsal');
		await client.query('RELEASE SAVEPOINT company_retirement_rehearsal');
	}
}

async function main() {
	const url = process.env.MEGU_TEST_DATABASE_URL;
	if (!isDisposableTestDatabase(url)) fail('retirement_rehearsal_local_test_only');
	const [actorId, ...companyIds] = process.argv.slice(2);
	const client = new Client({ ...postgresConnectionOptions(url), connectionTimeoutMillis: 5000 });
	try {
		await client.connect(); await client.query('BEGIN');
		console.log(JSON.stringify(await rehearse(client, { companyIds, actorId })));
	} finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
}

// Backup/recovery verification only. The ordinary CLI always rolls back; this
// commit path refuses even the shared disposable DB and has no startup caller.
async function commitDisposableTrial(client, input) {
	const location = (await client.query('SELECT current_database() AS name,host(inet_server_addr()) AS host')).rows[0];
	if (!/^megu_company_rollback_[a-f0-9]{16}_test$/.test(location.name) || !['127.0.0.1','::1'].includes(location.host)) fail('retirement_rehearsal_local_test_only');
	if (!Array.isArray(input.companyIds) || !input.companyIds.length || input.companyIds.length>100 || new Set(input.companyIds).size!==input.companyIds.length
		|| input.companyIds.some(id=>typeof id!=='string'||!id||id.length>100) || typeof input.actorId!=='string'||!input.actorId||input.actorId.length>100) fail('retirement_input_invalid');
	await client.query('BEGIN');
	try {
		await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='30s'");
		const summary = await apply(client,input.companyIds,input.actorId);
		await client.query('COMMIT'); return summary;
	} catch(error) { await client.query('ROLLBACK'); throw error; }
}

if (require.main === module) main().catch(error => { console.error(`Company rehearsal failed: ${error.code || 'validation'}`); process.exitCode=1; });
module.exports = { rehearse, commitDisposableTrial };
