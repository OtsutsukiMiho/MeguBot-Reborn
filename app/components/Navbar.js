'use client';

import { useState, useEffect, useRef } from 'react';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import MeguMark from './MeguMark';
import ThemeToggle from './ThemeToggle';
import { useLang, LANGS } from './LangProvider';
import { useCopy } from '../copy';
import { WorkspaceDraftNavigation } from './useDraftGuard';
import { spaceFor, ownsSpace, readRemembered, remember } from './navSpaces';

const PROJECTS_ENABLED = process.env.NEXT_PUBLIC_MEGU_PROJECTS_ENABLED !== '0';
const TEAMS_ENABLED = PROJECTS_ENABLED && process.env.NEXT_PUBLIC_MEGU_PROJECT_TEAMS_ENABLED !== '0';

export default function Navbar() {
	const [user, setUser] = useState(null);
	const [isDev, setIsDev] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	// The side the reader last chose, for pages both sides share. Read after
	// mount, since storage does not exist on the server.
	const [remembered, setRemembered] = useState(null);
	const menuButton = useRef(null);
	const pathname = usePathname();
	const { lang, setLang } = useLang();
	const { t } = useCopy();
	useEffect(() => { setMenuOpen(false); }, [pathname]);
	useEffect(() => { setRemembered(readRemembered()); }, []);
	const space = spaceFor(pathname, remembered);
	useEffect(() => {
		if (space && ownsSpace(pathname)) { remember(space); setRemembered(space); }
	}, [space, pathname]);
	useEffect(() => {
		if (!menuOpen) return;
		const close = event => {
			if (event.key === 'Escape') { setMenuOpen(false); menuButton.current?.focus(); }
		};
		document.addEventListener('keydown', close);
		return () => document.removeEventListener('keydown', close);
	}, [menuOpen]);

	// True while the landing page's hero band is still behind the bar. Starts
	// true on `/` so the first paint is already transparent — the bar being
	// solid for a frame over a dark hero is the exact flash this removes.
	const [overBand, setOverBand] = useState(pathname === '/');
	// `/` swaps its landing for the signed-in greeting once the session is
	// known, so the hero can appear and disappear without a route change. The
	// hero announces both (useLandingHero), and each announcement re-runs the
	// check below.
	const [heroTick, setHeroTick] = useState(0);
	useEffect(() => {
		const changed = () => setHeroTick(n => n + 1);
		window.addEventListener('megu:landing-hero', changed);
		return () => window.removeEventListener('megu:landing-hero', changed);
	}, []);

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
				// After an announcement the answer is already final: the hero
				// just left. Only the first look on arrival waits for it.
				if (heroTick === 0 && tries++ < 60) frame = requestAnimationFrame(attach);
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
	}, [pathname, heroTick]);

	const handleLogout = async () => {
		await fetch('/api/auth/logout', { method: 'POST' });
		window.location.href = '/';
	};

	const avatarUrl = user?.avatarUrl
		? user.avatarUrl
		: 'https://cdn.discordapp.com/embed/avatars/0.png';

	return (
		<nav aria-label={t.nav.mainNavigation} className={`navbar${overBand ? ' is-over-band' : ''}`}>
			<WorkspaceDraftNavigation />
			<div className="navbar-inner">
				<Link href="/" className="nav-brand" aria-label="Megu">
					<MeguMark size={34} />
					<span className="brand-megubot">Megu</span>
				</Link>

				<div id="main-navigation" className={`nav-menu${menuOpen ? ' is-open' : ''}`} aria-label={t.nav.mainNavigation} onClick={event => { if (event.target.closest('a')) setMenuOpen(false); }}>
					{/* Which side of Megu this is, and the way to the other one. */}
					<div className="nav-spaces" role="group" aria-label={t.nav.spaces}>
						<Link href="/bills" aria-current={space === 'bills' ? 'true' : undefined} onClick={() => remember('bills')}>
							{t.nav.spaceBills}
						</Link>
						<Link href={user ? (PROJECTS_ENABLED ? '/projects' : '/servers') : '/org'} aria-current={space === 'org' ? 'true' : undefined} onClick={() => remember('org')}>
							{t.nav.spaceOrg}
						</Link>
					</div>

					{/* Every item below needs an account: the bill list, creating a
					    bill, projects, teams and the server console. Someone signed
					    out gets the switcher, which leads to the landing pages, and
					    the sign-in button, rather than links to screens that can only
					    ask them to sign in or fail to load. */}
					{user && space === 'bills' && (
						<>
							<Link href="/bills" aria-current={pathname === '/bills' || pathname.startsWith('/a/') ? 'page' : undefined} className={`tab-btn ${pathname === '/bills' || pathname.startsWith('/a/') ? 'active' : ''}`}>
								{t.nav.myBills}
							</Link>
							<Link href="/activities" aria-current={pathname.startsWith('/activities') ? 'page' : undefined} className={`tab-btn ${pathname.startsWith('/activities') ? 'active' : ''}`}>
								{t.nav.newBill}
							</Link>
						</>
					)}
					{user && space === 'org' && (
						<>
							{PROJECTS_ENABLED && <Link href="/projects" aria-current={pathname.startsWith('/projects') || pathname.startsWith('/p/') ? 'page' : undefined} className={`tab-btn ${pathname.startsWith('/projects') || pathname.startsWith('/p/') ? 'active' : ''}`}>
								{t.nav.projects}
							</Link>}
							{TEAMS_ENABLED && <Link href="/teams" aria-current={pathname === '/teams' || pathname.startsWith('/teams/') || pathname.startsWith('/companies/') ? 'page' : undefined} className={`tab-btn ${pathname === '/teams' || pathname.startsWith('/teams/') || pathname.startsWith('/companies/') ? 'active' : ''}`}>
								{t.nav.teams}
							</Link>}
						</>
					)}
					{user && space && (
						<Link href="/servers" aria-current={pathname.startsWith('/servers') ? 'page' : undefined} className={`tab-btn ${pathname.startsWith('/servers') ? 'active' : ''}`}>
							{t.nav.servers}
						</Link>
					)}
					{isDev && (
						<Link href="/developer" className={`tab-btn ${pathname.startsWith('/developer') ? 'active' : ''}`}>
							Developer
						</Link>
					)}
					{user && <button type="button" className="btn btn-ghost nav-mobile-signout" onClick={handleLogout}>{t.nav.signOut}</button>}
				</div>

				<div className="nav-actions">
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
					<button ref={menuButton} type="button" className="btn btn-ghost nav-menu-toggle" aria-label={menuOpen ? t.nav.closeMenu : t.nav.openMenu} aria-expanded={menuOpen} aria-controls="main-navigation" onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}</button>
					{user ? (
						<div className="user-profile-badge">
							<Link href="/account" className="user-identity-link" aria-current={pathname.startsWith('/account') ? 'page' : undefined} aria-label={`${user.displayName} · ${t.nav.account}`}>
								<img src={avatarUrl} className="user-avatar" alt="" width={28} height={28} />
								<span className="user-name">{user.displayName}</span>
							</Link>
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
