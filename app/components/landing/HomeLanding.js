'use client';

import Link from 'next/link';
import { ArrowRight, MessageSquare, Plus, ShieldCheck, Smartphone } from 'lucide-react';
import MeguMark from '../MeguMark';
import { ExampleQr, Phrases, useLandingCopy, useLandingHero } from './parts';
import styles from './landing.module.css';

const FACT_ICONS = { chat: MessageSquare, phone: Smartphone, shield: ShieldCheck };

/**
 * `/` for someone who is not signed in: a front door, not a dashboard.
 *
 * Megu leads the first viewport with real lines from both sides of the
 * product around it, then two posters send the reader to the side that fits
 * their group. The posters are deliberately two materials, light paper for
 * friends and indigo for organisations, because they are two audiences.
 */
export default function HomeLanding() {
	const { t, lang } = useLandingCopy();
	const hero = useLandingHero();
	const h = t.home;

	return (
		<div className={styles.page} lang={lang}>
			<section ref={hero} className={`${styles.bleed} ${styles.band} ${styles.homeHero}`} data-landing-hero>
				<div className={styles.homeHeroInner}>
					<div>
						<h1>
							<span className={styles.nb}>{h.h1[0]}</span>{' '}
							<em className={styles.nb}>{h.h1[1]}</em>{' '}
							<em className={styles.nb}>{h.h1[2]}</em>
						</h1>
						<p className={styles.bandLede}>{h.lede}</p>
						<div className={styles.ctas}>
							<Link href="/servers" className={`${styles.btn} ${styles.btnLight}`}><Plus aria-hidden="true" />{t.addMegu}</Link>
							<Link href="#worlds" className={`${styles.btn} ${styles.btnGhostBand}`}>{h.secondary}</Link>
						</div>
						<p className={styles.bandSmall}>{h.small}</p>
					</div>
					<div className={styles.stage} aria-label={h.stageLabel}>
						<MeguMark size={380} className={styles.stageMegu} title="Megu" />
						{h.bubbles.map(bubble => (
							<p key={bubble.say} className={`${styles.say} ${bubble.tone === 'money' ? styles.sayMoney : styles.sayWork}`}>
								<small>{bubble.where}</small>{bubble.say}
							</p>
						))}
					</div>
				</div>
			</section>

			<section className={styles.section} id="worlds">
				<Phrases as="h2" className={styles.sectionTitle} parts={h.worldsTitle} />
				<p className={styles.worldsLede}>{h.worldsLede}</p>
				<div className={styles.posters}>
					<Link href="/bills" className={`${styles.poster} ${styles.posterBills}`}>
						<span className={styles.kind}>{h.bills.kind}</span>
						<h3 className={styles.posterTitle}>{h.bills.title.map(line => <span key={line}>{line}</span>)}</h3>
						<p className={styles.what}>{h.bills.what}</p>
						<div className={styles.scene} aria-hidden="true">
							<div className={styles.miniBill}>
								<header><b>{h.bills.billTitle}</b><span>฿65</span></header>
								<p>{h.bills.billMeta}</p>
								<div className={styles.people}>
									{h.bills.people.map(person => (
										<div key={person.name} className={styles.person} data-state={person.state}>{person.name}<small>{person.note}</small></div>
									))}
								</div>
							</div>
							<div className={styles.qrCard}>
								<p>{h.bills.yourShare}</p>
								<b>฿65.00</b>
								<div className={styles.code}><ExampleQr /></div>
							</div>
						</div>
						<div className={styles.go}>
							<b>{h.bills.go}<small>{h.bills.goSub}</small></b>
							<i><ArrowRight aria-hidden="true" /></i>
						</div>
					</Link>

					<Link href="/org" className={`${styles.poster} ${styles.posterOrg}`}>
						<span className={styles.kind}>{h.org.kind}</span>
						<h3 className={styles.posterTitle}>{h.org.title.map(line => <span key={line}>{line}</span>)}</h3>
						<p className={styles.what}>{h.org.what}</p>
						<div className={styles.scene} aria-hidden="true">
							<div className={styles.lane}>
								{h.org.tasks.map(task => (
									<div key={task.no} className={`${styles.task} ${task.lift ? styles.taskLift : ''}`}>
										<span className={styles.no}>{task.no}</span>
										<b>{task.title}<small>{task.note}</small></b>
										<span className={styles.pill} data-state={task.state}>{task.label}</span>
									</div>
								))}
							</div>
							<p className={styles.ping}><small>{h.org.ping.where}</small>{h.org.ping.say}</p>
						</div>
						<div className={styles.go}>
							<b>{h.org.go}<small>{h.org.goSub}</small></b>
							<i><ArrowRight aria-hidden="true" /></i>
						</div>
					</Link>
				</div>
			</section>

			<section className={`${styles.section} ${styles.split}`}>
				<div>
					<Phrases as="h2" className={styles.sectionTitle} parts={h.oneTitle} />
					<p className={styles.sectionBody}>{h.oneBody}</p>
				</div>
				<ul className={styles.facts}>
					{h.facts.map(fact => {
						const Icon = FACT_ICONS[fact.icon];
						return <li key={fact.title}><Icon aria-hidden="true" /><div><b>{fact.title}</b><span>{fact.body}</span></div></li>;
					})}
				</ul>
			</section>

			<section className={`${styles.bleed} ${styles.band} ${styles.close}`}>
				<div className={styles.closeInner}>
					<MeguMark size={220} mood="happy" className={styles.closeMegu} title="Megu" />
					<div>
						<Phrases as="p" className={styles.closeBubble} parts={h.closeLine} />
						<div className={styles.ctas}>
							<Link href="/servers" className={`${styles.btn} ${styles.btnLight}`}><Plus aria-hidden="true" />{t.addMegu}</Link>
							<a href="/api/auth/login" className={`${styles.btn} ${styles.btnGhostBand}`}>{t.signIn}</a>
						</div>
					</div>
				</div>
			</section>
		</div>
	);
}
