'use client';

import { createContext, useContext, useEffect, useState } from 'react';

const LangContext = createContext({ lang: 'en', setLang: () => {} });

export const LANGS = [
	{ code: 'th', label: 'ไทย' },
	{ code: 'en', label: 'EN' },
];

const STORAGE_KEY = 'megu-lang';

/**
 * The switch lives in the navbar and the copy lives on the page, so the choice
 * has to sit above both.
 *
 * Three signals, in order of how much they are worth trusting:
 *
 *   1. what this person chose here before — always wins, in both directions
 *   2. what their device says it speaks — only consulted on a first visit
 *   3. English
 *
 * English is the default rather than Thai because the link gets forwarded
 * further than the group it started in, and a reader who cannot read the page
 * cannot find the switch that would fix it. A Thai device still lands on Thai
 * without touching anything.
 *
 * The first render is always the default: reading localStorage during render
 * would make the server's HTML and the browser's first paint disagree, and
 * React would throw the whole tree away and rebuild it.
 */
export function LangProvider({ children }) {
	const [lang, setLangState] = useState('en');

	useEffect(() => {
		let next = null;
		try {
			const saved = localStorage.getItem(STORAGE_KEY);
			if (saved === 'en' || saved === 'th') next = saved;
		}
		catch {}

		// `navigator.languages` is ordered by preference, so the first entry we
		// recognise wins and the rest are ignored. Asking whether Thai appears
		// anywhere in the list is the tempting version and the wrong one: a
		// browser set to English with Thai listed second — which is a common
		// setup here — would be handed a Thai page it did not ask for.
		if (!next && typeof navigator !== 'undefined') {
			for (const tag of [navigator.language, ...(navigator.languages || [])]) {
				const spoken = String(tag || '').toLowerCase();
				if (spoken.startsWith('th')) { next = 'th'; break; }
				if (spoken.startsWith('en')) { next = 'en'; break; }
			}
		}

		if (next && next !== 'en') setLangState(next);
	}, []);

	// Screen readers and the browser's own hyphenation both read this, and Thai
	// and Latin break lines by different rules.
	useEffect(() => {
		document.documentElement.lang = lang;
	}, [lang]);

	const setLang = (next) => {
		setLangState(next);
		try {
			localStorage.setItem(STORAGE_KEY, next);
		}
		catch {}
	};

	return (
		<LangContext.Provider value={{ lang, setLang }}>
			{children}
		</LangContext.Provider>
	);
}

export function useLang() {
	return useContext(LangContext);
}
