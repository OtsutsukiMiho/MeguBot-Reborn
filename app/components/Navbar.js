'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Navbar() {
	const [user, setUser] = useState(null);
	const [isDev, setIsDev] = useState(false);
	const pathname = usePathname();

	useEffect(() => {
		fetch('/api/auth/me')
			.then(res => res.json())
			.then(data => {
				if (data.loggedIn && data.user) {
					setUser(data.user);
				}
			})
			.catch(() => setUser(null));

		fetch('/api/developer/check')
			.then(res => res.json())
			.then(data => {
				if (data.isDeveloper) {
					setIsDev(true);
				}
			})
			.catch(() => setIsDev(false));
	}, []);

	const handleLogout = async () => {
		await fetch('/api/auth/logout', { method: 'POST' });
		window.location.href = '/';
	};

	const avatarUrl = user?.avatar
		? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
		: 'https://cdn.discordapp.com/embed/avatars/0.png';

	return (
		<nav className="navbar">
			<div className="navbar-inner">
				<Link href="/" className="nav-brand">
					<img src="/icon.png" alt="MeguBot Logo" />
					<span>
						<span className="brand-megubot">MeguBot</span>
						<span className="brand-reborn">Reborn</span>
					</span>
				</Link>

				<div className="nav-menu">
					<Link href="/" className={`nav-link ${pathname === '/' ? 'active' : ''}`}>
						Home
					</Link>
					<Link href="/dashboard" className={`nav-link ${pathname.startsWith('/dashboard') ? 'active' : ''}`}>
						Dashboard
					</Link>
					{isDev && (
						<Link href="/developer" className={`nav-link ${pathname.startsWith('/developer') ? 'active' : ''}`} style={{ color: '#a5b4fc', fontWeight: 600 }}>
							🛠️ Developer
						</Link>
					)}
				</div>

				<div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
					{user ? (
						<div className="user-profile-badge">
							<img src={avatarUrl} className="user-avatar" alt="Avatar" />
							<span className="user-name">{user.global_name || user.username}</span>
							<button onClick={handleLogout} className="btn btn-secondary btn-sm" style={{ marginLeft: '0.5rem', padding: '0.25rem 0.6rem' }}>
								Logout
							</button>
						</div>
					) : (
						<a href="/api/auth/login" className="btn btn-discord btn-sm">
							Login with Discord
						</a>
					)}
				</div>
			</div>
		</nav>
	);
}
