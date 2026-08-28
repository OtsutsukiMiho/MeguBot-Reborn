'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import MeguMark from '../components/MeguMark';
import { useCopy } from '../copy';

function guildIconUrl(g) {
	if (!g?.icon) return null;
	if (g.icon.startsWith('http')) return g.icon;
	const ext = g.icon.startsWith('a_') ? 'gif' : 'png';
	return `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.${ext}?size=128`;
}

function guildBannerUrl(g) {
	const art = g?.banner || g?.splash;
	if (!art) return null;
	if (art.startsWith('http')) return art;
	const kind = g.banner ? 'banners' : 'splashes';
	const ext = art.startsWith('a_') ? 'gif' : 'png';
	return `https://cdn.discordapp.com/${kind}/${g.id}/${art}.${ext}?size=512`;
}

// A server with no artwork still needs its card to be distinguishable at a
// glance. The id picks the tint, so the same server keeps the same one.
function guildTint(guildId) {
	let sum = 0;
	for (let i = 0; i < guildId.length; i++) sum += guildId.charCodeAt(i);
	const hue = (sum * 47) % 360;
	return `linear-gradient(135deg, hsl(${hue} 32% 62%), hsl(${(hue + 40) % 360} 30% 46%))`;
}

function ServerCardAvatar({ guild }) {
	const [failed, setFailed] = useState(false);
	const url = guildIconUrl(guild);

	if (!failed && url) {
		return <img className="server-card-avatar" src={url} alt="" onError={() => setFailed(true)} />;
	}
	return (
		<div className="server-card-avatar" style={{ fontSize: '.85rem', fontWeight: 700 }}>
			{guild.name ? guild.name.substring(0, 2).toUpperCase() : '#'}
		</div>
	);
}

function ServerCard({ g, copy }) {
	// `fmt` rather than a `lang` prop: the member count is formatted by the
	// reader's locale, and asking the hook is one less thing to thread through.
	const { fmt } = useCopy();
	const banner = guildBannerUrl(g);

	return (
		<div className="server-card">
			<div
				className="server-card-banner"
				style={banner
					? { backgroundImage: `url(${banner})`, backgroundSize: 'cover', backgroundPosition: 'center' }
					: { background: guildTint(g.id) }}
			/>

			{/* Three states, not two: in the server, not in it, and — when the bot
			    process cannot be reached — genuinely unknown. Showing "ยังไม่มี Megu"
			    for the third one tells the admin something false about their server. */}
			<div className="server-card-badges">
				<span className="server-role-badge">{g.owner ? copy.owner : copy.manager}</span>
				{g.isBotInGuild === null
					? <span className="server-status-badge">{copy.unknown}</span>
					: g.isBotInGuild
						? <span className="server-status-badge status-online"><span className="status-dot" />{copy.ready}</span>
						: <span className="server-status-badge status-offline">{copy.notInstalled}</span>}
			</div>

			<div className="server-card-avatar-wrapper">
				<ServerCardAvatar guild={g} />
			</div>

			<div className="server-card-body">
				<div className="server-card-title" title={g.name}>{g.name}</div>
				<div className="server-card-details">
					{typeof g.memberCount === 'number'
						? copy.members(fmt.number(g.memberCount), g.id)
						: `ID ${g.id}`}
				</div>
			</div>

			{/* Never offer an invite on an unverified server — the whole point of
			    this state is that we do not know whether Megu is already in it. */}
			<div className="server-card-footer">
				{g.isBotInGuild === false
					? <a href={g.inviteUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm server-card-btn">{copy.invite}</a>
					: <Link href={`/servers/${g.id}`} className="btn btn-primary btn-sm server-card-btn">{copy.configure}</Link>}
			</div>
		</div>
	);
}

export default function ServersPage() {
	const { t, lang } = useCopy();
	const copy = t.servers;
	const [loggedIn, setLoggedIn] = useState(null);
	const [guilds, setGuilds] = useState([]);
	const [botOnline, setBotOnline] = useState(true);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		fetch('/api/guilds', { credentials: 'same-origin' })
			.then(r => {
				if (r.status === 401) {
					setLoggedIn(false);
					return null;
				}
				setLoggedIn(true);
				return r.ok ? r.json() : null;
			})
			.then(data => {
				if (data) setBotOnline(data.botOnline !== false);
				if (data?.guilds) {
					setGuilds([...data.guilds].sort((a, b) => {
						if (a.isBotInGuild !== b.isBotInGuild) return a.isBotInGuild ? -1 : 1;
						return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
					}));
				}
			})
			.catch(() => {})
			.finally(() => setLoading(false));
	}, []);

	if (loading) {
		return (
			<div className="center-screen">
				<MeguMark size={72} mood="asleep" />
				<p className="quiet-note">{t.common.loading}</p>
			</div>
		);
	}

	if (loggedIn === false) {
		return (
			<div className="center-screen">
				<MeguMark size={110} />
				<h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.9rem, 5vw, 2.8rem)', letterSpacing: '-.03em' }}>
					{copy.signedOutTitle}
				</h1>
				<p className="quiet-note" style={{ maxWidth: '42ch' }}>
					{copy.signedOutLede}
				</p>
				<a href="/api/auth/login" className="btn btn-primary btn-lg">{t.nav.signIn}</a>
			</div>
		);
	}

	const active = guilds.filter(g => g.isBotInGuild === true);
	const missing = guilds.filter(g => g.isBotInGuild === false);

	return (
		<div className="stack-lg">
			<header className="page-head rise">
				<h1>{copy.title}</h1>
				<div className="page-meta">
					{botOnline
						? <>
							<span>{copy.activeCount(active.length)}</span>
							{missing.length > 0 && <span>{copy.missingCount(missing.length)}</span>}
						</>
						: <span>{copy.managedCount(guilds.length)}</span>}
				</div>
			</header>

			{!botOnline && (
				<div className="notice rise">
					<strong>{copy.statusUnavailableTitle}</strong> — {copy.statusUnavailableBody}
					<br />
					{copy.statusUnavailableHelpBefore} <code>backend/web/web.js</code> {copy.statusUnavailableHelpMiddle} <code>npm run dev</code> {copy.statusUnavailableHelpAfter}
				</div>
			)}

			{guilds.length === 0
				? (
					<section className="panel rise rise-2">
						<p className="quiet-note">
							{copy.empty}
						</p>
					</section>
				)
				: (
					<div className="server-grid rise rise-2">
						{guilds.map(g => <ServerCard key={g.id} g={g} copy={copy} />)}
					</div>
				)}
		</div>
	);
}
