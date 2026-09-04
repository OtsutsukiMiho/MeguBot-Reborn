'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
	ArrowRight,
	CircleDollarSign,
	ReceiptText,
	RefreshCw,
	Repeat2,
	Users,
} from 'lucide-react';
import AuthGate from '../components/AuthGate';
import { useCopy } from '../copy';
import styles from './bills.module.css';

export default function BillsPage() {
	const { t, fmt } = useCopy();
	const [me, setMe] = useState(null);
	const [activities, setActivities] = useState([]);
	const [loading, setLoading] = useState(true);
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		let current = true;
		setLoading(true);
		setFailed(false);

		Promise.all([
			fetch('/api/megu/me', { credentials: 'same-origin' })
				.then(response => response.ok ? response.json() : null),
			fetch('/api/megu/activities', { credentials: 'same-origin' })
				.then(response => response.ok ? response.json() : null),
		])
			.then(([meData, activityData]) => {
				if (!current) return;
				setMe(meData);
				if (meData?.loggedIn && !activityData) setFailed(true);
				setActivities(activityData?.activities || []);
			})
			.catch(() => {
				if (current) setFailed(true);
			})
			.finally(() => {
				if (current) setLoading(false);
			});

		return () => { current = false; };
	}, [attempt]);

	if (loading) return <BillsSkeleton title={t.bills.title} />;

	if (!me?.loggedIn) {
		return <AuthGate title={t.bills.signedOutTitle} lede={t.bills.signedOutLede} />;
	}

	if (failed) {
		return (
		<section className={styles.failure}>
			<RefreshCw size={28} aria-hidden="true" />
			<h1>{t.bills.title}</h1>
			<p>{t.bills.loadFailed}</p>
			<button type="button" className="btn btn-primary" onClick={() => setAttempt(value => value + 1)}>
				{t.bills.retry}
			</button>
		</section>
		);
	}

	const monthly = activities.filter(activity => activity.kind === 'recurring');
	const oneOff = activities.filter(activity => (
		activity.kind !== 'recurring' && activity.summary?.moneyState !== 'none'
	));

	return (
		<div className={styles.page}>
			<header className={styles.hero}>
				<div>
					<p className={styles.eyebrow}>{t.bills.eyebrow}</p>
					<h1>{t.bills.title}</h1>
					<p className={styles.lede}>{t.bills.lede}</p>
				</div>
				<div className={styles.heroSummary} aria-label={t.bills.monthlyCount(monthly.length)}>
					<Repeat2 size={22} aria-hidden="true" />
					<strong>{fmt.number(monthly.length)}</strong>
					<span>{t.bills.monthlyTitle}</span>
				</div>
			</header>

			<section className={`${styles.group} ${styles.monthlyGroup}`}>
				<div className={styles.groupHead}>
					<div className={styles.groupTitle}>
						<span className={styles.iconBox}><Repeat2 size={20} aria-hidden="true" /></span>
						<div>
							<h2>{t.bills.monthlyTitle}</h2>
							<p>{t.bills.monthlyLede}</p>
						</div>
					</div>
					<span className={styles.count}>{t.bills.monthlyCount(monthly.length)}</span>
				</div>
				{monthly.length > 0 ? (
					<div className={styles.cardGrid}>
						{monthly.map(activity => (
							<BillCard key={activity.id} activity={activity} recurring t={t} fmt={fmt} />
						))}
					</div>
				) : <EmptyState icon={Repeat2} text={t.bills.emptyMonthly} />}
			</section>

			<section className={styles.group}>
				<div className={styles.groupHead}>
					<div className={styles.groupTitle}>
						<span className={styles.iconBox}><ReceiptText size={20} aria-hidden="true" /></span>
						<div>
							<h2>{t.bills.oneOffTitle}</h2>
							<p>{t.bills.oneOffLede}</p>
						</div>
					</div>
					<span className={styles.count}>{t.bills.oneOffCount(oneOff.length)}</span>
				</div>
				{oneOff.length > 0 ? (
					<div className={styles.cardGrid}>
						{oneOff.map(activity => (
							<BillCard key={activity.id} activity={activity} t={t} fmt={fmt} />
						))}
					</div>
				) : <EmptyState icon={ReceiptText} text={t.bills.emptyOneOff} />}
			</section>

			<div className={styles.bottomRow}>
				<div className={styles.guestNote}>
					<Users size={22} aria-hidden="true" />
					<div><strong>{t.bills.guestTitle}</strong><p>{t.bills.guestBody}</p></div>
				</div>
				<Link href="/activities" className={styles.createLink}>
					<CircleDollarSign size={19} aria-hidden="true" />
					{t.bills.newBill}
					<ArrowRight size={18} aria-hidden="true" />
				</Link>
			</div>
		</div>
	);
}

function BillCard({ activity, recurring = false, t, fmt }) {
	const summary = activity.summary || {};
	let status = t.bills.status.notStarted;
	let tone = '';

	if (summary.awaitingConfirmation > 0) {
		status = t.bills.status.awaiting(summary.awaitingConfirmation);
		tone = styles.due;
	}
	else if (summary.moneyState === 'open') {
		status = t.bills.status.outstanding(
			fmt.money(summary.outstandingSatang, activity.currency),
			summary.unpaidCount,
		);
		tone = styles.due;
	}
	else if (summary.moneyState === 'settled') {
		status = t.bills.status.settled;
		tone = styles.settled;
	}

	const detail = recurring
		? fmt.dueDay(activity.dueDay)
		: [fmt.when(activity.startsAt, { time: false }), activity.location].filter(Boolean).join(' · ');

	return (
		<Link href={`/a/${activity.code}`} className={`${styles.billCard} ${recurring ? styles.recurringCard : ''}`}>
			<span className={styles.cardTopline} />
			<div className={styles.cardHeading}>
				<span className={styles.cardIcon}>{recurring ? <Repeat2 size={18} /> : <ReceiptText size={18} />}</span>
				<span className={styles.kind}>{recurring ? t.bills.monthlyTitle : t.bills.oneOffTitle}</span>
			</div>
			<h3>{activity.title}</h3>
			<p className={styles.detail}>{detail || t.activity.notScheduled}</p>
			<div className={styles.cardFooter}>
				<span className={`${styles.status} ${tone}`}>{status}</span>
				<span className={styles.open}>{t.bills.open}<ArrowRight size={16} aria-hidden="true" /></span>
			</div>
		</Link>
	);
}

function EmptyState({ icon: Icon, text }) {
	return (
		<div className={styles.empty}>
			<Icon size={22} aria-hidden="true" />
			<p>{text}</p>
		</div>
	);
}

function BillsSkeleton({ title }) {
	return (
		<div className={styles.page} aria-busy="true">
			<header className={styles.hero}>
				<div><h1>{title}</h1><span className="skeleton-line" style={{ width: '30ch', marginTop: '.8rem' }} /></div>
			</header>
			{[0, 1].map(group => (
				<section className={styles.group} key={group}>
					<span className="skeleton-line" style={{ width: '12rem', height: '1.4rem' }} />
					<div className={styles.cardGrid}>
						{[0, 1].map(card => <span className={styles.skeletonCard} key={card} />)}
					</div>
				</section>
			))}
		</div>
	);
}
