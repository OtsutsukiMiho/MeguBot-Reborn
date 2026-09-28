'use strict';

const { transaction } = require('./db');
const { accessById, validate } = require('./teams');
const { achievement, validateMeasurement, validateEvidence } = require('./team-goal-measurement');
const { newId } = require('./ids');
const { createHash } = require('node:crypto');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const TERM_FIELDS = ['title', 'successDescription', 'periodStart', 'periodEnd', 'timezone', 'measurement'];
const AUTHOR_PROFILE = `u.display_name AS author_name,
 COALESCE((SELECT NULLIF(i.avatar_url,'') FROM identities i WHERE i.user_id=u.id AND i.provider='discord' ORDER BY i.id LIMIT 1),u.avatar_url) AS author_avatar`;

async function evidenceReference(client, code, topicId, participants) {
	try { return await require('./projects').resolveEvidenceReference(client, code, topicId, participants); }
	catch (error) {
		if (['project_not_found', 'topic_not_found', 'team_archived', 'company_archived'].includes(error.code)) fail('goal_reference_unavailable');
		throw error;
	}
}

function goalTerms(input) {
	for (const [key, max] of [['title', 120], ['successDescription', 4000], ['timezone', 100]]) {
		if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > max) fail('goal_input_invalid');
	}
	for (const key of ['periodStart', 'periodEnd']) {
		const value = input[key];
		if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('goal_period_invalid');
	}
	if (input.periodEnd < input.periodStart) fail('goal_period_invalid');
	try { new Intl.DateTimeFormat('en', { timeZone: input.timezone }); } catch { fail('timezone_invalid'); }
	const measurement = validateMeasurement(input.measurement);
	if (measurement.current != null) fail('goal_value_requires_evidence');
	return { title: input.title.trim(), successDescription: input.successDescription.trim(), periodStart: input.periodStart, periodEnd: input.periodEnd, timezone: input.timezone, measurement };
}

async function createGoal(teamId, actorId, input) {
	if (process.env.MEGU_TEAM_GOALS_ENABLED !== '1') fail('team_goals_disabled');
	validate.assertKnownFields(input, ['subjectId', 'reviewerId', 'requestKey', ...TERM_FIELDS]);
	const requestKey = input.requestKey ?? null;
	if (input.requestKey !== undefined && (typeof input.requestKey !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(input.requestKey))) fail('idempotency_key_invalid');
	if (typeof input.subjectId !== 'string' || !input.subjectId.trim() || input.subjectId.length > 200) fail('goal_input_invalid');
	const terms = goalTerms(input);
	const reviewerId = input.reviewerId ?? null;
	if (reviewerId !== null && (typeof reviewerId !== 'string' || !reviewerId || reviewerId.length > 200 || reviewerId === input.subjectId)) fail('goal_reviewer_invalid');
	const requestHash = requestKey ? createHash('sha256').update(JSON.stringify({ subjectId: input.subjectId, reviewerId, terms })).digest('hex') : null;
	return transaction(async client => {
		await client.query("SELECT pg_advisory_xact_lock(hashtext('team-goals-identity'))");
		const team = await accessById(client, teamId, actorId, { lock: true, allowArchived: false });
		if (input.subjectId !== actorId && !['owner', 'admin'].includes(team.role)) fail('goal_forbidden');
		if (requestKey) {
			const prior = (await client.query('SELECT id,team_id,created_by,creation_request_hash FROM team_goals WHERE creation_request_key=$1 FOR SHARE', [requestKey])).rows[0];
			if (prior) {
				if (prior.team_id !== teamId || prior.created_by !== actorId || prior.creation_request_hash !== requestHash) fail('idempotency_conflict');
				// The immutable creation receipt survives later goal/lifecycle edits.
				// Current caller authority was checked above; no private content is read.
				return { id: prior.id, version: 1, revision: 0, lifecycle: 'draft' };
			}
		}
		await accessById(client, teamId, input.subjectId, { allowArchived: false });
		if (reviewerId) {
			const reviewer = await accessById(client, teamId, reviewerId, { allowArchived: false });
			if (!['owner', 'admin'].includes(reviewer.role)) fail('goal_reviewer_invalid');
		}
		const id = newId('gol');
		await client.query('INSERT INTO team_goals(id,team_id,subject_id,created_by,creation_request_key,creation_request_hash) VALUES ($1,$2,$3,$4,$5,$6)', [id, teamId, input.subjectId, actorId, requestKey, requestHash]);
		await client.query(`INSERT INTO team_goal_versions(goal_id,version,reviewer_id,title,success_description,period_start,period_end,timezone,measurement,created_by)
		 VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, reviewerId, terms.title, terms.successDescription, terms.periodStart, terms.periodEnd, terms.timezone, JSON.stringify(terms.measurement), actorId]);
		await client.query("INSERT INTO team_goal_events(id,goal_id,version,actor_id,event_type) VALUES ($1,$2,1,$3,'goal_created')", [newId('gev'), id, actorId]);
		await require('./team-goal-notifications').enqueueChangeWithClient(client, { teamId, goalId: id, version: 1, revision: 0, recipients: [input.subjectId, reviewerId], actorId });
		return { id, version: 1, revision: 0, lifecycle: 'draft' };
	});
}

async function getGoal(goalId, actorId, options = {}) {
	if (process.env.MEGU_TEAM_GOALS_ENABLED !== '1') fail('team_goals_disabled');
	if (typeof goalId !== 'string' || !goalId || goalId.length > 200) fail('goal_not_found');
	for (const key of Object.keys(options)) if (!['teamId', 'updatesOffset', 'responsesOffset', 'version'].includes(key)) fail('goal_page_invalid');
	if (options.version != null && (!Number.isSafeInteger(options.version) || options.version < 1 || options.version > 2147483647)) fail('goal_page_invalid');
	const updatesOffset = options.updatesOffset ?? 0;
	const responsesOffset = options.responsesOffset ?? 0;
	if (![updatesOffset, responsesOffset].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 100000)) fail('goal_page_invalid');
	return transaction(async client => {
		// Read only routing metadata until active team membership is established.
		const route = (await client.query('SELECT team_id FROM team_goals WHERE id=$1', [goalId])).rows[0];
		if (!route || (options.teamId !== undefined && options.teamId !== route.team_id)) fail('goal_not_found');
		let team;
		try { team = await accessById(client, route.team_id, actorId, { lock: true, allowArchived: false }); }
		catch (error) { if (['team_not_found', 'company_not_found', 'company_archived'].includes(error.code)) fail('goal_not_found'); throw error; }
		const goal = (await client.query(`SELECT g.id,g.subject_id,g.current_version,g.revision,v.version,v.reviewer_id,v.period_start::text,v.period_end::text,v.lifecycle,v.needs_reviewer,
		 v.subject_accepted_at,v.reviewer_accepted_at,
		 (sm.user_id IS NOT NULL AND sm.revoked_at IS NULL) AS subject_active,
		 (v.reviewer_id IS NULL OR (rm.revoked_at IS NULL AND rm.role IN ('owner','admin') AND v.reviewer_id<>g.subject_id)) AS reviewer_eligible
		 FROM team_goals g JOIN team_goal_versions v ON v.goal_id=g.id AND v.version=COALESCE($2::integer,g.current_version)
		 LEFT JOIN team_memberships sm ON sm.team_id=g.team_id AND sm.user_id=g.subject_id
		 LEFT JOIN team_memberships rm ON rm.team_id=g.team_id AND rm.user_id=v.reviewer_id
		 WHERE g.id=$1 FOR SHARE OF g,v`, [goalId, options.version ?? null])).rows[0];
		if (!goal) fail('goal_not_found');
		const subject = goal.subject_id === actorId;
		const reviewer = goal.reviewer_id === actorId && ['owner', 'admin'].includes(team.role) && !goal.needs_reviewer;
		const proposedReviewer = goal.reviewer_id === actorId && ['owner', 'admin'].includes(team.role) && goal.needs_reviewer;
		const actionable = goal.version === goal.current_version && goal.subject_active && goal.reviewer_eligible;
		const capabilities = {
			canPropose: Boolean(actionable && !goal.needs_reviewer && goal.lifecycle === 'draft' && (subject || reviewer)),
			canEdit: Boolean(actionable && !goal.needs_reviewer && goal.lifecycle === 'draft' && (subject || reviewer)),
			canRevise: Boolean(actionable && !goal.needs_reviewer && goal.lifecycle === 'reviewed' && (subject || reviewer)),
			canAccept: Boolean(actionable && goal.lifecycle === 'proposed' && ((subject && !goal.subject_accepted_at) || ((reviewer || proposedReviewer) && !goal.reviewer_accepted_at))),
			canAddEvidence: Boolean(actionable && !goal.needs_reviewer && subject && goal.lifecycle === 'active'),
			canSubmit: Boolean(actionable && !goal.needs_reviewer && subject && goal.reviewer_id && goal.lifecycle === 'active'),
			canReview: Boolean(actionable && reviewer && goal.lifecycle === 'submitted'),
			canReturn: Boolean(actionable && reviewer && goal.lifecycle === 'submitted'),
			canRespond: Boolean(goal.version === goal.current_version && goal.subject_active && subject && goal.lifecycle === 'reviewed'),
			canCancel: Boolean(goal.version === goal.current_version && goal.subject_active && (subject || reviewer) && ['draft', 'proposed', 'active', 'submitted'].includes(goal.lifecycle)),
			canReassignReviewer: Boolean(goal.version === goal.current_version && goal.subject_active && ['owner', 'admin'].includes(team.role) && ['draft', 'proposed', 'active', 'submitted'].includes(goal.lifecycle)),
		};
		const administration = { id: goal.id, teamId: route.team_id, subjectId: goal.subject_id, reviewerId: goal.reviewer_id,
			periodStart: goal.period_start, periodEnd: goal.period_end, lifecycle: goal.lifecycle, version: goal.version, currentVersion: goal.current_version,
			revision: goal.revision, needsReviewer: goal.needs_reviewer };
		if (!subject && !reviewer && !proposedReviewer) {
			if (!['owner', 'admin'].includes(team.role)) fail('goal_not_found');
			return { access: 'administration', capabilities, goal: administration };
		}
		const content = (await client.query(`SELECT title,success_description,timezone,measurement,self_review,subject_accepted_at,reviewer_accepted_at
		 FROM team_goal_versions WHERE goal_id=$1 AND version=$2`, [goalId, goal.version])).rows[0];
		if (proposedReviewer && !subject) return { access: 'proposal', capabilities, goal: { ...administration, title: content.title,
			successDescription: content.success_description, timezone: content.timezone,
			subjectAcceptedAt: content.subject_accepted_at, reviewerAcceptedAt: content.reviewer_accepted_at,
			measurement: content.measurement.kind === 'numeric' ? { ...content.measurement, current: null } : content.measurement } };
		const review = (await client.query(`SELECT r.id,r.reviewer_id,r.outcome,r.explanation,r.next_step,r.published_at,${AUTHOR_PROFILE}
		 FROM team_goal_reviews r JOIN users u ON u.id=r.reviewer_id WHERE r.goal_id=$1 AND r.version=$2`, [goalId, goal.version])).rows[0];
		const updates = (await client.query(`SELECT e.id,e.author_id,e.reported_value,e.note,e.links,e.created_at,e.project_id,e.topic_id,${AUTHOR_PROFILE}
		 FROM team_goal_updates e JOIN users u ON u.id=e.author_id
		 WHERE e.goal_id=$1 AND e.version=$2 ORDER BY e.created_at,e.id LIMIT 51 OFFSET $3`, [goalId, goal.version, updatesOffset])).rows;
		const references = new Map();
		for (const update of updates.slice(0, 50)) {
			if (!update.project_id) continue;
			const key = JSON.stringify([update.project_id, update.topic_id]);
			if (!references.has(key)) {
				const locator = (await client.query('SELECT code FROM projects WHERE id=$1', [update.project_id])).rows[0];
				let reference = { access: 'unavailable' };
				try {
					if (locator) reference = { access: 'available', ...await evidenceReference(client, locator.code, update.topic_id, [actorId, goal.subject_id, goal.reviewer_id]) };
				} catch (error) { if (error.code !== 'goal_reference_unavailable') throw error; }
				references.set(key, reference);
			}
			update.reference = references.get(key);
		}
		const responses = review ? (await client.query(`SELECT r.id,r.author_id,r.response,r.acknowledged,r.created_at,${AUTHOR_PROFILE}
		 FROM team_goal_responses r JOIN users u ON u.id=r.author_id
		 WHERE r.review_id=$1 ORDER BY r.created_at,r.id LIMIT 51 OFFSET $2`, [review.id, responsesOffset])).rows : [];
		return { access: 'private', capabilities, goal: { ...administration, title: content.title, successDescription: content.success_description,
			timezone: content.timezone, measurement: content.measurement, achievement: achievement(content.measurement), selfReview: content.self_review,
			subjectAcceptedAt: content.subject_accepted_at, reviewerAcceptedAt: content.reviewer_accepted_at },
			review: review ? { id: review.id, authorId: review.reviewer_id, authorName: review.author_name, authorAvatarUrl: review.author_avatar || null, outcome: review.outcome, explanation: review.explanation, nextStep: review.next_step, publishedAt: review.published_at } : null,
			updates: updates.slice(0, 50).map(row => ({ id: row.id, authorId: row.author_id, authorName: row.author_name, authorAvatarUrl: row.author_avatar || null, value: row.reported_value, note: row.note, links: row.links, createdAt: row.created_at, ...(row.reference ? { reference: row.reference } : {}) })),
			updatesNextOffset: updates.length > 50 ? updatesOffset + 50 : null,
			responses: responses.slice(0, 50).map(row => ({ id: row.id, authorId: row.author_id, authorName: row.author_name, authorAvatarUrl: row.author_avatar || null, response: row.response, acknowledged: row.acknowledged, createdAt: row.created_at })),
			responsesNextOffset: responses.length > 50 ? responsesOffset + 50 : null };
	});
}

async function transitionGoal(goalId, actorId, input) {
	if (process.env.MEGU_TEAM_GOALS_ENABLED !== '1') fail('team_goals_disabled');
	const fields = { edit: ['reason', ...TERM_FIELDS], propose: [], accept: [], evidence: ['note', 'value', 'links', 'reference'], submit: ['selfReview'], return: ['reason'], review: ['outcome', 'explanation', 'nextStep'], respond: ['response', 'acknowledged'], revise: ['reason', ...TERM_FIELDS], cancel: ['reason'] };
	if (!input || !Object.hasOwn(fields, input.action)) fail('goal_action_invalid');
	validate.assertKnownFields(input, ['action', 'expectedRevision', 'version', ...fields[input.action]]);
	if (input.action === 'respond' && ((input.acknowledged != null && typeof input.acknowledged !== 'boolean') || (input.response != null && (typeof input.response !== 'string' || !input.response.trim() || input.response.length > 4000)) || (!input.response && input.acknowledged !== true))) fail('goal_input_invalid');
	for (const key of ['selfReview', 'reason', 'explanation', 'nextStep']) {
		if (fields[input.action].includes(key) && (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 4000)) fail('goal_input_invalid');
	}
	if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !Number.isSafeInteger(input.version) || input.version < 1) fail('goal_revision_conflict');
	return transaction(async client => {
		await client.query("SELECT pg_advisory_xact_lock(hashtext('team-goals-identity'))");
		const route = (await client.query('SELECT team_id FROM team_goals WHERE id=$1', [goalId])).rows[0];
		if (!route) fail('goal_not_found');
		const actorTeam = await accessById(client, route.team_id, actorId, { lock: true, allowArchived: false });
		const goal = (await client.query(`SELECT g.subject_id,g.created_by,g.revision,g.current_version,v.reviewer_id,v.lifecycle,v.subject_accepted_at,v.reviewer_accepted_at,v.needs_reviewer,v.measurement,
		 v.title,v.success_description,v.period_start::text,v.period_end::text,v.timezone
		 FROM team_goals g JOIN team_goal_versions v ON v.goal_id=g.id AND v.version=g.current_version WHERE g.id=$1 FOR UPDATE OF g,v`, [goalId])).rows[0];
		if (!goal) fail('goal_not_found');
		if (goal.current_version !== input.version || goal.revision !== input.expectedRevision) fail('goal_revision_conflict');
		await accessById(client, route.team_id, goal.subject_id, { allowArchived: false });
		if (goal.reviewer_id && !['respond', 'cancel'].includes(input.action)) {
			const reviewer = await accessById(client, route.team_id, goal.reviewer_id, { allowArchived: false });
			if (!['owner', 'admin'].includes(reviewer.role) || goal.reviewer_id === goal.subject_id || (goal.needs_reviewer && input.action !== 'accept')) fail('goal_reviewer_invalid');
		}
		const subject = goal.subject_id === actorId;
		const reviewer = goal.reviewer_id === actorId && ['owner', 'admin'].includes(actorTeam.role) && (!goal.needs_reviewer || input.action === 'accept');
		let lifecycle = goal.lifecycle;
		let version = input.version;
		let termChanges;
		if (input.action === 'edit') {
			if (!subject && !reviewer) fail('goal_forbidden');
			if (lifecycle !== 'draft') fail('goal_transition_invalid');
			if (!TERM_FIELDS.some(key => Object.hasOwn(input, key))) fail('goal_input_invalid');
			const before = { title: goal.title, successDescription: goal.success_description, periodStart: goal.period_start, periodEnd: goal.period_end, timezone: goal.timezone, measurement: goal.measurement };
			const after = goalTerms({ ...before, ...Object.fromEntries(TERM_FIELDS.filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]])) });
			await client.query(`UPDATE team_goal_versions SET title=$3,success_description=$4,period_start=$5,period_end=$6,timezone=$7,measurement=$8
			 WHERE goal_id=$1 AND version=$2`, [goalId, version, after.title, after.successDescription, after.periodStart, after.periodEnd, after.timezone, JSON.stringify(after.measurement)]);
			termChanges = { before, after };
		} else if (input.action === 'propose') {
			if (!subject && !reviewer && (goal.created_by !== actorId || !['owner', 'admin'].includes(actorTeam.role))) fail('goal_forbidden');
			if (lifecycle !== 'draft') fail('goal_transition_invalid');
			lifecycle = 'proposed';
			await client.query("UPDATE team_goal_versions SET lifecycle='proposed' WHERE goal_id=$1 AND version=$2", [goalId, input.version]);
		} else if (input.action === 'accept') {
			if (!subject && !reviewer) fail('goal_forbidden');
			if (lifecycle !== 'proposed') fail('goal_transition_invalid');
			if (subject ? goal.subject_accepted_at : goal.reviewer_accepted_at) fail('goal_already_accepted');
			const bothAccepted = (subject || goal.subject_accepted_at) && (!goal.reviewer_id || reviewer || goal.reviewer_accepted_at);
			lifecycle = bothAccepted ? 'active' : 'proposed';
			await client.query(`UPDATE team_goal_versions SET subject_accepted_at=CASE WHEN $3 THEN now() ELSE subject_accepted_at END,
			 reviewer_accepted_at=CASE WHEN $4 THEN now() ELSE reviewer_accepted_at END,lifecycle=$5,
			 needs_reviewer=CASE WHEN $5='active' THEN false ELSE needs_reviewer END WHERE goal_id=$1 AND version=$2`, [goalId, input.version, subject, reviewer, lifecycle]);
		} else if (input.action === 'cancel') {
			if (!subject && !reviewer) fail('goal_forbidden');
			if (!['draft', 'proposed', 'active', 'submitted'].includes(lifecycle)) fail('goal_transition_invalid');
			lifecycle = 'cancelled';
			await client.query("UPDATE team_goal_versions SET lifecycle='cancelled',reason=$3 WHERE goal_id=$1 AND version=$2", [goalId, input.version, input.reason.trim()]);
		} else if (input.action === 'revise') {
			if (!subject && !reviewer) fail('goal_forbidden');
			if (lifecycle !== 'reviewed') fail('goal_transition_invalid');
			const terms = goalTerms({ title: goal.title, successDescription: goal.success_description, periodStart: goal.period_start, periodEnd: goal.period_end, timezone: goal.timezone,
				measurement: goal.measurement.kind === 'numeric' ? { ...goal.measurement, current: null } : goal.measurement,
				...Object.fromEntries(TERM_FIELDS.filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]])) });
			version++;
			lifecycle = 'draft';
			await client.query(`INSERT INTO team_goal_versions(goal_id,version,reviewer_id,title,success_description,period_start,period_end,timezone,measurement,prior_version,reason,created_by)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [goalId, version, goal.reviewer_id, terms.title, terms.successDescription, terms.periodStart, terms.periodEnd, terms.timezone, JSON.stringify(terms.measurement), input.version, input.reason.trim(), actorId]);
			await client.query('UPDATE team_goals SET current_version=$2 WHERE id=$1', [goalId, version]);
		} else if (input.action === 'respond') {
			if (!subject) fail('goal_forbidden');
			if (lifecycle !== 'reviewed') fail('goal_transition_invalid');
			const review = (await client.query('SELECT id FROM team_goal_reviews WHERE goal_id=$1 AND version=$2', [goalId, input.version])).rows[0];
			if (!review) fail('goal_transition_invalid');
			await client.query('INSERT INTO team_goal_responses(id,review_id,author_id,response,acknowledged) VALUES ($1,$2,$3,$4,$5)', [newId('grp'), review.id, actorId, input.response?.trim() || null, input.acknowledged === true]);
		} else if (input.action === 'evidence') {
			if (!subject) fail('goal_forbidden');
			if (lifecycle !== 'active') fail('goal_transition_invalid');
			const evidence = validateEvidence(input, goal.measurement.kind);
			const reference = evidence.reference ? await evidenceReference(client, evidence.reference.projectCode, evidence.reference.topicId, [goal.subject_id, goal.reviewer_id]) : null;
			await client.query('INSERT INTO team_goal_updates(id,goal_id,version,author_id,reported_value,note,links,project_id,topic_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
				[newId('gup'), goalId, input.version, actorId, evidence.value, evidence.note, JSON.stringify(evidence.links), reference?.projectId || null, reference?.topicId || null]);
			if (evidence.value !== null) await client.query("UPDATE team_goal_versions SET measurement=jsonb_set(measurement,'{current}',$3::jsonb) WHERE goal_id=$1 AND version=$2", [goalId, input.version, JSON.stringify(evidence.value)]);
		} else if (input.action === 'submit') {
			if (!subject) fail('goal_forbidden');
			if (lifecycle !== 'active') fail('goal_transition_invalid');
			if (!goal.reviewer_id) fail('goal_reviewer_required');
			lifecycle = 'submitted';
			await client.query("UPDATE team_goal_versions SET lifecycle='submitted',self_review=$3 WHERE goal_id=$1 AND version=$2", [goalId, input.version, input.selfReview.trim()]);
		} else {
			if (!reviewer) fail('goal_forbidden');
			if (lifecycle !== 'submitted') fail('goal_transition_invalid');
			if (input.action === 'return') {
				lifecycle = 'active';
				await client.query("UPDATE team_goal_versions SET lifecycle='active' WHERE goal_id=$1 AND version=$2", [goalId, input.version]);
			} else {
				if (!['exceeded', 'met', 'partially_met', 'not_met', 'not_assessed'].includes(input.outcome) || (goal.measurement.kind === 'milestone' && input.outcome === 'exceeded')) fail('goal_outcome_invalid');
				await client.query('INSERT INTO team_goal_reviews(id,goal_id,version,reviewer_id,outcome,explanation,next_step) VALUES ($1,$2,$3,$4,$5,$6,$7)',
					[newId('grv'), goalId, input.version, actorId, input.outcome, input.explanation.trim(), input.nextStep.trim()]);
				lifecycle = 'reviewed';
				await client.query("UPDATE team_goal_versions SET lifecycle='reviewed' WHERE goal_id=$1 AND version=$2", [goalId, input.version]);
			}
		}
		await client.query('UPDATE team_goals SET revision=revision+1 WHERE id=$1', [goalId]);
		await client.query('INSERT INTO team_goal_events(id,goal_id,version,actor_id,event_type,payload) VALUES ($1,$2,$3,$4,$5,$6)',
			[newId('gev'), goalId, version, actorId, { edit: 'goal_terms_edited', propose: 'goal_proposed', accept: 'goal_accepted', evidence: 'goal_evidence_added', submit: 'goal_submitted', return: 'goal_returned', review: 'goal_reviewed', respond: 'goal_response_added', revise: 'goal_revised', cancel: 'goal_cancelled' }[input.action], JSON.stringify({ lifecycle, participant: subject ? 'subject' : reviewer ? 'reviewer' : 'creator', ...(['edit', 'return', 'revise', 'cancel'].includes(input.action) ? { reason: input.reason.trim() } : {}), ...(termChanges ? { terms: termChanges } : {}), ...(input.action === 'revise' ? { priorVersion: input.version } : {}), ...(input.action === 'submit' ? { selfReview: input.selfReview.trim() } : {}) })]);
		await require('./team-goal-notifications').enqueueChangeWithClient(client, { teamId: route.team_id, goalId, version, revision: goal.revision + 1, recipients: [goal.subject_id, goal.reviewer_id], actorId });
		return { id: goalId, version, revision: input.expectedRevision + 1, lifecycle };
	});
}

async function reassignReviewer(goalId, actorId, input) {
	if (process.env.MEGU_TEAM_GOALS_ENABLED !== '1') fail('team_goals_disabled');
	validate.assertKnownFields(input, ['reviewerId', 'reason', 'expectedRevision']);
	if (typeof input.reviewerId !== 'string' || !input.reviewerId || input.reviewerId.length > 200 || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 4000) fail('goal_input_invalid');
	if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('goal_revision_conflict');
	return transaction(async client => {
		await client.query("SELECT pg_advisory_xact_lock(hashtext('team-goals-identity'))");
		const route = (await client.query('SELECT team_id FROM team_goals WHERE id=$1', [goalId])).rows[0];
		if (!route) fail('goal_not_found');
		const actor = await accessById(client, route.team_id, actorId, { lock: true, allowArchived: false });
		if (!['owner', 'admin'].includes(actor.role)) fail('goal_forbidden');
		const goal = (await client.query(`SELECT g.subject_id,g.current_version,g.revision,v.lifecycle,v.reviewer_id
		 FROM team_goals g JOIN team_goal_versions v ON v.goal_id=g.id AND v.version=g.current_version WHERE g.id=$1 FOR UPDATE OF g,v`, [goalId])).rows[0];
		if (!goal || goal.revision !== input.expectedRevision) fail('goal_revision_conflict');
		if (!['draft', 'proposed', 'active', 'submitted'].includes(goal.lifecycle)) fail('goal_transition_invalid');
		if (goal.subject_id === input.reviewerId) fail('goal_reviewer_invalid');
		await accessById(client, route.team_id, goal.subject_id, { allowArchived: false });
		const reviewer = await accessById(client, route.team_id, input.reviewerId, { allowArchived: false });
		if (!['owner', 'admin'].includes(reviewer.role)) fail('goal_reviewer_invalid');
		await client.query(`UPDATE team_goal_versions SET reviewer_id=$3,lifecycle='proposed',needs_reviewer=true,
		 subject_accepted_at=NULL,reviewer_accepted_at=NULL,self_review=NULL WHERE goal_id=$1 AND version=$2`, [goalId, goal.current_version, input.reviewerId]);
		await client.query('UPDATE team_goals SET revision=revision+1 WHERE id=$1', [goalId]);
		await client.query("INSERT INTO team_goal_events(id,goal_id,version,actor_id,event_type,payload) VALUES ($1,$2,$3,$4,'goal_reviewer_reassigned',$5)",
			[newId('gev'), goalId, goal.current_version, actorId, JSON.stringify({ previousReviewerId: goal.reviewer_id, reviewerId: input.reviewerId, reason: input.reason.trim() })]);
		await require('./team-goal-notifications').enqueueChangeWithClient(client, { teamId: route.team_id, goalId, version: goal.current_version, revision: goal.revision + 1, recipients: [goal.subject_id, input.reviewerId], actorId });
		return { id: goalId, revision: goal.revision + 1, version: goal.current_version, lifecycle: 'proposed' };
	});
}

async function listGoals(teamId, actorId, { offset = 0, limit = 30 } = {}) {
	if (process.env.MEGU_TEAM_GOALS_ENABLED !== '1') fail('team_goals_disabled');
	if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('goal_page_invalid');
	return transaction(async client => {
		const team = await accessById(client, teamId, actorId, { lock: true, allowArchived: false });
		const manager = ['owner', 'admin'].includes(team.role);
		const result = await client.query(`SELECT g.id,g.subject_id,u.display_name AS subject_name,
		 COALESCE((SELECT NULLIF(i.avatar_url,'') FROM identities i WHERE i.user_id=u.id AND i.provider='discord' ORDER BY i.id LIMIT 1),u.avatar_url) AS subject_avatar,
		 g.current_version,g.revision,v.reviewer_id,v.period_start::text,v.period_end::text,v.lifecycle,v.needs_reviewer,
		 CASE WHEN g.subject_id=$2 OR (v.reviewer_id=$2 AND $3) THEN v.title ELSE NULL END AS title,
		 (g.subject_id=$2 OR (v.reviewer_id=$2 AND $3 AND NOT v.needs_reviewer)) AS private_access
		 FROM team_goals g JOIN users u ON u.id=g.subject_id JOIN team_goal_versions v ON v.goal_id=g.id AND v.version=g.current_version
		 WHERE g.team_id=$1 AND ($3 OR g.subject_id=$2)
		 ORDER BY v.period_end DESC,g.id LIMIT $4 OFFSET $5`, [teamId, actorId, manager, limit + 1, offset]);
		return { team: { id: team.id, name: team.name }, goals: result.rows.slice(0, limit).map(row => ({ id: row.id, subjectId: row.subject_id, subjectName: row.subject_name, subjectAvatarUrl: row.subject_avatar || null, reviewerId: row.reviewer_id,
			version: row.current_version, revision: row.revision, periodStart: row.period_start, periodEnd: row.period_end,
			lifecycle: row.lifecycle, needsReviewer: row.needs_reviewer,
			access: row.private_access ? 'private' : row.reviewer_id === actorId && manager ? 'proposal' : 'administration',
			...(row.title !== null ? { title: row.title } : {}) })), nextOffset: result.rows.length > limit ? offset + limit : null };
	});
}

module.exports = { getGoal, createGoal, transitionGoal, reassignReviewer, listGoals };
