'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import MeguMark from './MeguMark';
import ThemeToggle from './ThemeToggle';
import { useLang, LANGS } from './LangProvider';
import { useCopy } from '../copy';

export default function Navbar() {
	const [user, setUser] = useState(null);
	const [isDev, setIsDev] = useState(false);
	const pathname = usePathname();
	const { lang, setLang } = useLang();
	const { t } = useCopy();

	// True while the landing page's hero band is still behind the bar. Starts
	// true on `/` so the first paint is already transparent — the bar being
	// solid for a frame over a dark hero is the exact flash this removes.
	const [overBand, setOverBand] = useState(pathname === '/');

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

	// The hero is a full viewport tall on a laptop and, on a phone, barely more
	// than its own content — so what decides is the element's position, not a
	// scroll distance. The observer's top margin is the bar's own height, read
	// from the token rather than repeated as a number, so the two cannot drift.
	//
	// The hero belongs to the page and this bar belongs to the layout, so there
	// is no ref to hand over. React commits the whole tree before any effect
	// runs, which makes the query safe in the ordinary case — but a route
	// transition or a streamed segment can land it a frame early, and giving up
	// there would leave the bar solid over the hero, which is the bug. So it
	// retries for a second before accepting that there is no band.
	useEffect(() => {
		if (pathname !== '/') {
			setOverBand(false);
			return;
		}

		let observer;
		let frame;
		let tries = 0;

		const attach = () => {
			const hero = document.querySelector('[data-landing-hero]');

			if (!hero) {
				if (tries++ < 60) frame = requestAnimationFrame(attach);
				else setOverBand(false);
				return;
			}

			const navH = parseInt(
				getComputedStyle(document.documentElement).getPropertyValue('--nav-h'),
				10,
			) || 64;

			// The observer's first callback is a frame away, and arriving at `/`
			// from another page leaves the state behind until it lands — one frame
			// of solid bar over the hero, or of transparent bar over the page if
			// the browser restored the scroll position down the page. Reading the
			// rect once answers it now; the observer keeps it answered.
			const rect = hero.getBoundingClientRect();
			setOverBand(rect.bottom > navH && rect.top < window.innerHeight);

			observer = new IntersectionObserver(
				([entry]) => setOverBand(entry.isIntersecting),
				{ rootMargin: `-${navH}px 0px 0px 0px` },
			);
			observer.observe(hero);
		};

		attach();

		return () => {
			if (observer) observer.disconnect();
			if (frame) cancelAnimationFrame(frame);
		};
	}, [pathname]);

	const handleLogout = async () => {
		await fetch('/api/auth/logout', { method: 'POST' });
		window.location.href = '/';
	};

	const avatarUrl = user?.avatarUrl
		? user.avatarUrl
		: 'https://cdn.discordapp.com/embed/avatars/0.png';

	return (
		<nav className={`navbar${overBand ? ' is-over-band' : ''}`}>
			<div className="navbar-inner">
				<Link href="/" className="nav-brand">
					<MeguMark size={34} />
					<span className="brand-megubot">Megu</span>
				</Link>

				<div className="nav-menu">
					<Link href="/" className={`tab-btn ${pathname === '/' ? 'active' : ''}`}>
						{t.nav.home}
					</Link>
					<Link href="/servers" className={`tab-btn ${pathname.startsWith('/servers') ? 'active' : ''}`}>
						{t.nav.servers}
					</Link>
					<Link href="/activities" className={`tab-btn ${pathname.startsWith('/activities') ? 'active' : ''}`}>
						{t.nav.activities}
					</Link>
					<Link href="/bills" className={`tab-btn ${pathname.startsWith('/bills') ? 'active' : ''}`}>
						{t.nav.bills}
					</Link>
					{user && <Link href="/account" className={`tab-btn ${pathname.startsWith('/account') ? 'active' : ''}`}>{t.nav.account}</Link>}
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
							<Link href="/account" className="user-name">{user.displayName}</Link>
							<button onClick={handleLogout} className="btn btn-ghost btn-sm" style={{ marginLeft: '0.25rem' }}>
								{t.nav.signOut}
							</button>
						</div>
					) : (
						<a href="/api/auth/login" className="btn btn-primary btn-sm">
							{t.nav.signIn}
						</a>
					)}
				</div>
			</div>
		</nav>
	);
}
