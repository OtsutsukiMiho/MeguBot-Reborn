const assert = require('node:assert');

(async () => {
	const {
		ATTENTION_FILTERS,
		deriveProjectTopicFilters,
		deriveReportableTopics,
		parseProjectFilterParams,
		topicMatchesAttention,
		writeProjectFilterParams,
	} = await import('../app/components/projects/projectFilters.mjs');

	const now = Date.parse('2026-09-12T10:00:00.000Z');
	const topics = [
		{ id: 'blocked-mine', title: 'Backend API', workflow: 'in_progress', blocked: true, deadlineAt: '2026-09-11T10:00:00.000Z', assignees: [{ userId: 'me', primary: true }] },
		{ id: 'review-mine', title: 'หน้าชำระเงิน', workflow: 'in_review', blocked: false, deadlineAt: '2026-09-13T10:00:00.000Z', assignees: [{ userId: 'lead', primary: true }, { userId: 'me', primary: false }] },
		{ id: 'collaborator-only', title: 'Launch checklist', workflow: 'not_started', blocked: false, deadlineAt: null, assignees: [{ userId: 'helper', primary: false }] },
		{ id: 'completed', title: 'Backend prototype', workflow: 'completed', blocked: true, deadlineAt: '2026-09-01T10:00:00.000Z', assignees: [] },
		{ id: 'invalid-date', title: 'Data cleanup', workflow: 'in_progress', blocked: false, deadlineAt: 'not-a-date', assignees: [] },
	];

	assert.deepStrictEqual(ATTENTION_FILTERS, ['all', 'blocked', 'overdue', 'review', 'unassigned']);
	assert.equal(topicMatchesAttention(topics[0], 'blocked', now), true);
	assert.equal(topicMatchesAttention(topics[3], 'blocked', now), false, 'completed work is not attention-blocked');
	assert.equal(topicMatchesAttention(topics[0], 'overdue', now), true);
	assert.equal(topicMatchesAttention({ ...topics[0], deadlineAt: new Date(now).toISOString() }, 'overdue', now), false, 'the exact deadline instant is not overdue');
	assert.equal(topicMatchesAttention(topics[3], 'overdue', now), false, 'completed work is not overdue');
	assert.equal(topicMatchesAttention(topics[4], 'overdue', now), false, 'malformed deadlines are not overdue');
	assert.equal(topicMatchesAttention(topics[2], 'unassigned', now), true, 'a collaborator without a primary remains unassigned');
	assert.equal(topicMatchesAttention(topics[1], 'review', now), true);

	const unassigned = deriveProjectTopicFilters(topics, { attention: 'unassigned', now });
	assert.deepStrictEqual(unassigned.visibleTopics.map(topic => topic.id), ['collaborator-only', 'invalid-date']);
	assert.deepStrictEqual(unassigned.counts, { all: 5, blocked: 1, overdue: 1, review: 1, unassigned: 2 });
	assert.equal(unassigned.totalCount, 5);

	const mine = deriveProjectTopicFilters(topics, { attention: 'all', assignedToMe: true, currentUserId: 'me', now });
	assert.deepStrictEqual(mine.visibleTopics.map(topic => topic.id), ['blocked-mine', 'review-mine']);
	assert.deepStrictEqual(mine.counts, { all: 2, blocked: 1, overdue: 1, review: 1, unassigned: 0 });

	const searched = deriveProjectTopicFilters(topics, { attention: 'blocked', query: '  BACKEND  ', now });
	assert.deepStrictEqual(searched.visibleTopics.map(topic => topic.id), ['blocked-mine']);
	assert.deepStrictEqual(searched.counts, { all: 2, blocked: 1, overdue: 1, review: 0, unassigned: 0 }, 'counts apply search before attention');
	assert.deepStrictEqual(deriveProjectTopicFilters(topics, { query: 'ชำระ', now }).visibleTopics.map(topic => topic.id), ['review-mine']);

	const parsed = parseProjectFilterParams('?view=topics&attention=blocked&assigned=me&q=backend');
	assert.deepStrictEqual(parsed, { attention: 'blocked', assignedToMe: true, query: 'backend' });
	assert.equal(parseProjectFilterParams(`?attention=unknown&q=${'x'.repeat(140)}`).attention, 'all');
	assert.equal(parseProjectFilterParams(`?q=${'x'.repeat(140)}`).query.length, 120);

	const written = writeProjectFilterParams('view=topics&topic=top_1&keep=yes', { attention: 'review', assignedToMe: true, query: '  ไทย  ' });
	assert.equal(written.get('view'), 'topics');
	assert.equal(written.get('topic'), 'top_1');
	assert.equal(written.get('keep'), 'yes');
	assert.equal(written.get('attention'), 'review');
	assert.equal(written.get('assigned'), 'me');
	assert.equal(written.get('q'), 'ไทย');
	const cleared = writeProjectFilterParams(written, { attention: 'all', assignedToMe: false, query: '' });
	assert.equal(cleared.has('attention'), false);
	assert.equal(cleared.has('assigned'), false);
	assert.equal(cleared.has('q'), false);
	assert.equal(cleared.get('keep'), 'yes');

	assert.deepStrictEqual(
		deriveReportableTopics(topics, { role: 'owner', userId: 'owner', projectStatus: 'active' }).map(topic => topic.id),
		['blocked-mine', 'review-mine', 'collaborator-only', 'invalid-date'],
		'owners can report every unfinished topic',
	);
	assert.deepStrictEqual(
		deriveReportableTopics(topics, { role: 'member', userId: 'me', projectStatus: 'active' }).map(topic => topic.id),
		['blocked-mine', 'review-mine'],
		'members can report only their assigned unfinished topics',
	);
	assert.deepStrictEqual(deriveReportableTopics(topics, { role: 'viewer', userId: 'me', projectStatus: 'active' }), []);
	assert.deepStrictEqual(deriveReportableTopics(topics, { role: 'lead', userId: 'lead', projectStatus: 'paused' }), []);

	console.log('project attention filters passed — filtering, report eligibility, multilingual search and URL state are deterministic');
})().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
