'use client';

import { useState } from 'react';
import MeguMark from '../MeguMark';
import { tabKeys, useAutoplay } from './parts';
import styles from './landing.module.css';

const FACES = { a: '#8C5BB8', b: '#2E7D8C', c: '#A0623A' };

/**
 * One month of a bill, a day at a time: who has paid, whose slip is being
 * checked, and what Megu says that day. The point of the page in one widget.
 */
export default function MonthDemo({ t }) {
	const [index, setIndex] = useState(0);
	const stop = useAutoplay(t.steps.length, setIndex);
	const step = t.steps[index];
	const select = next => { stop(); setIndex(next); };

	return (
		<div>
			<div className={styles.demo} aria-label={t.label}>
				<div className={styles.demoTop}><h2>{t.title}</h2><span>{t.period}</span><b>{t.perHead}</b></div>
				<ul className={styles.roster}>
					<li>
						<span className={styles.face} style={{ background: '#3D4795' }} aria-hidden="true">{t.owner.name[0]}</span>
						<span className={styles.who}>{t.owner.name}<small>{t.owner.note}</small></span>
						<span className={styles.state} data-state="owner">{t.owner.state}</span>
					</li>
					{t.people.map(person => (
						<li key={person.id}>
							<span className={styles.face} style={{ background: FACES[person.id] }} aria-hidden="true">{person.name[0]}</span>
							<span className={styles.who}>{person.name}<small>{person.note}</small></span>
							<span className={styles.state} data-state={step.st[person.id]}>{t.states[step.st[person.id]]}</span>
						</li>
					))}
				</ul>
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
