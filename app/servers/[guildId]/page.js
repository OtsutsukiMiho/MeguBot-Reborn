'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import FloatingSaveBar from '../../components/FloatingSaveBar';
import Toast from '../../components/Toast';
import { useCopy } from '../../copy';

export default function ServerConfigPage({ params }) {
	const { guildId } = use(params);
	const router = useRouter();
	const { t } = useCopy();

	const [activeTab, setActiveTab] = useState('welcome');
	const [guildData, setGuildData] = useState(null);
	const [activeGuilds, setActiveGuilds] = useState([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [toastMsg, setToastMsg] = useState(null);
	const [toastError, setToastError] = useState(false);
	const [iconFailed, setIconFailed] = useState(false);

	// Config form state
	const [config, setConfig] = useState({});
	const [automod, setAutomod] = useState({});
	const [initialState, setInitialState] = useState(null);
	const [isDirty, setIsDirty] = useState(false);
	const [isForbidden, setIsForbidden] = useState(false);

	const showToast = (msg, isErr = false) => {
		setToastMsg(msg);
		setToastError(isErr);
		setTimeout(() => setToastMsg(null), 3500);
	};

	const [needLogin, setNeedLogin] = useState(false);

	const fetchServerData = () => {
		setLoading(true);
		fetch(`/api/guilds/${guildId}`)
			.then(res => {
				if (res.status === 401) {
					setNeedLogin(true);
					return null;
				}
				if (res.status === 403) {
					setIsForbidden(true);
					router.replace('/servers');
					return null;
				}
				return res.json();
			})
			.then(data => {
				if (!data) return;
				if (data.success) {
					setGuildData(data);
					if (data.isAdmin === false) {
						setActiveTab('personal');
					}
					const cfg = data.config || {};
					const am = cfg.automod || {};
					setConfig(cfg);
					setAutomod(am);

					const stateSnap = JSON.stringify({ cfg, am });
					setInitialState(stateSnap);
					setIsDirty(false);

					if (data.name) {
						document.title = `${data.name} | Megu`;
					}
				}
				else if (data.error && data.error.toLowerCase().includes('unauthorized')) {
					setNeedLogin(true);
				}
				else if (data.error && (data.error.toLowerCase().includes('forbidden') || data.error.toLowerCase().includes('permission'))) {
					setIsForbidden(true);
					router.replace('/servers');
				}
				else {
					showToast(data.error || 'Failed to load server config.', true);
				}
			})
			.catch(() => showToast('Error loading server config.', true))
			.finally(() => setLoading(false));
	};

	useEffect(() => {
		fetchServerData();

		fetch('/api/guilds')
			.then(res => res.json())
			.then(data => {
				if (data.success && data.guilds) {
					setActiveGuilds(data.guilds.filter(g => g.isBotInGuild));
				}
			})
			.catch(() => {});
	}, [guildId]);

	// Track dirty state
	useEffect(() => {
		if (initialState) {
			const currentState = JSON.stringify({ cfg: config, am: automod });
			setIsDirty(currentState !== initialState);
		}
	}, [config, automod, initialState]);

	const handleConfigChange = (key, val) => {
		setConfig(prev => ({ ...prev, [key]: val }));
	};

	const handleAutomodChange = (key, val) => {
		setAutomod(prev => ({ ...prev, [key]: val }));
	};

	const handleSaveAll = async () => {
		setSaving(true);
		try {
			const [configRes, automodRes] = await Promise.all([
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

			const cfgData = await configRes.json();
			const amData = await automodRes.json();

			if (cfgData.success && amData.success) {
				showToast('All server settings saved successfully!');
				const stateSnap = JSON.stringify({ cfg: config, am: automod });
				setInitialState(stateSnap);
				setIsDirty(false);
			} else {
				showToast(cfgData.error || amData.error || 'Failed to save configuration.', true);
			}
		} catch (e) {
			showToast('Error saving server configuration.', true);
		} finally {
			setSaving(false);
		}
	};

	if (loading) {
		return (
			<div style={{ color: 'var(--text-secondary)', padding: '3rem 0', textAlign: 'center' }}>
				{t.common.loading}
			</div>
		);
	}

	if (isForbidden) {
		return (
			<div style={{ maxWidth: '540px', margin: '3rem auto 0', textAlign: 'center' }}>
				<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '20px', padding: '2.5rem 2rem', backdropFilter: 'blur(12px)' }}>
					<h2 style={{ fontSize: '1.6rem', fontWeight: 800, marginBottom: '0.5rem', color: 'var(--due)' }}>
						{t.servers.accessForbiddenTitle}
					</h2>
					<p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '1.5rem', lineHeight: '1.6' }}>
						{t.servers.accessForbiddenLede}
					</p>
					<Link href="/servers" className="btn btn-primary btn-sm">
						{t.servers.backToServerSelector}
					</Link>
				</div>
			</div>
		);
	}

	if (needLogin) {
		return <AuthGate title={t.servers.signedOutTitle} lede={t.servers.signedOutLede} mood="asking" />;
	}

	const channels = guildData?.channels || [];
	const roles = guildData?.roles || [];
	const rawIcon = guildData?.icon;

	let iconUrl = null;
	if (rawIcon) {
		iconUrl = rawIcon.startsWith('http://') || rawIcon.startsWith('https://')
			? rawIcon
			: `https://cdn.discordapp.com/icons/${guildId}/${rawIcon}.${rawIcon.startsWith('a_') ? 'gif' : 'png'}?size=128`;
	}

	const matchedGuild = activeGuilds.find(g => String(g.id) === String(guildId));
	const serverName = guildData?.name || matchedGuild?.name || 'Discord Server';

	return (
		<div style={{ paddingTop: '2rem', paddingBottom: '3rem' }}>
			<Toast message={toastMsg} isError={toastError} />

			{/* Server Banner Header */}
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2.25rem', flexWrap: 'wrap', gap: '1.25rem' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
					{!iconFailed && iconUrl ? (
						<img
							src={iconUrl}
							alt={serverName}
							className="server-card-avatar"
							style={{ width: '64px', height: '64px' }}
							onError={() => setIconFailed(true)}
						/>
					) : (
						<div className="server-card-avatar" style={{ width: '64px', height: '64px', fontSize: '1.5rem', fontWeight: 800 }}>
							{serverName ? serverName.substring(0, 2).toUpperCase() : '#'}
						</div>
					)}
					<div>
						<div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
							<h2 style={{ fontSize: '1.8rem', fontWeight: 800, margin: 0 }}>
								{serverName}
							</h2>
							<span className={`server-role-badge ${guildData?.isOwner ? 'role-owner' : (guildData?.isAdmin ? 'role-manager' : 'role-member')}`}>
								{guildData?.isOwner ? t.servers.owner : (guildData?.isAdmin ? t.servers.manager : t.servers.member)}
							</span>
						</div>
						<span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
							ID: {guildId}
						</span>
					</div>
				</div>

				<Link href="/servers" className="btn btn-secondary btn-sm">
					{t.servers.backToServerList}
				</Link>
			</div>

			{guildData?.isAdmin === false ? (
				/* Member-Only Dedicated View */
				<div className="card-panel">
					<PersonalSettingsTab
						guildId={guildId}
						serverName={serverName}
						initialChannels={channels}
						showToast={showToast}
					/>
				</div>
			) : (
				/* Admin Full Dashboard Layout */
				<div className="config-layout">
					{/* Sidebar Menu */}
					<div className="sidebar-menu">
						<button className={`tab-btn ${activeTab === 'personal' ? 'active' : ''}`} onClick={() => setActiveTab('personal')}>
							{t.servers.tabs.personal}
						</button>
						<div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0.5rem' }} />
						<button className={`tab-btn ${activeTab === 'welcome' ? 'active' : ''}`} onClick={() => setActiveTab('welcome')}>
							{t.servers.tabs.welcome}
						</button>
						<button className={`tab-btn ${activeTab === 'autorole' ? 'active' : ''}`} onClick={() => setActiveTab('autorole')}>
							{t.servers.tabs.autorole}
						</button>
						<button className={`tab-btn ${activeTab === 'roles' ? 'active' : ''}`} onClick={() => setActiveTab('roles')}>
							{t.servers.tabs.roles}
						</button>
						<button className={`tab-btn ${activeTab === 'members' ? 'active' : ''}`} onClick={() => setActiveTab('members')}>
							{t.servers.tabs.members}
						</button>
						<button className={`tab-btn ${activeTab === 'nicknames' ? 'active' : ''}`} onClick={() => setActiveTab('nicknames')}>
							{t.servers.tabs.nicknames}
						</button>
						<button className={`tab-btn ${activeTab === 'tts' ? 'active' : ''}`} onClick={() => setActiveTab('tts')}>
							{t.servers.tabs.tts}
						</button>
						<button className={`tab-btn ${activeTab === 'honeypot' ? 'active' : ''}`} onClick={() => setActiveTab('honeypot')}>
							{t.servers.tabs.honeypot}
						</button>
						<button className={`tab-btn ${activeTab === 'automod' ? 'active' : ''}`} onClick={() => setActiveTab('automod')}>
							{t.servers.tabs.automod}
						</button>
						<button className={`tab-btn ${activeTab === 'reactionroles' ? 'active' : ''}`} onClick={() => setActiveTab('reactionroles')}>
							{t.servers.tabs.reactionroles}
						</button>
						<button className={`tab-btn ${activeTab === 'audioqueue' ? 'active' : ''}`} onClick={() => setActiveTab('audioqueue')}>
							{t.servers.tabs.audioqueue}
						</button>
						<button className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => setActiveTab('audit')}>
							{t.servers.tabs.audit}
						</button>
						<button className={`tab-btn ${activeTab === 'embeds' ? 'active' : ''}`} onClick={() => setActiveTab('embeds')}>
							{t.servers.tabs.embeds}
						</button>
					</div>

					{/* Main Tab Panel */}
					<div className="card-panel" style={{ marginBottom: 0 }}>
						{activeTab === 'personal' && (
							<PersonalSettingsTab
								guildId={guildId}
								serverName={serverName}
								initialChannels={channels}
								showToast={showToast}
							/>
						)}
						{activeTab === 'welcome' && (
							<WelcomeTab config={config} channels={channels} onChange={handleConfigChange} serverName={serverName} />
						)}
						{activeTab === 'autorole' && (
							<AutoroleTab config={config} roles={roles} onChange={handleConfigChange} />
						)}
						{activeTab === 'roles' && (
							<RoleManagerTab roles={roles} guildId={guildId} showToast={showToast} onRefresh={fetchServerData} />
						)}
						{activeTab === 'members' && (
							<MemberManagerTab
								guildId={guildId}
								roles={roles}
								initialMembers={guildData?.members || []}
								showToast={showToast}
								onRefresh={fetchServerData}
							/>
						)}
						{activeTab === 'nicknames' && (
							<NicknameManagerTab
								guildId={guildId}
								initialMembers={guildData?.members || []}
								showToast={showToast}
								onRefresh={fetchServerData}
							/>
						)}
						{activeTab === 'tts' && (
							<VoiceTtsTab config={config} channels={channels} onChange={handleConfigChange} />
						)}
						{activeTab === 'audioqueue' && (
							<AudioQueueTab guildId={guildId} showToast={showToast} />
						)}
						{activeTab === 'honeypot' && (
							<HoneypotTab config={config} channels={channels} onChange={handleConfigChange} />
						)}
						{activeTab === 'automod' && (
							<AutomodTab automod={automod} onChange={handleAutomodChange} />
						)}
						{activeTab === 'reactionroles' && (
							<ReactionRolesTab
								guildId={guildId}
								reactionRoles={config.reaction_roles}
								roles={roles}
								channels={channels}
								onRefresh={fetchServerData}
								showToast={showToast}
							/>
						)}
						{activeTab === 'audit' && (
							<AuditLogsTab guildId={guildId} />
						)}
						{activeTab === 'embeds' && (
							<EmbedCreatorTab
								currentGuildId={guildId}
								activeGuilds={activeGuilds}
								channels={channels}
								showToast={showToast}
							/>
						)}
					</div>
				</div>
			)}

			{/* Floating Unsaved Changes Bar */}
			{isDirty && activeTab !== 'personal' && guildData?.isAdmin !== false && (
				<FloatingSaveBar onSave={handleSaveAll} saving={saving} />
			)}
		</div>
	);
}
