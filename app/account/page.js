'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	BellOff,
	BellRing,
	Check,
	CircleAlert,
	CreditCard,
	Link2,
	Mail,
	MessageCircle,
	PencilLine,
	RefreshCw,
	ShieldCheck,
	UserRound,
} from 'lucide-react';
import AuthGate from '../components/AuthGate';
import MeguMark from '../components/MeguMark';
import PaymentMethods from '../components/PaymentMethods';
import { useCopy } from '../copy';
import styles from './account.module.css';

const MODE_ICONS = {
	discord: MessageCircle,
	email: Mail,
	both: BellRing,
	off: BellOff,
};

export default function AccountPage() {
	const { t, lang } = useCopy();
	const [data, setData] = useState(null);
	const [mode, setMode] = useState('off');
	const [savedMode, setSavedMode] = useState('off');
	const [savedLocale, setSavedLocale] = useState('en');
	const [saving, setSaving] = useState(false);
	const [savingProfile, setSavingProfile] = useState(false);
	const [notice, setNotice] = useState(null);

	const load = useCallback((syncNotifications = true) => fetch('/api/megu/me', { credentials: 'same-origin' })
		.then(response => response.json())
		.then(next => {
			setData(next);
			if (syncNotifications && next.notificationPreferences) {
				setMode(next.notificationPreferences.mode);
				setSavedMode(next.notificationPreferences.mode);
				setSavedLocale(next.notificationPreferences.locale);
			}
			return next;
		}), []);

	useEffect(() => {
		load().catch(() => setData({ loggedIn: false }));
		const params = new URLSearchParams(window.location.search);
		const result = params.get('link');
		if (result === 'conflict') setNotice({ message: t.account.linkConflict, tone: 'error' });
		if (result === 'success') setNotice({ message: t.account.linkSuccess, tone: 'success' });
		if (params.get('merge') === 'done') setNotice({ message: t.account.merge.done, tone: 'success' });
	}, [load, t.account.linkConflict, t.account.linkSuccess, t.account.merge.done]);

	const identities = useMemo(() => data?.user?.identities || [], [data]);
	const providers = useMemo(() => new Set(identities.map(identity => identity.provider)), [identities]);
	const hasDiscord = providers.has('discord');
	const hasEmail = identities.some(identity => identity.provider === 'google' && identity.emailVerified && identity.email);
	const choices = [
		{ id: 'discord', available: hasDiscord },
		{ id: 'email', available: hasEmail },
		{ id: 'both', available: hasDiscord && hasEmail },
		{ id: 'off', available: true },
	];
	const notificationDirty = mode !== savedMode || lang !== savedLocale;

	if (!data) {
		return (
			<div className={styles.loadingPage} aria-live="polite">
				<div className={styles.loadingRail} />
				<div className={styles.loadingContent}>
					<span /><span /><span />
					<p>{t.common.loading}</p>
				</div>
			</div>
		);
	}
	if (!data.loggedIn) return <AuthGate />;

	async function savePreferences() {
		setSaving(true);
		setNotice(null);
		try {
			const response = await fetch('/api/megu/me', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({ notificationMode: mode, notificationLocale: lang }),
			});
			const result = await response.json().catch(() => ({}));
			if (!response.ok) {
				setNotice({ message: t.errors[result.code] || t.errors.failed, tone: 'error' });
				return;
			}
			setSavedMode(mode);
			setSavedLocale(lang);
			setNotice({ message: t.account.saved, tone: 'success' });
		}
		catch {
			setNotice({ message: t.errors.offline || t.errors.failed, tone: 'error' });
		}
		finally {
			setSaving(false);
		}
	}

	async function saveProfileSource(source) {
		if (source === data.user.profileSource || savingProfile) return;
		setSavingProfile(true);
		setNotice(null);
		try {
			const response = await fetch('/api/megu/me', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({ profileSource: source }),
			});
			const result = await response.json().catch(() => ({}));
			if (!response.ok) {
				setNotice({ message: t.errors[result.code] || t.errors.failed, tone: 'error' });
				return;
			}
			await load(false);
			setNotice({ message: t.account.profileSourceSaved, tone: 'success' });
		}
		catch {
			setNotice({ message: t.errors.offline || t.errors.failed, tone: 'error' });
		}
		finally {
			setSavingProfile(false);
		}
	}

	async function unlink(provider) {
		if (!window.confirm(t.account.unlinkConfirm(provider))) return;
		setNotice(null);
		try {
			const response = await fetch(`/api/megu/me/identities/${provider}`, {
				method: 'DELETE',
				credentials: 'same-origin',
			});
			const result = await response.json().catch(() => ({}));
			if (!response.ok) {
				setNotice({ message: t.errors[result.code] || t.errors.failed, tone: 'error' });
				return;
			}
			await load();
			setNotice({ message: t.account.unlinked, tone: 'success' });
		}
		catch {
			setNotice({ message: t.errors.offline || t.errors.failed, tone: 'error' });
		}
	}

	const discordIdentity = identities.find(identity => identity.provider === 'discord');
	const profileSources = [
		{ id: 'discord', icon: RefreshCw },
		{ id: 'manual', icon: PencilLine },
	];
	const NoticeIcon = notice?.tone === 'error' ? CircleAlert : Check;

	return (
		<div className={styles.accountPage}>
			<aside className={styles.accountRail}>
				<div className={styles.identityCard}>
					<div className={styles.avatarWrap}>
						{data.user.avatarUrl
							? <img src={data.user.avatarUrl} alt="" className={styles.avatar} />
							: <MeguMark size={72} />}
						<span className={styles.onlineDot} aria-hidden="true" />
					</div>
					<p className={styles.accountEyebrow}>{t.account.eyebrow}</p>
					<h2>{data.user.displayName}</h2>
					<div className={styles.connectionState}>
						<ShieldCheck size={15} aria-hidden="true" />
						<span>{hasDiscord ? `${t.account.providers.discord} · ${t.account.connected}` : t.account.notConnected}</span>
					</div>
				</div>

				<nav className={styles.sectionNav} aria-label={t.account.title}>
					<a href="#profile"><UserRound size={17} aria-hidden="true" /><span>{t.account.profileSourceTitle}</span></a>
					<a href="#payments"><CreditCard size={17} aria-hidden="true" /><span>{t.paymentMethods.accountTitle}</span></a>
					<a href="#notifications"><BellRing size={17} aria-hidden="true" /><span>{t.account.notificationsTitle}</span></a>
				</nav>
			</aside>

			<div className={styles.accountMain}>
				<header className={styles.pageHeader}>
					<p className={styles.kicker}>{t.account.title}</p>
					<h1>{data.user.displayName}</h1>
					<p>{t.account.lede}</p>
				</header>

				{notice && (
					<div className={`${styles.notice} ${notice.tone === 'error' ? styles.noticeError : ''}`} role="status">
						<NoticeIcon size={18} aria-hidden="true" />
						<span>{notice.message}</span>
					</div>
				)}

				<section className={styles.accountSection} id="profile" aria-labelledby="profile-title">
					<div className={styles.sectionHeading}>
						<span className={styles.sectionIndex}>01</span>
						<div>
							<h2 id="profile-title">{t.account.profileSourceTitle}</h2>
							<p>{t.account.profileSourceHint}</p>
						</div>
					</div>

					<div className={styles.settingGroup}>
						<div className={styles.settingLabel}>
							<Link2 size={18} aria-hidden="true" />
							<div><strong>{t.account.connectedTitle}</strong><span>{t.account.connectedHint}</span></div>
						</div>
						<div className={styles.identityRow}>
							<div className={styles.providerMark}><MessageCircle size={21} aria-hidden="true" /></div>
							<div className={styles.identityDetails}>
								<strong>{t.account.providers.discord}</strong>
								<span>{discordIdentity ? (discordIdentity.email || discordIdentity.username || t.account.connected) : t.account.notConnected}</span>
							</div>
							{discordIdentity
								? <div className={styles.identityAction}>
									<button className="btn btn-ghost btn-sm" onClick={() => unlink('discord')} disabled={identities.length === 1}>{t.account.unlink}</button>
									{identities.length === 1 && <small>{t.account.lastIdentityHint}</small>}
								</div>
								: <a className="btn btn-secondary btn-sm" href="/api/auth/discord/link">{t.account.connect}</a>}
						</div>
					</div>

					<div className={styles.settingGroup}>
						<div className={styles.settingLabel}>
							<UserRound size={18} aria-hidden="true" />
							<div><strong>{t.account.profileSourceTitle}</strong><span>{t.account.profileHint}</span></div>
						</div>
						<div className={styles.choiceGrid} role="radiogroup" aria-label={t.account.profileSourceTitle}>
							{profileSources.map(source => {
								const available = source.id === 'manual' || providers.has(source.id);
								const selected = data.user.profileSource === source.id;
								const SourceIcon = source.icon;
								return (
									<button
										key={source.id}
										type="button"
										role="radio"
										aria-checked={selected}
										disabled={!available || savingProfile}
										className={`${styles.choice} ${selected ? styles.selected : ''}`}
										onClick={() => saveProfileSource(source.id)}
									>
										<span className={styles.choiceIcon}><SourceIcon size={18} aria-hidden="true" /></span>
										<span className={styles.choiceCopy}>
											<strong>{t.account.profileSources[source.id]}</strong>
											<small>{available ? (identities.find(item => item.provider === source.id)?.displayName || t.account.profileHint) : t.account.connectFirst}</small>
										</span>
										<span className={styles.radioMark}>{selected && <Check size={14} aria-hidden="true" />}</span>
									</button>
								);
							})}
						</div>
					</div>
				</section>

				<section className={styles.accountSection} id="payments" aria-labelledby="payments-title">
					<div className={styles.sectionHeading}>
						<span className={styles.sectionIndex}>02</span>
						<div>
							<h2 id="payments-title">{t.paymentMethods.accountTitle}</h2>
							<p>{t.paymentMethods.accountHint}</p>
						</div>
					</div>
					<div className={styles.paymentWorkspace}><PaymentMethods /></div>
				</section>

				<section className={styles.accountSection} id="notifications" aria-labelledby="notifications-title">
					<div className={styles.sectionHeading}>
						<span className={styles.sectionIndex}>03</span>
						<div>
							<h2 id="notifications-title">{t.account.notificationsTitle}</h2>
							<p>{t.account.notificationsHint}</p>
						</div>
					</div>
					<div className={styles.choiceGrid} role="radiogroup" aria-label={t.account.notificationsTitle}>
						{choices.map(choice => {
							const ChoiceIcon = MODE_ICONS[choice.id];
							const selected = mode === choice.id;
							return (
								<button
									key={choice.id}
									type="button"
									role="radio"
									aria-checked={selected}
									disabled={!choice.available}
									className={`${styles.choice} ${selected ? styles.selected : ''}`}
									onClick={() => setMode(choice.id)}
								>
									<span className={styles.choiceIcon}><ChoiceIcon size={18} aria-hidden="true" /></span>
									<span className={styles.choiceCopy}>
										<strong>{t.account.modes[choice.id]}</strong>
										<small>{choice.available ? t.account.modeHints[choice.id] : t.account.connectFirst}</small>
									</span>
									<span className={styles.radioMark}>{selected && <Check size={14} aria-hidden="true" />}</span>
								</button>
							);
						})}
					</div>
					<div className={styles.saveRow}>
						<p>{notificationDirty ? t.account.unsaved : t.account.savedState}</p>
						<button className="btn btn-primary" onClick={savePreferences} disabled={saving || !notificationDirty}>
							{saving ? t.common.saving : t.common.save}
						</button>
					</div>
				</section>
			</div>
		</div>
	);
}
