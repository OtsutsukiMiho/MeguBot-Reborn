'use client';

import { useEffect, useState } from 'react';
import HomeLanding from './components/landing/HomeLanding';
import HomeSignedIn from './components/landing/HomeSignedIn';

/**
 * `/` is two pages. Someone new gets the front door that sends them to bills
 * or to organisations; someone signed in gets what is waiting for them.
 *
 * The landing renders first and the greeting replaces it once the session is
 * known. Most visitors to `/` are new, so they never see a placeholder, and a
 * signed-in reader sees the landing for the length of one request.
 */
export default function HomePage() {
	const [user, setUser] = useState(null);

	useEffect(() => {
		let live = true;
		fetch('/api/megu/me', { credentials: 'same-origin' })
			.then(res => (res.ok ? res.json() : null))
			.then(data => { if (live && data?.loggedIn && data.user) setUser(data.user); })
			.catch(() => {});
		return () => { live = false; };
	}, []);

	return user ? <HomeSignedIn user={user} /> : <HomeLanding />;
}
