'use client';

import { CalendarClock, Settings2, ShieldCheck } from 'lucide-react';
import LoginOptions from './LoginOptions';
import MeguMark from './MeguMark';
import { useCopy } from '../copy';
import styles from '../account/account.module.css';

/**
 * One signed-out experience for every owner surface. The story stays stable so
 * users recognise the page; the card changes its title and action to explain
 * why the page they asked for needs Discord.
 */
export default function AuthGate({ title, lede, action, href = '/api/auth/login', mood = 'happy' }) {
	const { t } = useCopy();

	return (
		<main className={styles.signInPage}>
			<section className={styles.story}>
				<p className={styles.eyebrow}>{t.account.signInEyebrow}</p>
				<h1>{t.account.signInHeadingBefore}<br /><em>{t.account.signInHeadingAccent}</em></h1>
				<p className={styles.lede}>{t.account.signInLede}</p>
				<div className={styles.benefits}>
					<div className={styles.benefit}>
						<Settings2 size={22} aria-hidden="true" />
						<div><strong>{t.account.signInManageTitle}</strong><span>{t.account.signInManageHint}</span></div>
					</div>
					<div className={styles.benefit}>
						<CalendarClock size={22} aria-hidden="true" />
						<div><strong>{t.account.signInContinueTitle}</strong><span>{t.account.signInContinueHint}</span></div>
					</div>
				</div>
			</section>
			<aside className={styles.card} aria-labelledby="auth-gate-title">
				<div className={styles.mark}><MeguMark size={62} mood={mood} /></div>
				<h2 id="auth-gate-title">{title || t.account.signInTitle}</h2>
				<p className={styles.cardLede}>{lede || t.account.signInCardLede}</p>
				<div className={styles.loginSlot}><LoginOptions href={href} label={action} /></div>
				<p className={styles.privacy}><ShieldCheck size={16} aria-hidden="true" /><span>{t.account.signInPrivacy}</span></p>
			</aside>
		</main>
	);
}
