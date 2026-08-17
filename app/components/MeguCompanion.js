'use client';

import { useEffect, useRef, useState } from 'react';
import MeguMark from './MeguMark';

/**
 * Megu travelling down the page with the reader.
 *
 * The mark is fixed to the viewport and drifts as the page scrolls, so it
 * reads as one character accompanying you rather than four copies pasted into
 * four sections. Its mood is driven by whichever section is under the middle
 * of the screen, which turns the page into a short narrative: it is calm at
 * the top, asking while the four steps explain how it chases people, on watch
 * over the moderation half, and pleased at the close.
 *
 * It only exists where it can earn its keep. Below 1100px the column is too
 * narrow for a companion in the margin — it would sit on the words — and
 * under prefers-reduced-motion a thing that follows you is exactly what the
 * setting is asking not to happen.
 */

// Section -> mood. The order matches document order and the first match under
// the viewport's midline wins.
const BEATS = [
	{ selector: '.hero-field', mood: 'calm' },
	{ selector: '.flow', mood: 'asking' },
	{ selector: '.server-side', mood: 'alert' },
	{ selector: '.closing', mood: 'happy' },
];

export default function MeguCompanion() {
	const [mood, setMood] = useState('calm');
	const [shown, setShown] = useState(false);
	const ref = useRef(null);

	useEffect(() => {
		const narrow = window.matchMedia('(max-width: 1100px)');
		const still = window.matchMedia('(prefers-reduced-motion: reduce)');
		if (narrow.matches || still.matches) return;

		const el = ref.current;
		if (!el) return;

		const sections = BEATS
			.map(b => ({ ...b, node: document.querySelector(b.selector) }))
			.filter(b => b.node);
		if (!sections.length) return;

		const hero = document.querySelector('.hero-field');
		let frame = 0;

		const read = () => {
			frame = 0;
			const mid = window.innerHeight / 2;

			// Mood: whichever beat currently crosses the midline.
			for (let i = sections.length - 1; i >= 0; i--) {
				const r = sections[i].node.getBoundingClientRect();
				if (r.top <= mid && r.bottom >= 0) {
					setMood(sections[i].mood);
					break;
				}
			}

			// The companion only appears once the hero's own Megu has left, so
			// the two are never on screen together.
			const heroGone = hero ? hero.getBoundingClientRect().bottom < mid : true;
			setShown(heroGone);

			// Drift: a slow vertical travel across the whole document, which is
			// what makes it read as flowing down the page rather than parked.
			const max = document.documentElement.scrollHeight - window.innerHeight;
			const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
			el.style.setProperty('--travel', `${progress * 42}vh`);
			el.style.setProperty('--spin', `${progress * 26 - 13}deg`);
		};

		const onScroll = () => {
			if (!frame) frame = requestAnimationFrame(read);
		};

		read();
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll, { passive: true });

		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onScroll);
		};
	}, []);

	return (
		<div
			ref={ref}
			className={`megu-companion${shown ? ' is-shown' : ''}`}
			aria-hidden="true"
		>
			<MeguMark size={92} mood={mood} />
		</div>
	);
}
