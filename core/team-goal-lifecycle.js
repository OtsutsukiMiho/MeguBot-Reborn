'use strict';
const { newId } = require('./ids');

// Caller holds the team row lock. Never expose goal content to the manager.
async function reconcileMember(client, teamId, userId, actorId) {
	if (!(await client.query("SELECT to_regclass('public.team_goals') AS table_name")).rows[0].table_name) return;
	const member = (await client.query('SELECT role,revoked_at FROM team_memberships WHERE team_id=$1 AND user_id=$2', [teamId, userId])).rows[0];
	const active = Boolean(member && !member.revoked_at);
	const reviewerEligible = active && ['owner', 'admin'].includes(member.role);
	if (reviewerEligible) return;
	const goals = (await client.query(`SELECT g.id,g.subject_id,g.current_version,g.revision,v.reviewer_id,v.needs_reviewer
	 FROM team_goals g JOIN team_goal_versions v ON v.goal_id=g.id AND v.version=g.current_version
	 WHERE g.team_id=$1 AND (g.subject_id=$2 OR v.reviewer_id=$2)
	 AND v.lifecycle IN ('draft','proposed','active','submitted') ORDER BY g.id FOR UPDATE OF g,v`, [teamId, userId])).rows;
	for (const goal of goals) {
		const cancel = goal.subject_id === userId && !active;
		if (!cancel && (goal.reviewer_id !== userId || goal.needs_reviewer)) continue;
		const reason = cancel ? 'subject_membership_revoked' : 'reviewer_no_longer_eligible';
		if (cancel) await client.query("UPDATE team_goal_versions SET lifecycle='cancelled',reason=$3 WHERE goal_id=$1 AND version=$2", [goal.id, goal.current_version, reason]);
		else await client.query('UPDATE team_goal_versions SET needs_reviewer=true,reviewer_accepted_at=NULL WHERE goal_id=$1 AND version=$2', [goal.id, goal.current_version]);
		await client.query('UPDATE team_goals SET revision=revision+1 WHERE id=$1', [goal.id]);
		await client.query('INSERT INTO team_goal_events(id,goal_id,version,actor_id,event_type,payload) VALUES ($1,$2,$3,$4,$5,$6)',
			[newId('gev'), goal.id, goal.current_version, actorId, cancel ? 'goal_cancelled' : 'goal_reviewer_required', JSON.stringify({ reason, userId })]);
		await require('./team-goal-notifications').enqueueChangeWithClient(client, { teamId, goalId: goal.id, version: goal.current_version, revision: goal.revision + 1, recipients: cancel ? [goal.reviewer_id] : [goal.subject_id], actorId });
	}
}

// Caller holds the team row lock, shared with every goal mutation.
async function archiveForTeam(client, teamId, actorId) {
	if (!(await client.query("SELECT to_regclass('public.team_goals') AS table_name")).rows[0].table_name) return;
	const goals = (await client.query(`SELECT g.id,g.current_version
	 FROM team_goals g JOIN team_goal_versions v ON v.goal_id=g.id AND v.version=g.current_version
	 WHERE g.team_id=$1 AND v.lifecycle IN ('draft','proposed','active','submitted')
	 ORDER BY g.id FOR UPDATE OF g,v`, [teamId])).rows;
	for (const goal of goals) {
		await client.query("UPDATE team_goal_versions SET lifecycle='archived',reason='team_archived' WHERE goal_id=$1 AND version=$2", [goal.id, goal.current_version]);
		await client.query('UPDATE team_goals SET revision=revision+1 WHERE id=$1', [goal.id]);
		await client.query("INSERT INTO team_goal_events(id,goal_id,version,actor_id,event_type,payload) VALUES ($1,$2,$3,$4,'goal_archived',$5)",
			[newId('gev'), goal.id, goal.current_version, actorId, JSON.stringify({ reason: 'team_archived' })]);
	}
}

module.exports = { reconcileMember, archiveForTeam };
