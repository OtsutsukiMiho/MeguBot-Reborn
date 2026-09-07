'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
	ArrowLeft,
	Bot,
	CircleAlert,
	Crown,
	Hash,
	History,
	MessageSquareQuote,
	Mic2,
	MousePointer2,
	RefreshCw,
	Search,
	ShieldAlert,
	ShieldCheck,
	Sparkles,
	Tags,
	UserCog,
	UserPlus,
	UserRound,
	UsersRound,
	Volume2,
} from 'lucide-react';
import AuthGate from '../../components/AuthGate';
import WelcomeTab from '../../components/Tabs/WelcomeTab';
import AutoroleTab from '../../components/Tabs/AutoroleTab';
import RoleManagerTab from '../../components/Tabs/RoleManagerTab';
import MemberManagerTab from '../../components/Tabs/MemberManagerTab';
import NicknameManagerTab from '../../components/Tabs/NicknameManagerTab';
import VoiceTtsTab from '../../components/Tabs/VoiceTtsTab';
import HoneypotTab from '../../components/Tabs/HoneypotTab';
import AutomodTab from '../../components/Tabs/AutomodTab';
import ReactionRolesTab from '../../components/Tabs/ReactionRolesTab';
import AuditLogsTab from '../../components/Tabs/AuditLogsTab';
import EmbedCreatorTab from '../../components/Tabs/EmbedCreatorTab';
import AudioQueueTab from '../../components/Tabs/AudioQueueTab';
import PersonalSettingsTab from '../../components/Tabs/PersonalSettingsTab';
import CustomSelect from '../../components/CustomSelect';
import FloatingSaveBar from '../../components/FloatingSaveBar';
import Toast from '../../components/Toast';
import { useCopy } from '../../copy';
import styles from '../servers.module.css';

const TAB_DEFINITIONS = [
	{ id: 'personal', group: 'you', icon: UserRound },
	{ id: 'welcome', group: 'community', icon: Sparkles },
	{ id: 'autorole', group: 'community', icon: UserPlus },
	{ id: 'roles', group: 'community', icon: Tags },
	{ id: 'members', group: 'community', icon: UsersRound },
	{ id: 'nicknames', group: 'community', icon: UserCog },
	{ id: 'honeypot', group: 'safety', icon: ShieldAlert },
	{ id: 'automod', group: 'safety', icon: ShieldCheck },
	{ id: 'reactionroles', group: 'safety', icon: MousePointer2 },
	{ id: 'tts', group: 'voice', icon: Mic2 },
	{ id: 'audioqueue', group: 'voice', icon: Volume2 },
	{ id: 'embeds', group: 'tools', icon: MessageSquareQuote },
	{ id: 'audit', group: 'tools', icon: History },
];

const TAB_IDS = new Set(TAB_DEFINITIONS.map(tab => tab.id));
const GROUP_ORDER = ['you', 'community', 'safety', 'voice', 'tools'];

function guildIconUrl(guildId, icon) {
	if (!icon) return null;
	if (icon.startsWith('http://') || icon.startsWith('https://')) return icon;
	return `https://cdn.discordapp.com/icons/${guildId}/${icon}.${icon.startsWith('a_') ? 'gif' : 'png'}?size=128`;
}

export default function ServerConfigPage({ params }) {
	const { guildId } = use(params);
	const router = useRouter();
	const { t, fmt } = useCopy();
	const copy = t.servers;
	const [activeTab, setActiveTab] = useState('welcome');
	const [navQuery, setNavQuery] = useState('');
	const [guildData, setGuildData] = useState(null);
	const [activeGuilds, setActiveGuilds] = useState([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState('');
	const [saving, setSaving] = useState(false);
	const [toastMsg, setToastMsg] = useState(null);
	const [toastError, setToastError] = useState(false);
	const [iconFailed, setIconFailed] = useState(false);
	const [config, setConfig] = useState({});
	const [automod, setAutomod] = useState({});
	const [initialState, setInitialState] = useState(null);
	const [isDirty, setIsDirty] = useState(false);
	const [isForbidden, setIsForbidden] = useState(false);
	const [needLogin, setNeedLogin] = useState(false);

	const showToast = useCallback((message, isError = false) => {
		setToastMsg(message);
		setToastError(isError);
		window.setTimeout(() => setToastMsg(null), 3500);
	}, []);

	const fetchServerData = useCallback(async ({ quiet = false } = {}) => {
		if (!quiet) setLoading(true);
		setLoadError('');
		try {
			const response = await fetch(`/api/guilds/${guildId}`, { credentials: 'same-origin' });
			const data = await response.json().catch(() => ({}));
			if (response.status === 401) {
				setNeedLogin(true);
				return;
			}
			if (response.status === 403) {
				setIsForbidden(true);
				return;
			}
			if (!response.ok || !data.success) throw new Error(data.error || copy.loadServerFailed);

			setGuildData(data);
			setNeedLogin(false);
			setIsForbidden(false);
			setIconFailed(false);
			if (data.isAdmin === false) setActiveTab('personal');
			const nextConfig = data.config || {};
			const nextAutomod = nextConfig.automod || {};
			setConfig(nextConfig);
			setAutomod(nextAutomod);
			setInitialState(JSON.stringify({ cfg: nextConfig, am: nextAutomod }));
			setIsDirty(false);
			document.title = `${data.name || copy.fallbackServerName} | Megu`;
		}
		catch (error) {
			setLoadError(error.message || copy.loadServerFailed);
		}
		finally {
			setLoading(false);
		}
	}, [copy.fallbackServerName, copy.loadServerFailed, guildId]);

	useEffect(() => {
		const requestedTab = new URLSearchParams(window.location.search).get('tab');
		if (requestedTab && TAB_IDS.has(requestedTab)) setActiveTab(requestedTab);
		fetchServerData();

		fetch('/api/guilds', { credentials: 'same-origin' })
			.then(response => response.ok ? response.json() : null)
			.then(data => {
				if (data?.success && data.guilds) setActiveGuilds(data.guilds.filter(guild => guild.isBotInGuild));
			})
			.catch(() => undefined);
	}, [fetchServerData]);

	useEffect(() => {
		if (!initialState) return;
		setIsDirty(JSON.stringify({ cfg: config, am: automod }) !== initialState);
	}, [automod, config, initialState]);

	useEffect(() => {
		if (!isDirty) return;
		const warnBeforeLeaving = event => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener('beforeunload', warnBeforeLeaving);
		return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
	}, [isDirty]);

	const navigation = useMemo(() => TAB_DEFINITIONS.map(tab => ({
		...tab,
		label: copy.tabs[tab.id],
		description: copy.tabDescriptions[tab.id],
	})), [copy]);

	const filteredNavigation = useMemo(() => {
		const needle = navQuery.trim().toLocaleLowerCase();
		if (!needle) return navigation;
		return navigation.filter(tab => `${tab.label} ${tab.description}`.toLocaleLowerCase().includes(needle));
	}, [navQuery, navigation]);

	const activeDefinition = navigation.find(tab => tab.id === activeTab) || navigation[1];

	const handleConfigChange = (key, value) => setConfig(previous => ({ ...previous, [key]: value }));
	const handleAutomodChange = (key, value) => setAutomod(previous => ({ ...previous, [key]: value }));

	function selectTab(tabId) {
		if (!TAB_IDS.has(tabId)) return;
		setActiveTab(tabId);
		const url = new URL(window.location.href);
		url.searchParams.set('tab', tabId);
		window.history.replaceState({}, '', `${url.pathname}${url.search}`);
	}

	function canLeave() {
		return !isDirty || window.confirm(copy.leaveUnsaved);
	}

	function switchServer(nextGuildId) {
		if (!nextGuildId || String(nextGuildId) === String(guildId) || !canLeave()) return;
		router.push(`/servers/${nextGuildId}?tab=${activeTab}`);
	}

	async function handleSaveAll() {
		setSaving(true);
		try {
			const [configResponse, automodResponse] = await Promise.all([
				fetch(`/api/guilds/${guildId}/config`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(config),
				}),
				fetch(`/api/guilds/${guildId}/automod`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(automod),
				}),
			]);
			const configResult = await configResponse.json().catch(() => ({}));
			const automodResult = await automodResponse.json().catch(() => ({}));
			if (!configResponse.ok || !automodResponse.ok || !configResult.success || !automodResult.success) {
				throw new Error(configResult.error || automodResult.error || copy.saveFailed);
			}
			const confirmedConfig = { ...config, ...(configResult.config || {}) };
			setConfig(confirmedConfig);
			setInitialState(JSON.stringify({ cfg: confirmedConfig, am: automod }));
			setIsDirty(false);
			showToast(copy.settingsSaved);
		}
		catch (error) {
			showToast(error.message || copy.saveFailed, true);
		}
		finally {
			setSaving(false);
		}
	}

	function discardChanges() {
		if (!initialState) return;
		const snapshot = JSON.parse(initialState);
		setConfig(snapshot.cfg);
		setAutomod(snapshot.am);
		setIsDirty(false);
		showToast(copy.changesDiscarded);
	}

	if (loading) {
		return (
			<div className={styles.loadingState} aria-live="polite">
				<span className={styles.loadingGlyph}><RefreshCw size={26} /></span>
				<strong>{copy.loadingServer}</strong>
				<span>{copy.loadingServerLede}</span>
			</div>
		);
	}

	if (isForbidden) {
		return (
			<section className={styles.errorState}>
				<span className={styles.errorMark}><ShieldAlert size={28} /></span>
				<p className={styles.eyebrow}>{copy.workspaceEyebrow}</p>
				<h1>{copy.accessForbiddenTitle}</h1>
				<p>{copy.accessForbiddenLede}</p>
				<Link href="/servers" className="btn btn-primary"><ArrowLeft size={16} />{copy.backToServerSelector}</Link>
			</section>
		);
	}

	if (needLogin) return <AuthGate title={copy.signedOutTitle} lede={copy.signedOutLede} mood="asking" />;

	if (loadError || !guildData) {
		return (
			<section className={styles.errorState}>
				<span className={styles.errorMark}><CircleAlert size={28} /></span>
				<p className={styles.eyebrow}>{copy.workspaceEyebrow}</p>
				<h1>{copy.loadServerFailedTitle}</h1>
				<p>{loadError || copy.loadServerFailed}</p>
				<div className={styles.errorActions}>
					<button type="button" className="btn btn-primary" onClick={() => fetchServerData()}><RefreshCw size={16} />{copy.retry}</button>
					<Link href="/servers" className="btn btn-secondary">{copy.backToServerSelector}</Link>
				</div>
			</section>
		);
	}

	const channels = guildData.channels || [];
	const roles = guildData.roles || [];
	const members = guildData.members || [];
	const matchedGuild = activeGuilds.find(guild => String(guild.id) === String(guildId));
	const serverName = guildData.name || matchedGuild?.name || copy.fallbackServerName;
	const iconUrl = guildIconUrl(guildId, guildData.icon);
	const ActiveIcon = activeDefinition.icon;

	const tabPanel = (
		<>
			{activeTab === 'personal' && <PersonalSettingsTab guildId={guildId} serverName={serverName} initialChannels={channels} showToast={showToast} />}
			{activeTab === 'welcome' && <WelcomeTab config={config} channels={channels} onChange={handleConfigChange} serverName={serverName} />}
			{activeTab === 'autorole' && <AutoroleTab config={config} roles={roles} onChange={handleConfigChange} />}
			{activeTab === 'roles' && <RoleManagerTab roles={roles} guildId={guildId} showToast={showToast} onRefresh={() => fetchServerData({ quiet: true })} />}
			{activeTab === 'members' && <MemberManagerTab guildId={guildId} roles={roles} initialMembers={members} showToast={showToast} onRefresh={() => fetchServerData({ quiet: true })} />}
			{activeTab === 'nicknames' && <NicknameManagerTab guildId={guildId} initialMembers={members} showToast={showToast} onRefresh={() => fetchServerData({ quiet: true })} />}
			{activeTab === 'tts' && <VoiceTtsTab config={config} channels={channels} onChange={handleConfigChange} />}
			{activeTab === 'audioqueue' && <AudioQueueTab guildId={guildId} showToast={showToast} />}
			{activeTab === 'honeypot' && <HoneypotTab config={config} channels={channels} onChange={handleConfigChange} />}
			{activeTab === 'automod' && <AutomodTab automod={automod} onChange={handleAutomodChange} />}
			{activeTab === 'reactionroles' && <ReactionRolesTab guildId={guildId} reactionRoles={config.reaction_roles} roles={roles} channels={channels} onRefresh={() => fetchServerData({ quiet: true })} showToast={showToast} />}
			{activeTab === 'audit' && <AuditLogsTab guildId={guildId} />}
			{activeTab === 'embeds' && <EmbedCreatorTab currentGuildId={guildId} activeGuilds={activeGuilds} channels={channels} showToast={showToast} />}
		</>
	);

	return (
		<div className={styles.detailPage}>
			{toastMsg && <Toast message={toastMsg} isError={toastError} onClose={() => setToastMsg(null)} />}

			<header className={styles.detailHeader}>
				<Link href="/servers" className={styles.backLink} onClick={event => { if (!canLeave()) event.preventDefault(); }}>
					<ArrowLeft size={15} />{copy.backToServerList}
				</Link>
				{activeGuilds.length > 1 && (
					<div className={styles.serverSwitcher}>
						<span>{copy.quickSwitch}</span>
						<div className={styles.serverSwitchControl}>
							<CustomSelect
								value={guildId}
								onChange={switchServer}
								options={activeGuilds.map(guild => ({
									value: guild.id,
									label: guild.name,
									badge: guild.owner ? copy.owner : guild.isAdmin ? copy.manager : copy.member,
								}))}
								placeholder={copy.quickSwitch}
								searchable={activeGuilds.length > 5}
							/>
						</div>
					</div>
				)}
			</header>

			<section className={styles.serverHero}>
				<div className={styles.heroIdentity}>
					{!iconFailed && iconUrl
						? <img src={iconUrl} alt="" onError={() => setIconFailed(true)} />
						: <span className={styles.heroAvatarFallback}>{serverName.substring(0, 2).toUpperCase()}</span>}
					<div>
						<p className={styles.eyebrow}>{guildData.isAdmin ? copy.adminWorkspace : copy.memberWorkspace}</p>
						<div className={styles.serverTitleRow}>
							<h1>{serverName}</h1>
							<span className={`${styles.badge} ${guildData.isOwner ? styles.ownerBadge : guildData.isAdmin ? styles.managerBadge : ''}`}>
								{guildData.isOwner ? <Crown size={12} /> : guildData.isAdmin ? <ShieldCheck size={12} /> : <UserRound size={12} />}
								{guildData.isOwner ? copy.owner : guildData.isAdmin ? copy.manager : copy.member}
							</span>
						</div>
						<p className={styles.serverId}><Hash size={13} />{guildId}</p>
					</div>
				</div>
				<div className={styles.heroStatus}>
					<span className={guildData.isBotInGuild ? styles.readyBadge : styles.unknownBadge}><Bot size={14} />{guildData.isBotInGuild ? copy.meguConnected : copy.meguUnavailable}</span>
				</div>
			</section>

			{guildData.isAdmin && (
				<dl className={styles.serverFacts}>
					<div><dt>{copy.channelsLabel}</dt><dd>{fmt.number(channels.length)}</dd></div>
					<div><dt>{copy.rolesLabel}</dt><dd>{fmt.number(roles.length)}</dd></div>
					<div><dt>{copy.membersLabel}</dt><dd>{fmt.number(members.length)}</dd></div>
					<div><dt>{copy.workspaceStatusLabel}</dt><dd className={isDirty ? styles.unsavedText : styles.savedText}>{isDirty ? copy.unsavedShort : copy.savedShort}</dd></div>
				</dl>
			)}

			{guildData.isAdmin === false ? (
				<section className={styles.memberPanel}>
					<div className={styles.memberIntro}>
						<span><UserRound size={20} /></span>
						<div><p className={styles.sectionKicker}>{copy.personalEyebrow}</p><h2>{copy.personalWorkspaceTitle}</h2><p>{copy.personalWorkspaceLede}</p></div>
					</div>
					<div className={styles.tabContent}>{tabPanel}</div>
				</section>
			) : (
				<div className={styles.configWorkspace}>
					<aside className={styles.toolNav} aria-label={copy.navigationLabel}>
						<div className={styles.toolNavHeader}>
							<p className={styles.sectionKicker}>{copy.toolsEyebrow}</p>
							<strong>{copy.toolsTitle}</strong>
							<label className={styles.toolSearch}>
								<Search size={15} />
								<span className={styles.srOnly}>{copy.searchToolsLabel}</span>
								<input value={navQuery} onChange={event => setNavQuery(event.target.value)} placeholder={copy.searchToolsPlaceholder} />
							</label>
						</div>
						<nav>
							{GROUP_ORDER.map(group => {
								const tabs = filteredNavigation.filter(tab => tab.group === group);
								if (!tabs.length) return null;
								return (
									<div className={styles.navGroup} key={group}>
										<span>{copy.tabGroups[group]}</span>
										{tabs.map(tab => {
											const Icon = tab.icon;
											return <button type="button" key={tab.id} className={activeTab === tab.id ? styles.activeTool : ''} aria-current={activeTab === tab.id ? 'page' : undefined} onClick={() => selectTab(tab.id)}><Icon size={16} /><span>{tab.label}</span></button>;
										})}
									</div>
								);
							})}
							{filteredNavigation.length === 0 && <p className={styles.noTools}>{copy.noToolsFound}</p>}
						</nav>
					</aside>

					<label className={styles.mobileToolSelect}>
						<span>{copy.currentToolLabel}</span>
						<select value={activeTab} onChange={event => selectTab(event.target.value)}>
							{GROUP_ORDER.map(group => <optgroup label={copy.tabGroups[group]} key={group}>{navigation.filter(tab => tab.group === group).map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}</optgroup>)}
						</select>
					</label>

					<section className={styles.toolPanel} aria-labelledby="active-server-tool">
						<header className={styles.toolPanelHeader}>
							<span className={styles.toolIcon}><ActiveIcon size={20} /></span>
							<div><p className={styles.sectionKicker}>{copy.tabGroups[activeDefinition.group]}</p><h2 id="active-server-tool">{activeDefinition.label}</h2><p>{activeDefinition.description}</p></div>
							{isDirty && activeTab !== 'personal' && <span className={styles.unsavedBadge}>{copy.unsavedShort}</span>}
						</header>
						<div className={styles.tabContent} key={activeTab}>{tabPanel}</div>
					</section>
				</div>
			)}

			{isDirty && activeTab !== 'personal' && guildData.isAdmin !== false && (
				<FloatingSaveBar onSave={handleSaveAll} onDiscard={discardChanges} saving={saving} />
			)}
		</div>
	);
}
