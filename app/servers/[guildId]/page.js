'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
	ArrowLeft,
	Bot,
	CircleAlert,
	Info,
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
import { TabDialog } from '../../components/Tabs/TabWorkspace';
import { useCopy } from '../../copy';
import styles from '../servers.module.css';
const { emptyServerToolDrafts, getLocalDraftToolIds } = require('../../../core/server-dashboard-drafts');

const TAB_DEFINITIONS = [
	{ id: 'welcome', group: 'community', icon: Sparkles },
	{ id: 'autorole', group: 'community', icon: UserPlus },
	{ id: 'reactionroles', group: 'community', icon: MousePointer2 },
	{ id: 'members', group: 'people', icon: UsersRound },
	{ id: 'roles', group: 'people', icon: Tags },
	{ id: 'nicknames', group: 'people', icon: UserCog },
	{ id: 'honeypot', group: 'safety', icon: ShieldAlert },
	{ id: 'automod', group: 'safety', icon: ShieldCheck },
	{ id: 'tts', group: 'voice', icon: Mic2 },
	{ id: 'audioqueue', group: 'voice', icon: Volume2 },
	{ id: 'embeds', group: 'tools', icon: MessageSquareQuote },
	{ id: 'audit', group: 'tools', icon: History },
	{ id: 'personal', group: 'you', icon: UserRound },
];

const TAB_IDS = new Set(TAB_DEFINITIONS.map(tab => tab.id));
const GROUP_ORDER = ['community', 'people', 'safety', 'voice', 'tools', 'you'];

const CONFIG_TOOL_KEYS = {
	welcome: ['welcome_channel_id', 'welcome_message_template', 'welcome_mode', 'welcome_embed', 'leave_channel_id', 'leave_message_template', 'leave_mode', 'leave_embed'],
	autorole: ['autorole_id', 'autorole_ids', 'bot_autorole_ids'],
	tts: ['tts_channel_id', 'tts_engine', 'tts_lang', 'tts_voice', 'tts_ignore_prefix', 'tts_max_length', 'tts_antispam_enabled', 'tts_antispam_max_messages', 'tts_antispam_cooldown_seconds', 'tts_afk_bringback_enabled', 'tts_join_greeting_enabled', 'tts_join_greeting_text', 'tts_vc_welcome_enabled', 'tts_vc_welcome_template', 'tts_vc_leave_enabled', 'tts_vc_leave_template'],
	honeypot: ['honeypot_channel_id'],
};

function sameValue(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

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
	const copyRef = useRef(copy);
	copyRef.current = copy;
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
	const [saveError, setSaveError] = useState('');
	const [pendingNavigation, setPendingNavigation] = useState(null);
	const [pendingToolNavigation, setPendingToolNavigation] = useState(null);
	const [isForbidden, setIsForbidden] = useState(false);
	const [needLogin, setNeedLogin] = useState(false);
	const [toolDrafts, setToolDrafts] = useState(emptyServerToolDrafts);
	const [volatileEditorDirtyIds, setVolatileEditorDirtyIds] = useState(() => new Set());
	const handleEditorDirtyChange = useCallback((toolId, dirty) => {
		setVolatileEditorDirtyIds(current => {
			const next = new Set(current);
			if (dirty) next.add(toolId); else next.delete(toolId);
			return next.size === current.size && [...next].every(id => current.has(id)) ? current : next;
		});
	}, []);

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
				return false;
			}
			if (response.status === 403) {
				setIsForbidden(true);
				return false;
			}
			if (!response.ok || !data.success) throw new Error(data.error || copyRef.current.loadServerFailed);

			setGuildData(data);
			setNeedLogin(false);
			setIsForbidden(false);
			setIconFailed(false);
			if (data.isAdmin === false) {
				setActiveTab('personal');
				const url = new URL(window.location.href);
				url.searchParams.set('tab', 'personal');
				window.history.replaceState({}, '', `${url.pathname}${url.search}`);
			}
			const nextConfig = data.config || {};
			const nextAutomod = nextConfig.automod || {};
			if (quiet) {
				setConfig(previous => ({
					...nextConfig,
					...previous,
					reaction_roles: nextConfig.reaction_roles ?? previous.reaction_roles,
				}));
			} else {
				setConfig(nextConfig);
				setAutomod(nextAutomod);
				setInitialState({ cfg: nextConfig, am: nextAutomod });
				setSaveError('');
			}
			document.title = `${data.name || copyRef.current.fallbackServerName} | Megu`;
			return true;
		}
		catch (error) {
			const message = error.message || copyRef.current.loadServerFailed;
			if (quiet) showToast(message, true);
			else setLoadError(message);
			return false;
		}
		finally {
			setLoading(false);
		}
	}, [guildId, showToast]);

	useEffect(() => {
		setToolDrafts(emptyServerToolDrafts());
		setVolatileEditorDirtyIds(new Set());
	}, [guildId]);

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

	const configDirty = !!initialState && !sameValue(config, initialState.cfg);
	const automodDirty = !!initialState && !sameValue(automod, initialState.am);
	const isDirty = configDirty || automodDirty;
	const parentDraftToolIds = useMemo(() => getLocalDraftToolIds(toolDrafts), [toolDrafts]);
	const localDraftToolIds = useMemo(() => new Set([...parentDraftToolIds, ...volatileEditorDirtyIds]), [parentDraftToolIds, volatileEditorDirtyIds]);
	const localDraftDirty = localDraftToolIds.size > 0;
	const departureDirty = isDirty || localDraftDirty;

	useEffect(() => {
		if (!departureDirty) return;
		const warnBeforeLeaving = event => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener('beforeunload', warnBeforeLeaving);
		return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
	}, [departureDirty]);

	useEffect(() => {
		if (!departureDirty) return;
		const guardLinkNavigation = event => {
			if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			const anchor = event.target.closest?.('a[href]');
			if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
			const next = new URL(anchor.href, window.location.href);
			if (next.origin !== window.location.origin) return;
			const current = new URL(window.location.href);
			if (next.pathname === current.pathname && next.search === current.search && next.hash) return;
			event.preventDefault();
			event.stopPropagation();
			setPendingNavigation(`${next.pathname}${next.search}${next.hash}`);
		};
		document.addEventListener('click', guardLinkNavigation, true);
		return () => document.removeEventListener('click', guardLinkNavigation, true);
	}, [departureDirty]);

	useEffect(() => {
		const syncTabFromHistory = event => {
			const requestedHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
			const currentPath = `/servers/${guildId}`;
			if (window.location.pathname !== currentPath) {
				if (!departureDirty) return;
				event.stopImmediatePropagation();
				window.history.pushState({}, '', `${currentPath}?tab=${activeTab}`);
				setPendingNavigation(requestedHref);
				return;
			}
			const requestedTab = new URLSearchParams(window.location.search).get('tab');
			if (!requestedTab || !TAB_IDS.has(requestedTab) || requestedTab === activeTab) return;
			if (volatileEditorDirtyIds.has(activeTab)) {
				event.stopImmediatePropagation();
				const restoredUrl = new URL(window.location.href);
				restoredUrl.searchParams.set('tab', activeTab);
				window.history.pushState({}, '', `${restoredUrl.pathname}${restoredUrl.search}`);
				setPendingToolNavigation(requestedTab);
				return;
			}
			setActiveTab(requestedTab);
		};
		window.addEventListener('popstate', syncTabFromHistory, true);
		return () => window.removeEventListener('popstate', syncTabFromHistory, true);
	}, [activeTab, departureDirty, guildId, volatileEditorDirtyIds]);

	const navigation = useMemo(() => TAB_DEFINITIONS.map(tab => ({
		...tab,
		label: copy.tabs[tab.id],
		description: copy.tabDescriptions[tab.id],
	})), [copy]);

	const filteredNavigation = useMemo(() => {
		const needle = navQuery.trim().toLocaleLowerCase();
		if (!needle) return navigation;
		return navigation.filter(tab => `${tab.label} ${tab.description} ${(copy.tabSearchAliases?.[tab.id] || []).join(' ')}`.toLocaleLowerCase().includes(needle));
	}, [copy.tabSearchAliases, navQuery, navigation]);

	const activeDefinition = navigation.find(tab => tab.id === activeTab) || navigation[0];

	const handleConfigChange = (key, value) => setConfig(previous => ({ ...previous, [key]: value }));
	const handleAutomodChange = (key, value) => setAutomod(previous => ({ ...previous, [key]: value }));
	const dirtyToolIds = useMemo(() => {
		if (!initialState) return new Set();
		const dirty = new Set();
		for (const [toolId, keys] of Object.entries(CONFIG_TOOL_KEYS)) {
			if (keys.some(key => !sameValue(config[key], initialState.cfg[key]))) dirty.add(toolId);
		}
		if (automodDirty) dirty.add('automod');
		return dirty;
	}, [automodDirty, config, initialState]);
	const dirtyToolLabels = navigation.filter(tab => dirtyToolIds.has(tab.id)).map(tab => tab.label);
	const welcomeDirtyKinds = useMemo(() => ({
		welcome: Boolean(initialState && ['welcome_channel_id', 'welcome_message_template', 'welcome_mode', 'welcome_embed'].some(key => !sameValue(config[key], initialState.cfg[key]))),
		leave: Boolean(initialState && ['leave_channel_id', 'leave_message_template', 'leave_mode', 'leave_embed'].some(key => !sameValue(config[key], initialState.cfg[key]))),
	}), [config, initialState]);
	const localDraftToolLabels = navigation.filter(tab => localDraftToolIds.has(tab.id)).map(tab => tab.label);
	const pendingVisualToolIds = useMemo(() => new Set([...dirtyToolIds, ...localDraftToolIds]), [dirtyToolIds, localDraftToolIds]);

	function commitTabSelection(tabId) {
		if (!TAB_IDS.has(tabId)) return;
		setActiveTab(tabId);
		const url = new URL(window.location.href);
		url.searchParams.set('tab', tabId);
		window.history.pushState({}, '', `${url.pathname}${url.search}`);
	}

	function selectTab(tabId) {
		if (!TAB_IDS.has(tabId) || tabId === activeTab) return;
		if (volatileEditorDirtyIds.has(activeTab)) {
			setPendingToolNavigation(tabId);
			return;
		}
		commitTabSelection(tabId);
	}

	function discardEditorAndSwitch() {
		const tabId = pendingToolNavigation;
		setPendingToolNavigation(null);
		setVolatileEditorDirtyIds(current => {
			const next = new Set(current);
			next.delete(activeTab);
			return next;
		});
		if (tabId) commitTabSelection(tabId);
	}

	function switchServer(nextGuildId) {
		if (!nextGuildId || String(nextGuildId) === String(guildId)) return;
		requestNavigation(`/servers/${nextGuildId}?tab=${activeTab}`);
	}

	async function handleSaveAll() {
		if (!configDirty && !automodDirty) return true;
		setSaving(true);
		setSaveError('');
		try {
			const requests = [];
			if (configDirty) requests.push(['config', fetch(`/api/guilds/${guildId}/config`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(config),
				})]);
			if (automodDirty) requests.push(['automod', fetch(`/api/guilds/${guildId}/automod`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(automod),
				})]);

			const settled = await Promise.all(requests.map(async ([scope, responsePromise]) => {
				try {
					const response = await responsePromise;
					const result = await response.json().catch(() => ({}));
					return { scope, ok: response.ok && result.success, result };
				} catch (error) {
					return { scope, ok: false, result: { error: error.message } };
				}
			}));
			const configSave = settled.find(item => item.scope === 'config');
			const automodSave = settled.find(item => item.scope === 'automod');
			const configResult = configSave?.result || {};
			const confirmedConfig = configSave?.ok ? { ...config, ...(configResult.config || {}) } : config;
			if (configSave?.ok) setConfig(confirmedConfig);
			setInitialState(previous => ({
				cfg: configSave?.ok ? confirmedConfig : previous.cfg,
				am: automodSave?.ok ? automod : previous.am,
			}));

			const failed = settled.filter(item => !item.ok);
			if (failed.length) {
				const message = failed.length < settled.length
					? copy.partialSaveFailed
					: (failed[0].result.error || copy.saveFailed);
				setSaveError(message);
				showToast(message, true);
				return false;
			}
			showToast(copy.settingsSaved);
			return true;
		}
		catch (error) {
			const message = error.message || copy.saveFailed;
			setSaveError(message);
			showToast(message, true);
			return false;
		}
		finally {
			setSaving(false);
		}
	}

	function discardChanges() {
		if (!initialState) return;
		setConfig(initialState.cfg);
		setAutomod(initialState.am);
		setSaveError('');
		showToast(copy.changesDiscarded);
	}

	function requestNavigation(href) {
		if (!departureDirty) {
			router.push(href);
			return;
		}
		setPendingNavigation(href);
	}

	function discardAndLeave() {
		const href = pendingNavigation;
		discardChanges();
		setToolDrafts(emptyServerToolDrafts());
		setVolatileEditorDirtyIds(new Set());
		setPendingNavigation(null);
		if (href) router.push(href);
	}

	async function saveAndLeave() {
		const href = pendingNavigation;
		const saved = await handleSaveAll();
		if (saved && href) {
			setPendingNavigation(null);
			router.push(href);
		}
	}

	if (loading) {
		return (
			<div className={styles.serverShellSkeleton} aria-live="polite" aria-label={copy.loadingServer}>
				<div className={styles.skeletonContext}><span /><span /><span /></div>
				<div className={styles.skeletonWorkspace}>
					<div className={styles.skeletonRail}>{Array.from({ length: 7 }, (_, index) => <span key={index} />)}</div>
					<div className={styles.skeletonContent}><strong>{copy.loadingServer}</strong><small>{copy.loadingServerLede}</small>{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div>
				</div>
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
			{activeTab === 'personal' && <PersonalSettingsTab guildId={guildId} serverName={serverName} initialChannels={channels} showToast={showToast} onEditorDirtyChange={handleEditorDirtyChange} />}
			{activeTab === 'welcome' && <WelcomeTab config={config} channels={channels} onChange={handleConfigChange} serverName={serverName} dirtyKinds={welcomeDirtyKinds} />}
			{activeTab === 'autorole' && <AutoroleTab config={config} roles={roles} onChange={handleConfigChange} />}
			{activeTab === 'roles' && <RoleManagerTab roles={roles} guildId={guildId} showToast={showToast} onRefresh={() => fetchServerData({ quiet: true })} onEditorDirtyChange={handleEditorDirtyChange} />}
			{activeTab === 'members' && <MemberManagerTab guildId={guildId} roles={roles} initialMembers={members} showToast={showToast} onRefresh={() => fetchServerData({ quiet: true })} onEditorDirtyChange={handleEditorDirtyChange} />}
			{activeTab === 'nicknames' && <NicknameManagerTab guildId={guildId} initialMembers={members} showToast={showToast} onRefresh={() => fetchServerData({ quiet: true })} onEditorDirtyChange={handleEditorDirtyChange} />}
			{activeTab === 'tts' && <VoiceTtsTab config={config} channels={channels} onChange={handleConfigChange} />}
			{activeTab === 'audioqueue' && <AudioQueueTab guildId={guildId} showToast={showToast} draft={toolDrafts.audioqueue} onDraftChange={draft => setToolDrafts(current => ({ ...current, audioqueue: draft }))} />}
			{activeTab === 'honeypot' && <HoneypotTab config={config} channels={channels} onChange={handleConfigChange} />}
			{activeTab === 'automod' && <AutomodTab automod={automod} onChange={handleAutomodChange} />}
			{activeTab === 'reactionroles' && <ReactionRolesTab guildId={guildId} reactionRoles={config.reaction_roles} roles={roles} channels={channels} onRefresh={() => fetchServerData({ quiet: true })} showToast={showToast} draft={toolDrafts.reactionroles} onDraftChange={draft => setToolDrafts(current => ({ ...current, reactionroles: draft }))} />}
			{activeTab === 'audit' && <AuditLogsTab guildId={guildId} />}
			{activeTab === 'embeds' && <EmbedCreatorTab currentGuildId={guildId} activeGuilds={activeGuilds} channels={channels} showToast={showToast} draft={toolDrafts.embeds} onDraftChange={draft => setToolDrafts(current => ({ ...current, embeds: draft }))} />}
		</>
	);

	return (
		<div className={styles.detailPage}>
			{toastMsg && <Toast message={toastMsg} isError={toastError} onClose={() => setToastMsg(null)} />}

			<header className={styles.serverContext}>
				<Link href="/servers" className={styles.backLink} onClick={event => { event.preventDefault(); requestNavigation('/servers'); }}>
					<ArrowLeft size={16} />{copy.backToServerList}
				</Link>
				<div className={styles.contextIdentity}>
					{!iconFailed && iconUrl
						? <img src={iconUrl} alt="" onError={() => setIconFailed(true)} />
						: <span className={styles.contextAvatarFallback}>{serverName.substring(0, 2).toUpperCase()}</span>}
					<div className={styles.contextName}>
						<h1 title={serverName}>{serverName}</h1>
						<span>{guildData.isOwner ? copy.owner : guildData.isAdmin ? copy.manager : copy.member}</span>
					</div>
				</div>
				<div className={styles.contextActions}>
					<span className={guildData.isBotInGuild ? styles.readyBadge : styles.unknownBadge}><Bot size={14} />{guildData.isBotInGuild ? copy.meguPresent : copy.meguUnavailable}</span>
					{activeGuilds.length > 1 && (
						<div className={styles.serverSwitchControl}>
							<CustomSelect
								value={guildId}
								onChange={switchServer}
								ariaLabel={copy.quickSwitch}
								options={activeGuilds.map(guild => ({
									value: guild.id,
									label: guild.name,
									badge: guild.owner ? copy.owner : guild.isAdmin ? copy.manager : copy.member,
								}))}
								placeholder={copy.quickSwitch}
								searchable={activeGuilds.length > 5}
							/>
						</div>
					)}
					<details className={styles.serverDetails}>
						<summary><Info size={15} />{copy.serverDetails}</summary>
						<div className={styles.serverDetailsPanel}>
							<p>{copy.serverDetailsDescription}</p>
							<dl>
								<div><dt>{copy.serverIdentifier}</dt><dd><Hash size={13} />{guildId}</dd></div>
								<div><dt>{copy.channelsLabel}</dt><dd>{fmt.number(channels.length)}</dd></div>
								<div><dt>{copy.rolesLabel}</dt><dd>{fmt.number(roles.length)}</dd></div>
								<div><dt>{copy.membersLabel}</dt><dd>{fmt.number(members.length)}</dd></div>
							</dl>
						</div>
					</details>
				</div>
			</header>

			{guildData.isAdmin === false ? (
				<section className={styles.memberPanel}>
						<div className={styles.memberIntro} id="active-server-tool">
							<span><UserRound size={20} /></span>
							<div><h2>{copy.personalWorkspaceTitle}</h2><p>{copy.personalWorkspaceLede}</p></div>
					</div>
					<div className={styles.tabContent}>{tabPanel}</div>
				</section>
			) : (
				<div className={styles.configWorkspace}>
					<aside className={styles.toolNav} aria-label={copy.navigationLabel}>
						<div className={styles.toolNavHeader}>
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
							return <button type="button" key={tab.id} className={activeTab === tab.id ? styles.activeTool : ''} aria-current={activeTab === tab.id ? 'page' : undefined} onClick={() => selectTab(tab.id)}><Icon size={16} /><span className={styles.navLabel}>{tab.label}</span>{pendingVisualToolIds.has(tab.id) ? <span className={styles.navPending}><span className={styles.srOnly}>{copy.unsavedShort}</span></span> : null}</button>;
										})}
									</div>
								);
							})}
							{filteredNavigation.length === 0 && <div className={styles.noTools}><p>{copy.noToolsFound}</p><button type="button" onClick={() => setNavQuery('')}>{copy.clearToolSearch}</button></div>}
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
							<div className={styles.toolHeading}><ActiveIcon size={21} /><h2 id="active-server-tool">{activeDefinition.label}</h2></div>
							<p>{activeDefinition.description}</p>
							<span className={pendingVisualToolIds.has(activeTab) ? styles.unsavedBadge : styles.savedBadge}>{pendingVisualToolIds.has(activeTab) ? copy.unsavedShort : copy.noPendingChanges}</span>
						</header>
						<div className={styles.tabContent} key={activeTab}>{tabPanel}</div>
					</section>
				</div>
			)}

			{isDirty && guildData.isAdmin !== false && (
				<FloatingSaveBar onSave={handleSaveAll} onDiscard={discardChanges} saving={saving} affectedTools={dirtyToolLabels} error={saveError} />
			)}

			<TabDialog
				open={!!pendingNavigation}
				onClose={saving ? undefined : () => setPendingNavigation(null)}
				title={localDraftDirty ? copy.leaveLocalDraftTitle : copy.leaveDialogTitle}
				description={localDraftDirty ? copy.leaveLocalDraftDescription : copy.leaveDialogDescription}
				footer={(
					<>
						<button type="button" className="btn btn-secondary" onClick={() => setPendingNavigation(null)} disabled={saving}>{copy.stayHere}</button>
						<button type="button" className="btn btn-secondary" onClick={discardAndLeave} disabled={saving}>{copy.discardAndLeave}</button>
						{isDirty && localDraftDirty ? <button type="button" className="btn btn-primary" onClick={handleSaveAll} disabled={saving}>{saving ? copy.savingChanges : copy.saveServerOnly}</button> : null}
						{!localDraftDirty ? <button type="button" className="btn btn-primary" onClick={saveAndLeave} disabled={saving}>{saving ? copy.savingChanges : copy.saveAndLeave}</button> : null}
					</>
				)}
			>
				{dirtyToolLabels.length ? <p className={styles.leaveDialogMessage}>{copy.pendingTools(dirtyToolLabels)}</p> : null}
				{localDraftToolLabels.length ? <p className={styles.leaveDialogMessage}>{copy.pendingLocalDrafts(localDraftToolLabels)}</p> : null}
			</TabDialog>

			<TabDialog
				open={!!pendingToolNavigation}
				onClose={() => setPendingToolNavigation(null)}
				title={copy.switchDraftTitle}
				description={copy.switchDraftDescription}
				footer={(
					<>
						<button type="button" className="btn btn-secondary" onClick={() => setPendingToolNavigation(null)}>{copy.stayHere}</button>
						<button type="button" className="btn btn-primary" onClick={discardEditorAndSwitch}>{copy.discardAndSwitch}</button>
					</>
				)}
			>
				<p className={styles.leaveDialogMessage}>{copy.pendingLocalDrafts([activeDefinition.label])}</p>
			</TabDialog>
		</div>
	);
}
