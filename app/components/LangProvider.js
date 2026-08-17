'use client';

import { createContext, useContext, useEffect, useState } from 'react';

const LangContext = createContext({ lang: 'th', setLang: () => {} });

export const LANGS = [
	{ code: 'th', label: 'ไทย' },
	{ code: 'en', label: 'EN' },
];

/**
 * The switch lives in the navbar and the copy lives on the page, so the choice
 * has to sit above both. Thai is the default and is never guessed from the
 * browser: this is a Thai product, and a stored preference is the only signal
 * worth trusting.
 */
export function LangProvider({ children }) {
	const [lang, setLangState] = useState('th');

	useEffect(() => {
		try {
			const saved = localStorage.getItem('megu-lang');
			if (saved === 'en' || saved === 'th') setLangState(saved);
		}
		catch {}
	}, []);

	const setLang = (next) => {
		setLangState(next);
		try {
			localStorage.setItem('megu-lang', next);
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
