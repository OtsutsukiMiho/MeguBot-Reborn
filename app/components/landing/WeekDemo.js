'use client';

import { useState } from 'react';
import MeguMark from '../MeguMark';
import { tabKeys, useAutoplay } from './parts';
import styles from './landing.module.css';

/**
 * One task's week, from assigned to accepted: its workflow state, how far
 * along it is, and what Megu says at each step. The org page's answer to the
 * bills page's month.
 */
export default function WeekDemo({ t }) {
	const [index, setIndex] = useState(0);
	const stop = useAutoplay(t.steps.length, setIndex);
	const step = t.steps[index];
	const select = next => { stop(); setIndex(next); };
	const stateOf = i => {
		if (i < step.step || (i === step.step && step.step === t.flow.length - 1)) return 'done';
		return i === step.step ? 'now' : undefined;
	};

	return (
		<div>
			<div className={styles.demo} aria-label={t.label}>
				<div className={styles.demoTop}><span>{t.no}</span><h2>{t.title}</h2><span style={{ marginLeft: 'auto' }}>{t.project}</span></div>
				<div className={styles.meta}>
					{t.meta.map(item => <div key={item.label}>{item.label}<b>{item.value}</b></div>)}
				</div>
				<ol className={styles.flow}>
					{t.flow.map((label, i) => <li key={label} data-step={stateOf(i)}>{label}</li>)}
				</ol>
				<div className={styles.bar} aria-hidden="true"><i style={{ width: `${step.bar}%` }} /></div>
				<div className={styles.says}>
					<span className={styles.saysAvatar}><MeguMark size={32} /></span>
					<p key={index} className={`${styles.bubble} ${index ? styles.bubbleSwap : ''}`} aria-live="polite">
						<small>{step.where}</small>{step.say}
					</p>
				</div>
				<div className={styles.days} role="tablist" aria-label={t.days}>
					{t.steps.map((item, i) => (
						<button
							key={`${item.day}-${item.label}`}
							type="button"
							role="tab"
							className={styles.day}
							aria-selected={i === index}
							tabIndex={i === index ? 0 : -1}
							onClick={() => select(i)}
							onKeyDown={event => tabKeys(event, i, t.steps.length, select)}
						>
							<b>{item.day}</b>{item.label}
						</button>
					))}
				</div>
			</div>
			<p className={styles.hint}>{t.hint}</p>
		</div>
	);
}
