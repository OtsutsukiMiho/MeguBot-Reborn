'use client';

import styles from './projectInsights.module.css';

export default function ProjectInsights({ insights, topics, copy, lang, timezone, onSelect, onRefresh, refreshing }) {
	if (!insights) return <section className={styles.insights}><p role="status">{copy.unavailable}</p><button type="button" className="btn btn-secondary" disabled={refreshing} onClick={onRefresh}>{copy.refresh}</button></section>;
	const byId = new Map(topics.map(topic => [topic.id, topic]));
	const metrics = [
		['completed', copy.completed, copy.completedHint],
		['overdue', copy.overdue, copy.overdueHint],
		['blocked', copy.blocked, copy.blockedHint],
		['awaitingReview', copy.review, copy.reviewHint],
		['onTime', copy.onTime, copy.onTimeHint],
	];
	const timestamp = new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(insights.asOf));
	return <section className={styles.insights} aria-labelledby="project-insights-heading">
		<header className={styles.header}><div><h2 id="project-insights-heading">{copy.title}</h2><p>{copy.scope}</p></div><button type="button" className="btn btn-secondary btn-sm" disabled={refreshing} onClick={onRefresh}>{refreshing ? copy.refreshing : copy.refresh}</button></header>
		<p className={styles.timestamp}>{copy.asOf(timestamp, timezone)}</p>
		{insights.topicCount === 0 ? <p>{copy.empty}</p> : <>
			<dl className={styles.progress}><dt>{copy.reported}</dt><dd>{insights.reportedProgress}%</dd></dl>
			<p>{copy.reportedHint}</p>
			<div className={styles.metrics}>{metrics.map(([key, label, hint]) => {
				const metric = insights[key];
				const value = key === 'onTime' ? metric.total ? `${metric.percentage}% · ${metric.count}/${metric.total}` : copy.notAvailable : key === 'completed' ? `${metric.count}/${metric.total}` : metric.count;
				return <section className={styles.metric} key={key}>
					<div className={styles.metricHeading}><h3>{label}</h3><strong>{value}</strong></div><p>{hint}</p>
					{key === 'onTime' && <p>{copy.excluded(metric.unknownCompletionCount, metric.missingDeadlineCount)}</p>}
					{metric.topicIds.length > 0 && <details><summary>{copy.showTopics(metric.topicIds.length)}</summary><ul>{metric.topicIds.map(id => {
						const topic = byId.get(id);
						return topic ? <li key={id}><button type="button" onClick={() => onSelect(id)}>#{topic.number} {topic.title}</button></li> : null;
					})}</ul></details>}
				</section>;
			})}</div>
			<p>{copy.undated(insights.undatedCount)}</p>
		</>}
		<p className={styles.note}>{copy.notEvaluation}</p>
	</section>;
}
