'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useCopy } from '../../copy';
import { useLandingCopy } from './parts';
import styles from './home-signed-in.module.css';

const PROJECTS_ENABLED = process.env.NEXT_PUBLIC_MEGU_PROJECTS_ENABLED !== '0';

/**
 * `/` once someone is signed in: what is waiting for them, not a brochure.
 *
 * Built only from data the site already serves. Bills are the ones this person
 * owns (the list endpoint is owner-scoped), so "waiting" means slips they have
 * to confirm and money still to collect. Work is the active projects with
 * tasks assigned to them, nearest deadline first. Each side loads and fails on
 * its own, so a slow projects query never blanks the bills.
 */
export default function HomeSignedIn({ user }) {
	const { t, lang } = useLandingCopy();
	const { fmt } = useCopy();
	const s = t.signedIn;
	const [bills, setBills] = useState({ state: 'loading', items: [] });
	const [work, setWork] = useState({ state: PROJECTS_ENABLED ? 'loading' : 'off', items: [] });

	useEffect(() => {
		let live = true;
		fetch('/api/megu/activities?includeClosed=false', { credentials: 'same-origin' })
			.then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
			.then(data => {
				if (!live) return;
				const open = (data.activities || []).filter(a => a.planState !== 'cancelled'
					&& ((a.summary?.awaitingConfirmation || 0) > 0 || (a.summary?.outstandingSatang || 0) > 0));
				open.sort((a, b) => (b.summary?.awaitingConfirmation || 0) - (a.summary?.awaitingConfirmation || 0));
				setBills({ state: 'ready', items: open });
			})
			.catch(() => { if (live) setBills({ state: 'failed', items: [] }); });

		if (PROJECTS_ENABLED) {
			fetch('/api/megu/projects?assigned=true&bucket=active', { credentials: 'same-origin' })
				.then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
				.then(data => {
					if (!live) return;
					const mine = (data.projects || []).filter(p => p.assignedCount > 0);
					mine.sort((a, b) => (a.nextDueAt || '9999').localeCompare(b.nextDueAt || '9999'));
					setWork({ state: 'ready', items: mine });
				})
				.catch(() => { if (live) setWork({ state: 'failed', items: [] }); });
		}
		return () => { live = false; };
	}, []);

	const awaiting = bills.items.reduce((n, a) => n + (a.summary?.awaitingConfirmation || 0), 0);
	const waiting = awaiting + work.items.length;
	const ready = bills.state !== 'loading' && work.state !== 'loading';

	return (
		<div className={styles.home} lang={lang}>
			<header className={styles.hello}>
				<h1>{s.hello(user.displayName)}</h1>
				<p aria-live="polite">{ready ? s.waiting(waiting) : ' '}</p>
			</header>

			<div className={styles.panes}>
				<section className={styles.pane} aria-labelledby="home-bills">
					<div className={styles.paneTop}>
						<h2 id="home-bills">{s.bills}</h2>
						{bills.state === 'ready' && <span>{s.billsMeta(bills.items.length)}</span>}
						<Link href="/bills">{s.seeAll}</Link>
					</div>
					<Pane state={bills.state} empty={bills.items.length === 0} s={s} emptyText={s.billsEmpty} emptyCta={s.billsEmptyCta} emptyHref="/activities">
						{bills.items.slice(0, 4).map(activity => {
							const pending = activity.summary?.awaitingConfirmation || 0;
							return (
								<li key={activity.id}>
									<div>
										<b>{activity.title}</b>
										<small>{pending > 0 ? s.awaiting(pending) : s.outstanding(fmt.money(activity.summary?.outstandingSatang || 0, activity.currency))}</small>
									</div>
									<Link href={`/a/${activity.code}`} className={pending > 0 ? styles.act : `${styles.act} ${styles.soft}`}>{pending > 0 ? s.check : s.open}</Link>
								</li>
							);
						})}
					</Pane>
				</section>

				{work.state !== 'off' && (
					<section className={`${styles.pane} ${styles.org}`} aria-labelledby="home-work">
						<div className={styles.paneTop}>
							<h2 id="home-work">{s.work}</h2>
							{work.state === 'ready' && <span>{s.workMeta(work.items.length)}</span>}
							<Link href="/projects">{s.seeAll}</Link>
						</div>
						<Pane state={work.state} empty={work.items.length === 0} s={s} emptyText={s.workEmpty} emptyCta={s.workEmptyCta} emptyHref="/projects">
							{work.items.slice(0, 4).map(project => (
								<li key={project.id}>
									<div>
										<b>{project.title}</b>
										<small>
											{s.assigned(project.assignedCount)}
											{project.nextDueAt ? ` ${s.nextDue(fmt.when(project.nextDueAt, { time: false }))}` : ''}
										</small>
									</div>
									<Link href={`/p/${project.code}`} className={`${styles.act} ${styles.soft}`}>{s.openProject}</Link>
								</li>
							))}
						</Pane>
					</section>
				)}
			</div>
		</div>
	);
}

function Pane({ state, empty, s, emptyText, emptyCta, emptyHref, children }) {
	if (state === 'loading') return <ul className={styles.todo} aria-busy="true"><li className={styles.skeleton} /><li className={styles.skeleton} /></ul>;
	if (state === 'failed') return <p className={styles.quiet}>{s.loadFailed}</p>;
	if (empty) return <p className={styles.quiet}>{emptyText} <Link href={emptyHref}>{emptyCta}</Link></p>;
	return <ul className={styles.todo}>{children}</ul>;
}
