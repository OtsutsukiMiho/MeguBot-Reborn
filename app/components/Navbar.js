'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import MeguMark from './MeguMark';
import ThemeToggle from './ThemeToggle';
import { useLang, LANGS } from './LangProvider';

export default function Navbar() {
	const [user, setUser] = useState(null);
	const [isDev, setIsDev] = useState(false);
	const pathname = usePathname();
	const { lang, setLang } = useLang();

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

	// Animated avatars are a_-prefixed and only exist as .gif; asking for .png
	// on those returns a 404, which is why some users saw a broken image.
	const avatarUrl = user?.avatar
		? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith('a_') ? 'gif' : 'png'}?size=64`
		: 'https://cdn.discordapp.com/embed/avatars/0.png';

	return (
		<nav className="navbar">
			<div className="navbar-inner">
				<Link href="/" className="nav-brand">
					<MeguMark size={34} />
					<span className="brand-megubot">Megu</span>
				</Link>

				<div className="nav-menu">
					<Link href="/" className={`tab-btn ${pathname === '/' ? 'active' : ''}`}>
						หน้าแรก
					</Link>
					<Link href="/activities" className={`tab-btn ${pathname.startsWith('/activities') ? 'active' : ''}`}>
						กิจกรรม
					</Link>
					<Link href="/servers" className={`tab-btn ${pathname.startsWith('/servers') ? 'active' : ''}`}>
						เซิร์ฟเวอร์
					</Link>
					{isDev && (
						<Link href="/developer" className={`tab-btn ${pathname.startsWith('/developer') ? 'active' : ''}`}>
							Developer
						</Link>
					)}
				</div>

				<div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
					<div className="lang-switch" role="group" aria-label="Language">
						{LANGS.map(l => (
							<button
								key={l.code}
								type="button"
								lang={l.code}
								aria-pressed={lang === l.code}
								onClick={() => setLang(l.code)}
							>
								{l.label}
							</button>
						))}
					</div>
					<ThemeToggle />
					{user ? (
						<div className="user-profile-badge">
							<img src={avatarUrl} className="user-avatar" alt="" width={28} height={28} />
							<span className="user-name">{user.global_name || user.username}</span>
							<button onClick={handleLogout} className="btn btn-ghost btn-sm" style={{ marginLeft: '0.25rem' }}>
								ออก
							</button>
						</div>
					) : (
						<a href="/api/auth/login" className="btn btn-discord btn-sm">
							เข้าสู่ระบบด้วย Discord
						</a>
					)}
				</div>
			</div>
		</nav>
	);
}
