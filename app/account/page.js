'use client';

import { useEffect, useMemo, useState } from 'react';
import LoginOptions from '../components/LoginOptions';
import MeguMark from '../components/MeguMark';
import { useCopy } from '../copy';

export default function AccountPage() {
	const { t, lang } = useCopy();
	const [data, setData] = useState(null);
	const [mode, setMode] = useState('off');
	const [saving, setSaving] = useState(false);
	const [notice, setNotice] = useState('');
	const load = () => fetch('/api/megu/me').then(response => response.json()).then(next => {
		setData(next);
		if (next.notificationPreferences) setMode(next.notificationPreferences.mode);
	});
	useEffect(() => {
		load().catch(() => setData({ loggedIn: false }));
		const result = new URLSearchParams(window.location.search).get('link');
		if (result === 'conflict') setNotice(t.account.linkConflict);
		if (result === 'success') setNotice(t.account.linkSuccess);
	}, [t.account.linkConflict, t.account.linkSuccess]);
	const providers = useMemo(() => new Set(data?.user?.identities?.map(identity => identity.provider) || []), [data]);
	const hasDiscord = providers.has('discord');
	const hasEmail = data?.user?.identities?.some(identity => identity.provider === 'google' && identity.emailVerified && identity.email);
	const choices = [
		{ id: 'discord', available: hasDiscord }, { id: 'email', available: hasEmail },
		{ id: 'both', available: hasDiscord && hasEmail }, { id: 'off', available: true },
	];
	if (!data) return <div className="center-screen"><MeguMark size={72} mood="asleep" /><p>{t.common.loading}</p></div>;
	if (!data.loggedIn) return <div className="center-screen account-signin"><MeguMark size={92} /><h1>{t.account.signInTitle}</h1><p className="quiet-note">{t.account.signInLede}</p><LoginOptions /></div>;

	async function savePreferences() {
		setSaving(true); setNotice('');
		const response = await fetch('/api/megu/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notificationMode: mode, notificationLocale: lang }) });
		const result = await response.json();
		setSaving(false); setNotice(response.ok ? t.account.saved : (t.errors[result.code] || t.errors.failed));
	}
	async function unlink(provider) {
		if (!window.confirm(t.account.unlinkConfirm(provider))) return;
		const response = await fetch(`/api/megu/me/identities/${provider}`, { method: 'DELETE' });
		const result = await response.json();
		if (!response.ok) return setNotice(t.errors[result.code] || t.errors.failed);
		await load(); setNotice(t.account.unlinked);
	}
	return <div className="account-page stack-lg">
		<header className="page-head"><div><h1>{t.account.title}</h1><p className="quiet-note">{t.account.lede}</p></div></header>
		{notice && <div className="account-notice" role="status">{notice}</div>}
		<section className="panel account-profile">{data.user.avatarUrl ? <img src={data.user.avatarUrl} alt="" className="account-avatar" /> : <MeguMark size={58} />}<div><h2>{data.user.displayName}</h2><p className="quiet-note">{t.account.profileHint}</p></div></section>
		<section className="panel stack-md"><div><h2>{t.account.connectedTitle}</h2><p className="quiet-note">{t.account.connectedHint}</p></div><div className="identity-list">
			{['google', 'discord'].map(provider => { const identity = data.user.identities.find(item => item.provider === provider); return <div className="identity-row" key={provider}><div><strong>{t.account.providers[provider]}</strong><span>{identity ? (identity.email || identity.username || t.account.connected) : t.account.notConnected}</span></div>{identity ? <button className="btn btn-ghost btn-sm" onClick={() => unlink(provider)} disabled={data.user.identities.length === 1}>{t.account.unlink}</button> : <a className="btn btn-secondary btn-sm" href={`/api/auth/${provider}/link`}>{t.account.connect}</a>}</div>; })}
		</div><p className="quiet-note">{t.account.noMergeNote}</p></section>
		<section className="panel stack-md"><div><h2>{t.account.notificationsTitle}</h2><p className="quiet-note">{t.account.notificationsHint}</p></div><div className="notification-grid" role="radiogroup" aria-label={t.account.notificationsTitle}>
			{choices.map(choice => <button key={choice.id} type="button" role="radio" aria-checked={mode === choice.id} disabled={!choice.available} className={`notification-choice ${mode === choice.id ? 'selected' : ''}`} onClick={() => setMode(choice.id)}><strong>{t.account.modes[choice.id]}</strong><span>{choice.available ? t.account.modeHints[choice.id] : t.account.connectFirst}</span></button>)}
		</div><div><button className="btn btn-primary" onClick={savePreferences} disabled={saving}>{saving ? t.common.saving : t.common.save}</button></div></section>
	</div>;
}
