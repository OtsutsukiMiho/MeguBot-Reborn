'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import MeguMark from '../MeguMark';
import MonthDemo from './MonthDemo';
import { Phrases, useLandingCopy } from './parts';
import styles from './landing.module.css';

const CHAT_FACE = '#3D4795';

/**
 * `/bills` for someone who is not signed in.
 *
 * The month demo is the claim: one bill, played out day by day, with what
 * Megu says on each day. Every section after it shows a real surface at
 * readable size (the Discord card, the DM, the phone, the slip as the owner
 * receives it) and says plainly what Megu cannot do: it never holds money and
 * never knows for certain that a transfer arrived.
 */
export default function BillsLanding() {
	const { t, lang } = useLandingCopy();
	const b = t.bills;

	return (
		<div className={styles.page} lang={lang}>
			<section className={styles.pageHero}>
				<div className={styles.pageHeroInner}>
					<div>
						<h1>
							<span className={styles.nb}>{b.h1[0]}</span>{' '}
							<span className={`${styles.accentLine} ${styles.nb}`}>{b.h1[1]}</span>
						</h1>
						<p className={styles.lede}>{b.lede}</p>
						<div className={styles.ctas}>
							<a href="/api/invite" className={`${styles.btn} ${styles.btnBrand}`}><Plus aria-hidden="true" />{t.addMegu}</a>
							<Link href="#places" className={`${styles.btn} ${styles.btnLine}`}>{b.secondary}</Link>
						</div>
						<p className={styles.small}>{b.small}</p>
					</div>
					<MonthDemo t={t.month} />
				</div>
			</section>

			<section className={`${styles.bleed} ${styles.quiet}`}>
				<div className={styles.split}>
					<div className={styles.chat} aria-label={b.chatLabel}>
						{b.chat.map(line => (
							<div key={line.text}>
								<div className={styles.line}><i style={{ background: CHAT_FACE }} /><div><small>{line.who}</small><p>{line.text}</p></div></div>
								<p className={styles.seen}>{line.seen}</p>
							</div>
						))}
					</div>
					<div>
						<Phrases as="h2" className={styles.sectionTitle} parts={b.silenceTitle} />
						<p className={styles.sectionBody}>{b.silenceBody}</p>
					</div>
				</div>
			</section>

			<section className={styles.section} id="places">
				<Phrases as="h2" className={styles.sectionTitle} parts={b.placesTitle} />
				<p className={styles.sectionBody}>{b.placesBody}</p>
				<div className={styles.rail}>
					<div>
						<p className={styles.where}><b>{b.inChannel[0]}</b> {b.inChannel[1]}</p>
						<div className={styles.discord}>
							<div className={styles.discordRow}>
								<span className={styles.discordAvatar}><MeguMark size={26} /></span>
								<div>
									<p className={styles.ownerWho}>Megu<span className={styles.app}>APP</span></p>
									<div className={styles.embed}>
										<h3>{b.card.title}</h3><p>{b.card.meta}</p>
										<div className={styles.chips}>{b.card.actions.map(a => <span key={a}>{a}</span>)}</div>
									</div>
								</div>
							</div>
						</div>
					</div>
					<div>
						<p className={styles.where}><b>{b.inDm[0]}</b> {b.inDm[1]}</p>
						<div className={styles.dm}>
							<p className={styles.bubble}><small>{b.dm.where}</small>{b.dm.say}</p>
							<div className={styles.chips}>{b.dm.actions.map(a => <span key={a}>{a}</span>)}</div>
						</div>
					</div>
					<div>
						<p className={styles.where}><b>{b.onPhone[0]}</b> {b.onPhone[1]}</p>
						<div className={styles.phone}>
							<p className={styles.phoneTo}>{b.phone.to}</p>
							<p className={styles.phoneAmt}>฿65.00</p>
							<div className={styles.methods}>
								{b.phone.methods.map((m, i) => <div key={m}>{m}{i === 0 && <small>{b.phone.best}</small>}</div>)}
							</div>
							<p className={styles.phoneSend}>{b.phone.send}</p>
						</div>
					</div>
				</div>
			</section>

			<section className={`${styles.section} ${styles.split}`}>
				<div>
					<Phrases as="h2" className={styles.sectionTitle} parts={b.ownerTitle} />
					<p className={styles.sectionBody}>{b.ownerBody}</p>
					<p className={styles.honest}>{b.ownerHonest}</p>
				</div>
				<div className={styles.ownerDm} aria-label={b.ownerDm.label}>
					<div className={styles.ownerRow}>
						<span className={styles.ownerAvatar}><MeguMark size={29} /></span>
						<div><p className={styles.ownerWho}>Megu<small>{b.ownerDm.time}</small></p><p className={styles.ownerMsg}>{b.ownerDm.msg}</p></div>
					</div>
					<div className={styles.read}>
						<div className={styles.slip}><b>{b.ownerDm.slip.ok}</b>{b.ownerDm.slip.when}<strong>฿65.00</strong>{b.ownerDm.slip.from}<br />{b.ownerDm.slip.to}</div>
						<div className={styles.checks}>{b.ownerDm.checks.map(([k, v]) => <div key={k}><span>{k}</span><span>{v}</span></div>)}</div>
					</div>
					<div className={styles.decide}>{b.ownerDm.actions.map(a => <span key={a}>{a}</span>)}</div>
				</div>
			</section>

			<section className={`${styles.bleed} ${styles.band} ${styles.listBand}`}>
				<div className={styles.split}>
					<div>
						<Phrases as="h2" className={styles.sectionTitle} parts={b.payTitle} />
						<p className={styles.sectionBody}>{b.payBody}</p>
					</div>
					<ul className={styles.ways}>
						{b.ways.map(way => (
							<li key={way.name}><div><b>{way.name}</b><span>{way.note}</span></div>{way.badge && <em>{way.badge}</em>}</li>
						))}
					</ul>
				</div>
			</section>

			<section className={`${styles.section} ${styles.faq}`}>
				<Phrases as="h2" className={styles.sectionTitle} parts={b.faqTitle} />
				<div>
					{b.faq.map(([q, a], i) => (
						<details key={q} open={i === 0}>
							<summary>{q}<Plus aria-hidden="true" /></summary>
							<p>{a}</p>
						</details>
					))}
				</div>
			</section>

			<section className={`${styles.bleed} ${styles.band} ${styles.close}`}>
				<div className={styles.closeInner}>
					<MeguMark size={220} mood="happy" className={styles.closeMegu} title="Megu" />
					<div>
						<Phrases as="p" className={styles.closeBubble} parts={b.closeLine} />
						<div className={styles.ctas}>
							<a href="/api/invite" className={`${styles.btn} ${styles.btnLight}`}><Plus aria-hidden="true" />{t.addMegu}</a>
							<Link href="/org" className={`${styles.btn} ${styles.btnGhostBand}`}>{b.seeOrg}</Link>
						</div>
					</div>
				</div>
			</section>
			<p className={styles.note}>{t.example}</p>
		</div>
	);
}
