'use strict';

// These guards deliberately do not depend on a UI feature flag. Once a team
// belongs to a company, turning its screens off must never bypass revocation.
async function hasLegacyCompanySchema(client) {
	const row = (await client.query(`SELECT to_regclass('companies') AS table_name,
	 EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('teams') AND attname='company_id' AND NOT attisdropped) AS company_column`)).rows[0];
	if (row.table_name) {
		if (!row.company_column) throw Object.assign(new Error('legacy_company_schema_incomplete'), { code:'legacy_company_schema_incomplete' });
		return true;
	}
	if (row.company_column && (await client.query('SELECT 1 FROM teams WHERE company_id IS NOT NULL LIMIT 1')).rowCount) {
		throw Object.assign(new Error('legacy_company_schema_incomplete'), { code:'legacy_company_schema_incomplete' });
	}
	return false;
}

async function companyEligibilitySql(client, teamAlias, userParameter) {
	if (!/^[a-z_]+$/.test(teamAlias) || !/^\$\d+$/.test(userParameter)) throw new Error('invalid_company_scope_sql');
	if (!await hasLegacyCompanySchema(client)) return 'TRUE';
	return `(${teamAlias}.company_id IS NULL OR EXISTS (SELECT 1 FROM company_memberships cm
		WHERE cm.company_id=${teamAlias}.company_id AND cm.user_id=${userParameter} AND cm.revoked_at IS NULL))`;
}

async function requireTeamCompanyAccess(client, teamId, userId, { lock = false, write = false, notFound = 'team_not_found' } = {}) {
	if (!await hasLegacyCompanySchema(client)) {
		if (!(await client.query('SELECT 1 FROM teams WHERE id=$1',[teamId])).rowCount) throw Object.assign(new Error(notFound), { code:notFound });
		return null;
	}
	const locator = await client.query('SELECT company_id FROM teams WHERE id=$1', [teamId]);
	if (!locator.rowCount) throw Object.assign(new Error(notFound), { code: notFound });
	if (!locator.rows[0].company_id) return null;
	const result = await client.query(`SELECT c.id,c.lifecycle,c.name FROM companies c
		JOIN company_memberships cm ON cm.company_id=c.id AND cm.user_id=$2 AND cm.revoked_at IS NULL
		WHERE c.id=$1 ${lock ? 'FOR UPDATE OF c' : ''}`, [locator.rows[0].company_id, userId]);
	if (!result.rowCount) throw Object.assign(new Error(notFound), { code: notFound });
	if (write && result.rows[0].lifecycle === 'archived') throw Object.assign(new Error('company_archived'), { code: 'company_archived' });
	return result.rows[0];
}

async function notificationScopeEligible(client,row) {
	// Generic access-loss/integration notices have their own recipient proof:
	// a removed member or configuration-only manager cannot read the team.
	if (['team_role_membership_changed','team_role_sync_attention'].includes(row.event_type)) return require('./server-role-notifications').eligible(client,row);
	const legacy = await hasLegacyCompanySchema(client);
	if (row.event_type === 'company_join_requested') {
		if (!legacy) return false;
		const result = await client.query(`SELECT 1 FROM companies c
		 JOIN company_memberships m ON m.company_id=c.id AND m.user_id=$2 AND m.revoked_at IS NULL AND m.role IN ('owner','admin')
		 JOIN company_join_requests r ON r.company_id=c.id
		 WHERE c.id=$1 AND c.lifecycle='active' AND r.id=$3 AND r.status='pending' AND r.request_cycle=$4
		 AND ${require('./companies').validRequestSourceSql}`,
		[row.payload?.companyId,row.user_id,row.payload?.companyRequestId,Number(row.payload?.requestCycle)]);
		return result.rowCount>0;
	}
	if (row.payload?.projectId) {
		const result = await client.query(`SELECT p.team_id,${legacy ? 't.company_id,c.lifecycle,cm.user_id AS company_member,' : ''}
		 pm.user_id AS project_member,tm.user_id AS team_member,t.archived_at,p.status
		 FROM projects p LEFT JOIN teams t ON t.id=p.team_id ${legacy ? `LEFT JOIN companies c ON c.id=t.company_id
		 LEFT JOIN company_memberships cm ON cm.company_id=c.id AND cm.user_id=$2 AND cm.revoked_at IS NULL` : ''}
		 LEFT JOIN project_memberships pm ON pm.project_id=p.id AND pm.user_id=$2 AND pm.revoked_at IS NULL
		 LEFT JOIN team_memberships tm ON tm.team_id=t.id AND tm.user_id=$2 AND tm.revoked_at IS NULL
		 WHERE p.id=$1`, [row.payload.projectId,row.user_id]);
		const scope = result.rows[0];
		if (!scope) return false;
		if (row.event_type === 'project_join_requested') return !scope.team_id;
		return Boolean(scope.status === 'active' && scope.project_member
		 && (!scope.team_id || (scope.team_member && !scope.archived_at))
		 && (!scope.company_id || (scope.company_member && scope.lifecycle !== 'archived')));
	}
	if (row.payload?.teamId) {
		const result = await client.query(`SELECT 1 FROM teams t JOIN team_memberships m ON m.team_id=t.id AND m.user_id=$2 AND m.revoked_at IS NULL
		 ${legacy ? 'LEFT JOIN companies c ON c.id=t.company_id' : ''}
		 WHERE t.id=$1 AND t.archived_at IS NULL AND ${await companyEligibilitySql(client,'t','$2')}
		 ${legacy ? "AND (c.id IS NULL OR c.lifecycle<>'archived')" : ''}`, [row.payload.teamId,row.user_id]);
		return result.rowCount>0;
	}
	return true;
}

module.exports = { hasLegacyCompanySchema, companyEligibilitySql, requireTeamCompanyAccess, notificationScopeEligible };
