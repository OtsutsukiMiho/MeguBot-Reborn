'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import AuthGate from '../AuthGate';
import ProjectAvatar from '../projects/ProjectAvatar';
import useWorkspaceResource from '../useWorkspaceResource';
import TeamWorkspaceNav from './TeamWorkspaceNav';
import { useCopy } from '../../copy';
import styles from '../../teams/teams.module.css';

export default function TeamGoals({ teamId, offset = 0 }) {
	const { t, lang } = useCopy();
	const c = t.teamGoals;
	const base = `/teams/${encodeURIComponent(teamId)}/goals`;
	const { data, loading, error, reload } = useWorkspaceResource(`/api/megu/teams/${encodeURIComponent(teamId)}/goals?offset=${offset}&limit=30`);
	if (error?.status === 401) return <AuthGate title={t.teams.signedOutTitle} lede={t.teams.signedOutLede} />;
	const date = value => new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
	return <main className={styles.shell} aria-busy={loading}>
		<Link href={`/teams/${encodeURIComponent(teamId)}`} className={styles.back}><ArrowLeft size={15} aria-hidden="true" />{t.teams.backToTeam}</Link>
		<header className={styles.header}><div><h1>{c.title}</h1>{data?.team && <p>{data.team.name}</p>}</div>{data && <Link className="btn btn-primary" href={`${base}/new`}>{c.create}</Link>}</header>
		<p className={styles.lede}>{c.privacy}</p>
		<div className={styles.layout}><TeamWorkspaceNav teamId={teamId} section="goals" goalsEnabled /><section className={styles.content}>
		{loading && <p role="status">{c.loading}</p>}
		{error && <div className={styles.error} role="alert"><p>{[403, 404].includes(error.status) ? c.unavailable : c.failed}</p><button type="button" className="btn btn-secondary" onClick={reload}>{c.retry}</button></div>}
		{data && <>
			{data.goals.length ? <ul className={styles.goalList}>{data.goals.map(goal => <li className={styles.goalRow} key={goal.id}>
				<div className={styles.goalIdentity}><ProjectAvatar className={styles.avatar} name={goal.subjectName} avatarUrl={goal.subjectAvatarUrl} /><span>{goal.subjectName || c.member}</span></div>
				<div className={styles.goalTerms}><Link href={`${base}/${encodeURIComponent(goal.id)}`}><strong>{goal.access === 'administration' ? c.administration : goal.title}</strong></Link><span>{c.period}: {date(goal.periodStart)} — {date(goal.periodEnd)}</span>{goal.access === 'proposal' && <span>{c.proposal}</span>}</div>
				<div className={styles.goalState}><span className={styles.role}>{c.state[goal.lifecycle]}</span>{goal.needsReviewer && <span>{c.needsReviewer}</span>}</div>
			</li>)}</ul> : <section className={styles.empty}><div><h2>{offset ? c.emptyPage : c.empty}</h2>{!offset && <p>{c.emptyHint}</p>}</div></section>}
			{(offset > 0 || data.nextOffset != null) && <nav className={styles.headerActions} aria-label={c.pagination}>
				{offset > 0 && <Link className="btn btn-secondary" href={`${base}?offset=${Math.max(0, offset - 30)}`}>{c.previous}</Link>}
				{data.nextOffset != null && <Link className="btn btn-secondary" href={`${base}?offset=${data.nextOffset}`}>{c.next}</Link>}
			</nav>}
		</>}
		</section></div>
	</main>;
}
