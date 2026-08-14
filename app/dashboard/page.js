'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

function getGuildIconUrl(g) {
	if (!g || !g.icon) return null;
	if (typeof g.icon === 'string' && (g.icon.startsWith('http://') || g.icon.startsWith('https://'))) {
		return g.icon;
	}
	const ext = g.icon.startsWith('a_') ? 'gif' : 'png';
	return `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.${ext}?size=128`;
}

function getGuildBannerUrl(g) {
	if (!g) return null;
	if (g.banner) {
		if (typeof g.banner === 'string' && (g.banner.startsWith('http://') || g.banner.startsWith('https://'))) {
			return g.banner;
		}
		const ext = g.banner.startsWith('a_') ? 'gif' : 'png';
		return `https://cdn.discordapp.com/banners/${g.id}/${g.banner}.${ext}?size=512`;
	}
	if (g.splash) {
		if (typeof g.splash === 'string' && (g.splash.startsWith('http://') || g.splash.startsWith('https://'))) {
			return g.splash;
		}
		return `https://cdn.discordapp.com/splashes/${g.id}/${g.splash}.png?size=512`;
	}
	return null;
}

function getGuildGradient(guildId = '') {
	const gradients = [
		'linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #ec4899 100%)',
		'linear-gradient(135deg, #0ea5e9 0%, #3b82f6 50%, #6366f1 100%)',
		'linear-gradient(135deg, #10b981 0%, #059669 50%, #047857 100%)',
		'linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%)',
		'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 50%, #4c1d95 100%)',
		'linear-gradient(135deg, #ec4899 0%, #be185d 50%, #831843 100%)',
	];
	let sum = 0;
	for (let i = 0; i < guildId.length; i++) sum += guildId.charCodeAt(i);
	return gradients[sum % gradients.length];
}

function ServerCardAvatar({ guild }) {
	const [failed, setFailed] = useState(false);
	const iconUrl = getGuildIconUrl(guild);

	if (!failed && iconUrl) {
		return (
			<img
				className="server-card-avatar"
				src={iconUrl}
				alt={guild.name}
				onError={() => setFailed(true)}
			/>
		);
	}

	return (
		<div className="server-card-avatar">
			{guild.name ? guild.name.substring(0, 2).toUpperCase() : '??'}
		</div>
	);
}

export default function DashboardServersPage() {
	const [guilds, setGuilds] = useState([]);
	const [loading, setLoading] = useState(true);
	const [needLogin, setNeedLogin] = useState(false);
	const [error, setError] = useState(null);

	useEffect(() => {
		fetch('/api/guilds')
			.then(res => {
				if (res.status === 401) {
					setNeedLogin(true);
					return null;
				}
				return res.json();
			})
			.then(data => {
				if (!data) return;
				if (data.success && data.guilds) {
					// Active Servers FIRST, sorted A-Z second
					const sorted = [...data.guilds].sort((a, b) => {
						if (a.isBotInGuild !== b.isBotInGuild) {
							return a.isBotInGuild ? -1 : 1;
						}
						return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
					});
					setGuilds(sorted);
				}
				else if (data.error && data.error.toLowerCase().includes('unauthorized')) {
					setNeedLogin(true);
				}
				else {
					setError('Failed to load your admin servers.');
				}
			})
			.catch(() => setError('Error connecting to server list API.'))
			.finally(() => setLoading(false));
	}, []);

	if (loading) {
		return (
			<div style={{ color: 'var(--text-secondary)', padding: '3rem 0', textAlign: 'center' }}>
				Loading your admin servers...
			</div>
		);
	}

	if (needLogin) {
		return (
			<div style={{ maxWidth: '540px', margin: '3rem auto 0', textAlign: 'center' }}>
				<div style={{ background: 'rgba(31, 41, 55, 0.4)', border: '1px solid var(--border-color)', borderRadius: '20px', padding: '2.5rem 2rem', backdropFilter: 'blur(12px)' }}>
					<div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔐</div>
					<h2 style={{ fontSize: '1.6rem', fontWeight: 800, marginBottom: '0.5rem', color: '#ffffff' }}>
						Discord Login Required
					</h2>
					<p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '2rem', lineHeight: '1.6' }}>
						You need to log in with your Discord account to view and manage your Discord servers on the dashboard.
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

	if (error) {
		return (
			<div style={{ color: '#ef4444', padding: '3rem 0', textAlign: 'center' }}>
				{error}
			</div>
		);
	}

	return (
		<div>
			<div style={{ marginBottom: '2rem' }}>
				<h2 style={{ fontSize: '1.8rem', fontWeight: 800 }}>Select a Server to Manage</h2>
				<p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginTop: '0.25rem' }}>
					Configure onboarding, reaction roles, AutoMod security rules, voice TTS, and audit logs.
				</p>
			</div>

			{guilds.length === 0 ? (
				<div style={{ color: 'var(--text-secondary)', padding: '2rem 0' }}>
					No servers found where you have Administrator or Manage Server permissions.
				</div>
			) : (
				<div className="server-grid">
					{guilds.map(g => {
						const bannerUrl = getGuildBannerUrl(g);
						const gradientBg = getGuildGradient(g.id);

						return (
							<div key={g.id} className="server-card">
								{/* Top Banner Header with Status & Role Pills */}
								<div
									className="server-card-banner"
									style={{
										backgroundImage: bannerUrl ? `url(${bannerUrl})` : undefined,
										background: !bannerUrl ? gradientBg : undefined,
									}}
								>
									<span className="server-role-badge">
										{g.owner ? 'Owner' : 'Admin'}
									</span>

									{g.isBotInGuild ? (
										<span className="server-status-badge status-online">
											<span className="status-dot"></span> Active
										</span>
									) : (
										<span className="server-status-badge status-offline">
											Bot Missing
										</span>
									)}
								</div>

								{/* Overlapping Server Avatar Icon */}
								<div className="server-card-avatar-wrapper">
									<ServerCardAvatar guild={g} />
								</div>

								{/* Server Card Body */}
								<div className="server-card-body">
									<div>
										<div className="server-card-title" title={g.name}>
											{g.name}
										</div>
										<div className="server-card-details">
											{g.memberCount !== undefined && (
												<span>👥 {g.memberCount.toLocaleString()} members</span>
											)}
											<span>ID: {g.id}</span>
										</div>
									</div>

									{/* Action Button */}
									<div className="server-card-footer">
										{g.isBotInGuild ? (
											<Link href={`/dashboard/${g.id}`} className="btn btn-sm server-card-btn">
												Configure Server
											</Link>
										) : (
											<a
												href={g.inviteUrl}
												target="_blank"
												rel="noreferrer"
												className="btn btn-secondary btn-sm server-card-btn"
											>
												+ Add MeguBot
											</a>
										)}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
