'use client';

import { useState } from 'react';
import { useCopy } from '../../copy';

// Deciding when. Both of these belong to the same question — "which time
// works?" — and now live on the screen that asks it rather than halfway
// down a page about money.

export function TimePoll({ poll, me, isOwner, busy, call, total }) {
	const { t, fmt } = useCopy();
	const leading = poll.slots[0];
	const answered = poll.answered;
	const waiting = Math.max(total - answered, 0);
	const VOTE_LABEL = { yes: t.poll.free, maybe: t.poll.maybe, no: t.poll.busy };

	return (
		<section className="panel">
			<div className="panel-head">
				<span className="panel-title">{t.poll.title}</span>
				<span className="panel-count">{poll.ready ? t.poll.allAnswered : t.poll.waitingFor(waiting)}</span>
			</div>
			<div>
				{poll.slots.map(slot => (
					<div key={slot.id} className={`slot ${slot.id === leading?.id ? 'leading' : ''}`}>
						<div className="slot-main">
							<div className="slot-when">{fmt.when(slot.startsAt, { long: true })}</div>
							<div className="slot-tally">
								<span className="up">{t.poll.freeCount(slot.yes)}</span>
								{slot.maybe > 0 && <span>{t.poll.maybeCount(slot.maybe)}</span>}
								{slot.no > 0 && <span className="down">{t.poll.busyCount(slot.no)}</span>}
							</div>
						</div>
						{me && (
							<div className="slot-vote">
								{['yes', 'maybe', 'no'].map(answer => (
									<button
										key={answer}
										type="button"
										className={`vote-btn ${poll.myVotes[slot.id] === answer ? `on-${answer}` : ''}`}
										disabled={busy}
										onClick={() => call('POST', '/slots/vote', { votes: { [slot.id]: answer } })}
									>
										{VOTE_LABEL[answer]}
									</button>
								))}
							</div>
						)}
					</div>
				))}

				{leading && (
					<div className="verdict">
						<div>
							<div className="row-sub">{t.poll.meguSuggests}</div>
							<div className="verdict-when">{fmt.when(leading.startsAt, { long: true })}</div>
						</div>
						{isOwner && (
							<button type="button" className="btn btn-pay" disabled={busy || !poll.ready} onClick={() => call('POST', '/slots/lock')}>
								{t.poll.lockIt}
							</button>
						)}
					</div>
				)}
			</div>
		</section>
	);
}

export function ProposeSlots({ busy, call }) {
	const { t } = useCopy();
	const [times, setTimes] = useState(['', '', '']);

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				const startTimes = times.filter(Boolean);
				if (startTimes.length > 0) call('POST', '/slots', { startTimes });
			}}
			style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}
		>
			{times.map((time, i) => (
				<input
					key={i}
					className="form-control"
					type="datetime-local"
					value={time}
					onChange={e => setTimes(prev => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
					aria-label={t.poll.option(i + 1)}
				/>
			))}
			<button type="button" className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setTimes(prev => [...prev, ''])}>
				{t.poll.anotherOption}
			</button>
			<button type="submit" className="btn btn-primary btn-block" disabled={busy || times.filter(Boolean).length === 0}>
				{t.poll.askForMe}
			</button>
		</form>
	);
}
