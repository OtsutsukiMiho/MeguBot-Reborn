'use client';

import Link from 'next/link';
import { ArrowRight, Plus } from 'lucide-react';
import AuthGate from '../AuthGate';
import ProjectAvatar from '../projects/ProjectAvatar';
import useWorkspaceResource from '../useWorkspaceResource';
import WorkspaceSkeleton from '../WorkspaceSkeleton';
import { useCopy } from '../../copy';
import styles from '../../teams/teams.module.css';

export default function TeamGoals({ teamId, offset = 0 }) {
	const { t, lang } = useCopy();
	const c = t.teamGoals;
	const base = `/teams/${encodeURIComponent(teamId)}/goals`;
	const { data, loading, error, reload } = useWorkspaceResource(`/api/megu/teams/${encodeURIComponent(teamId)}/goals?offset=${offset}&limit=30`);
	if (error?.status === 401) return <AuthGate title={t.teams.signedOutTitle} lede={t.teams.signedOutLede} />;
	const date = value => new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
	return <section aria-busy={loading}>
		<div className={styles.pageHeading}><div><h2>{c.title}</h2><p>{c.listIntro}</p></div><div className={styles.goalHeadingActions}>{data && <Link className="btn btn-primary" href={`${base}/new`}><Plus size={16} aria-hidden="true" />{c.create}</Link>}<details className={styles.privacyNote}><summary>{c.privacyTitle}</summary><p>{c.privacy}</p></details></div></div>
		{loading && !data && <WorkspaceSkeleton kind="cards" label={c.loading} />}
		{error && <div className={styles.error} role="alert"><p>{[403, 404].includes(error.status) ? c.unavailable : c.failed}</p><button type="button" className="btn btn-secondary" onClick={reload}>{c.retry}</button></div>}
		{data && <>
			{data.goals.length ? <ul className={styles.goalList}>{data.goals.map(goal => <li className={styles.goalRow} data-state={goal.lifecycle} key={goal.id}><Link href={`${base}/${encodeURIComponent(goal.id)}`} className={styles.goalCard}>
				<span className={styles.goalCardHead}><span className={styles.goalTerms}><small>{c.period}: {date(goal.periodStart)} — {date(goal.periodEnd)}</small><strong>{goal.access === 'administration' ? c.administration : goal.title}</strong>{goal.access === 'proposal' && <small>{c.proposal}</small>}</span><span className={styles.role}>{c.state[goal.lifecycle]}</span></span>
				<span className={styles.goalCardFooter}><span className={styles.goalNext}><small>{c.nextStep}</small><strong>{goal.needsReviewer ? c.needsReviewer : c.listHint[goal.lifecycle]}</strong><span>{c.responsibleLabel}: {goal.needsReviewer ? c.responsible.manager : c.responsible[goal.lifecycle]}</span></span><span className={styles.goalIdentity}><ProjectAvatar className={styles.avatar} name={goal.subjectName} avatarUrl={goal.subjectAvatarUrl} /><span><small>{c.listMember}</small>{goal.subjectName || c.member}</span></span><ArrowRight className={styles.goalRowArrow} size={18} aria-hidden="true" /></span>
			</Link></li>)}</ul> : <section className={styles.empty}><div><h2>{offset ? c.emptyPage : c.empty}</h2>{!offset && <p>{c.emptyHint}</p>}</div></section>}
			{(offset > 0 || data.nextOffset != null) && <nav className={styles.collectionFooter} aria-label={c.pagination}><span>{c.pagination}</span><div className={styles.headerActions}>
				{offset > 0 && <Link className="btn btn-secondary" href={`${base}?offset=${Math.max(0, offset - 30)}`}>{c.previous}</Link>}
				{data.nextOffset != null && <Link className="btn btn-secondary" href={`${base}?offset=${data.nextOffset}`}>{c.next}</Link>}</div>
			</nav>}
		</>}
	</section>;
}
