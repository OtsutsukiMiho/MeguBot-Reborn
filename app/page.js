'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function HomePage() {
	const [user, setUser] = useState(null);

	useEffect(() => {
		fetch('/api/auth/me')
			.then(res => res.json())
			.then(data => {
				if (data.loggedIn && data.user) setUser(data.user);
			})
			.catch(() => {});
	}, []);

	return (
		<div>
			{/* Hero Section */}
			<section className="hero-section">
				<div className="hero-badge">
					<span>✨ Next-Gen Discord Platform</span>
				</div>
				<h1 className="hero-title">
					Empower Your Discord Community With MeguBot Reborn
				</h1>
				<p className="hero-subtitle">
					Advanced reaction roles, high-fidelity Google & Edge Neural TTS voice playback, automated anti-spam moderation, security honeypots, and real-time live audit logging.
				</p>
				<div className="hero-actions">
					{user ? (
						<Link href="/dashboard" className="btn btn-discord btn-lg">
							<span>⚙️ Manage Servers</span>
						</Link>
					) : (
						<a href="/api/auth/login" className="btn btn-discord btn-lg">
							<span>🚀 Login with Discord</span>
						</a>
					)}
					<a href="https://discord.com" target="_blank" rel="noreferrer" className="btn btn-secondary btn-lg">
						💬 Join Support Server
					</a>
				</div>
			</section>

			{/* Features Grid Header */}
			<div className="features-header">
				<h2>Built for High-Performance Discord Communities</h2>
				<p className="hero-subtitle" style={{ marginBottom: 0 }}>
					Everything you need to automate, protect, and entertain your server.
				</p>
			</div>

			{/* Features Grid */}
			<div className="features-grid">
				<div className="feature-card">
					<div className="feature-icon">⚡</div>
					<h3 className="feature-title">Reaction Roles Engine</h3>
					<p className="feature-desc">
						Assign and revoke roles with custom emojis, Toggle & Give-Only modes, and instant status toggling per mapping.
					</p>
				</div>
				<div className="feature-card">
					<div className="feature-icon">🗣️</div>
					<h3 className="feature-title">High-Fidelity Voice TTS</h3>
					<p className="feature-desc">
						Natural neural voice synthesis with Edge Neural & Google TTS. Connect MeguBot to voice channels and read chat text live.
					</p>
				</div>
				<div className="feature-card">
					<div className="feature-icon">🛡️</div>
					<h3 className="feature-title">AutoMod & Honeypot Security</h3>
					<p className="feature-desc">
						Catch spammers, block invite links, filter bad words, and set honeypot channels to ban stealth raid bots.
					</p>
				</div>
				<div className="feature-card">
					<div className="feature-icon">📊</div>
					<h3 className="feature-title">Live Audit Log Feed</h3>
					<p className="feature-desc">
						Inspect every automated kick, honeypot ban, TTS speech, and reaction role assignment in real-time with 7-day retention.
					</p>
				</div>
			</div>
		</div>
	);
}
