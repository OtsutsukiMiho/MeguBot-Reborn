const { query } = require('./db.js');
const { newId } = require('./ids.js');
const { formatMoney, formatWhen } = require('./format.js');
const activities = require('./activities.js');
const notifications = require('./notifications.js');

// Megu nags on a schedule, but she is not a spammer. One person gets at most
// one message per cooldown window, and it covers everything they owe across
// every group at once — a statement, not a pile of pokes.

const DEFAULT_COOLDOWN_HOURS = 20;

// How far back the due-date sweep will look.
//
// Each deadline is announced exactly once, so without a window a server that
// was down for a fortnight would come back up and announce every deadline it
// slept through, all at once — a burst of Discord traffic produced by a
// restart, which is the precise shape DISCORD-RATE-LIMITS.md exists to stop.
// Anything older than this is not silently dropped: it is already overdue, and
// overdue is what the hourly statement sweep has always been for.
const DUE_WINDOW_HOURS = 72;

// The `payment_reminders.channel` value the due-date announcement writes. It
// doubles as the cooldown the hourly statement reads, so the two never arrive
// on the same day saying much the same thing.
const DUE_CHANNEL = 'payment-due';

/**
 * The scopes of one activity that can carry a payment deadline.
 *
 * A recurring agreement has one per month and always has. A one-off has
 * exactly one, and its deadline is `paymentDueAt` — deliberately not
 * `startsAt`, because the court is played on the 20th and settled on the 21st.
 */
function scopesOf(activity) {
	if (activity.kind === 'recurring' && activity.periods.length > 0) {
		return activity.periods.map(period => ({ periodId: period.id, period, dueAt: period.dueAt || null }));
	}
	return [{ periodId: null, period: null, dueAt: activity.paymentDueAt || null }];
}

/**
 * Every outstanding line, grouped by the person who owes it.
 *
 * Only people with a linked Discord account can be reached, so unclaimed
 * roster rows are skipped rather than silently counted.
 */
async function outstandingByPerson({ now = new Date() } = {}) {
	const withMoney = await query(`
		SELECT DISTINCT a.id
		FROM activities a
		JOIN expenses e ON e.activity_id = a.id
		WHERE a.plan_state <> 'cancelled'
	`);

	const people = new Map();

	for (const { id } of withMoney.rows) {
		const activity = await activities.getActivity(id);
		if (!activity) continue;

		for (const scope of scopesOf(activity)) {
			const sum = activities.settlement(activity, scope.periodId);
			if (sum.state !== 'open') continue;

			// A future due date is not yet late.
			if (scope.dueAt && new Date(scope.dueAt) > now) continue;

			for (const row of sum.unpaid) {
				const participant = activity.participants.find(p => p.id === row.participantId);
				if (!participant?.userId && !participant?.discordUid) continue;

				const personKey = `${participant.userId ? `user:${participant.userId}` : `discord:${participant.discordUid}`}:${activity.currency}`;
				if (!people.has(personKey)) {
					people.set(personKey, { userId: participant.userId || null, discordUid: participant.discordUid || null, displayName: participant.displayName, currency: activity.currency, lines: [], total: 0 });
				}
				const person = people.get(personKey);
				person.lines.push({
					activityId: activity.id,
					code: activity.code,
					title: activity.title,
					kind: activity.kind,
					periodId: scope.periodId,
					periodLabel: scope.period?.label || null,
					dueAt: scope.dueAt,
					participantId: participant.id,
					amountSatang: row.outstanding,
					currency: activity.currency,
					// Who this person actually owes, rather than whoever happened
					// to pay for the first thing that month. That guess was
					// standing in for a creditor the payments table could not
					// name; now it can, and on a trip where two people fronted
					// money it is routinely more than one person.
					creditors: sum.obligations
						.filter(o => o.debtorId === participant.id && o.outstandingSatang > 0)
						.map(o => ({
							participantId: o.creditorId,
							displayName: o.creditorName,
							amountSatang: o.outstandingSatang,
						})),
					// The single name, kept for messages that want to say "pay
					// ฟิก" — and null rather than a coin toss when there are two.
					owedTo: (() => {
						const mine = sum.obligations.filter(o => o.debtorId === participant.id && o.outstandingSatang > 0);
						return mine.length === 1 ? mine[0].creditorName : null;
					})(),
				});
				person.total += row.outstanding;
			}
		}
	}

	return [...people.values()];
}

async function lastRemindedAt(participantIds) {
	if (participantIds.length === 0) return new Map();
	const res = await query(
		`SELECT participant_id, MAX(sent_at) AS last FROM payment_reminders
		 WHERE participant_id = ANY($1::text[]) GROUP BY participant_id`,
		[participantIds],
	);
	return new Map(res.rows.map(r => [r.participant_id, new Date(r.last)]));
}

/**
 * Who should hear from Megu right now, with the message already written.
 * Returns nothing for anyone she spoke to inside the cooldown.
 */
async function due({ now = new Date(), cooldownHours = DEFAULT_COOLDOWN_HOURS, baseUrl = '' } = {}) {
	const people = await outstandingByPerson({ now });
	if (people.length === 0) return [];

	const allParticipantIds = people.flatMap(p => p.lines.map(l => l.participantId));
	const lastSeen = await lastRemindedAt(allParticipantIds);
	// Somebody who has already answered "not now, payday is the 25th" has said
	// everything a reminder was going to ask them. Asking again inside their
	// snooze is how a useful nag turns into the thing people mute.
	const deferred = await activities.activeDeferrals(allParticipantIds, { now });
	const cutoff = new Date(now.getTime() - cooldownHours * 3600 * 1000);

	const out = [];
	for (const person of people) {
		const fresh = person.lines.filter((line) => {
			if (deferred.has(line.participantId)) return false;
			const last = lastSeen.get(line.participantId);
			return !last || last < cutoff;
		});
		if (fresh.length === 0) continue;

		const total = fresh.reduce((sum, l) => sum + l.amountSatang, 0);
		out.push({
			userId: person.userId,
			discordUid: person.discordUid,
			displayName: person.displayName,
			lines: fresh,
			total,
			currency: person.currency,
			message: composeStatement({ displayName: person.displayName, lines: fresh, total, currency: person.currency, baseUrl, now }),
		});
	}
	return out;
}

/**
 * A statement, in Megu's voice at the top and the bank's format underneath.
 * Plain text so it survives any channel; the adapter decides how to dress it.
 */
function composeStatement({ displayName, lines, total, currency = 'THB', baseUrl = '', now = new Date(), locale = 'th' }) {
	const th = locale === 'th';
	const head = th
		? (lines.length === 1 ? `${displayName} มียอดค้างอยู่รายการนึงนะ` : `${displayName} มียอดค้างอยู่ ${lines.length} รายการนะ`)
		: (lines.length === 1 ? `${displayName}, you have one outstanding payment.` : `${displayName}, you have ${lines.length} outstanding payments.`);

	const body = lines.map((line) => {
		const when = line.periodLabel ? ` · ${line.periodLabel}` : '';
		const late = line.dueAt ? daysLate(line.dueAt, now) : null;
		const lateText = late && late > 0 ? (th ? `  (เลยกำหนด ${late} วัน)` : `  (${late} days overdue)`) : '';
		const link = baseUrl ? `\n   ${baseUrl}/a/${line.code}` : '';
		return `• ${line.title}${when}\n   ${formatMoney(line.amountSatang, line.currency || currency)}${lateText}${link}`;
	}).join('\n');

	const foot = lines.length > 1
		? `\n\n${th ? 'รวมทั้งหมด' : 'Total'} ${formatMoney(total, currency)}`
		: '';

	return `${head}\n\n${body}${foot}\n\n${th ? 'จ่ายแล้วกดแจ้งในลิงก์ได้เลย เดี๋ยวเราบอกเจ้าของให้' : 'After paying, use the link to submit it and Megu will tell the organizer.'}`;
}

/**
 * The deadline has arrived. Who needs to hear about it, and who cannot be told.
 *
 * This is a different message from the statement above, and deliberately so.
 * The statement is a summary of everything one person owes across every group,
 * which is the right shape for a nag and the wrong shape for a button: a single
 * "Pay" cannot mean four activities at once. So a due-date notice is scoped to
 * one activity, states one amount, and carries one link to one payment screen.
 *
 * Nothing here talks to Discord, email or HTTP. It reads Postgres and returns
 * sentences; an adapter decides what to do with them. That separation is what
 * lets the sweep run on a five-minute timer without breaking the rule about
 * short timers — a database poll is not a Discord call.
 *
 * Returns two lists, because a deadline produces two different problems:
 *
 *   `notices`      — one per person who owes and can actually be reached.
 *   `hostDigests`  — one per activity that has people who owe and cannot be
 *                    reached at all. Nobody linked an account, nobody linked
 *                    Discord, and there is no address to send anything to. The
 *                    organizer is the only one who can chase them, so Megu
 *                    hands them the list and a message to paste.
 */
async function paymentDueNow({ now = new Date(), baseUrl = '', windowHours = DUE_WINDOW_HOURS } = {}) {
	const windowStart = new Date(now.getTime() - windowHours * 3600 * 1000);
	const candidates = await query(`
		SELECT DISTINCT a.id
		FROM activities a
		JOIN expenses e ON e.activity_id = a.id
		LEFT JOIN periods p ON p.activity_id = a.id
		WHERE a.plan_state <> 'cancelled'
		  AND ((a.payment_due_at IS NOT NULL AND a.payment_due_at <= $1 AND a.payment_due_at > $2)
		    OR (p.due_at IS NOT NULL AND p.due_at <= $1 AND p.due_at > $2))
	`, [now, windowStart]);

	const notices = [];
	const hostDigests = [];

	for (const { id } of candidates.rows) {
		const activity = await activities.getActivity(id);
		if (!activity) continue;

		for (const scope of scopesOf(activity)) {
			if (!scope.dueAt) continue;
			const dueAt = new Date(scope.dueAt);
			if (dueAt > now || dueAt <= windowStart) continue;

			const sum = activities.settlement(activity, scope.periodId);
			if (sum.state !== 'open') continue;

			const unpaidIds = sum.unpaid.map(row => row.participantId);
			const deferred = await activities.activeDeferrals(unpaidIds, { now });
			// Idempotency that does not depend on the outbox. Only accounts get
			// an outbox row, and a roster line that came from Discord and never
			// made a Megu account is DMed directly — without this it would be
			// DMed again on every sweep for three days.
			const alreadyTold = await announcedSince(unpaidIds, scope.periodId, dueAt);
			const unreachable = [];

			for (const row of sum.unpaid) {
				const participant = activity.participants.find(p => p.id === row.participantId);
				if (!participant) continue;
				// Somebody who has already said "not now, payday is the 25th"
				// has answered this exact question. Asking again inside their
				// snooze is what makes a reminder something people mute.
				if (deferred.has(participant.id)) continue;
				if (alreadyTold.has(participant.id)) continue;

				const line = {
					activityId: activity.id,
					code: activity.code,
					title: activity.title,
					kind: activity.kind,
					periodId: scope.periodId,
					periodLabel: scope.period?.label || null,
					periodKey: scope.period?.key || null,
					dueAt: scope.dueAt,
					participantId: participant.id,
					displayName: participant.displayName,
					amountSatang: row.outstanding,
					currency: activity.currency,
				};

				if (!participant.userId && !participant.discordUid) {
					unreachable.push(line);
					continue;
				}

				notices.push({
					...line,
					userId: participant.userId || null,
					discordUid: participant.discordUid || null,
					ownerUserId: activity.ownerUserId,
					payUrl: scopedUrl(baseUrl, activity.code, scope.periodId, 'pay'),
					deferUrl: scopedUrl(baseUrl, activity.code, scope.periodId, 'defer'),
					// One deadline, one announcement. Re-editing the date is a
					// new deadline and deliberately produces a new key: the
					// organizer moved the goalposts and everyone should hear it.
					dedupeKey: `payment-due:${participant.id}:${scope.periodId || 'event'}:${dueAt.toISOString()}`,
				});
			}

			if (unreachable.length > 0) {
				hostDigests.push({
					ownerUserId: activity.ownerUserId,
					activityId: activity.id,
					code: activity.code,
					title: activity.title,
					periodId: scope.periodId,
					periodLabel: scope.period?.label || null,
					dueAt: scope.dueAt,
					currency: activity.currency,
					lines: unreachable,
					total: unreachable.reduce((sum_, line) => sum_ + line.amountSatang, 0),
					shareUrl: baseUrl ? `${baseUrl}/a/${activity.code}` : '',
					dedupeKey: `payment-due-host:${activity.id}:${scope.periodId || 'event'}:${dueAt.toISOString()}`,
				});
			}
		}
	}

	return { notices, hostDigests };
}

/**
 * Who has already been told about this exact deadline.
 *
 * The channel name is what distinguishes it from the hourly statement: those
 * rows exist to space out a nag, these exist to make a one-time announcement
 * happen once.
 */
async function announcedSince(participantIds, periodId, since) {
	if (participantIds.length === 0) return new Set();
	const res = await query(
		`SELECT DISTINCT participant_id FROM payment_reminders
		 WHERE participant_id = ANY($1::text[])
		   AND channel = $2
		   AND sent_at >= $3
		   AND (($4::text IS NULL AND period_id IS NULL) OR period_id = $4)`,
		[participantIds, DUE_CHANNEL, since, periodId],
	);
	return new Set(res.rows.map(row => row.participant_id));
}

/**
 * Where a button on a reminder actually lands.
 *
 * Both go to the payment screen, which is a route of its own rather than a
 * section of the activity page. That is what makes a reminder's button honest:
 * it opens the thing it names, with nothing else on it, and pressing back goes
 * somewhere sensible. Pointing at an anchor instead meant landing wherever the
 * layout happened to be mid-settle, on a screen that also offered to share the
 * invite link with other people.
 *
 * "Not now" keeps a query flag because it is not a different destination — it
 * is the same screen with its reason box already open, which an email's plain
 * link has no other way to ask for.
 */
function scopedUrl(baseUrl, code, periodId, action) {
	if (!baseUrl) return '';
	const params = new URLSearchParams();
	if (action === 'defer') params.set('defer', '1');
	if (periodId) params.set('period', periodId);
	const search = params.toString();
	return `${baseUrl}/a/${encodeURIComponent(code)}/pay${search ? `?${search}` : ''}`;
}

/**
 * The due-date message, in both directions at once: what is owed, and the
 * explicit invitation to say "not yet" instead of going quiet.
 *
 * The second half is not politeness. A reminder offering only one answer gets
 * ignored by everyone who cannot give it, and an ignored reminder tells the
 * organizer nothing at all.
 */
function composeDueNotice(notice, { locale = 'th' } = {}) {
	const th = locale === 'th';
	const amount = formatMoney(notice.amountSatang, notice.currency);
	const what = notice.periodLabel ? `${notice.title} · ${notice.periodLabel}` : notice.title;
	const when = formatWhen(notice.dueAt, th ? 'th' : 'en', { time: false });

	if (th) {
		return [
			`${notice.displayName} วันนี้ครบกำหนดจ่ายค่า "${what}" แล้วนะ`,
			'',
			`ยอดที่ต้องจ่าย ${amount}`,
			`ครบกำหนด ${when}`,
			'',
			'พร้อมจ่ายหรือยัง? กดปุ่มจ่ายเงินได้เลย',
			'ถ้ายังไม่พร้อม กด "ยังไม่จ่ายตอนนี้" แล้วบอกเหตุผลไว้ เดี๋ยวเราบอกให้ จะได้ไม่ต้องทวงกันเอง',
		].join('\n');
	}

	return [
		`${notice.displayName}, "${what}" is due today.`,
		'',
		`Amount ${amount}`,
		`Due ${when}`,
		'',
		'Ready to pay? The button below opens the payment screen.',
		'Not ready? Choose "Not now" and say why — Megu will pass it on, so nobody has to ask.',
	].join('\n');
}

/**
 * What the organizer is told about the people Megu cannot reach.
 *
 * These are roster rows that were typed as names and never claimed: no Megu
 * account, no Discord. There is no address to send anything to and no amount of
 * engineering invents one — so the honest thing is to say so, name them, and
 * hand over a message that can be pasted wherever the group actually talks.
 */
function composeHostDigest(digest, { locale = 'th' } = {}) {
	const th = locale === 'th';
	const what = digest.periodLabel ? `${digest.title} · ${digest.periodLabel}` : digest.title;
	const when = formatWhen(digest.dueAt, th ? 'th' : 'en', { time: false });
	const names = digest.lines.map(line => `• ${line.displayName} — ${formatMoney(line.amountSatang, line.currency || digest.currency)}`).join('\n');

	if (th) {
		return [
			`"${what}" ครบกำหนดจ่ายวันที่ ${when} แล้ว`,
			'',
			`${digest.lines.length} คนนี้ยังไม่จ่าย และเราส่งข้อความหาเขาเองไม่ได้ เพราะยังไม่ได้ผูกบัญชีหรือ Discord ไว้:`,
			names,
			'',
			`รวม ${formatMoney(digest.total, digest.currency)}`,
			'',
			'ก๊อปข้อความนี้ไปวางในกลุ่มได้เลย:',
			'—',
			composeForwardable(digest, { locale }),
		].join('\n');
	}

	return [
		`"${what}" was due on ${when}.`,
		'',
		`${digest.lines.length} people have not paid, and Megu has no way to reach them — no linked account, no Discord:`,
		names,
		'',
		`Total ${formatMoney(digest.total, digest.currency)}`,
		'',
		'Paste this into the group chat:',
		'—',
		composeForwardable(digest, { locale }),
	].join('\n');
}

/**
 * The message the organizer pastes. Written to be readable on its own, in a
 * group chat, by somebody who has never heard of Megu.
 */
function composeForwardable(digest, { locale = 'th' } = {}) {
	const th = locale === 'th';
	const what = digest.periodLabel ? `${digest.title} · ${digest.periodLabel}` : digest.title;
	const names = digest.lines.map(line => line.displayName).join(', ');
	const link = digest.shareUrl ? `\n${digest.shareUrl}` : '';

	return th
		? `${names} — ค่า "${what}" ครบกำหนดแล้วนะ กดลิงก์นี้เพื่อดูยอดและจ่ายได้เลย${link}`
		: `${names} — "${what}" is due. Open this link to see your amount and pay:${link}`;
}

/**
 * What the organizer hears when somebody chooses "not now".
 *
 * This is the whole payoff of the second button. Without it the organizer sees
 * an unpaid row and no explanation, which is exactly the state the feature was
 * meant to remove.
 */
function composeDeferralNotice({ displayName, title, periodLabel, amountSatang, currency, reason, snoozeUntil }, { locale = 'th' } = {}) {
	const th = locale === 'th';
	const what = periodLabel ? `${title} · ${periodLabel}` : title;
	const amount = formatMoney(amountSatang, currency);
	const back = formatWhen(snoozeUntil, th ? 'th' : 'en', { time: false });

	return th
		? [`${displayName} กด "ยังไม่จ่ายตอนนี้" สำหรับ "${what}" (${amount})`, '', `เหตุผล: ${reason}`, '', `เราจะเตือนเขาอีกทีวันที่ ${back} ยอดนี้ยังนับเป็นค้างชำระอยู่เหมือนเดิม`].join('\n')
		: [`${displayName} chose "Not now" for "${what}" (${amount}).`, '', `Reason: ${reason}`, '', `Megu will ask again on ${back}. The amount is still counted as outstanding.`].join('\n');
}

/**
 * Tell the organizer that somebody chose "not now", and why.
 *
 * Event-driven — one person pressed one button — so there is no timer and no
 * sweep involved. It goes through the same outbox as everything else, which
 * means it obeys the organizer's own channel choice and inherits the retry and
 * dedupe behaviour rather than reimplementing them.
 *
 * A deferral by somebody who is not on the roster, or on an activity whose
 * organizer is the person deferring, is not announced: the first cannot happen
 * and the second is Megu telling you what you just did.
 */
async function announceDeferral({ activity, participantId, deferral, baseUrl = '' }) {
	const participant = activity.participants.find(p => p.id === participantId);
	if (!participant || !activity.ownerUserId) return null;
	if (participant.userId && participant.userId === activity.ownerUserId) return null;

	const scope = scopesOf(activity).find(item => item.periodId === (deferral.periodId || null))
		|| { periodId: null, period: null };
	const row = activities.settlement(activity, scope.periodId).rows.find(entry => entry.participantId === participantId);
	const context = {
		displayName: participant.displayName,
		title: activity.title,
		periodLabel: scope.period?.label || null,
		amountSatang: Math.max(0, row?.outstanding || 0),
		currency: activity.currency,
		reason: deferral.reason,
		snoozeUntil: deferral.snoozeUntil,
	};

	return notifications.enqueue({
		userId: activity.ownerUserId,
		eventType: 'payment_deferred',
		dedupeKey: `payment-deferred:${deferral.id}`,
		payload: {
			activityTitle: activity.title,
			subjectTh: `${participant.displayName} ขอเลื่อนจ่าย · ${activity.title}`,
			subjectEn: `${participant.displayName} deferred a payment · ${activity.title}`,
			bodyTh: composeDeferralNotice(context, { locale: 'th' }),
			bodyEn: composeDeferralNotice(context, { locale: 'en' }),
			ctaUrl: baseUrl ? `${baseUrl}/a/${encodeURIComponent(activity.code)}` : null,
			ctaLabelTh: 'เปิดกิจกรรม',
			ctaLabelEn: 'Open activity',
		},
	});
}

function daysLate(dueAt, now = new Date()) {
	return Math.floor((now.getTime() - new Date(dueAt).getTime()) / 86400000);
}

/**
 * Write down that a reminder actually went out. Call this only after the
 * channel confirms delivery, so a failed send retries next run.
 *
 * `sentAt` is explicit rather than defaulting to the database clock: the
 * caller already knows which moment this batch belongs to, and passing it
 * keeps the cooldown testable without waiting a real day.
 */
async function markSent(line, { channel = 'discord-dm', sentAt = new Date() } = {}) {
	await query(
		`INSERT INTO payment_reminders (id, activity_id, period_id, participant_id, channel, amount_satang, sent_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[newId('rem'), line.activityId, line.periodId, line.participantId, channel, line.amountSatang, sentAt],
	);
}

module.exports = {
	DEFAULT_COOLDOWN_HOURS,
	DUE_WINDOW_HOURS,
	scopesOf,
	outstandingByPerson,
	due,
	paymentDueNow,
	composeStatement,
	composeDueNotice,
	composeHostDigest,
	composeForwardable,
	composeDeferralNotice,
	announceDeferral,
	daysLate,
	markSent,
};
