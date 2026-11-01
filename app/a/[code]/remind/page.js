'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ScreenHead, useActivity } from '../../../components/activity/ActivityShell';
import { Rise, Stagger } from '../../../components/activity/Motion';
import { useCopy } from '../../../copy';

/**
 * "Remind these people", the same thing the button on the Discord card does.
 *
 * The list comes from the server because a cooldown or a snooze decides who can
 * be picked, and what comes back after sending is one plain report of who heard.
 * A message goes out under the organiser's name and cannot be taken back, so the
 * screen says what each person will receive before anyone presses send.
 */
export default function RemindScreen() {
	const { code, activity, busy, problem, call } = useActivity();
	const { t, fmt } = useCopy(activity.currency);
	const [topics, setTopics] = useState(null);
	const [topicKey, setTopicKey] = useState(null);
	const [skipped, setSkipped] = useState(() => new Set());
	const [note, setNote] = useState('');
	const [report, setReport] = useState('');
	const isOwner = activity.role === 'owner';

	useEffect(() => {
		if (!isOwner) return undefined;
		let live = true;
		call('GET', '/nudge').then((data) => {
			if (live) setTopics(data?.topics || []);
		});
		return () => {
			live = false;
		};
	}, [call, isOwner]);

	const head = (
		<Rise as="header">
			<ScreenHead title={t.nudge.title} sub={t.screens.manageFor(activity.title)} backTo={`/a/${code}/manage`} backLabel={t.screens.back} />
		</Rise>
	);

	if (!isOwner) {
		return (
			<Stagger className="focus-screen">
				{head}
				<Rise as="section" className="panel settled-note">
					<p>{t.screens.manageDenied}</p>
					<Link className="btn btn-secondary" href={`/a/${code}`}>{t.screens.summary}</Link>
				</Rise>
			</Stagger>
		);
	}

	const topic = topics?.find(item => item.key === topicKey) || topics?.[0] || null;
	const chosen = topic ? topic.people.filter(person => person.state === 'ready' && !skipped.has(person.id)) : [];
	// A plan reminder with no time and nothing typed would say only the title.
	const needsNote = topic?.key === 'attending' && !activity.startsAt && !note.trim();
	const stateLine = (person) => {
		if (person.state === 'cooldown') return t.nudge.cooldown(fmt.when(person.until));
		if (person.state === 'deferred') return `${t.nudge.deferred(fmt.when(person.until, { time: false }))}: ${person.reason}`;
		if (person.state === 'unreachable') return t.nudge.unreachable;
		return null;
	};

	const send = async () => {
		const result = await call('POST', '/nudge', { topic: topic.key, participantIds: chosen.map(person => person.id), note });
		if (!result) return;
		setReport(result.report);
		setTopics(result.topics);
		setNote('');
		setSkipped(new Set());
	};

	const toggle = id => setSkipped((current) => {
		const next = new Set(current);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		return next;
	});

	return (
		<Stagger className="focus-screen">
			{head}

			{problem && <div className="error-note">{problem}</div>}

			{report && (
				<Rise as="section" className="panel" role="status">
					<div className="panel-head"><span className="panel-title">{t.nudge.reportTitle}</span></div>
					<p className="quiet-note" style={{ whiteSpace: 'pre-line', marginTop: 0 }}>{report}</p>
				</Rise>
			)}

			{topics && !topic && (
				<Rise as="section" className="panel settled-note">
					<p>{t.nudge.nobody}</p>
					<Link className="btn btn-secondary" href={`/a/${code}/manage`}>{t.screens.manageTitle}</Link>
				</Rise>
			)}

			{topic && (
				<Rise as="section" className="panel">
					<div className="stack-fields">
						{topics.length > 1 && (
							<fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
								<legend className="field-label">{t.nudge.who}</legend>
								<div className="segmented">
									{topics.map(item => (
										<span key={item.key} style={{ display: 'contents' }}>
											<input type="radio" id={`nudge-${item.key}`} name="nudge-topic" checked={item.key === topic.key} onChange={() => setTopicKey(item.key)} />
											<label htmlFor={`nudge-${item.key}`}>{t.nudge.topics[item.key]}</label>
										</span>
									))}
								</div>
							</fieldset>
						)}

						<p className="field-hint" style={{ margin: 0 }}>{t.nudge.willSee[topic.key]}</p>

						<div>
							{topic.people.map(person => (
								<label key={person.id} className="row nudge-person">
									<input
										type="checkbox"
										disabled={busy || person.state !== 'ready'}
										checked={person.state === 'ready' && !skipped.has(person.id)}
										onChange={() => toggle(person.id)}
									/>
									<span className="row-main">
										<span className="row-name">{person.displayName}</span>
										{stateLine(person) && <span className="row-sub" style={{ display: 'block' }}>{stateLine(person)}</span>}
									</span>
									{topic.key === 'unpaid' && <span className="row-figure fig-due">{fmt.money(person.amountSatang)}</span>}
								</label>
							))}
						</div>

						<div>
							<label className="field-label" htmlFor="nudge-note">{needsNote ? t.nudge.noteRequired : t.nudge.note}</label>
							<textarea id="nudge-note" className="form-control" rows={2} maxLength={300} placeholder={t.nudge.noteHint} value={note} onChange={e => setNote(e.target.value)} />
							<p className="field-hint">{t.nudge.limit}</p>
						</div>

						<div>
							<button type="button" className="btn btn-primary" disabled={busy || chosen.length === 0 || needsNote} onClick={send}>
								{chosen.length === 0 ? t.nudge.nobodyReady : t.nudge.send(chosen.length)}
							</button>
						</div>
					</div>
				</Rise>
			)}
		</Stagger>
	);
}
