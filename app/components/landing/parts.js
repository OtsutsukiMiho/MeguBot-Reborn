'use client';

import { useEffect, useRef } from 'react';
import { useLang } from '../LangProvider';
import { withFallback } from '../../copy/fallback';
import { COPY } from './copy';
import styles from './landing.module.css';

/** The landing copy in the reader's language, English underneath every gap. */
export function useLandingCopy() {
	const { lang } = useLang();
	return { t: withFallback(COPY.en, COPY[lang]), lang };
}

/**
 * A heading made of phrases that never break inside themselves. Thai has no
 * spaces between words, and a display face broken mid-word is the first thing
 * a reader notices; lines may only break between the phrases given.
 */
export function Phrases({ parts, as: Tag = 'span', className }) {
	return (
		<Tag className={className}>
			{parts.map((part, index) => (
				<span key={part}>
					{index > 0 && ' '}
					<span className={styles.nb}>{part}</span>
				</span>
			))}
		</Tag>
	);
}

/**
 * Marks a full-bleed hero the navbar should sit transparently over.
 *
 * The navbar lives in the layout and cannot hold a ref to a page's hero, and
 * on `/` and `/bills` the hero only appears once the page knows the reader is
 * signed out. Announcing mount and unmount lets the bar re-check at exactly
 * those moments instead of guessing with a timer.
 */
export function useLandingHero() {
	const ref = useRef(null);
	useEffect(() => {
		window.dispatchEvent(new Event('megu:landing-hero'));
		return () => window.dispatchEvent(new Event('megu:landing-hero'));
	}, []);
	return ref;
}

/** The QR on the example payment card. Decorative: it encodes nothing. */
export function ExampleQr() {
	return (
		<svg viewBox="0 0 29 29" shapeRendering="crispEdges" aria-hidden="true">
			<path fill="#15172B" d="M0 0h7v7H0zM1 1v5h5V1zM2 2h3v3H2zM22 0h7v7h-7zm1 1v5h5V1zm1 1h3v3h-3zM0 22h7v7H0zm1 1v5h5v-5zm1 1h3v3H2zM9 0h2v2H9zm4 1h2v3h-2zm3-1h3v2h-3zM9 4h3v2H9zm7 3h2v3h-2zM9 9h4v2H9zm6 0h2v4h-2zm4 0h3v2h-3zm5 0h2v3h-2zM0 9h2v3H0zm3 2h3v2H3zm8 2h3v2h-3zm7 1h4v2h-4zm6 2h5v2h-5zM2 15h4v2H2zm7 2h2v4H9zm4-1h3v2h-3zm5 2h2v3h-2zm4 1h3v2h-3zm4 3h3v3h-3zM9 23h3v2H9zm4 2h4v2h-4zm6-3h3v3h-3zm3 5h4v2h-4z" />
		</svg>
	);
}

/**
 * Steps through a demo once on arrival, then hands control to the reader. Any
 * click or key on a day stops it; a reader who prefers less motion never sees
 * it run at all.
 */
export function useAutoplay(count, setIndex, interval = 2600) {
	const timer = useRef(null);
	const stop = () => {
		if (timer.current) clearInterval(timer.current);
		timer.current = null;
	};
	useEffect(() => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
		let at = 0;
		timer.current = setInterval(() => {
			at += 1;
			if (at >= count) { stop(); return; }
			setIndex(at);
		}, interval);
		return stop;
	}, [count, setIndex, interval]);
	return stop;
}

/** Arrow-key movement across a row of tabs, as the ARIA tabs pattern expects. */
export function tabKeys(event, index, count, select) {
	const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
	if (!step) return;
	event.preventDefault();
	const next = (index + step + count) % count;
	select(next);
	event.currentTarget.parentElement.children[next]?.focus();
}
