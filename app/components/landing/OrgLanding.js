'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import MeguMark from '../MeguMark';
import WeekDemo from './WeekDemo';
import { Phrases, useLandingCopy } from './parts';
import styles from './landing.module.css';

const FACES = { Alex: '#3D4795', Mina: '#8C5BB8', Ken: '#2E7D8C', Sara: '#A0623A' };

/**
 * `/org`, for startups that already run their work in Discord.
 *
 * Built the same way as `/bills`: one task's week played out in the hero, then
 * the problem in the team's own chat, then each capability shown as the thing
 * itself. No prices: plans for organisations are not decided, so the page
 * offers a conversation instead of a number.
 */
export default function OrgLanding() {
	const { t, lang } = useLandingCopy();
	const o = t.org;

	return (
		<div className={styles.page} lang={lang}>
			<section className={styles.pageHero}>
				<div className={styles.pageHeroInner}>
					<div>
						<h1>
							<span className={styles.nb}>{o.h1[0]}</span>{' '}
							<Phrases className={styles.accentLine} parts={o.h1Accent} />
						</h1>
						<p className={styles.lede}>{o.lede}</p>
						<div className={styles.ctas}>
							<a href="/api/invite" className={`${styles.btn} ${styles.btnBrand}`}><Plus aria-hidden="true" />{t.addMegu}</a>
							<Link href="#contact" className={`${styles.btn} ${styles.btnLine}`}>{o.secondary}</Link>
						</div>
						<p className={styles.small}>{o.small}</p>
					</div>
					<WeekDemo t={t.week} />
				</div>
			</section>

			<section className={`${styles.bleed} ${styles.quiet}`}>
				<div className={styles.split}>
					<div className={styles.thread} aria-label={o.threadLabel}>
						<p>{o.channel}</p>
						{o.thread.map(line => (
							<div key={line.text} className={styles.line}>
								<i style={{ background: FACES[line.who] || '#3D4795' }} />
								<div><small>{line.who}</small><p>{line.text}</p></div>
							</div>
						))}
					</div>
					<div>
						<Phrases as="h2" className={styles.sectionTitle} parts={o.lostTitle} />
						<p className={styles.sectionBody}>{o.lostBody}</p>
					</div>
				</div>
			</section>

			<section className={`${styles.section} ${styles.split}`}>
				<div className={`${styles.map} ${styles.orderLast}`} aria-label={o.rolesLabel}>
					{o.roles.map(row => (
						<div key={row.role} className={styles.mapRow}>
							<span className={styles.role}><i style={{ background: row.color }} />{row.role}</span>
							<span className={styles.arrow} aria-hidden="true" />
							<span className={styles.team}>{row.team}{row.badge && <em data-ok={row.ok ? '' : undefined}>{row.badge}</em>}<small>{row.count}</small></span>
						</div>
					))}
					<p className={styles.mapFoot}>{o.rolesFoot}</p>
				</div>
				<div>
					<Phrases as="h2" className={styles.sectionTitle} parts={o.rolesTitle} />
					<p className={styles.sectionBody}>{o.rolesBody}</p>
				</div>
			</section>

			<section className={styles.section}>
				<div className={styles.boardHead}>
					<Phrases as="h2" className={styles.sectionTitle} parts={o.boardTitle} />
					<p>{o.boardBody}</p>
				</div>
				<div className={styles.project} aria-label={o.boardLabel}>
					<div className={styles.projectTop}>
						<h3>{o.project}</h3>
						{o.stats.map(([n, label]) => <span key={label} className={styles.stat}><b>{n}</b>{label}</span>)}
					</div>
					<table className={styles.table}>
						<thead><tr>{o.cols.map(c => <th key={c} scope="col">{c}</th>)}</tr></thead>
						<tbody>
							{o.rows.map(([task, state, label, owner, due, late]) => (
								<tr key={task}>
									<td>{task}</td>
									<td><span className={styles.pill} data-state={state}>{label}</span></td>
									<td>{owner}</td>
									<td className={late ? styles.late : undefined}>{due}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			<section className={`${styles.section} ${styles.split}`}>
				<div>
					<Phrases as="h2" className={styles.sectionTitle} parts={o.privateTitle} />
					<p className={styles.sectionBody}>{o.privateBody}</p>
				</div>
				<div className={styles.goal} aria-label={o.goal.label}>
					<h3>{o.goal.title}</h3>
					<div className={styles.goalWho}><span>{o.goal.member}</span><span>{o.goal.reviewer}</span></div>
					<p className={styles.goalHide}><b>{o.goal.othersLead}</b> {o.goal.others}</p>
				</div>
			</section>

			<section className={`${styles.bleed} ${styles.band} ${styles.listBand}`} id="tools">
				<div className={`${styles.split} ${styles.splitTop}`}>
					<div>
						<Phrases as="h2" className={styles.sectionTitle} parts={o.toolsTitle} />
						<p className={styles.sectionBody}>{o.toolsBody}</p>
					</div>
					<ul className={styles.tools}>
						{o.tools.map(([name, note]) => <li key={name}><b>{name}</b><span>{note}</span></li>)}
					</ul>
				</div>
			</section>

			<section className={`${styles.bleed} ${styles.band} ${styles.close} ${styles.closeAfterBand}`} id="contact">
				<div className={styles.closeInner}>
					<MeguMark size={220} mood="happy" className={styles.closeMegu} title="Megu" />
					<div>
						<Phrases as="p" className={styles.closeBubble} parts={o.closeLine} />
						<div className={styles.ctas}>
							<a href="/api/invite" className={`${styles.btn} ${styles.btnLight}`}><Plus aria-hidden="true" />{t.addMegu}</a>
						</div>
						<p className={styles.closeNote}>{o.closeNote}</p>
					</div>
				</div>
			</section>
			<p className={styles.note}>{t.example}</p>
		</div>
	);
}
