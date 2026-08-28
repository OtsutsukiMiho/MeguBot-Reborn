'use client';

import Link from 'next/link';
import { ProposeSlots, TimePoll } from '../../../components/activity/Scheduling';
import { ScreenHead, useActivity } from '../../../components/activity/ActivityShell';
import { LiftCard, Rise, Stagger } from '../../../components/activity/Motion';
import { useCopy } from '../../../copy';

/**
 * One question, asked once: are you coming, and when can you.
 *
 * These two used to be separate panels several screens apart — the poll above
 * the roster, the going/not-going buttons below it — even though they are the
 * same decision at two stages of the same activity. Only one of them is ever
 * live, so the screen shows whichever one is, and nothing else.
 */
export default function AnswerScreen() {
	const { code, activity, busy, problem, call } = useActivity();
	const { t } = useCopy(activity.currency);
	const { me, participants, poll, planState, role } = activity;
	const isOwner = role === 'owner';
	const myRow = me ? participants.find(p => p.id === me.id) : null;
	const recurring = activity.kind === 'recurring';
	const answered = participants.filter(p => p.rsvp !== 'pending').length;

	return (
		<Stagger className="focus-screen">
			<Rise as="header">
				<ScreenHead
					title={t.screens.answerTitle}
					sub={t.screens.answerFor(activity.title)}
					backTo={`/a/${code}`}
					backLabel={t.screens.back}
				/>
			</Rise>

			{problem && <div className="error-note">{problem}</div>}

			{poll && planState === 'open' && (
				<Rise>
					<TimePoll poll={poll} me={me} isOwner={isOwner} busy={busy} call={call} total={participants.length} />
				</Rise>
			)}

			{!recurring && !activity.startsAt && !poll && planState === 'open' && (
				<LiftCard as="section" className="panel schedule-needed">
					<div className="panel-head"><span className="panel-title">{t.schedule.title}</span></div>
					<div>
						<p className="quiet-note">{isOwner ? t.schedule.ownerHint : t.schedule.waitingHint}</p>
						{isOwner && <ProposeSlots busy={busy} call={call} />}
					</div>
				</LiftCard>
			)}

			{me && !recurring && activity.startsAt && !poll && planState === 'open' && (
				<LiftCard as="section" className="panel">
					<div className="panel-head">
						<span className="panel-title">{t.rsvp.question(me.displayName)}</span>
						<span className="panel-count">{t.screens.answered} {answered}/{participants.length}</span>
					</div>
					<div>
						<div className="names" style={{ paddingTop: '.6rem' }}>
							<button
								type="button"
								className={`vote-btn ${myRow?.rsvp === 'yes' ? 'on-yes' : ''}`}
								disabled={busy}
								onClick={() => call('POST', '/rsvp', { rsvp: 'yes' })}
							>
								{t.rsvp.going}
							</button>
							<button
								type="button"
								className={`vote-btn ${myRow?.rsvp === 'no' ? 'on-no' : ''}`}
								disabled={busy}
								onClick={() => call('POST', '/rsvp', { rsvp: 'no' })}
							>
								{t.rsvp.notGoing}
							</button>
						</div>
					</div>
				</LiftCard>
			)}

			{/* Nothing to answer is a real answer, and saying so beats an empty
			    screen that reads as something failing to load. There are two
			    ways to arrive at one, and they need different sentences: a
			    question that is over, and a question Megu cannot attribute to
			    anybody yet. */}
			{!poll && !me && planState === 'open' && !recurring && activity.startsAt && (
				<LiftCard as="section" className="panel settled-note">
					<p>{t.screens.claimFirst}</p>
					<Link className="btn btn-secondary" href={`/a/${code}`}>{t.screens.summary}</Link>
				</LiftCard>
			)}

			{!poll && (recurring || planState !== 'open') && (
				<LiftCard as="section" className="panel settled-note">
					<p>{t.next.clear}</p>
					<Link className="btn btn-secondary" href={`/a/${code}`}>{t.screens.summary}</Link>
				</LiftCard>
			)}
		</Stagger>
	);
}
