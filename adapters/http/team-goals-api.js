'use strict';
const goals = require('../../core/team-goals');

function registerTeamGoalRoutes(api, requireAccount) {
	const status = {
		team_goals_disabled: 404, goal_not_found: 404, team_not_found: 404, company_not_found: 404,
		goal_forbidden: 403, team_forbidden: 403, company_archived: 409,
		goal_revision_conflict: 409, goal_transition_invalid: 409, goal_already_accepted: 409,
		idempotency_conflict: 409, idempotency_key_invalid: 422,
		goal_reference_invalid: 422, goal_reference_unavailable: 422,
		goal_reviewer_invalid: 422, goal_reviewer_required: 422, goal_input_invalid: 422,
		goal_period_invalid: 422, timezone_invalid: 422, goal_page_invalid: 422,
		goal_action_invalid: 422, goal_value_requires_evidence: 422, goal_value_invalid: 422,
		goal_measurement_invalid: 422, goal_target_invalid: 422, goal_unit_required: 422,
		goal_criteria_required: 422, goal_evidence_invalid: 422, goal_evidence_note_required: 422,
		goal_evidence_links_invalid: 422, goal_outcome_invalid: 422, request_body_invalid: 422, unknown_field: 422,
	};
	const handle = (operation, success = 200) => async (req, res, next) => {
		res.set('Cache-Control', 'private, no-store');
		if (process.env.MEGU_TEAM_GOALS_ENABLED !== '1' || process.env.MEGU_PROJECT_TEAMS_ENABLED === '0') return res.status(404).json({ code: 'team_goals_disabled' });
		// JSON requires a browser preflight; these private routes do not enable CORS.
		// Reject simple HTML forms too, including same-site sibling-origin forms.
		if (req.method === 'POST') {
			if (req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({ code: 'goal_cross_site_request' });
			if (!req.is('application/json')) return res.status(415).json({ code: 'goal_json_required' });
		}
		try { res.status(success).json(await operation(req)); }
		catch (error) {
			if (status[error.code]) return res.status(status[error.code]).json({ code: error.code });
			next(error);
		}
	};
	const pagination = (query, keys) => {
		if (Object.keys(query).some(key => !keys.includes(key))) throw Object.assign(new Error('goal_page_invalid'), { code: 'goal_page_invalid' });
		return Object.fromEntries(Object.entries(query).map(([key, value]) => [key, typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN]));
	};
	api.get('/teams/:id/goals', requireAccount, handle(req => goals.listGoals(req.params.id, req.actor.userId, pagination(req.query, ['offset', 'limit']))));
	api.post('/teams/:id/goals', requireAccount, handle(req => goals.createGoal(req.params.id, req.actor.userId, req.body || {}), 201));
	api.get('/team-goals/:id', requireAccount, handle(req => goals.getGoal(req.params.id, req.actor.userId, pagination(req.query, ['version', 'updatesOffset', 'responsesOffset']))));
	api.get('/teams/:teamId/goals/:id', requireAccount, handle(req => goals.getGoal(req.params.id, req.actor.userId, { ...pagination(req.query, ['version', 'updatesOffset', 'responsesOffset']), teamId: req.params.teamId })));
	api.post('/team-goals/:id/transitions', requireAccount, handle(req => goals.transitionGoal(req.params.id, req.actor.userId, req.body || {})));
	api.post('/team-goals/:id/reviewer', requireAccount, handle(req => goals.reassignReviewer(req.params.id, req.actor.userId, req.body || {})));
}

module.exports = { registerTeamGoalRoutes };
