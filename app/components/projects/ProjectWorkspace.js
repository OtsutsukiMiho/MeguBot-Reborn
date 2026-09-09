'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	AlertTriangle, ArrowLeft, CalendarDays, Check, ChevronLeft, ChevronRight,
	CircleDot, Diamond, Flag, GitFork, LockKeyhole, Plus, Send, Settings2, X,
} from 'lucide-react';
import AuthGate from '../AuthGate';
import ProjectAvatar from './ProjectAvatar';
import CustomSelect from '../CustomSelect';
import { useCopy } from '../../copy';
import styles from './projectWorkspace.module.css';

const DAY = 86_400_000;
const LEADS = new Set(['owner', 'lead']);
const TABS = ['timeline', 'topics', 'updates'];
const EVENT_HUES = {
	project_created: 158, project_state_changed: 45, project_updated: 215,
	topic_created: 175, topic_updated: 205, topic_archived: 25, topic_restored: 150,
	progress_reported: 135, topic_completed: 115, topic_returned: 35, topic_reopened: 55,
	member_invited: 235, invitation_revoked: 355, member_joined: 185,
	member_role_changed: 265, member_removed: 5, member_left: 15, assignments_changed: 250,
	ownership_transfer_proposed: 290, ownership_transfer_cancelled: 335, ownership_transferred: 310,
	notification_settings_changed: 225, dependency_added: 275, dependency_removed: 345,
	milestone_created: 285, milestone_updated: 300, milestone_removed: 325,
};
const INLINE_MARKDOWN = /\*\*([^*\n]+)\*\*|`([^`\n]+)`|\*([^*\n]+)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/gi;

function markdownInline(value, prefix) {
	const source = String(value || '');
	const output = [];
	let cursor = 0;
	let match;
	INLINE_MARKDOWN.lastIndex = 0;
	while ((match = INLINE_MARKDOWN.exec(source))) {
		if (match.index > cursor) output.push(source.slice(cursor, match.index));
		const key = `${prefix}-${match.index}`;
		if (match[1] != null) output.push(<strong key={key}>{match[1]}</strong>);
		else if (match[2] != null) output.push(<code key={key}>{match[2]}</code>);
		else if (match[3] != null) output.push(<em key={key}>{match[3]}</em>);
		else output.push(<a key={key} href={match[5]} target="_blank" rel="noreferrer noopener">{match[4]}</a>);
		cursor = INLINE_MARKDOWN.lastIndex;
	}
	if (cursor < source.length) output.push(source.slice(cursor));
	return output;
}

function SafeProjectMarkdown({ children }) {
	const source = String(children || '').trim();
	if (!source) return null;
	return <div className={styles.markdown}>{source.split(/\n{2,}/).map((block, blockIndex) => <p key={blockIndex}>{block.split('\n').map((line, lineIndex) => <span key={lineIndex}>{lineIndex > 0 && <br />}{markdownInline(line, `${blockIndex}-${lineIndex}`)}</span>)}</p>)}</div>;
}

function projectDate(value, lang, timezone, withYear = true) {
	if (!value) return null;
	return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', {
		day: '2-digit', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: timezone,
	}).format(new Date(canonicalProjectDate(value)));
}

function canonicalProjectDate(value) {
	const source = String(value || '');
	const match = /^(\d{4})(-\d{2}-\d{2})(.*)$/.exec(source);
	if (!match) return value;
	const year = Number(match[1]);
	return year >= 2400 && year <= 2699 ? `${year - 543}${match[2]}${match[3]}` : value;
}

function dateInput(value, timezone) {
	if (!value) return '';
	const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(canonicalProjectDate(value))).map(part => [part.type, part.value]));
	return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftDateOnly(value, days) {
	if (!value) return '';
	const [year, month, day] = value.split('-').map(Number);
	const shifted = new Date(Date.UTC(year, month - 1, day));
	shifted.setUTCDate(shifted.getUTCDate() + days);
	return shifted.toISOString().slice(0, 10);
}

function relativeDate(value, lang) {
	const seconds = Math.round((new Date(canonicalProjectDate(value)).getTime() - Date.now()) / 1000);
	const formatter = new Intl.RelativeTimeFormat(lang === 'th' ? 'th' : 'en', { numeric: 'auto' });
	if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), 'minute');
	if (Math.abs(seconds) < 86400) return formatter.format(Math.round(seconds / 3600), 'hour');
	return formatter.format(Math.round(seconds / 86400), 'day');
}


function uuid() {
	return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function ProjectWorkspace({ code }) {
	const { t, lang } = useCopy();
	const p = t.projects;
	const [data, setData] = useState(null);
	const [loading, setLoading] = useState(true);
	const [signedOut, setSignedOut] = useState(false);
	const [error, setError] = useState('');
	const [tab, setTabState] = useState('timeline');
	const [selectedId, setSelectedId] = useState(null);
	const [adding, setAdding] = useState(false);
	const [reporting, setReporting] = useState(false);
	const [choosingReport, setChoosingReport] = useState(false);
	const [busyState, setBusyState] = useState(false);
	const [reportAnnouncement, setReportAnnouncement] = useState('');
	const [focusDetail, setFocusDetail] = useState(false);
	const tabsRef = useRef([]);
	const detailTriggerRef = useRef(null);

	const readError = useCallback(problem => p.errors[problem?.code] || p.errors.failed, [p.errors]);
	const load = useCallback(async ({ quiet = false } = {}) => {
		if (!quiet) setLoading(true);
		setError('');
		try {
			const response = await fetch(`/api/megu/projects/${encodeURIComponent(code)}`, { credentials: 'same-origin' });
			if (response.status === 401) { setSignedOut(true); return; }
			const body = await response.json();
			if (!response.ok) throw body;
			setData(body);
			setSelectedId(current => {
				const linked = new URLSearchParams(window.location.search).get('topic');
				if (linked && body.topics.some(topic => topic.id === linked)) return linked;
				if (window.matchMedia('(max-width: 620px)').matches) return null;
				return body.topics.some(topic => topic.id === current) ? current : (body.topics.find(topic => topic.assignees.some(a => a.userId === body.me.userId))?.id || body.topics[0]?.id || null);
			});
		}
		catch (problem) { setError(readError(problem)); }
		finally { setLoading(false); }
	}, [code, readError]);

	useEffect(() => {
		const view = new URLSearchParams(window.location.search).get('view');
		if (TABS.includes(view)) setTabState(view);
		else if (window.matchMedia('(max-width: 620px)').matches) setTabState('topics');
		load();
	}, [load]);

	const setTab = value => {
		setTabState(value);
		const next = new URL(window.location.href);
		next.searchParams.set('view', value);
		window.history.replaceState({}, '', next);
	};
	const selectTopic = value => {
		if (value && document.activeElement instanceof HTMLElement) {
			detailTriggerRef.current = document.activeElement;
			setFocusDetail(true);
		}
		setSelectedId(value);
		const next = new URL(window.location.href);
		if (value) next.searchParams.set('topic', value); else next.searchParams.delete('topic');
		window.history.replaceState({}, '', next);
	};
	const closeTopic = () => {
		selectTopic(null); setReporting(false); setFocusDetail(false);
		requestAnimationFrame(() => detailTriggerRef.current?.focus?.());
	};
	const startReport = topicId => { selectTopic(topicId); setReporting(true); setChoosingReport(false); };

	const onTabKey = (event, index) => {
		let next = index;
		if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
		else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = TABS.length - 1;
		else return;
		event.preventDefault(); setTab(TABS[next]); tabsRef.current[next]?.focus();
	};

	if (loading) return <ProjectSkeleton />;
	if (signedOut) return <AuthGate title={p.signedOutTitle} lede={p.signedOutLede} />;
	if (!data) return <ProjectFailure message={error} retry={load} p={p} />;

	const { project, topics, archivedTopics = [], members, me, events } = data;
	const canLead = LEADS.has(me.role);
	const selected = topics.find(topic => topic.id === selectedId) || null;
	const mine = topics.filter(topic => topic.assignees.some(assignee => assignee.userId === me.userId));
	const reportableMine = mine.filter(topic => topic.workflow !== 'completed');
	const awaiting = mine.filter(topic => topic.workflow === 'in_review').length;
	const canReportSelected = selected && project.status === 'active' && (canLead || selected.assignees.some(a => a.userId === me.userId)) && selected.workflow !== 'completed';

	const activate = async () => {
		setBusyState(true); setError('');
		try {
			const response = await fetch(`/api/megu/projects/${project.code}/state`, {
				method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: 'active', expectedRevision: project.revision }),
			});
			const body = await response.json(); if (!response.ok) throw body; await load({ quiet: true });
		}
		catch (problem) { setError(readError(problem)); }
		finally { setBusyState(false); }
	};

	return (
		<div className={styles.workspace}>
			<Link href="/projects" className={styles.back}><ArrowLeft size={15} />{p.title}</Link>
			<header className={styles.projectHead}>
				<div className={styles.projectIdentity}>
					<div className={styles.titleLine}><h1>{project.title}</h1><span className={styles.private}><LockKeyhole size={13} />{p.private}</span><State value={project.status} p={p} /></div>
					{project.description && <p className={styles.description}>{project.description}</p>}
					<div className={styles.meta}>
						<span>{p.topicsCount(project.topicCount)}</span><span>{p.peopleCount(members.length)}</span>
						<span>{project.deadlineAt ? `${p.due} ${projectDate(project.deadlineAt, lang, project.timezone)}` : p.noDeadline}</span>
						<span>{project.timezone}</span>
					</div>
				</div>
				<div className={styles.headActions}>
					<Link href={`/p/${project.code}/manage`} className="btn btn-secondary"><Settings2 size={16} />{p.manage}</Link>
					{project.status === 'planning' && canLead ? <button type="button" className="btn btn-primary" disabled={busyState || topics.length === 0} onClick={activate}>{busyState ? p.starting : p.startProject}</button> :
						<button type="button" className="btn btn-primary" disabled={reportableMine.length === 0 || project.status !== 'active'} onClick={() => reportableMine.length === 1 ? startReport(reportableMine[0].id) : setChoosingReport(true)}>{p.reportProgress}</button>}
				</div>
				<div className={styles.projectProgress}><span style={{ width: `${project.progress}%` }} /><strong>{project.progress}%</strong><em>{p.progress}</em></div>
			</header>

			{error && <div className={styles.errorBanner} role="alert"><AlertTriangle size={17} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label={p.cancel}><X size={16} /></button></div>}
			{reportAnnouncement && <div className={styles.successBanner} role="status"><Check size={17} /><span>{reportAnnouncement}</span><button type="button" onClick={() => setReportAnnouncement('')} aria-label={p.cancel}><X size={16} /></button></div>}
			{project.status === 'planning' && <div className={styles.planningNote}><Flag size={16} /><span>{p.planningNote}</span>{canLead && topics.length === 0 && <button type="button" onClick={() => setAdding(true)}>{p.addTopic}</button>}</div>}

			<section className={styles.myWork} aria-labelledby="my-work-title">
				<div><strong id="my-work-title">{p.myWork}</strong><span>{mine.length ? `${p.assigned(mine.length)} · ${p.awaitingReview(awaiting)}` : p.noAssignedWork}</span></div>
				{mine.length > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { selectTopic(mine[0].id); setTab('topics'); }}>{p.chooseTopic}</button>}
			</section>
			{choosingReport && <AssignedTopicChooser topics={reportableMine} project={project} p={p} lang={lang} onChoose={startReport} onClose={() => setChoosingReport(false)} />}

			{adding && <AddTopic project={project} me={me} p={p} readError={readError} onCancel={() => setAdding(false)} onSaved={async result => { setAdding(false); await load({ quiet: true }); selectTopic(result.topic.id); }} />}

			<div className={`${styles.workArea}${selected ? ` ${styles.hasDetail}` : ''}`}>
				<div className={styles.mainArea}>
					<div className={styles.toolRow}>
						<div className={styles.tabs} role="tablist" aria-label={project.title}>
							{TABS.map((value, index) => <button key={value} ref={node => { tabsRef.current[index] = node; }} type="button" role="tab" id={`project-tab-${value}`} aria-selected={tab === value} aria-controls={`project-panel-${value}`} tabIndex={tab === value ? 0 : -1} onKeyDown={event => onTabKey(event, index)} onClick={() => setTab(value)}>{p.views[value]}</button>)}
						</div>
						<div className={styles.toolActions}>{canLead && <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Plus size={15} />{p.addTopic}</button>}</div>
					</div>

					<div role="tabpanel" id={`project-panel-${tab}`} aria-labelledby={`project-tab-${tab}`} className={styles.tabPanel}>
						{topics.length === 0 && tab !== 'topics' ? <NoTopics canLead={canLead} p={p} onAdd={() => setAdding(true)} /> : tab === 'timeline' ?
							<Timeline topics={topics} milestones={data.milestones || []} dependencies={data.dependencies || []} project={project} canLead={canLead} readError={readError} onChanged={() => load({ quiet: true })} selectedId={selectedId} onSelect={selectTopic} p={p} lang={lang} timezone={project.timezone} /> :
							tab === 'topics' ? <TopicList topics={topics} archivedTopics={archivedTopics} project={project} canLead={canLead} selectedId={selectedId} onSelect={selectTopic} onChanged={() => load({ quiet: true })} readError={readError} p={p} lang={lang} timezone={project.timezone} /> :
							<Updates events={events} topics={topics} members={members} code={project.code} p={p} lang={lang} />}
					</div>
				</div>

				{selected && <TopicDetail key={selected.id} topic={selected} project={project} members={members} notificationSettings={data.notificationSettings} p={p} lang={lang} canLead={canLead} canReport={canReportSelected} reporting={reporting} setReporting={setReporting} readError={readError} shouldFocus={focusDetail} onClose={closeTopic} onReportSaved={async () => { setReporting(false); await load({ quiet: true }); setReportAnnouncement(p.reportSaved); }} onChanged={() => load({ quiet: true })} />}
			</div>
		</div>
	);
}

function AssignedTopicChooser({ topics, project, p, lang, onChoose, onClose }) {
	const chooserRef = useRef(null);
	useEffect(() => { chooserRef.current?.querySelector('button')?.focus(); }, []);
	return <section ref={chooserRef} className={styles.topicChooser} aria-labelledby="assigned-topic-chooser" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}><div><h2 id="assigned-topic-chooser">{p.chooseReportTopic}</h2><button type="button" onClick={onClose} aria-label={p.cancel}><X size={18} /></button></div><p>{p.chooseReportTopicHint}</p><div>{topics.map(topic => <button type="button" key={topic.id} onClick={() => onChoose(topic.id)}><span><strong>#{topic.number} {topic.title}</strong><small>{topic.deadlineAt ? `${p.due} ${projectDate(topic.deadlineAt, lang, project.timezone)}` : p.unscheduled}</small></span><span>{topic.progress}%</span></button>)}</div></section>;
}

function State({ value, p, workflow = false, blocked = false, overdue = false }) {
	return <span className={`${styles.state} ${styles[`tone_${value}`]}${blocked || overdue ? ` ${styles.tone_blocked}` : ''}`}>{workflow ? p.workflow[value] : p.state[value]}{blocked ? ` · ${p.blocked}` : ''}{overdue && !blocked ? ` · ${p.overdue}` : ''}</span>;
}

function Timeline({ topics, milestones, dependencies, project, canLead, readError, onChanged, selectedId, onSelect, p, lang, timezone }) {
	const [zoom, setZoom] = useState('week');
	const [centerOverride, setCenterOverride] = useState(null);
	const [scheduleDraft, setScheduleDraft] = useState(null);
	const [scheduleAnnouncement, setScheduleAnnouncement] = useState('');
	const scheduled = [...topics.flatMap(topic => [topic.startsAt, topic.deadlineAt].filter(Boolean)), ...milestones.map(item => item.dueAt)].map(value => new Date(canonicalProjectDate(value)).getTime());
	const dataStart = scheduled.length ? Math.min(...scheduled) : Date.now();
	const dataEnd = scheduled.length ? Math.max(...scheduled) : Date.now() + DAY * 21;
	const fitSpan = Math.max(DAY * 24, dataEnd - dataStart + DAY * 6);
	const zoomSpan = zoom === 'day' ? DAY * 14 : zoom === 'month' ? Math.max(DAY * 90, fitSpan) : fitSpan;
	const center = centerOverride ?? (dataStart + dataEnd) / 2;
	let start = center - zoomSpan / 2;
	let end = center + zoomSpan / 2;
	const span = end - start;
	const markers = [0, .25, .5, .75, 1].map(position => ({ position, label: projectDate(start + span * position, lang, timezone, false) }));
	const today = ((Date.now() - start) / span) * 100;
	const todayVisible = today >= 0 && today <= 100;
	const visibleMilestones = milestones.map(item => ({ ...item, position: ((new Date(canonicalProjectDate(item.dueAt)).getTime() - start) / span) * 100 })).filter(item => item.position >= 0 && item.position <= 100);
	useEffect(() => {
		if (!scheduleDraft) return undefined;
		const cancel = event => { if (event.key === 'Escape') setScheduleDraft(null); };
		window.addEventListener('keydown', cancel);
		return () => window.removeEventListener('keydown', cancel);
	}, [scheduleDraft]);
	const beginDrag = (event, topic, mode) => {
		if (!canLead || event.button !== 0) return;
		event.preventDefault(); event.stopPropagation();
		const target = event.currentTarget;
		const chart = target.closest(`.${styles.chartCell}`);
		if (!chart) return;
		const originX = event.clientX;
		const width = Math.max(1, chart.getBoundingClientRect().width);
		const original = { startsAt: dateInput(topic.startsAt, timezone), deadlineAt: dateInput(topic.deadlineAt, timezone) };
		let lastDays = 0;
		const move = nextEvent => {
			const days = Math.round(((nextEvent.clientX - originX) / width) * (span / DAY));
			if (days === lastDays) return;
			lastDays = days;
			let startsAt = original.startsAt;
			let deadlineAt = original.deadlineAt;
			if (mode === 'move' || mode === 'start') startsAt = shiftDateOnly(startsAt, days);
			if (mode === 'move' || mode === 'end') deadlineAt = shiftDateOnly(deadlineAt, days);
			if (startsAt && deadlineAt && startsAt > deadlineAt) return;
			setScheduleDraft({ topic, original, startsAt, deadlineAt, dragging: true });
		};
		const finish = () => {
			target.removeEventListener('pointermove', move);
			target.removeEventListener('pointerup', finish);
			target.removeEventListener('pointercancel', cancel);
			setScheduleDraft(current => current ? { ...current, dragging: false } : null);
		};
		const cancel = () => {
			target.removeEventListener('pointermove', move);
			target.removeEventListener('pointerup', finish);
			target.removeEventListener('pointercancel', cancel);
			setScheduleDraft(null);
		};
		target.setPointerCapture?.(event.pointerId);
		target.addEventListener('pointermove', move);
		target.addEventListener('pointerup', finish);
		target.addEventListener('pointercancel', cancel);
	};
	return (
		<div className={styles.timelineFrame}>
			<p className="sr-only" aria-live="polite">{scheduleAnnouncement}</p>
			<div className={styles.timelineToolbar}><strong>{projectDate(start, lang, timezone)} — {projectDate(end, lang, timezone)}</strong><div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setCenterOverride(center - span * .6)} aria-label={p.previousRange}><ChevronLeft size={15} /></button><button type="button" className="btn btn-secondary btn-sm" onClick={() => setCenterOverride(Date.now())}>{p.today}</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => setCenterOverride(center + span * .6)} aria-label={p.nextRange}><ChevronRight size={15} /></button><button type="button" className="btn btn-secondary btn-sm" onClick={() => { setZoom('week'); setCenterOverride(null); }}>{p.fitProject}</button>{['day', 'week', 'month'].map(value => <button key={value} type="button" className={`btn btn-sm ${zoom === value ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={zoom === value} onClick={() => { setZoom(value); setCenterOverride(center); }}>{p.zoom[value]}</button>)}</div></div>
			{scheduleDraft && !scheduleDraft.dragging && <ScheduleChange draft={scheduleDraft} project={project} p={p} timezone={timezone} readError={readError} onCancel={() => setScheduleDraft(null)} onChanged={async () => { setScheduleAnnouncement(p.scheduleSaved(scheduleDraft.startsAt || '—', scheduleDraft.deadlineAt || '—')); setScheduleDraft(null); await onChanged(); }} />}
			<div className={styles.timelineScroll}>
				<div className={styles.timelineGrid}>
					<div className={styles.topicHeader}><span aria-hidden="true" /><span>{p.topic}</span><span>{p.owner}</span><span>{p.status}</span><span>%</span></div>
					<div className={styles.axis}>{markers.map(marker => <span key={marker.position} style={{ left: `${marker.position * 100}%` }}>{marker.label}</span>)}</div>
					{topics.map(topic => <TimelineRow key={topic.id} topic={scheduleDraft?.topic.id === topic.id ? { ...topic, startsAt: scheduleDraft.startsAt || null, deadlineAt: scheduleDraft.deadlineAt || null } : topic} selected={selectedId === topic.id} onSelect={onSelect} onDrag={beginDrag} canLead={canLead} p={p} start={start} span={span} />)}
					{todayVisible && <div className={styles.todayLine} style={{ left: `${42 + .58 * today}%` }}><span>{p.today}</span></div>}
					{visibleMilestones.map(item => <div key={item.id} className={`${styles.milestoneLine}${item.state === 'reached' ? ` ${styles.milestoneReached}` : ''}`} style={{ left: `${42 + .58 * item.position}%` }}><span><Diamond size={12} fill="currentColor" />{item.title}</span></div>)}
				</div>
			</div>
			<div className={styles.legend}><span><i className={styles.legendComplete} />{p.workflow.completed}</span><span><i className={styles.legendProgress} />{p.workflow.in_progress}</span><span><i className={styles.legendBlocked} />{p.blocked}</span><span><i className={styles.legendToday} />{p.today}</span></div>
			<ScheduleStructure project={project} topics={topics} milestones={milestones} dependencies={dependencies} canLead={canLead} p={p} lang={lang} readError={readError} onChanged={onChanged} />
		</div>
	);
}

function ScheduleChange({ draft, project, p, timezone, readError, onCancel, onChanged }) {
	const [acknowledgeProjectDeadline, setAcknowledge] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [latest, setLatest] = useState(null);
	const [retryRevision, setRetryRevision] = useState(draft.topic.revision);
	const projectDeadline = dateInput(project.deadlineAt, timezone);
	const laterThanProject = Boolean(draft.deadlineAt && projectDeadline && draft.deadlineAt > projectDeadline);
	const save = async event => {
		event.preventDefault(); setBusy(true); setError('');
		try {
			const response = await fetch(`/api/megu/projects/${project.code}/topics/${draft.topic.id}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startsAt: draft.startsAt || null, startsPrecision: draft.startsAt ? 'date' : null, deadlineAt: draft.deadlineAt || null, deadlinePrecision: draft.deadlineAt ? 'date' : null, acknowledgeProjectDeadline, expectedRevision: retryRevision }) });
			const body = await response.json(); if (!response.ok) throw body; await onChanged();
		}
		catch (problem) {
			setError(readError(problem));
			if (problem?.code === 'revision_conflict') {
				try { const response = await fetch(`/api/megu/projects/${project.code}`, { credentials: 'same-origin' }); const body = await response.json(); const current = body?.topics?.find(topic => topic.id === draft.topic.id); if (response.ok && current) setLatest(current); }
				catch { /* Keep the proposal even when the refresh also fails. */ }
			}
			setBusy(false);
		}
	};
	return <form className={styles.scheduleConfirm} onSubmit={save}><div><strong>{p.scheduleChangeTitle}</strong><span>{draft.topic.title}</span><p>{p.scheduleChangeHint}</p></div><dl><div><dt>{p.startDate}</dt><dd><s>{draft.original.startsAt || '—'}</s><b>{draft.startsAt || '—'}</b></dd></div><div><dt>{p.dueDate}</dt><dd><s>{draft.original.deadlineAt || '—'}</s><b>{draft.deadlineAt || '—'}</b></dd></div></dl>{laterThanProject && <label className={styles.overrideCheck}><input type="checkbox" required checked={acknowledgeProjectDeadline} onChange={event => setAcknowledge(event.target.checked)} />{p.deadlineOverride}</label>}{error && <p className={styles.formError} role="alert">{error}</p>}{latest && <div className={styles.latestSchedule}><strong>{p.latestSchedule}</strong><span>{dateInput(latest.startsAt, timezone) || '—'} — {dateInput(latest.deadlineAt, timezone) || '—'}</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => { setRetryRevision(latest.revision); setLatest(null); setError(''); }}>{p.reapplySchedule}</button></div>}<div className={styles.formActions}><button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>{p.cancel}</button><button type="submit" className="btn btn-primary btn-sm" disabled={busy || Boolean(latest)}>{busy ? p.saving : p.applySchedule}</button></div></form>;
}

function ScheduleStructure({ project, topics, milestones, dependencies, canLead, p, lang, readError, onChanged }) {
	const [milestoneForm, setMilestoneForm] = useState({ title: '', dueAt: '' });
	const [dependencyForm, setDependencyForm] = useState({ predecessorTopicId: '', successorTopicId: '' });
	const [busy, setBusy] = useState('');
	const [error, setError] = useState('');
	const [pendingRemoval, setPendingRemoval] = useState(null);
	const request = async (url, options, key) => {
		setBusy(key); setError('');
		try {
			const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options });
			const body = await response.json();
			if (!response.ok) throw body;
			setPendingRemoval(null);
			await onChanged();
			return true;
		}
		catch (problem) { setError(readError(problem)); return false; }
		finally { setBusy(''); }
	};
	const addMilestone = async event => {
		event.preventDefault();
		if (await request(`/api/megu/projects/${project.code}/milestones`, { method: 'POST', body: JSON.stringify({ ...milestoneForm, duePrecision: 'date', expectedRevision: project.revision }) }, 'milestone-new')) {
			setMilestoneForm({ title: '', dueAt: '' });
		}
	};
	const addDependency = async event => {
		event.preventDefault();
		if (!dependencyForm.predecessorTopicId || !dependencyForm.successorTopicId) {
			setError(p.errors.dependency_topics_required);
			return;
		}
		if (await request(`/api/megu/projects/${project.code}/dependencies`, { method: 'POST', body: JSON.stringify({ ...dependencyForm, expectedRevision: project.revision }) }, 'dependency-new')) {
			setDependencyForm({ predecessorTopicId: '', successorTopicId: '' });
		}
	};
	return <section className={styles.scheduleStructure} aria-labelledby="schedule-structure-title">
		<div className={styles.scheduleIntro}><div><h2 id="schedule-structure-title">{p.scheduleTools}</h2><p>{p.scheduleToolsHint}</p></div><GitFork size={21} aria-hidden="true" /></div>
		{error && <p className={styles.formError} role="alert">{error}</p>}
		<div className={styles.scheduleColumns}>
			<section><h3>{p.milestones}</h3>{milestones.length ? <ul className={styles.scheduleList}>{milestones.map(item => <li key={item.id}><span className={styles.milestoneIcon}><Diamond size={13} fill="currentColor" /></span><div><strong>{item.title}</strong><small>{projectDate(item.dueAt, lang, project.timezone)} · {p.milestoneState[item.state]}</small></div>{canLead && <div className={styles.rowActions}><button type="button" disabled={Boolean(busy)} onClick={() => request(`/api/megu/projects/${project.code}/milestones/${item.id}`, { method: 'PATCH', body: JSON.stringify({ state: item.state === 'open' ? 'reached' : 'open', expectedRevision: item.revision }) }, `milestone-${item.id}`)}>{item.state === 'open' ? p.markReached : p.markOpen}</button>{pendingRemoval === `milestone-${item.id}` ? <><button type="button" className={styles.removeAction} disabled={Boolean(busy)} onClick={() => request(`/api/megu/projects/${project.code}/milestones/${item.id}`, { method: 'DELETE', body: JSON.stringify({ expectedRevision: item.revision }) }, `remove-${item.id}`)}>{p.confirmRemove}</button><button type="button" onClick={() => setPendingRemoval(null)}>{p.keep}</button></> : <button type="button" onClick={() => setPendingRemoval(`milestone-${item.id}`)}>{p.remove}</button>}</div>}</li>)}</ul> : <p className={styles.scheduleEmpty}>{p.noMilestones}</p>}
				{canLead && <form className={styles.scheduleForm} onSubmit={addMilestone}><label className={styles.field}><span>{p.milestoneTitle}</span><input required maxLength={120} value={milestoneForm.title} onChange={event => setMilestoneForm(current => ({ ...current, title: event.target.value }))} /></label><label className={styles.field}><span>{p.milestoneDate}</span><input type="date" required value={milestoneForm.dueAt} onChange={event => setMilestoneForm(current => ({ ...current, dueAt: event.target.value }))} /></label><button type="submit" className="btn btn-secondary btn-sm" disabled={Boolean(busy)}><Plus size={14} />{p.addMilestone}</button></form>}
			</section>
			<section><h3>{p.dependencies}</h3><p className={styles.sectionHint}>{p.dependencyHint}</p>{dependencies.length ? <ul className={styles.scheduleList}>{dependencies.map(item => <li key={item.id}><GitFork size={14} aria-hidden="true" /><div><strong>#{item.predecessor.number} {item.predecessor.title} → #{item.successor.number} {item.successor.title}</strong><small className={item.scheduleStatus === 'warning' ? styles.scheduleWarning : ''}>{p.dependencyStatus[item.scheduleStatus]}</small></div>{canLead && (pendingRemoval === `dependency-${item.id}` ? <div className={styles.rowActions}><button type="button" className={styles.removeAction} disabled={Boolean(busy)} onClick={() => request(`/api/megu/projects/${project.code}/dependencies/${item.id}`, { method: 'DELETE', body: JSON.stringify({ expectedRevision: project.revision }) }, `remove-${item.id}`)}>{p.confirmRemove}</button><button type="button" onClick={() => setPendingRemoval(null)}>{p.keep}</button></div> : <button type="button" className={styles.textAction} onClick={() => setPendingRemoval(`dependency-${item.id}`)}>{p.remove}</button>)}</li>)}</ul> : <p className={styles.scheduleEmpty}>{p.noDependencies}</p>}
				{canLead && topics.length > 1 && <form className={styles.scheduleForm} onSubmit={addDependency}><label className={styles.field}><span>{p.predecessor}</span><CustomSelect required ariaLabel={p.predecessor} value={dependencyForm.predecessorTopicId} onChange={predecessorTopicId => setDependencyForm(current => ({ ...current, predecessorTopicId }))} options={topics.map(topic => ({ value: topic.id, label: `#${topic.number} ${topic.title}` }))} searchable={topics.length > 5} /></label><label className={styles.field}><span>{p.successor}</span><CustomSelect required ariaLabel={p.successor} value={dependencyForm.successorTopicId} onChange={successorTopicId => setDependencyForm(current => ({ ...current, successorTopicId }))} options={topics.map(topic => ({ value: topic.id, label: `#${topic.number} ${topic.title}` }))} searchable={topics.length > 5} /></label><button type="submit" className="btn btn-secondary btn-sm" disabled={Boolean(busy) || !dependencyForm.predecessorTopicId || !dependencyForm.successorTopicId}><Plus size={14} />{p.addDependency}</button></form>}
			</section>
		</div>
	</section>;
}

function TimelineRow({ topic, selected, onSelect, onDrag, canLead, p, start, span }) {
	const primary = topic.assignees.find(a => a.primary);
	const overdue = Boolean(topic.deadlineAt && new Date(canonicalProjectDate(topic.deadlineAt)) < new Date() && topic.workflow !== 'completed');
	const left = topic.startsAt ? Math.max(0, Math.min(100, ((new Date(canonicalProjectDate(topic.startsAt)).getTime() - start) / span) * 100)) : topic.deadlineAt ? Math.max(0, Math.min(100, ((new Date(canonicalProjectDate(topic.deadlineAt)).getTime() - start) / span) * 100)) : 0;
	const rightAt = topic.deadlineAt || topic.startsAt;
	const width = rightAt ? Math.max(topic.startsAt && topic.deadlineAt ? 3 : 1.3, Math.min(100 - left, ((new Date(canonicalProjectDate(rightAt)).getTime() - (topic.startsAt ? new Date(canonicalProjectDate(topic.startsAt)).getTime() : new Date(canonicalProjectDate(rightAt)).getTime())) / span) * 100)) : 0;
	return <div role="button" tabIndex="0" className={`${styles.timelineRow}${selected ? ` ${styles.selected}` : ''}`} onClick={() => onSelect(topic.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(topic.id); } }} aria-pressed={selected}>
		<span className={styles.topicInfo}><span className={styles.topicNumber}>#{String(topic.number).padStart(2, '0')}</span><strong>{topic.title}</strong><span className={styles.ownerName}>{primary ? <><ProjectAvatar name={primary.displayName} avatarUrl={primary.avatarUrl} className={styles.avatar} />{primary.displayName}</> : p.unassigned}</span><State value={topic.workflow} p={p} workflow blocked={topic.blocked} overdue={overdue} /><span className={styles.progressNumber}>{topic.progress}%</span></span>
		<span className={styles.chartCell} aria-label={topic.startsAt || topic.deadlineAt ? p.schedule : p.unscheduled}>{rightAt ? <span className={`${styles.ganttBar} ${styles[`bar_${topic.workflow}`]}${topic.blocked ? ` ${styles.barBlocked}` : ''}${canLead ? ` ${styles.draggableBar}` : ''}`} style={{ left: `${left}%`, width: `${width}%` }} onPointerDown={event => onDrag(event, topic, 'move')} title={canLead ? p.dragSchedule : undefined}>{canLead && topic.startsAt && <b className={`${styles.dragHandle} ${styles.dragStart}`} onPointerDown={event => onDrag(event, topic, 'start')} aria-hidden="true" />}<i style={{ width: `${topic.progress}%` }} />{canLead && topic.deadlineAt && <b className={`${styles.dragHandle} ${styles.dragEnd}`} onPointerDown={event => onDrag(event, topic, 'end')} aria-hidden="true" />}</span> : <em>{p.unscheduled}</em>}</span>
	</div>;
}

function TopicList({ topics, archivedTopics, project, canLead, selectedId, onSelect, onChanged, readError, p, lang, timezone }) {
	const [error, setError] = useState('');
	const [sort, setSort] = useState('number');
	const orderedTopics = useMemo(() => [...topics].sort((left, right) => {
		if (sort === 'title') return left.title.localeCompare(right.title, lang === 'th' ? 'th' : 'en');
		if (sort === 'deadline') return (left.deadlineAt ? new Date(canonicalProjectDate(left.deadlineAt)).getTime() : Number.MAX_SAFE_INTEGER) - (right.deadlineAt ? new Date(canonicalProjectDate(right.deadlineAt)).getTime() : Number.MAX_SAFE_INTEGER) || left.number - right.number;
		if (sort === 'status') return left.workflow.localeCompare(right.workflow) || left.number - right.number;
		if (sort === 'progress') return right.progress - left.progress || left.number - right.number;
		return left.number - right.number;
	}), [lang, sort, topics]);
	const restore = async topic => {
		setError('');
		try { const response = await fetch(`/api/megu/projects/${project.code}/topics/${topic.id}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: false, expectedRevision: topic.revision }) }); const body = await response.json(); if (!response.ok) throw body; await onChanged(); }
		catch (problem) { setError(readError(problem)); }
	};
	return <div className={styles.listView}><div className={styles.listToolbar}><label><span>{p.sortTopics}</span><CustomSelect size="compact" searchable={false} ariaLabel={p.sortTopics} value={sort} onChange={setSort} options={Object.entries(p.topicSort).map(([value, label]) => ({ value, label }))} /></label></div>{orderedTopics.map(topic => { const primary = topic.assignees.find(a => a.primary); const overdue = Boolean(topic.deadlineAt && new Date(canonicalProjectDate(topic.deadlineAt)) < new Date() && topic.workflow !== 'completed'); return <button type="button" key={topic.id} className={`${styles.listRow}${selectedId === topic.id ? ` ${styles.selected}` : ''}`} onClick={() => onSelect(topic.id)}><span className={styles.topicNumber}>#{String(topic.number).padStart(2, '0')}</span><span><strong>{topic.title}</strong><small>{topic.deadlineAt ? `${p.due} ${projectDate(topic.deadlineAt, lang, timezone)}` : p.unscheduled}</small></span><span>{primary ? primary.displayName : p.unassigned}</span><State value={topic.workflow} p={p} workflow blocked={topic.blocked} overdue={overdue} /><b>{topic.progress}%</b></button>; })}{archivedTopics.length > 0 && <section className={styles.archivedTopics}><h2>{p.archivedTopics}</h2>{archivedTopics.map(topic => <div key={topic.id}><span>#{topic.number}</span><strong>{topic.title}</strong>{canLead && <button type="button" className="btn btn-secondary btn-sm" onClick={() => restore(topic)}>{p.restoreTopic}</button>}</div>)}</section>}{error && <p className={styles.formError} role="alert">{error}</p>}</div>;
}

function historyCursor(event) {
	const raw = btoa(JSON.stringify({ at: new Date(event.createdAt).toISOString(), id: event.id }));
	return raw.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function Updates({ events, topics, members, code, p, lang }) {
	const [feed, setFeed] = useState(events);
	const [nextCursor, setNextCursor] = useState(events.length === 30 ? historyCursor(events.at(-1)) : null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [topicFilter, setTopicFilter] = useState('');
	const [personFilter, setPersonFilter] = useState('');
	const filtered = feed.filter(event => (!topicFilter || event.topicId === topicFilter) && (!personFilter || event.actorUserId === personFilter));
	useEffect(() => { setFeed(current => [...events, ...current.filter(item => !events.some(fresh => fresh.id === item.id))]); }, [events]);
	const loadMore = async () => {
		setBusy(true); setError('');
		try {
			const response = await fetch(`/api/megu/projects/${code}/events?cursor=${encodeURIComponent(nextCursor)}&limit=30`, { credentials: 'same-origin' });
			const body = await response.json(); if (!response.ok) throw body;
			setFeed(current => [...current, ...body.events.filter(item => !current.some(existing => existing.id === item.id))]); setNextCursor(body.nextCursor);
		}
		catch { setError(p.errors.failed); }
		finally { setBusy(false); }
	};
	if (!feed.length) return <div className={styles.emptyPanel}>{p.updatesEmpty}</div>;
	return <div><div className={styles.updateFilters}><label><span>{p.filterTopic}</span><CustomSelect size="compact" ariaLabel={p.filterTopic} value={topicFilter} onChange={setTopicFilter} options={[{ value: '', label: p.allTopics }, ...topics.map(topic => ({ value: topic.id, label: `#${topic.number} ${topic.title}` }))]} searchable={topics.length > 5} /></label><label><span>{p.filterPerson}</span><CustomSelect size="compact" type="member" ariaLabel={p.filterPerson} value={personFilter} onChange={setPersonFilter} options={[{ value: '', label: p.allPeople }, ...members.map(member => ({ value: member.userId, label: member.displayName, avatar: member.avatarUrl }))]} searchable={members.length > 5} /></label></div>{filtered.length ? <ol className={styles.updates}>{filtered.map(event => <li key={event.id} style={{ '--event-hue': EVENT_HUES[event.type] ?? 215 }}><CircleDot className={styles.eventBullet} size={16} aria-hidden="true" /><div><strong>{p.event?.[event.type] || event.type.replaceAll('_', ' ')}</strong><SafeProjectMarkdown>{event.payload?.summary || event.payload?.title || event.payload?.reason || ''}</SafeProjectMarkdown><small>{event.actorName || 'Megu'} · {relativeDate(event.createdAt, lang)}</small></div></li>)}</ol> : <div className={styles.emptyPanel}>{p.filteredUpdatesEmpty}</div>}{error && <p className={styles.formError} role="alert">{error}</p>}{nextCursor && <div className={styles.loadMore}><button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={loadMore}>{busy ? p.loadingMore : p.loadMore}</button></div>}</div>;
}

function TopicDetail({ topic, project, members, notificationSettings, p, lang, canLead, canReport, reporting, setReporting, readError, shouldFocus, onClose, onReportSaved, onChanged }) {
	const primary = topic.assignees.find(a => a.primary);
	const panelRef = useRef(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [assigning, setAssigning] = useState(false);
	const [editing, setEditing] = useState(false);
	const [historyOpen, setHistoryOpen] = useState(false);
	const [correctionOf, setCorrectionOf] = useState(null);
	const [reviewAction, setReviewAction] = useState(null);
	const [confirmArchive, setConfirmArchive] = useState(false);
	useEffect(() => { if (shouldFocus) panelRef.current?.focus(); }, [shouldFocus, topic.id]);
	const handlePanelKey = event => {
		if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
		if (event.key !== 'Tab') return;
		const focusable = [...panelRef.current.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
		if (!focusable.length) { event.preventDefault(); panelRef.current.focus(); return; }
		const first = focusable[0]; const last = focusable.at(-1);
		if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
		else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
	};
	const approve = async () => {
		setBusy(true); setError('');
		try {
			const response = await fetch(`/api/megu/projects/${project.code}/topics/${topic.id}/review`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve', expectedRevision: topic.revision }) });
			const body = await response.json(); if (!response.ok) throw body; await onChanged();
		}
		catch (problem) { setError(readError(problem)); }
		finally { setBusy(false); }
	};
	const archive = async () => {
		setBusy(true); setError('');
		try { const response = await fetch(`/api/megu/projects/${project.code}/topics/${topic.id}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: true, expectedRevision: topic.revision }) }); const body = await response.json(); if (!response.ok) throw body; await onChanged(); onClose(); }
		catch (problem) { setError(readError(problem)); setBusy(false); }
	};
	return <aside ref={panelRef} className={styles.detail} role="dialog" aria-labelledby="topic-detail-title" tabIndex="-1" onKeyDown={handlePanelKey}>
		<div className={styles.detailTop}><span>#{String(topic.number).padStart(2, '0')} · {p.topicDetails}</span><button type="button" onClick={onClose} aria-label={p.closeDetails}><X size={18} /></button></div>
		{reporting ? <ReportForm topic={topic} project={project} notificationSettings={notificationSettings} correctionOf={correctionOf} p={p} readError={readError} onCancel={() => { setReporting(false); setCorrectionOf(null); }} onSaved={async () => { setCorrectionOf(null); await onReportSaved(); }} /> : historyOpen ? <ReportHistory topic={topic} project={project} p={p} lang={lang} canCorrect={canReport} onCorrect={report => { setHistoryOpen(false); setCorrectionOf(report); setReporting(true); }} onClose={() => setHistoryOpen(false)} /> : <>
			<div className={styles.detailTitle}><h2 id="topic-detail-title">{topic.title}</h2><State value={topic.workflow} p={p} workflow blocked={topic.blocked} overdue={Boolean(topic.deadlineAt && new Date(canonicalProjectDate(topic.deadlineAt)) < new Date() && topic.workflow !== 'completed')} /></div>
			{topic.description && <p className={styles.detailDescription}>{topic.description}</p>}
			<dl className={styles.detailsList}><div><dt>{p.primaryAssignee}</dt><dd>{primary ? <><ProjectAvatar name={primary.displayName} avatarUrl={primary.avatarUrl} className={styles.avatar} />{primary.displayName}</> : p.unassigned}</dd></div><div><dt>{p.schedule}</dt><dd>{topic.startsAt || topic.deadlineAt ? [projectDate(topic.startsAt, lang, project.timezone), projectDate(topic.deadlineAt, lang, project.timezone)].filter(Boolean).join(' — ') : p.unscheduled}</dd></div></dl>
			<div className={styles.detailProgress}><strong>{topic.progress}%</strong><span>{p.reportedProgress}</span><div><i style={{ width: `${topic.progress}%` }} /></div></div>
			<section className={styles.latest}><h3>{p.latestReport}</h3>{topic.latestReport ? <div className={styles.latestBody}><ProjectAvatar name={topic.latestReport.authorName} avatarUrl={topic.latestReport.authorAvatarUrl} className={styles.avatar} /><div><strong>{topic.latestReport.authorName}</strong><small>{relativeDate(topic.latestReport.createdAt, lang)}</small><SafeProjectMarkdown>{topic.latestReport.summary}</SafeProjectMarkdown></div></div> : <p className={styles.muted}>{p.noReport}</p>}{topic.latestReport && <button type="button" className={styles.historyLink} onClick={() => setHistoryOpen(true)}>{p.viewHistory}</button>}</section>
			{error && <p className={styles.formError} role="alert">{error}</p>}
			{editing && <TopicEditForm topic={topic} project={project} p={p} readError={readError} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); await onChanged(); }} />}
			{assigning && <AssigneeForm topic={topic} project={project} members={members} p={p} readError={readError} onCancel={() => setAssigning(false)} onSaved={async () => { setAssigning(false); await onChanged(); }} />}
			{reviewAction && <ReviewDecision topic={topic} project={project} action={reviewAction} p={p} readError={readError} onCancel={() => setReviewAction(null)} onSaved={async () => { setReviewAction(null); await onChanged(); }} />}
			{confirmArchive && <div className={styles.archiveConfirm} role="alert"><span>{p.archiveHint}</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmArchive(false)}>{p.keep}</button><button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={archive}>{p.archiveTopic}</button></div>}
			<div className={styles.detailActions}>{canLead && <button type="button" className={`btn btn-secondary ${styles.actionEdit}`} onClick={() => { setEditing(value => !value); setAssigning(false); }}>{p.editTopic}</button>}{canLead && <button type="button" className={`btn btn-secondary ${styles.actionAssignees}`} onClick={() => { setAssigning(value => !value); setEditing(false); }}>{p.editAssignees}</button>}{canLead && topic.workflow === 'in_review' && <button type="button" className="btn btn-primary" disabled={busy || topic.blocked} onClick={approve}><Check size={16} />{p.approve}</button>}{canLead && topic.workflow === 'in_review' && <button type="button" className="btn btn-secondary" onClick={() => setReviewAction('return')}>{p.returnWork}</button>}{canLead && topic.workflow === 'completed' && project.status === 'active' && <button type="button" className="btn btn-secondary" onClick={() => setReviewAction('reopen')}>{p.reopenTopic}</button>}{canLead && !['completed', 'cancelled'].includes(project.status) && <button type="button" className={`btn btn-secondary ${styles.actionArchive}`} onClick={() => setConfirmArchive(true)}>{p.archiveTopic}</button>}{canReport && <button type="button" className={`btn btn-secondary ${styles.actionReport}`} onClick={() => { setCorrectionOf(null); setReporting(true); }}><Send size={16} />{p.reportProgress}</button>}</div>
		</>}
	</aside>;
}

function ReviewDecision({ topic, project, action, p, readError, onCancel, onSaved }) {
	const [reason, setReason] = useState('');
	const [progress, setProgress] = useState(String(Math.min(topic.progress, 99)));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const submit = async event => {
		event.preventDefault(); setBusy(true); setError('');
		try {
			const response = await fetch(`/api/megu/projects/${project.code}/topics/${topic.id}/review`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason, progress: Number(progress), expectedRevision: topic.revision }) });
			const body = await response.json(); if (!response.ok) throw body; await onSaved();
		}
		catch (problem) { setError(readError(problem)); setBusy(false); }
	};
	return <form className={styles.reviewDecision} onSubmit={submit}><strong>{action === 'return' ? p.returnWork : p.reopenTopic}</strong>{action === 'reopen' && <label className={styles.field}><span>{p.reopenProgress}</span><input type="number" min="0" max="99" required value={progress} onChange={event => setProgress(event.target.value)} /></label>}<label className={styles.field}><span>{p.reviewReason}</span><textarea rows={2} required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>{error && <p className={styles.formError} role="alert">{error}</p>}<div className={styles.formActions}><button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>{p.cancel}</button><button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? p.saving : p.confirmReviewAction}</button></div></form>;
}

function TopicEditForm({ topic, project, p, readError, onCancel, onSaved }) {
	const [form, setForm] = useState({ title: topic.title, description: topic.description || '', startsAt: dateInput(topic.startsAt, project.timezone), deadlineAt: dateInput(topic.deadlineAt, project.timezone), acknowledgeProjectDeadline: false });
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
	const submit = async event => {
		event.preventDefault(); setBusy(true); setError('');
		try {
			const response = await fetch(`/api/megu/projects/${project.code}/topics/${topic.id}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, startsAt: form.startsAt || null, startsPrecision: form.startsAt ? 'date' : null, deadlineAt: form.deadlineAt || null, deadlinePrecision: form.deadlineAt ? 'date' : null, expectedRevision: topic.revision }) });
			const body = await response.json(); if (!response.ok) throw body; await onSaved();
		}
		catch (problem) { setError(readError(problem)); setBusy(false); }
	};
	const projectDeadline = dateInput(project.deadlineAt, project.timezone);
	const needsOverride = Boolean(form.deadlineAt && projectDeadline && form.deadlineAt > projectDeadline);
	return <form className={styles.topicEditForm} onSubmit={submit}><label className={styles.field}><span>{p.topicTitle}</span><input required maxLength={120} value={form.title} onChange={event => set('title', event.target.value)} /></label><label className={styles.field}><span>{p.topicDescription}</span><textarea rows={3} maxLength={4000} value={form.description} onChange={event => set('description', event.target.value)} /></label><div className={styles.topicDates}><label className={styles.field}><span>{p.startDate}</span><input type="date" value={form.startsAt} onChange={event => set('startsAt', canonicalProjectDate(event.target.value))} /></label><label className={styles.field}><span>{p.dueDate}</span><input type="date" value={form.deadlineAt} onChange={event => set('deadlineAt', canonicalProjectDate(event.target.value))} /></label></div>{needsOverride && <label className={styles.overrideCheck}><input type="checkbox" required checked={form.acknowledgeProjectDeadline} onChange={event => set('acknowledgeProjectDeadline', event.target.checked)} />{p.deadlineOverride}</label>}{error && <p className={styles.formError} role="alert">{error}</p>}<div className={styles.formActions}><button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>{p.cancel}</button><button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? p.saving : p.saveTopicChanges}</button></div></form>;
}

function ReportHistory({ topic, project, p, lang, canCorrect, onCorrect, onClose }) {
	const [reports, setReports] = useState([]);
	const [cursor, setCursor] = useState(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const load = useCallback(async next => {
		setLoading(true); setError('');
		try {
			const query = next ? `?cursor=${encodeURIComponent(next)}&limit=30` : '?limit=30';
			const response = await fetch(`/api/megu/projects/${project.code}/topics/${topic.id}/reports${query}`, { credentials: 'same-origin' });
			const body = await response.json(); if (!response.ok) throw body;
			setReports(current => next ? [...current, ...body.reports] : body.reports); setCursor(body.nextCursor);
		}
		catch { setError(p.errors.failed); }
		finally { setLoading(false); }
	}, [p.errors.failed, project.code, topic.id]);
	useEffect(() => { load(null); }, [load]);
	return <div className={styles.reportHistory}><div className={styles.reportHeading}><div><h2 id="topic-detail-title">{p.reportHistoryTitle}</h2><p>{topic.title}</p></div><button type="button" onClick={onClose} aria-label={p.cancel}><X size={18} /></button></div>{error && <p className={styles.formError} role="alert">{error}</p>}{loading && reports.length === 0 ? <span className="skeleton-line" style={{ width: '70%' }} /> : reports.length === 0 ? <p className={styles.muted}>{p.noReport}</p> : <ol>{reports.map(report => <li key={report.id}><div><strong>{report.progress}%</strong><State value={report.workflow} p={p} workflow blocked={report.blocked} /></div><SafeProjectMarkdown>{report.summary}</SafeProjectMarkdown>{report.changeReason && <small>{report.changeReason}</small>}{report.correctionOfReportId && <small>{p.correctionReference}</small>}<span>{p.reportBy(report.authorName)} · {relativeDate(report.createdAt, lang)}</span>{canCorrect && topic.workflow !== 'completed' && <button type="button" className={styles.historyLink} onClick={() => onCorrect(report)}>{p.correctWithUpdate}</button>}</li>)}</ol>}{cursor && <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={() => load(cursor)}>{loading ? p.loadingMore : p.loadEarlierReports}</button>}</div>;
}

function AssigneeForm({ topic, project, members, p, readError, onCancel, onSaved }) {
	const contributors = members.filter(member => member.role !== 'viewer');
	const initial = topic.assignees.map(assignee => assignee.userId);
	const [selected, setSelected] = useState(initial);
	const [primary, setPrimary] = useState(topic.assignees.find(assignee => assignee.primary)?.userId || '');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const toggle = userId => setSelected(current => {
		const next = current.includes(userId) ? current.filter(id => id !== userId) : [...current, userId];
		if (!next.includes(primary)) setPrimary('');
		return next;
	});
	const submit = async event => {
		event.preventDefault(); setBusy(true); setError('');
		try {
			const response = await fetch(`/api/megu/projects/${project.code}/topics/${topic.id}/assignees`, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userIds: selected, primaryUserId: primary || null, expectedRevision: topic.revision }) });
			const body = await response.json(); if (!response.ok) throw body; await onSaved();
		}
		catch (problem) { setError(readError(problem)); setBusy(false); }
	};
	return <form className={styles.assigneeForm} onSubmit={submit}><strong>{p.assignees}</strong>{contributors.map(member => <div key={member.userId} className={styles.assigneeChoice}><label><input type="checkbox" checked={selected.includes(member.userId)} onChange={() => toggle(member.userId)} /><ProjectAvatar name={member.displayName} avatarUrl={member.avatarUrl} className={styles.avatar} /><span>{member.displayName}</span></label><label className={styles.primaryChoice}><input type="radio" name="primary-assignee" disabled={!selected.includes(member.userId)} checked={primary === member.userId} onChange={() => setPrimary(member.userId)} />{p.primary}</label></div>)}{error && <p className={styles.formError} role="alert">{error}</p>}<div className={styles.formActions}><button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>{p.cancel}</button><button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? p.saving : p.saveAssignees}</button></div></form>;
}

function ReportForm({ topic, project, notificationSettings, correctionOf, p, readError, onCancel, onSaved }) {
	const [form, setForm] = useState({ progress: String(topic.progress), summary: '', requestReview: false, blocked: topic.blocked, blockerReason: topic.blockerReason || '', reason: '', notifyLeads: false });
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [preview, setPreview] = useState(false);
	const idempotency = useRef(uuid());
	const decreasing = Number(form.progress) < topic.progress;
	const clearingBlocker = topic.blocked && !form.blocked;
	const resultingWorkflow = form.requestReview ? 'in_review' : Number(form.progress) === 0 ? 'not_started' : 'in_progress';
	const set = (key, value) => { setPreview(false); setForm(current => ({ ...current, [key]: value })); };
	const submit = async event => {
		event.preventDefault(); setError('');
		if (!preview) { setPreview(true); return; }
		setBusy(true);
		try {
			const response = await fetch(`/api/megu/projects/${project.code}/topics/${topic.id}/reports`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, progress: Number(form.progress), correctionOfReportId: correctionOf?.id || null, expectedRevision: topic.revision, idempotencyKey: idempotency.current }) });
			const body = await response.json(); if (!response.ok) throw body; await onSaved();
		}
		catch (problem) { setError(readError(problem)); setBusy(false); }
	};
	return <form className={styles.reportForm} onSubmit={submit}>
		<div className={styles.reportHeading}><div><h2 id="topic-detail-title">{p.reportTitle}</h2><p>{topic.title}</p></div><button type="button" onClick={onCancel} aria-label={p.cancel}><X size={18} /></button></div>
		{correctionOf && <div className={styles.correctionNote}><strong>{p.correctingReport}</strong><p>{correctionOf.summary}</p></div>}
		<label className={styles.field}><span>{p.progressField}</span><input type="number" min="0" max="99" required value={form.progress} onChange={e => set('progress', e.target.value)} /></label>
		<label className={styles.field}><span>{p.summary}</span><textarea autoFocus rows={4} required maxLength={4000} value={form.summary} onChange={e => set('summary', e.target.value)} placeholder={p.summaryPlaceholder} /></label>
		{(decreasing || clearingBlocker) && <label className={styles.field}><span>{clearingBlocker ? p.clearBlockerReason : p.decreaseReason}</span><textarea rows={2} required maxLength={1000} value={form.reason} onChange={e => set('reason', e.target.value)} /></label>}
		<label className={styles.option}><input type="checkbox" checked={form.requestReview} onChange={e => set('requestReview', e.target.checked)} /><span>{p.requestReview}</span></label>
		<label className={styles.option}><input type="checkbox" checked={form.blocked} onChange={e => set('blocked', e.target.checked)} /><span>{p.blocker}</span></label>
		{form.blocked && <label className={styles.field}><span>{p.blockerReason}</span><textarea rows={2} required maxLength={1000} value={form.blockerReason} onChange={e => set('blockerReason', e.target.value)} /></label>}
		{form.blocked && !topic.blocked && notificationSettings?.enabled && notificationSettings?.blockerNotifications && <label className={styles.option}><input type="checkbox" checked={form.notifyLeads} onChange={e => set('notifyLeads', e.target.checked)} /><span>{p.notifyLeads}</span></label>}
		{preview && <section className={styles.reportPreview} aria-labelledby="report-preview-title"><strong id="report-preview-title">{p.reportPreview}</strong><dl><div><dt>{p.progressField}</dt><dd>{form.progress}%</dd></div><div><dt>{p.resultingState}</dt><dd><State value={resultingWorkflow} p={p} workflow blocked={form.blocked} /></dd></div></dl><SafeProjectMarkdown>{form.summary}</SafeProjectMarkdown>{form.blocked && <small>{p.blockerReason}: {form.blockerReason}</small>}</section>}
		{error && <p className={styles.formError} role="alert">{error}</p>}
		<div className={styles.formActions}><button type="button" className="btn btn-secondary" onClick={preview ? () => setPreview(false) : onCancel}>{preview ? p.editUpdate : p.cancel}</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? p.saving : preview ? p.submitReport : p.reviewUpdate}</button></div>
	</form>;
}

function AddTopic({ project, me, p, readError, onCancel, onSaved }) {
	const [form, setForm] = useState({ title: '', description: '', startsAt: '', deadlineAt: '', assignToMe: true, acknowledgeProjectDeadline: false });
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
	const submit = async event => {
		event.preventDefault(); setBusy(true); setError('');
		try {
			const response = await fetch(`/api/megu/projects/${project.code}/topics`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: form.title, description: form.description, startsAt: form.startsAt || null, startsPrecision: form.startsAt ? 'date' : null, deadlineAt: form.deadlineAt || null, deadlinePrecision: form.deadlineAt ? 'date' : null, acknowledgeProjectDeadline: form.acknowledgeProjectDeadline, assigneeUserIds: form.assignToMe ? [me.userId] : [], expectedRevision: project.revision }) });
			const body = await response.json(); if (!response.ok) throw body; await onSaved(body);
		}
		catch (problem) { setError(readError(problem)); setBusy(false); }
	};
	const projectDeadline = dateInput(project.deadlineAt, project.timezone);
	const needsOverride = Boolean(form.deadlineAt && projectDeadline && form.deadlineAt > projectDeadline);
	return <section className={styles.addTopic} aria-labelledby="add-topic-title"><div className={styles.addTopicHead}><h2 id="add-topic-title">{p.addTopic}</h2><button type="button" onClick={onCancel} aria-label={p.cancel}><X size={18} /></button></div><form onSubmit={submit} className={styles.addTopicForm}><label className={styles.field}><span>{p.topicTitle}</span><input autoFocus required maxLength={120} value={form.title} onChange={e => set('title', e.target.value)} /></label><label className={styles.field}><span>{p.topicDescription}</span><input maxLength={4000} value={form.description} onChange={e => set('description', e.target.value)} /></label><label className={styles.field}><span>{p.startDate}</span><input type="date" value={form.startsAt} onChange={e => set('startsAt', canonicalProjectDate(e.target.value))} /></label><label className={styles.field}><span>{p.dueDate}</span><input type="date" value={form.deadlineAt} onChange={e => set('deadlineAt', canonicalProjectDate(e.target.value))} /></label><label className={styles.option}><input type="checkbox" checked={form.assignToMe} onChange={e => set('assignToMe', e.target.checked)} /><span>{p.assignToMe}</span></label>{needsOverride && <label className={`${styles.option} ${styles.overrideCheck}`}><input type="checkbox" required checked={form.acknowledgeProjectDeadline} onChange={e => set('acknowledgeProjectDeadline', e.target.checked)} /><span>{p.deadlineOverride}</span></label>}{error && <p className={styles.formError} role="alert">{error}</p>}<div className={styles.formActions}><button type="button" className="btn btn-secondary" onClick={onCancel}>{p.cancel}</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? p.saving : p.saveTopic}</button></div></form></section>;
}

function NoTopics({ canLead, p, onAdd }) {
	return <div className={styles.emptyPanel}><Flag size={24} /><h2>{p.noTopicsTitle}</h2><p>{canLead ? p.noTopicsLead : p.noTopicsMember}</p>{canLead && <button type="button" className="btn btn-primary" onClick={onAdd}><Plus size={16} />{p.addTopic}</button>}</div>;
}


function ProjectSkeleton() {
	return <div className={styles.workspace} aria-busy="true"><span className="skeleton-line" style={{ width: '12ch', maxWidth: '100%' }} /><header className={styles.projectHead}><div><span className="skeleton-line" style={{ width: '24ch', maxWidth: '100%', height: '2.2rem' }} /><span className="skeleton-line" style={{ width: '34ch', maxWidth: '100%', marginTop: '.8rem' }} /></div></header><div className={styles.myWork}><span className="skeleton-line" style={{ width: '20ch', maxWidth: '100%' }} /></div><div className={styles.emptyPanel}><span className="skeleton-line" style={{ width: '65%', maxWidth: '100%' }} /></div></div>;
}

function ProjectFailure({ message, retry, p }) {
	return <div className={styles.failure} role="alert"><AlertTriangle size={26} /><h1>{message}</h1><div><Link href="/projects" className="btn btn-secondary">{p.title}</Link><button type="button" className="btn btn-primary" onClick={() => retry()}>{p.retry}</button></div></div>;
}
