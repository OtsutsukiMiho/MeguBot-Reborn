'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
	ArrowUpRight,
	Bot,
	CircleAlert,
	Crown,
	RefreshCw,
	Search,
	Settings2,
	ShieldCheck,
	Sparkles,
	UserRound,
	UsersRound,
} from 'lucide-react';
import AuthGate from '../components/AuthGate';
import MeguMark from '../components/MeguMark';
import { useCopy } from '../copy';
import styles from './servers.module.css';

function guildIconUrl(guild) {
	if (!guild?.icon) return null;
	if (guild.icon.startsWith('http')) return guild.icon;
	const extension = guild.icon.startsWith('a_') ? 'gif' : 'png';
	return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${extension}?size=128`;
}

function guildBannerUrl(guild) {
	const artwork = guild?.banner || guild?.splash;
	if (!artwork) return null;
	if (artwork.startsWith('http')) return artwork;
	const kind = guild.banner ? 'banners' : 'splashes';
	const extension = artwork.startsWith('a_') ? 'gif' : 'png';
	return `https://cdn.discordapp.com/${kind}/${guild.id}/${artwork}.${extension}?size=512`;
}

function guildTint(guildId = '') {
	let sum = 0;
	for (let index = 0; index < guildId.length; index += 1) sum += guildId.charCodeAt(index);
	const hue = (sum * 47) % 360;
	return `linear-gradient(135deg, hsl(${hue} 30% 58%), hsl(${(hue + 42) % 360} 28% 38%))`;
}

function ServerAvatar({ guild, className }) {
	const [failed, setFailed] = useState(false);
	const url = guildIconUrl(guild);

	if (!failed && url) {
		return <img className={className} src={url} alt="" onError={() => setFailed(true)} />;
	}

	return (
		<span className={`${className} ${styles.avatarFallback}`} aria-hidden="true">
			{guild.name ? guild.name.substring(0, 2).toUpperCase() : '#'}
		</span>
	);
}

function PermissionBadge({ guild, copy }) {
	if (guild.owner) return <span className={`${styles.badge} ${styles.ownerBadge}`}><Crown size={12} />{copy.owner}</span>;
	if (guild.isAdmin) return <span className={`${styles.badge} ${styles.managerBadge}`}><ShieldCheck size={12} />{copy.manager}</span>;
	return <span className={styles.badge}><UserRound size={12} />{copy.member}</span>;
}

function PresenceBadge({ guild, copy }) {
	if (guild.isBotInGuild === null) {
		return <span className={`${styles.badge} ${styles.unknownBadge}`}><CircleAlert size={12} />{copy.unknown}</span>;
	}
	if (guild.isBotInGuild) {
		return <span className={`${styles.badge} ${styles.readyBadge}`}><span className={styles.statusDot} />{copy.ready}</span>;
	}
	return <span className={`${styles.badge} ${styles.missingBadge}`}><Bot size={12} />{copy.notInstalled}</span>;
}

function ServerCard({ guild, copy, formatNumber }) {
	const banner = guildBannerUrl(guild);
	const destination = guild.isBotInGuild === false ? guild.inviteUrl : `/servers/${guild.id}`;
	const actionLabel = guild.isBotInGuild === false
		? copy.invite
		: guild.isAdmin ? copy.configure : copy.mySettings;
	const ActionIcon = guild.isBotInGuild === false ? ArrowUpRight : guild.isAdmin ? Settings2 : UserRound;
	const actionTone = guild.isBotInGuild === false
		? styles.cardActionInvite
		: guild.isAdmin ? styles.cardActionWorkspace : styles.cardActionPersonal;

	const card = (
		<article className={styles.serverCard}>
			<div
				className={styles.serverArtwork}
				style={banner
					? { backgroundImage: `linear-gradient(180deg, transparent 20%, rgba(7, 9, 15, .68)), url(${banner})` }
					: { backgroundImage: `linear-gradient(180deg, transparent 20%, rgba(7, 9, 15, .52)), ${guildTint(String(guild.id))}` }}
			>
				<div className={styles.cardBadges}>
					<PermissionBadge guild={guild} copy={copy} />
					<PresenceBadge guild={guild} copy={copy} />
				</div>
			</div>

			<div className={styles.serverIdentity}>
				<ServerAvatar guild={guild} className={styles.serverAvatar} />
				<div>
					<h2 title={guild.name}>{guild.name}</h2>
					<p>{typeof guild.memberCount === 'number'
						? copy.members(formatNumber(guild.memberCount))
						: copy.serverId(guild.id)}</p>
				</div>
			</div>

			<div className={styles.serverCardFooter}>
				<p>{guild.isBotInGuild === false
					? copy.inviteHint
					: guild.isAdmin ? copy.configureHint : copy.personalHint}</p>
				<span className={`${styles.cardAction} ${actionTone}`}>{actionLabel}<ActionIcon size={15} /></span>
			</div>
		</article>
	);

	const label = `${actionLabel}: ${guild.name}`;
	return guild.isBotInGuild === false ? (
		<a href={destination} target="_blank" rel="noreferrer" className={styles.serverCardLink} aria-label={label}>{card}</a>
	) : (
		<Link href={destination} className={styles.serverCardLink} aria-label={label}>{card}</Link>
	);
}

export default function ServersPage() {
	const { t, fmt } = useCopy();
	const copy = t.servers;
	const [denial, setDenial] = useState(null);
	const [guilds, setGuilds] = useState([]);
	const [filter, setFilter] = useState('all');
	const [query, setQuery] = useState('');
	const [botOnline, setBotOnline] = useState(true);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState('');

	const loadGuilds = useCallback(async () => {
		setLoading(true);
		setLoadError('');
		try {
			const response = await fetch('/api/guilds', { credentials: 'same-origin' });
			const body = await response.json().catch(() => ({}));
			if (response.status === 401) {
				setDenial(body.reason || 'signed-out');
				return;
			}
			if (!response.ok || !body.success) throw new Error(body.error || copy.loadFailed);
			setDenial(null);
			setBotOnline(body.botOnline !== false);
			setGuilds([...(body.guilds || [])].sort((left, right) => {
				if (left.isBotInGuild !== right.isBotInGuild) return left.isBotInGuild ? -1 : 1;
				if (left.isAdmin !== right.isAdmin) return left.isAdmin ? -1 : 1;
				return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
			}));
		}
		catch (error) {
			setLoadError(error.message || copy.loadFailed);
		}
		finally {
			setLoading(false);
		}
	}, [copy.loadFailed]);

	useEffect(() => { loadGuilds(); }, [loadGuilds]);

	const counts = useMemo(() => ({
		active: guilds.filter(guild => guild.isBotInGuild === true).length,
		missing: guilds.filter(guild => guild.isBotInGuild === false).length,
		manageable: guilds.filter(guild => guild.isAdmin).length,
		member: guilds.filter(guild => !guild.isAdmin).length,
	}), [guilds]);

	const displayedGuilds = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase();
		return guilds.filter(guild => {
			if (filter === 'manageable' && !guild.isAdmin) return false;
			if (filter === 'member' && guild.isAdmin) return false;
			if (filter === 'needs-megu' && guild.isBotInGuild !== false) return false;
			if (!needle) return true;
			return guild.name.toLocaleLowerCase().includes(needle) || String(guild.id).includes(needle);
		});
	}, [filter, guilds, query]);

	if (loading) {
		return (
			<div className={styles.loadingState} aria-live="polite">
				<MeguMark size={72} mood="asleep" />
				<strong>{copy.loadingServers}</strong>
				<span>{copy.loadingServersLede}</span>
			</div>
		);
	}

	if (denial) {
		const gate = {
			'signed-out': { title: copy.signedOutTitle, lede: copy.signedOutLede, action: t.nav.signIn, href: '/api/auth/login' },
			'discord-not-linked': { title: copy.discordNeededTitle, lede: copy.discordNeededLede, action: copy.discordNeededAction, href: '/api/auth/discord/link' },
			'discord-reconnect': { title: copy.discordExpiredTitle, lede: copy.discordExpiredLede, action: copy.discordExpiredAction, href: '/api/auth/discord/link' },
		}[denial] || { title: copy.signedOutTitle, lede: copy.signedOutLede, action: t.nav.signIn, href: '/api/auth/login' };

		return <AuthGate title={gate.title} lede={gate.lede} action={gate.action} href={gate.href} mood={denial === 'signed-out' ? 'calm' : 'asking'} />;
	}

	if (loadError) {
		return (
			<section className={styles.errorState}>
				<span className={styles.errorMark}><CircleAlert size={28} /></span>
				<p className={styles.eyebrow}>{copy.workspaceEyebrow}</p>
				<h1>{copy.loadFailedTitle}</h1>
				<p>{loadError}</p>
				<button type="button" className="btn btn-primary" onClick={loadGuilds}><RefreshCw size={16} />{copy.retry}</button>
			</section>
		);
	}

	const filterOptions = [
		{ id: 'all', label: copy.filterAll, count: guilds.length },
		{ id: 'manageable', label: copy.filterManageable, count: counts.manageable },
		{ id: 'member', label: copy.filterMember, count: counts.member },
		...(botOnline && counts.missing ? [{ id: 'needs-megu', label: copy.filterNeedsMegu, count: counts.missing }] : []),
	];

	return (
		<div className={styles.serversPage}>
			<header className={styles.listHeader}>
				<div>
					<p className={styles.eyebrow}>{copy.workspaceEyebrow}</p>
					<h1>{copy.title}</h1>
					<p className={styles.headerLede}>{copy.lede}</p>
				</div>
				<div className={styles.headerMark} aria-hidden="true"><MeguMark size={84} mood="happy" /></div>
			</header>

			<section className={styles.summaryRail} aria-label={copy.summaryLabel}>
				<div><span className={styles.summaryIcon}><Bot size={18} /></span><p><strong>{fmt.number(counts.active)}</strong>{copy.activeSummary}</p></div>
				<div><span className={styles.summaryIcon}><ShieldCheck size={18} /></span><p><strong>{fmt.number(counts.manageable)}</strong>{copy.manageableSummary}</p></div>
				<div><span className={styles.summaryIcon}><UsersRound size={18} /></span><p><strong>{fmt.number(guilds.length)}</strong>{copy.totalSummary}</p></div>
				<span className={`${styles.connectionState} ${botOnline ? styles.online : styles.unknown}`}>
					<span />{botOnline ? copy.botConnected : copy.botUnavailable}
				</span>
			</section>

			{!botOnline && (
				<div className={styles.notice} role="status">
					<CircleAlert size={19} />
					<div><strong>{copy.statusUnavailableTitle}</strong><p>{copy.statusUnavailableBody}</p></div>
				</div>
			)}

			<section className={styles.directory} aria-labelledby="server-directory-title">
				<div className={styles.directoryHeader}>
					<div>
						<p className={styles.sectionKicker}>{copy.directoryEyebrow}</p>
						<h2 id="server-directory-title">{copy.directoryTitle}</h2>
					</div>
					<label className={styles.searchField}>
						<Search size={17} aria-hidden="true" />
						<span className={styles.srOnly}>{copy.searchLabel}</span>
						<input value={query} onChange={event => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} />
						{query && <button type="button" onClick={() => setQuery('')} aria-label={copy.clearSearch}>×</button>}
					</label>
				</div>

				<div className={styles.filters} role="group" aria-label={copy.filterLabel}>
					{filterOptions.map(option => (
						<button
							type="button"
							key={option.id}
							className={filter === option.id ? styles.activeFilter : ''}
							aria-pressed={filter === option.id}
							onClick={() => setFilter(option.id)}
						>
							{option.label}<span>{fmt.number(option.count)}</span>
						</button>
					))}
				</div>

				{displayedGuilds.length ? (
					<div className={styles.serverGrid}>
						{displayedGuilds.map(guild => <ServerCard key={guild.id} guild={guild} copy={copy} formatNumber={fmt.number} />)}
					</div>
				) : (
					<div className={styles.emptyState}>
						<span><Sparkles size={22} /></span>
						<h3>{guilds.length ? copy.emptyFilteredTitle : copy.emptyTitle}</h3>
						<p>{guilds.length ? copy.emptyFilteredLede : copy.emptyLede}</p>
						{guilds.length > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setFilter('all'); setQuery(''); }}>{copy.clearFilters}</button>}
					</div>
				)}
			</section>
		</div>
	);
}
