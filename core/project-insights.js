'use strict';

// Date-only deadlines arrive as timezone-normalized end-of-day instants from
// projects.validate.dates. Never infer a legacy completion from updatedAt.
function time(value) {
	if (value == null || value === '') return null;
	const milliseconds = new Date(value).getTime();
	return Number.isFinite(milliseconds) ? milliseconds : null;
}

function reportedProgress(sum, count) {
	return Number(count) > 0 ? Math.round(Number(sum) / Number(count)) : null;
}

function projectInsights(topics, now = new Date()) {
	const at = time(now);
	if (at === null) throw new TypeError('A valid insight timestamp is required');
	const active = topics.filter(topic => !topic.archivedAt);
	const completed = active.filter(topic => topic.workflow === 'completed');
	const tracked = completed.filter(topic => time(topic.completedAt) !== null && time(topic.completionDeadlineAt) !== null);
	const onTime = tracked.filter(topic => time(topic.completedAt) <= time(topic.completionDeadlineAt));
	const overdue = active.filter(topic => topic.workflow !== 'completed' && time(topic.deadlineAt) !== null && time(topic.deadlineAt) < at);
	const blocked = active.filter(topic => topic.blocked === true);
	const review = active.filter(topic => topic.workflow === 'in_review');
	return {
		asOf: new Date(at).toISOString(),
		topicCount: active.length,
		reportedProgress: reportedProgress(active.reduce((sum, topic) => sum + Number(topic.progress), 0), active.length),
		completed: { count: completed.length, total: active.length, topicIds: completed.map(topic => topic.id) },
		overdue: { count: overdue.length, topicIds: overdue.map(topic => topic.id) },
		blocked: { count: blocked.length, topicIds: blocked.map(topic => topic.id) },
		awaitingReview: { count: review.length, topicIds: review.map(topic => topic.id) },
		undatedCount: active.filter(topic => time(topic.deadlineAt) === null).length,
		onTime: { count: onTime.length, total: tracked.length,
			percentage: tracked.length ? Math.round(onTime.length * 100 / tracked.length) : null,
			unknownCompletionCount: completed.filter(topic => time(topic.completedAt) === null).length,
			missingDeadlineCount: completed.filter(topic => time(topic.completedAt) !== null && time(topic.completionDeadlineAt) === null).length,
			topicIds: onTime.map(topic => topic.id) },
	};
}

module.exports = { projectInsights, reportedProgress };
