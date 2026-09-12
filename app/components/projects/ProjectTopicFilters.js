'use client';

import { Search, X } from 'lucide-react';
import CustomSelect from '../CustomSelect';
import { ATTENTION_FILTERS } from './projectFilters.mjs';
import styles from './projectWorkspace.module.css';

export default function ProjectTopicFilters({ attention, assignedToMe, query, counts, visibleCount, totalCount, refreshing, p, onAttentionChange, onAssignedChange, onQueryChange, onClear }) {
	const options = ATTENTION_FILTERS.map(value => ({
		value,
		label: `${p.attention[value]} (${counts[value] || 0})`,
	}));

	return <section className={styles.topicFilters} aria-label={p.topicFiltersLabel} aria-busy={refreshing || undefined}>
		<p id="project-unassigned-filter-hint" className={styles.srOnly}>{p.unassignedFilterHint}</p>
		<div className={styles.attentionButtons} aria-label={p.attentionLabel}>
			{options.map(option => <button key={option.value} type="button" aria-pressed={attention === option.value} aria-describedby={option.value === 'unassigned' ? 'project-unassigned-filter-hint' : undefined} onClick={() => onAttentionChange(option.value)}><span>{p.attention[option.value]}</span><b>{counts[option.value] || 0}</b></button>)}
		</div>
		<div className={styles.attentionSelect}>
			<CustomSelect size="compact" searchable={false} ariaLabel={p.attentionLabel} ariaDescribedBy={attention === 'unassigned' ? 'project-unassigned-filter-hint' : undefined} value={attention} options={options} onChange={onAttentionChange} />
		</div>
		<div className={styles.topicSearch}>
			<label htmlFor="project-topic-search" className={styles.srOnly}>{p.topicSearchLabel}</label>
			<Search size={16} aria-hidden="true" />
			<input id="project-topic-search" type="search" value={query} maxLength={120} onChange={event => onQueryChange(event.target.value)} placeholder={p.topicSearchPlaceholder} />
			{query && <button type="button" onClick={() => onQueryChange('')} aria-label={p.clearTopicSearch}><X size={15} /></button>}
		</div>
		<div className={styles.filterSummary}>
			<label className={styles.assignedFilter}><input type="checkbox" checked={assignedToMe} onChange={event => onAssignedChange(event.target.checked)} /><span>{p.assignedToMeFilter}</span></label>
			{refreshing && <span className={styles.refreshingTopics}>{p.refreshingTopics}</span>}
			<p role="status" aria-live="polite" aria-atomic="true">{p.showingTopics(visibleCount, totalCount)}</p>
			{(attention !== 'all' || assignedToMe || query.trim()) && <button type="button" className={styles.clearTopicFilters} onClick={onClear}>{p.clearFilters}</button>}
		</div>
	</section>;
}
