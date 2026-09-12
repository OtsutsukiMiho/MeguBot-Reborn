export const ATTENTION_FILTERS = Object.freeze(['all', 'blocked', 'overdue', 'review', 'unassigned']);

const ATTENTION_SET = new Set(ATTENTION_FILTERS);

export function normalizeTopicQuery(value) {
	return String(value || '').slice(0, 120);
}

export function parseProjectFilterParams(source = '') {
	const params = source instanceof URLSearchParams ? source : new URLSearchParams(source);
	const attention = params.get('attention');
	return {
		attention: ATTENTION_SET.has(attention) ? attention : 'all',
		assignedToMe: params.get('assigned') === 'me',
		query: normalizeTopicQuery(params.get('q') || ''),
	};
}

export function writeProjectFilterParams(source, filters) {
	const params = source instanceof URLSearchParams ? new URLSearchParams(source) : new URLSearchParams(source || '');
	const attention = ATTENTION_SET.has(filters?.attention) ? filters.attention : 'all';
	const query = normalizeTopicQuery(filters?.query || '').trim();

	if (attention === 'all') params.delete('attention');
	else params.set('attention', attention);
	if (filters?.assignedToMe) params.set('assigned', 'me');
	else params.delete('assigned');
	if (query) params.set('q', query);
	else params.delete('q');
	return params;
}

export function topicMatchesAttention(topic, attention, now) {
	const unfinished = topic?.workflow !== 'completed';
	if (attention === 'blocked') return unfinished && topic?.blocked === true;
	if (attention === 'review') return topic?.workflow === 'in_review';
	if (attention === 'unassigned') return unfinished && !topic?.assignees?.some(assignee => assignee.primary);
	if (attention === 'overdue') {
		if (!unfinished || !topic?.deadlineAt) return false;
		const deadline = Date.parse(topic.deadlineAt);
		return Number.isFinite(deadline) && deadline < now;
	}
	return true;
}

export function deriveProjectTopicFilters(topics, filters = {}) {
	const allTopics = Array.isArray(topics) ? topics : [];
	const attention = ATTENTION_SET.has(filters.attention) ? filters.attention : 'all';
	const needle = normalizeTopicQuery(filters.query || '').trim().toLocaleLowerCase();
	const currentUserId = String(filters.currentUserId || '');
	const now = Number.isFinite(filters.now) ? filters.now : Date.now();

	const baseTopics = allTopics.filter(topic => {
		if (filters.assignedToMe && !topic?.assignees?.some(assignee => assignee.userId === currentUserId)) return false;
		return !needle || String(topic?.title || '').toLocaleLowerCase().includes(needle);
	});
	const counts = Object.fromEntries(ATTENTION_FILTERS.map(value => [
		value,
		baseTopics.filter(topic => topicMatchesAttention(topic, value, now)).length,
	]));
	const visibleTopics = attention === 'all'
		? baseTopics
		: baseTopics.filter(topic => topicMatchesAttention(topic, attention, now));

	return {
		attention,
		counts,
		visibleTopics,
		visibleCount: visibleTopics.length,
		totalCount: allTopics.length,
		isActive: attention !== 'all' || Boolean(filters.assignedToMe) || Boolean(needle),
	};
}

export function deriveReportableTopics(topics, { role, userId, projectStatus } = {}) {
	if (projectStatus !== 'active' || role === 'viewer') return [];
	const unfinished = (Array.isArray(topics) ? topics : []).filter(topic => topic?.workflow !== 'completed');
	if (role === 'owner' || role === 'lead') return unfinished;
	const currentUserId = String(userId || '');
	return unfinished.filter(topic => topic?.assignees?.some(assignee => assignee.userId === currentUserId));
}
