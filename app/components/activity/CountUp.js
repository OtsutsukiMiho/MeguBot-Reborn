'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The figure counts up to itself once, on arrival.
 *
 * It earns the motion because the figure is the payload: somebody opened this
 * link from a group chat to find out one number, and a value that assembles
 * itself puts their eye on it without anything having to shout. Everything
 * else on the page is still.
 *
 * Three things keep it honest. It runs once per value, so a re-render does not
 * replay it. It is short — a count that takes a second is a page you are
 * waiting on. And `prefers-reduced-motion` skips straight to the answer, which
 * matters more here than anywhere: this is somebody's money, and the one thing
 * worse than a dull figure is a figure that appears to be changing.
 */
export default function CountUp({ value, format, className, duration = 620 }) {
	const [shown, setShown] = useState(value);
	const from = useRef(value);

	useEffect(() => {
		const target = value;
		const start = from.current;
		from.current = target;

		if (start === target) return undefined;
		if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
			setShown(target);
			return undefined;
		}

		let raf = 0;
		let t0 = 0;
		const step = (now) => {
			if (!t0) t0 = now;
			const p = Math.min(1, (now - t0) / duration);
			// Exponential ease-out: nearly all of the distance is covered
			// immediately, so the number is readable almost at once and only
			// the last digits settle.
			const eased = 1 - Math.pow(2, -10 * p);
			setShown(Math.round(start + (target - start) * (p === 1 ? 1 : eased)));
			if (p < 1) raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	}, [value, duration]);

	return <span className={className}>{format(shown)}</span>;
}
