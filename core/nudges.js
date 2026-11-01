const { query, transaction } = require('./db.js');
const { newId } = require('./ids.js');
const { formatMoney, formatPeriod, formatWhen } = require('./format.js');
const activities = require('./activities.js');
const notifications = require('./notifications.js');

// The organiser presses a button and Megu asks on their behalf.
//
// The automatic sweeps in reminders.js decide for themselves who is late. This
// is the other half: a person deciding that now is the moment. It answers to
// the same rules anyway, because a button can be pressed as many times as a
// person is annoyed. One person hears about one activity at most once per
// cooldown, somebody who already said "not now" is left alone, and a message
// the organiser typed is added to the facts rather than replacing them, since
// the roster can name anyone in the server and none of them signed up to
// receive free text from a bot.
//
// Nothing here talks to Discord. A person with an account goes through the
// outbox, so their own channel choice holds. A roster row with only a Discord
// id is handed to `deliver`, one at a time, which is the adapter's guarded DM.

const NUDGE_COOLDOWN_HOURS = 12;
const MAX_NOTE = 300;
const MAX_TEXT = 100;
const DM_SPACING_MS = 1000;

// Two channel names, one cooldown. A nudge about money pushes the hourly
// statement back the way any other payment reminder does. A nudge about the
// plan says nothing about money, so the statement must not wait for it.
const MONEY_CHANNEL = 'manual-nudge';
const PLAN_CHANNEL = 'manual-nudge-plan';
const CHANNEL_OF = { unpaid: MONEY_CHANNEL, unanswered: PLAN_CHANNEL, attending: PLAN_CHANNEL };

const TOPICS = ['unpaid', 'unanswered', 'attending'];

function codedError(code) {
	const error = new Error(code);
	error.code = code;
	return error;
}

/**
 * Text somebody typed, made inert for Discord and bounded. A note can say
 * anything, but it cannot ping anyone or dress a link up as something else.
 */
function cleanText(value, max = MAX_TEXT) {
	return String(value ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, max)
		.replace(/[\\`*_~|>[\]#<]/g, '\\$&')
		.replace(/@/g, '@​');
}

/** The same words for somewhere Discord's escaping would show as stray marks. */
function plainText(value) {
	return String(value ?? '').replace(/\\([\\`*_~|>[\]#<])/g, '$1').replace(/\u200b/g, '');
}

function mayNudge(activity, account) {
	return Boolean(account && (account.id === activity.ownerUserId || account.id === activity.payee?.userId));
}

function isPresser(participant, sender) {
	return Boolean((sender.userId && participant.userId === sender.userId)
		|| (sender.discordUid && participant.discordUid === String(sender.discordUid)));
}

/** A poll asks a different question: whoever has not voted on every option. */
function unanswered(activity) {
	if (activity.slots.length > 0) {
		return activity.participants.filter(p => !activity.slots.every(slot => activity.slotVotes.some(v => v.participantId === p.id && v.slotId === slot.id)));
	}
	// A one-off with no time has not asked anybody anything yet.
	return activity.startsAt ? activity.participants.filter(p => p.rsvp === 'pending') : [];
}

/** Who each topic is about, before anybody's cooldown or snooze. */
function candidates(activity, period) {
	const out = { unpaid: [], unanswered: [], attending: [] };
	const sum = activities.settlement(activity, period?.id ?? null);
	if (sum.state === 'open') {
		for (const row of sum.unpaid) {
			const participant = activity.participants.find(p => p.id === row.participantId);
			if (participant) out.unpaid.push({ participant, amountSatang: row.outstanding });
		}
	}
	if (activity.kind !== 'recurring') {
		if (activity.planState === 'open') out.unanswered = unanswered(activity).map(participant => ({ participant, amountSatang: 0 }));
		if (['open', 'confirmed'].includes(activity.planState)) {
			out.attending = activity.participants.filter(p => p.rsvp === 'yes').map(participant => ({ participant, amountSatang: 0 }));
		}
	}
	return out;
}

async function recentNudges(client, activityId, since) {
	const res = await client.query(
		`SELECT participant_id, MAX(sent_at) AS last FROM payment_reminders
		 WHERE activity_id = $1 AND channel = ANY($2::text[]) AND sent_at > $3
		 GROUP BY participant_id`,
		[activityId, [MONEY_CHANNEL, PLAN_CHANNEL], since],
	);
	return new Map(res.rows.map(row => [row.participant_id, new Date(row.last)]));
}

function cutoffFor(now) {
	return new Date(now.getTime() - NUDGE_COOLDOWN_HOURS * 3600 * 1000);
}

function nextAllowed(last) {
	return new Date(last.getTime() + NUDGE_COOLDOWN_HOURS * 3600 * 1000);
}

/**
 * What the organiser is offered: every topic with somebody in it, and what
 * would happen to each person if they pressed send now.
 *
 * @returns {Promise<{ topics: Array<{ key: string, people: object[] }> }>}
 */
async function preview(activity, { sender = {}, period = null, now = new Date() } = {}) {
	const groups = candidates(activity, period);
	const recent = await recentNudges({ query }, activity.id, cutoffFor(now));
	const deferred = await activities.activeDeferrals(groups.unpaid.map(item => item.participant.id), { now });
	const topics = [];
	for (const key of TOPICS) {
		const people = groups[key].filter(({ participant }) => !isPresser(participant, sender)).map(({ participant, amountSatang }) => {
			const person = { id: participant.id, displayName: participant.displayName, amountSatang, state: 'ready' };
			if (!participant.userId && !participant.discordUid) {person.state = 'unreachable';}
			else if (key === 'unpaid' && deferred.has(participant.id)) {
				person.state = 'deferred';
				person.reason = deferred.get(participant.id).reason;
				person.until = deferred.get(participant.id).snoozeUntil;
			}
			else if (recent.has(participant.id)) {
				person.state = 'cooldown';
				person.until = nextAllowed(recent.get(participant.id)).toISOString();
			}
			return person;
		});
		if (people.length > 0) topics.push({ key, people });
	}
	return { topics };
}

function whatOf(activity, period, lang) {
	const title = cleanText(activity.title);
	if (!period) return title;
	return lang === 'th' ? `${title} รอบ${formatPeriod(period.key, 'th')}` : `${title}, ${formatPeriod(period.key, 'en')}`;
}

/** One message, written once per language. The note is added, never substituted. */
function composeNudge({ topic, activity, period = null, amountSatang = 0, senderName, note = '', locale = 'th' }) {
	const lang = locale === 'th' ? 'th' : 'en';
	const th = lang === 'th';
	const who = cleanText(senderName, 60) || 'Megu';
	const what = whatOf(activity, period, lang);
	const lines = [];
	if (topic === 'unpaid') {
		lines.push(th ? `${who} ฝากเตือนเรื่อง "${what}"` : `${who} asked Megu to remind you about "${what}"`);
		lines.push(th ? `ยอดของคุณ ${formatMoney(amountSatang, activity.currency, 'th')}` : `Your share is ${formatMoney(amountSatang, activity.currency, 'en')}`);
	}
	else if (topic === 'unanswered') {
		lines.push(th ? `${who} ถามว่าคุณจะเข้าร่วม "${what}" ไหม` : `${who} is asking whether you are joining "${what}"`);
	}
	else {
		lines.push(th ? `${who} ฝากเตือนเรื่อง "${what}"` : `${who} asked Megu to remind you about "${what}"`);
	}
	if (topic !== 'unpaid' && activity.startsAt) {
		const when = formatWhen(activity.startsAt, lang);
		lines.push(th ? `เวลา ${when}` : `When: ${when}`);
	}
	if (topic === 'attending' && activity.location) {
		const where = cleanText(activity.location);
		lines.push(th ? `สถานที่ ${where}` : `Where: ${where}`);
	}
	if (note) lines.push('', th ? `ข้อความจาก ${who}: ${note}` : `From ${who}: ${note}`);
	if (topic === 'unpaid') {
		lines.push('', th
			? 'โอนแล้วแนบสลิปจากปุ่มด้านล่างได้เลย ถ้ายังไม่พร้อม กด "ยังไม่จ่ายตอนนี้" แล้วบอกเหตุผลไว้'
			: 'Paid? Send your slip with the button below. Not ready? Press "Not now" and say why.');
	}
	else if (topic === 'unanswered') {
		lines.push('', activity.slots.length > 0
			? (th ? 'เลือกเวลาที่ว่างจากปุ่มด้านล่างได้เลย' : 'Choose the times that work for you with the button below.')
			: (th ? 'ตอบจากปุ่มด้านล่างได้เลย' : 'Answer with the button below.'));
	}
	return lines.join('\n');
}

function urlFor(baseUrl, code, topic, period) {
	if (!baseUrl) return null;
	const root = `${baseUrl}/a/${encodeURIComponent(code)}`;
	if (topic === 'unanswered') return `${root}/rsvp`;
	if (topic !== 'unpaid') return root;
	return `${root}/pay${period ? `?period=${encodeURIComponent(period.id)}` : ''}`;
}

/**
 * Hold a slot for each person before anything is sent. The lock makes two
 * presses, in the bot and on the web, take turns, so the second finds the first
 * one's rows and stands down. A failed send gives its slot back.
 */
async function claim(activity, targets, { channel, periodId, now }) {
	return transaction(async (client) => {
		await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`nudge:${activity.id}`]);
		const recent = await recentNudges(client, activity.id, cutoffFor(now));
		const claimed = new Map();
		for (const target of targets) {
			if (recent.has(target.participant.id)) continue;
			const id = newId('rem');
			await client.query(
				`INSERT INTO payment_reminders (id, activity_id, period_id, participant_id, channel, amount_satang, sent_at)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				[id, activity.id, periodId, target.participant.id, channel, target.amountSatang, now],
			);
			claimed.set(target.participant.id, id);
		}
		return { claimed, recent };
	});
}

function release(id) {
	return query('DELETE FROM payment_reminders WHERE id = $1', [id]);
}

/**
 * Send one nudge.
 *
 * @param {object} input
 * @param {object} input.activity     from activities.getActivity
 * @param {string} input.topic        unpaid, unanswered or attending
 * @param {string[]|null} [input.participantIds]  empty or null means everyone the topic covers
 * @param {string} [input.note]       the organiser's own words
 * @param {{ userId?: string, discordUid?: string, displayName: string }} input.sender
 * @param {object|null} [input.period]  the month, for a monthly bill
 * @param {string} [input.baseUrl]
 * @param {string} [input.lang]       the language for a person with no account
 * @param {Function} [input.deliver]  ({ discordUid, message, cta, defer, rsvp }) => { delivered, blocked, closed }
 * @returns {Promise<Array<{ id: string, displayName: string, state: string }>>}
 */
async function send({ activity, topic, participantIds = null, note = '', sender, period = null, baseUrl = '', lang = 'th', deliver = null, now = new Date(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
	if (!TOPICS.includes(topic)) throw codedError('nudge_topic_invalid');
	const cleanNote = cleanText(note, MAX_NOTE);
	// A plan reminder with no time and nothing typed would say only the title.
	if (topic === 'attending' && !activity.startsAt && !cleanNote) throw codedError('nudge_note_required');

	const picked = participantIds?.length ? new Set(participantIds) : null;
	const groups = candidates(activity, period);
	const targets = groups[topic].filter(({ participant }) => !isPresser(participant, sender) && (!picked || picked.has(participant.id)));
	if (targets.length === 0) throw codedError(picked ? 'nudge_picked_none' : 'nudge_nobody');

	const deferred = topic === 'unpaid'
		? await activities.activeDeferrals(targets.map(item => item.participant.id), { now })
		: new Map();
	const results = [];
	const sendable = [];
	for (const target of targets) {
		const { participant } = target;
		const base = { id: participant.id, displayName: participant.displayName };
		if (!participant.userId && !participant.discordUid) results.push({ ...base, state: 'unreachable' });
		else if (deferred.has(participant.id)) results.push({ ...base, state: 'deferred', reason: deferred.get(participant.id).reason, until: deferred.get(participant.id).snoozeUntil });
		else sendable.push(target);
	}

	const periodId = period?.id ?? null;
	const { claimed, recent } = await claim(activity, sendable, { channel: CHANNEL_OF[topic], periodId, now });
	const ctaUrl = urlFor(baseUrl, activity.code, topic, period);
	const deferUrl = topic === 'unpaid' && baseUrl
		? `${ctaUrl}${period ? '&' : '?'}defer=1`
		: null;
	const defer = topic === 'unpaid' ? { participantId: null, periodId, code: activity.code } : null;
	const rsvp = topic === 'unanswered' && activity.slots.length === 0 ? { code: activity.code } : null;
	const labels = {
		unpaid: { th: 'จ่ายเงิน', en: 'Pay now' },
		unanswered: activity.slots.length > 0 ? { th: 'เลือกเวลา', en: 'Choose times' } : { th: 'ตอบเลย', en: 'Answer' },
		attending: { th: 'เปิดกิจกรรม', en: 'Open activity' },
	}[topic];

	let blocked = false;
	let spaced = false;
	for (const target of sendable) {
		const { participant, amountSatang } = target;
		const base = { id: participant.id, displayName: participant.displayName };
		const claimId = claimed.get(participant.id);
		if (!claimId) {
			results.push({ ...base, state: 'cooldown', until: nextAllowed(recent.get(participant.id)).toISOString() });
			continue;
		}
		const words = { topic, activity, period, amountSatang, senderName: sender.displayName, note: cleanNote };
		const ownDefer = defer ? { ...defer, participantId: participant.id } : null;
		try {
			if (participant.userId) {
				const enqueued = await notifications.enqueue({
					userId: participant.userId,
					eventType: 'activity_nudge',
					dedupeKey: `activity-nudge:${claimId}`,
					payload: {
						activityTitle: activity.title,
						activityCode: activity.code,
						subjectTh: `${plainText(cleanText(sender.displayName, 60))} ฝากเตือนเรื่อง ${activity.title}`,
						subjectEn: `${plainText(cleanText(sender.displayName, 60))} sent a reminder about ${activity.title}`,
						bodyTh: composeNudge({ ...words, locale: 'th' }),
						bodyEn: composeNudge({ ...words, locale: 'en' }),
						emailBodyTh: plainText(composeNudge({ ...words, locale: 'th' })),
						emailBodyEn: plainText(composeNudge({ ...words, locale: 'en' })),
						ctaUrl,
						ctaLabelTh: labels.th,
						ctaLabelEn: labels.en,
						secondaryUrl: deferUrl,
						secondaryLabelTh: 'ยังไม่จ่ายตอนนี้',
						secondaryLabelEn: 'Not now',
						defer: ownDefer,
						rsvp,
					},
				});
				if (enqueued.channels === 0) {
					await release(claimId);
					results.push({ ...base, state: 'muted' });
				}
				else {results.push({ ...base, state: 'sent' });}
				continue;
			}
			// The first refusal is how a block announces itself. Nobody after it
			// is tried, and nothing is written down as said.
			if (blocked || !deliver) {
				await release(claimId);
				results.push({ ...base, state: 'blocked' });
				continue;
			}
			if (spaced) await wait(DM_SPACING_MS);
			spaced = true;
			const reply = await deliver({
				discordUid: participant.discordUid,
				message: composeNudge({ ...words, locale: lang }),
				cta: ctaUrl ? { label: labels[lang === 'th' ? 'th' : 'en'], url: ctaUrl } : null,
				defer: ownDefer ? { ...ownDefer, label: lang === 'th' ? 'ยังไม่จ่ายตอนนี้' : 'Not now', payLabel: lang === 'th' ? 'แนบสลิป' : 'Send slip' } : null,
				rsvp: rsvp ? { ...rsvp, yesLabel: lang === 'th' ? 'เข้าร่วม' : 'Join', noLabel: lang === 'th' ? 'ไม่เข้าร่วม' : 'Can\'t join' } : null,
			});
			if (reply?.delivered) {
				results.push({ ...base, state: 'sent' });
				continue;
			}
			await release(claimId);
			if (reply?.blocked) blocked = true;
			results.push({ ...base, state: reply?.blocked ? 'blocked' : 'closed' });
		}
		catch (error) {
			await release(claimId);
			results.push({ ...base, state: 'failed', error: error.message });
		}
	}
	return results;
}

/** The private answer to whoever pressed send: who heard, and who they still have to chase. */
function composeNudgeReport(results, { locale = 'th', shareUrl = '' } = {}) {
	const th = locale === 'th';
	const lang = th ? 'th' : 'en';
	const names = state => results.filter(item => item.state === state).map(item => cleanText(item.displayName, 60)).join(', ');
	const lines = [];
	const add = (state, line) => {
		const list = names(state);
		if (list) lines.push(line(list));
	};
	add('sent', list => (th ? `ส่งให้แล้ว: ${list}` : `Sent to: ${list}`));
	add('muted', list => (th ? `ปิดการแจ้งเตือนไว้ เลยไม่ได้ส่ง: ${list}` : `Notifications off, so not sent: ${list}`));
	add('closed', list => (th ? `ส่ง DM ไม่ได้ ต้องบอกเอง: ${list}` : `Could not be DMed, so you will have to tell them: ${list}`));
	add('blocked', list => (th ? `Discord ไม่รับข้อความตอนนี้ ลองใหม่ภายหลัง: ${list}` : `Discord is refusing messages right now. Try later for: ${list}`));
	add('failed', list => (th ? `ส่งไม่สำเร็จ ลองใหม่อีกที: ${list}` : `Failed, please try again: ${list}`));
	for (const item of results.filter(entry => entry.state === 'cooldown')) {
		const when = formatWhen(item.until, lang);
		const name = cleanText(item.displayName, 60);
		lines.push(th ? `${name} เพิ่งได้รับการเตือน เตือนอีกได้ตั้งแต่ ${when}` : `${name} was reminded recently. You can remind them again from ${when}`);
	}
	for (const item of results.filter(entry => entry.state === 'deferred')) {
		const when = formatWhen(item.until, lang, { time: false });
		const name = cleanText(item.displayName, 60);
		const reason = cleanText(item.reason, MAX_NOTE);
		lines.push(th ? `${name} ขอเลื่อนถึง ${when} เหตุผล: ${reason}` : `${name} asked to wait until ${when}. Reason: ${reason}`);
	}
	const unreachable = names('unreachable');
	if (unreachable) {
		lines.push(th
			? `${unreachable} ไม่ได้ใช้ Discord ส่งลิงก์นี้ให้เอง: ${shareUrl}`
			: `${unreachable} ${unreachable.includes(',') ? 'are' : 'is'} not on Discord. Send them this link: ${shareUrl}`);
	}
	return lines.join('\n').slice(0, 1900);
}

module.exports = { NUDGE_COOLDOWN_HOURS, MAX_NOTE, MONEY_CHANNEL, PLAN_CHANNEL, TOPICS, cleanText, plainText, mayNudge, preview, send, composeNudge, composeNudgeReport };
