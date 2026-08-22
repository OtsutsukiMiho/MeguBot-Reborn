'use client';

import { useEffect, useState } from 'react';
import { useCopy } from '../copy';

const ORDER = ['system', 'light', 'dark'];

// Sun, moon, and a half-filled disc for "follow the device".
const ICON = {
	system: (
		<>
			<circle cx="12" cy="12" r="8" />
			<path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none" />
		</>
	),
	light: (
		<>
			<circle cx="12" cy="12" r="4.2" />
			<path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
		</>
	),
	dark: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
};

export function applyTheme(mode) {
	const root = document.documentElement;
	if (mode === 'system') root.removeAttribute('data-theme');
	else root.setAttribute('data-theme', mode);
}

export default function ThemeToggle() {
	const { t } = useCopy();
	const [mode, setMode] = useState('system');
	const [ready, setReady] = useState(false);

	useEffect(() => {
		const saved = localStorage.getItem('megu-theme');
		setMode(ORDER.includes(saved) ? saved : 'system');
		setReady(true);
	}, []);

	function cycle() {
		const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
		setMode(next);
		localStorage.setItem('megu-theme', next);
		applyTheme(next);
	}

	return (
		<button
			type="button"
			className="theme-toggle"
			onClick={cycle}
			title={t.theme.title(t.theme.modes[mode])}
			aria-label={t.theme.change(t.theme.modes[mode])}
			// Rendered before hydration reads localStorage; hide the icon rather
			// than flash the wrong one.
			style={{ opacity: ready ? 1 : 0 }}
		>
			<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
				{ICON[mode]}
			</svg>
		</button>
	);
}
