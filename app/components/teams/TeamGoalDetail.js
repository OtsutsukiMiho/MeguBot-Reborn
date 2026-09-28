'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import AuthGate from '../AuthGate';
import GoalActionForm from './GoalActionForm';
import GoalReviewerForm from './GoalReviewerForm';
import GoalTermsEditor from './GoalTermsEditor';
import ProjectAvatar from '../projects/ProjectAvatar';
import useWorkspaceResource from '../useWorkspaceResource';
import { useCopy } from '../../copy';
import TeamWorkspaceNav from './TeamWorkspaceNav';
import styles from '../../teams/teams.module.css';

function goalGuidanceKey(goal, capabilities = {}, access) {
	if (goal.version !== goal.currentVersion) return 'history';
	if (access === 'administration') return 'administration';
	if (goal.needsReviewer) return capabilities.canReassignReviewer ? 'assign' : 'waiting';
	if (capabilities.canPropose) return 'propose';
	if (capabilities.canAccept) return goal.reviewerId ? 'accept' : 'acceptPersonal';
	if (capabilities.canReview) return 'review';
	if (capabilities.canRespond) return 'respond';
	if (capabilities.canAddEvidence) return goal.reviewerId ? 'evidence' : 'personal';
	return 'waiting';
}

export default function TeamGoalDetail({ teamId, goalId, options = {} }) {
	const router = useRouter();
	const { t, lang } = useCopy();
	const c = t.teamGoals;
	const directory = `/teams/${encodeURIComponent(teamId)}/goals`;
	const base = `${directory}/${encodeURIComponent(goalId)}`;
	const { data, loading, error, reload } = useWorkspaceResource(`/api/megu${base}?${new URLSearchParams(options)}`);
	const [saving, setSaving] = useState(false);
	const [feedback, setFeedback] = useState(null);
	const submitting = useRef(false);
	if (error?.status === 401) return <AuthGate title={t.teams.signedOutTitle} lede={t.teams.signedOutLede} />;
	const goal = data?.goal;
	const privateAccess = data?.access === 'private';
	const hasTerms = privateAccess || data?.access === 'proposal';
	const mutate = async (path, fields) => {
		if (submitting.current || loading || !goal) return false;
		submitting.current = true; setSaving(true); setFeedback(null);
		let success = false;
		try {
			const response = await fetch(`/api/megu/team-goals/${encodeURIComponent(goalId)}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...fields, expectedRevision: goal.revision }) });
			if (!response.ok) {
				const problem = await response.json().catch(() => ({}));
				setFeedback({ error: true, text: ['goal_reference_invalid', 'goal_reference_unavailable'].includes(problem.code) ? c.referenceDenied : response.status === 409 ? c.conflict : c.uncertain });
			}
			else { success = true; setFeedback({ error: false, text: c.saved }); }
		} catch { setFeedback({ error: true, text: c.uncertain }); }
		finally { await reload(); submitting.current = false; setSaving(false); }
		return success;
	};
	const transition = async (action, fields = {}) => {
		const success = await mutate('transitions', { ...fields, action, version: goal.version });
		if (success && action === 'revise') router.replace(base);
		return success;
	};
	const number = value => new Intl.NumberFormat(lang === 'th' ? 'th-TH' : 'en-GB', { maximumFractionDigits: 2 }).format(value);
	const date = value => new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value));
	const author = (entry, timestamp) => <div className={styles.goalIdentity}><ProjectAvatar className={styles.avatar} name={entry.authorName} avatarUrl={entry.authorAvatarUrl} /><div><strong>{entry.authorName || c.member}</strong><time className={styles.goalTimestamp} dateTime={timestamp}>{new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: goal.timezone || 'UTC' }).format(new Date(timestamp))} · {goal.timezone || 'UTC'}</time></div></div>;
	const href = changes => `${base}?${new URLSearchParams({ ...options, version: goal.version, ...changes })}`;
	const pagination = (key, nextOffset, label) => ((options[key] || 0) > 0 || nextOffset != null) && <nav className={styles.headerActions} aria-label={label}>
		{options[key] > 0 && <Link className="btn btn-secondary" href={href({ [key]: Math.max(0, options[key] - 50) })}>{c.previous}</Link>}
		{nextOffset != null && <Link className="btn btn-secondary" href={href({ [key]: nextOffset })}>{c.next}</Link>}
	</nav>;
	return <main className={styles.shell} aria-busy={loading}><div className={styles.layout}><TeamWorkspaceNav teamId={teamId} section="goals" goalsEnabled /><section className={styles.content}>
		<Link href={directory} className={styles.back}><ArrowLeft size={15} aria-hidden="true" />{c.back}</Link>
		{loading && <p role="status">{c.loading}</p>}
		{error && <div className={styles.error} role="alert"><p>{[403, 404].includes(error.status) ? c.unavailable : c.failed}</p><button type="button" className="btn btn-secondary" onClick={reload}>{c.retry}</button></div>}
		{feedback && <p className={feedback.error ? styles.error : styles.notice} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
		{goal && <>
			<header className={styles.header}><div><h1>{hasTerms ? goal.title : c.administration}</h1><p>{c.version(goal.version)} · {date(goal.periodStart)} — {date(goal.periodEnd)}</p></div><span className={styles.role}>{c.state[goal.lifecycle]}</span></header>
			<section className={styles.notice} aria-labelledby="goal-next-action"><h2 id="goal-next-action">{c.guidance.title}</h2><p>{c.guidance[goalGuidanceKey(goal, data.capabilities, data.access)]}</p></section><p className={styles.lede}>{data.access === 'proposal' ? c.proposal : c.privacy}</p>
			{goal.needsReviewer && <p className={styles.notice}>{c.needsReviewer}</p>}
			<nav className={styles.headerActions} aria-label={c.title}>
				{goal.version > 1 && <Link className="btn btn-secondary" href={`${base}?version=${goal.version - 1}`}>{c.previousVersion}</Link>}
				{goal.version < goal.currentVersion && <Link className="btn btn-secondary" href={`${base}?version=${goal.version + 1}`}>{c.nextVersion}</Link>}
			</nav>
			{hasTerms && <>
				{['draft', 'proposed'].includes(goal.lifecycle) && <section className={styles.goalDetail}><h2>{c.agreement}</h2><p>{goal.subjectAcceptedAt ? c.subjectAccepted : c.subjectPending}</p><p>{!goal.reviewerId ? c.personalOnly : goal.reviewerAcceptedAt ? c.reviewerAccepted : c.reviewerPending}</p><div className={styles.headerActions}>
					{data.capabilities?.canPropose && <button type="button" className="btn btn-primary" disabled={saving || loading} onClick={() => transition('propose')}>{saving ? c.saving : c.propose}</button>}
					{data.capabilities?.canAccept && <button type="button" className="btn btn-primary" disabled={saving || loading} onClick={() => transition('accept')}>{saving ? c.saving : c.accept}</button>}
				</div></section>}
				<section className={styles.goalDetail}><h2>{c.success}</h2><p>{goal.successDescription}</p></section>
				<section className={styles.goalDetail}><h2>{c.measurement}</h2>{goal.measurement.kind === 'milestone' ? <><h3>{c.criteria}</h3><p>{goal.measurement.criteria}</p></> : <dl className={styles.goalNumbers}>
					<div><dt>{c.baseline}</dt><dd>{number(goal.measurement.baseline)} {goal.measurement.unit}</dd></div>
					<div><dt>{c.target}</dt><dd>{number(goal.measurement.target)} {goal.measurement.unit}</dd></div>
					{privateAccess && <><div><dt>{c.current}</dt><dd>{goal.measurement.current == null ? c.unreported : `${number(goal.measurement.current)} ${goal.measurement.unit}`}</dd></div><div><dt>{c.achievement}</dt><dd>{goal.achievement == null ? c.unreported : `${number(goal.achievement)}%`}</dd></div></>}
				</dl>}<p className={styles.lede}>{c.noScore}</p></section>
			</>}
			{privateAccess && <>
				<section className={styles.goalDetail}><h2>{c.evidence}</h2>{data.updates.length ? <ol className={styles.goalList}>{data.updates.map(update => <li className={styles.goalEvidence} key={update.id}>{author(update, update.createdAt)}<p>{update.note}</p>{update.value != null && <strong>{c.current}: {number(update.value)} {goal.measurement.unit}</strong>}{update.reference && <p>{update.reference.access === 'available' ? <Link href={`/p/${encodeURIComponent(update.reference.projectCode)}${update.reference.topicId ? `?topic=${encodeURIComponent(update.reference.topicId)}` : ''}`}>{update.reference.title}{update.reference.topicTitle ? ` · ${update.reference.topicTitle}` : ''}</Link> : <span>{c.referenceUnavailable}</span>}</p>}{update.links.length > 0 && <ul>{update.links.map((link, index) => <li key={`${index}:${link}`}><a href={link} target="_blank" rel="noopener noreferrer">{link}</a></li>)}</ul>}</li>)}</ol> : <p>{c.noEvidence}</p>}{pagination('updatesOffset', data.updatesNextOffset, c.evidencePages)}</section>
				{goal.selfReview && <section className={styles.goalDetail}><h2>{c.selfReview}</h2><p>{goal.selfReview}</p></section>}
				<section className={styles.goalDetail}><h2>{c.review}</h2>{data.review ? <>{author(data.review, data.review.publishedAt)}<strong>{c.outcome[data.review.outcome]}</strong><p>{data.review.explanation}</p><h3>{c.nextStep}</h3><p>{data.review.nextStep}</p></> : <p>{c.noReview}</p>}</section>
				{data.review && <section className={styles.goalDetail}><h2>{c.responses}</h2>{data.responses.length ? <ol className={styles.goalList}>{data.responses.map(response => <li className={styles.goalEvidence} key={response.id}>{author(response, response.createdAt)}{response.acknowledged && <strong>{c.acknowledged}</strong>}{response.response && <p>{response.response}</p>}</li>)}</ol> : <p>{c.noResponses}</p>}{pagination('responsesOffset', data.responsesNextOffset, c.responsePages)}</section>}
			</>}
		</>}
		<GoalActionForm goal={privateAccess ? goal : null} capabilities={data?.capabilities} busy={saving || loading} onTransition={transition} />
		<GoalTermsEditor goal={privateAccess ? goal : null} capabilities={data?.capabilities} busy={saving || loading} onTransition={transition} />
		<GoalReviewerForm teamId={teamId} goal={goal} allowed={Boolean(data?.capabilities?.canReassignReviewer)} busy={saving || loading} onAssign={fields => mutate('reviewer', fields)} />
	</section></div></main>;
}
