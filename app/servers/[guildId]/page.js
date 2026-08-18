'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import WelcomeTab from '../../components/Tabs/WelcomeTab';
import AutoroleTab from '../../components/Tabs/AutoroleTab';
import RoleManagerTab from '../../components/Tabs/RoleManagerTab';
import MemberManagerTab from '../../components/Tabs/MemberManagerTab';
import VoiceTtsTab from '../../components/Tabs/VoiceTtsTab';
import HoneypotTab from '../../components/Tabs/HoneypotTab';
import AutomodTab from '../../components/Tabs/AutomodTab';
import ReactionRolesTab from '../../components/Tabs/ReactionRolesTab';
import AuditLogsTab from '../../components/Tabs/AuditLogsTab';
import EmbedCreatorTab from '../../components/Tabs/EmbedCreatorTab';
import AudioQueueTab from '../../components/Tabs/AudioQueueTab';
import FloatingSaveBar from '../../components/FloatingSaveBar';
import Toast from '../../components/Toast';

export default function ServerConfigPage({ params }) {
	const { guildId } = use(params);
	const router = useRouter();

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
				Loading server configuration...
			</div>
		);
	}

	if (isForbidden) {
		return (
			<div style={{ maxWidth: '540px', margin: '3rem auto 0', textAlign: 'center' }}>
				<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '20px', padding: '2.5rem 2rem', backdropFilter: 'blur(12px)' }}>
					<div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⛔</div>
					<h2 style={{ fontSize: '1.6rem', fontWeight: 800, marginBottom: '0.5rem', color: 'var(--due)' }}>
						Access Forbidden
					</h2>
					<p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '1.5rem', lineHeight: '1.6' }}>
						You do not have Administrator or Manage Server permissions for this server. Redirecting to server selector...
					</p>
					<Link href="/servers" className="btn btn-primary btn-sm">
						Back to Server Selector
					</Link>
				</div>
			</div>
		);
	}

	if (needLogin) {
		return (
			<div style={{ maxWidth: '540px', margin: '3rem auto 0', textAlign: 'center' }}>
				<div style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '20px', padding: '2.5rem 2rem', backdropFilter: 'blur(12px)' }}>
					<div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔐</div>
					<h2 style={{ fontSize: '1.6rem', fontWeight: 800, marginBottom: '0.5rem', color: 'var(--ink)' }}>
						Discord Login Required
					</h2>
					<p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '2rem', lineHeight: '1.6' }}>
						You need to log in with your Discord account to view and manage this server's configuration.
					</p>
					<a href="/api/auth/login" className="btn btn-discord" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1.75rem', fontSize: '1rem', fontWeight: 700 }}>
						<svg width="20" height="20" viewBox="0 0 127.14 96.36" fill="currentColor">
							<path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1,105.25,105.25,0,0,0,32.19-16.14c2.64-27.38-4.51-51.11-18.91-72.15ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,45.92,53.86,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,45.92,96.09,53,91.08,65.69,84.69,65.69Z"/>
						</svg>
						Login with Discord
					</a>
				</div>
			</div>
		);
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
		<div>
			<Toast message={toastMsg} isError={toastError} />

			{/* Server Banner Header */}
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
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
							{serverName ? serverName.substring(0, 2).toUpperCase() : '⚙️'}
						</div>
					)}
					<div>
						<h2 style={{ fontSize: '1.8rem', fontWeight: 800 }}>
							{serverName}
						</h2>
						<span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
							Configuring automation & security settings for <strong>{serverName}</strong> (ID: {guildId})
						</span>
					</div>
				</div>

				<Link href="/servers" className="btn btn-secondary btn-sm">
					Back to Server List
				</Link>
			</div>

			{/* Dashboard Layout */}
			<div className="config-layout">
				{/* Sidebar Menu */}
				<div className="sidebar-menu">
					<button className={`tab-btn ${activeTab === 'welcome' ? 'active' : ''}`} onClick={() => setActiveTab('welcome')}>
						Welcome & Leave
					</button>
					<button className={`tab-btn ${activeTab === 'autorole' ? 'active' : ''}`} onClick={() => setActiveTab('autorole')}>
						Autorole
					</button>
					<button className={`tab-btn ${activeTab === 'roles' ? 'active' : ''}`} onClick={() => setActiveTab('roles')}>
						Role Manager
					</button>
					<button className={`tab-btn ${activeTab === 'members' ? 'active' : ''}`} onClick={() => setActiveTab('members')}>
						Member Manager
					</button>
					<button className={`tab-btn ${activeTab === 'tts' ? 'active' : ''}`} onClick={() => setActiveTab('tts')}>
						Voice TTS Channel
					</button>
					<button className={`tab-btn ${activeTab === 'honeypot' ? 'active' : ''}`} onClick={() => setActiveTab('honeypot')}>
						Honeypot
					</button>
					<button className={`tab-btn ${activeTab === 'automod' ? 'active' : ''}`} onClick={() => setActiveTab('automod')}>
						Auto-Mod
					</button>
					<button className={`tab-btn ${activeTab === 'reactionroles' ? 'active' : ''}`} onClick={() => setActiveTab('reactionroles')}>
						Reaction Roles
					</button>
					<button className={`tab-btn ${activeTab === 'audioqueue' ? 'active' : ''}`} onClick={() => setActiveTab('audioqueue')}>
						Audio Queue
					</button>
					<button className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => setActiveTab('audit')}>
						Audit Logs
					</button>
					<button className={`tab-btn ${activeTab === 'embeds' ? 'active' : ''}`} onClick={() => setActiveTab('embeds')}>
						Embed Creator
					</button>
				</div>

				{/* Main Tab Panel */}
				<div className="card-panel" style={{ marginBottom: 0 }}>
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

			{/* Floating Unsaved Changes Bar */}
			{isDirty && (
				<FloatingSaveBar onSave={handleSaveAll} saving={saving} />
			)}
		</div>
	);
}
