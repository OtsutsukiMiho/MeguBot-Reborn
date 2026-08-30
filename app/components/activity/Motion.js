'use client';

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/**
 * Whether an entrance animation may be trusted to run at all.
 *
 * Framer Motion animates on `requestAnimationFrame`, and a hidden tab does not
 * get frames. A page that starts its children at `opacity: 0` and waits for an
 * animation that never runs is a blank page — measured, on this build, at
 * exactly that: two cards stuck at opacity 0 with the tab in the background.
 *
 * That is not a test artifact. Megu's whole distribution model is a link pasted
 * into a group chat, and links open in background tabs. Content that depends on
 * motion to become visible is content that can fail to arrive, so when the
 * document is hidden at mount the entrance is skipped and the final state is
 * rendered immediately. The animation is an enhancement; being readable is not.
 */
function useCanAnimate() {
	// Read once, synchronously, on the first client render. An effect is too
	// late: by the time it runs Framer Motion has already committed `opacity: 0`
	// inline, and undoing that needs a frame — the very thing a hidden tab is
	// not giving us. Server-side there is no document and no animation either
	// way, so it reports true and the markup matches.
	const [can] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
	return can;
}

/**
 * The page's one authored moment: cards arrive in sequence rather than all at
 * once. That is the whole of it — the arrival, and nothing after it. Motion
 * that continues to answer the pointer once the page has settled is the subject
 * of the note at the bottom of this file.
 *
 * Two rules keep it from becoming decoration. Nothing here animates a value —
 * the figure counts, the cards move, and those are separate concerns — and
 * every variant collapses to a still frame under `prefers-reduced-motion`,
 * which `useReducedMotion` reads for us. A settings screen full of somebody's
 * money is the last place a motion preference should be ignored.
 */

const EASE = [0.22, 0.61, 0.36, 1];

export function Stagger({ children, className, delay = 0 }) {
	const reduced = useReducedMotion();
	const canAnimate = useCanAnimate();
	const still = reduced || !canAnimate;
	return (
		<motion.div
			className={className}
			initial={still ? false : 'hidden'}
			animate="shown"
			variants={{
				hidden: {},
				// Small enough that the last card is on screen well inside half a
				// second — a stagger you have to wait through is a slow page
				// wearing a designer's clothes.
				shown: { transition: { staggerChildren: still ? 0 : 0.055, delayChildren: delay } },
			}}
		>
			{children}
		</motion.div>
	);
}

export function Rise({ children, className, as = 'div', ...rest }) {
	const reduced = useReducedMotion();
	const canAnimate = useCanAnimate();
	const still = reduced || !canAnimate;
	const Tag = motion[as] || motion.div;
	return (
		<Tag
			className={className}
			variants={{
				// Both the opacity and the offset collapse together: a variant that
				// only drops the movement still leaves the card invisible if the
				// animation never runs.
				hidden: still ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 },
				shown: { opacity: 1, y: 0, transition: { duration: 0.42, ease: EASE } },
			}}
			{...rest}
		>
			{children}
		</Tag>
	);
}

/*
 * There is deliberately no hover-lift component here.
 *
 * Every section on every activity screen used to be one: a `LiftCard` that
 * translated 3px on pointer enter. Measured on the organizer screen, that was
 * 57% of the content area answering the pointer, and the tallest of them was a
 * 2,200px column of form fields moving as one block — so aiming at an input
 * moved the input, and the QR on the pay screen slid out from under the pointer
 * that came to read it. None of those cards was clickable, which is the other
 * half of it: a lift is how an interface says "this is a target".
 *
 * A card that genuinely is a target takes the `lift` class in globals.css, which
 * does the same three pixels in CSS and is already switched off under
 * `prefers-reduced-motion`. A section that is a document gets no hover response
 * at all, because it is not answering anything.
 */
