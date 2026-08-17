const { query } = require('./db.js');
const { newId } = require('./ids.js');
const { formatTHB } = require('./money.js');
const activities = require('./activities.js');

// Megu nags on a schedule, but she is not a spammer. One person gets at most
// one message per cooldown window, and it covers everything they owe across
// every group at once — a statement, not a pile of pokes.

const DEFAULT_COOLDOWN_HOURS = 20;

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

		const scopes = activity.kind === 'recurring' && activity.periods.length > 0
			? activity.periods.map(p => ({ periodId: p.id, period: p }))
			: [{ periodId: null, period: null }];

		for (const scope of scopes) {
			const sum = activities.settlement(activity, scope.periodId);
			if (sum.state !== 'open') continue;

			// A future due date is not yet late.
			if (scope.period?.dueAt && new Date(scope.period.dueAt) > now) continue;

			for (const row of sum.unpaid) {
				const participant = activity.participants.find(p => p.id === row.participantId);
				if (!participant?.discordUid) continue;

				if (!people.has(participant.discordUid)) {
					people.set(participant.discordUid, { discordUid: participant.discordUid, displayName: participant.displayName, lines: [], total: 0 });
				}
				const person = people.get(participant.discordUid);
				person.lines.push({
					activityId: activity.id,
					code: activity.code,
					title: activity.title,
					kind: activity.kind,
					periodId: scope.periodId,
					periodLabel: scope.period?.label || null,
					dueAt: scope.period?.dueAt || null,
					participantId: participant.id,
					amountSatang: row.outstanding,
					owedTo: activity.participants.find(p => p.id === activity.expenses.find(e => e.periodId === scope.periodId)?.paidBy)?.displayName || null,
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
	const cutoff = new Date(now.getTime() - cooldownHours * 3600 * 1000);

	const out = [];
	for (const person of people) {
		const fresh = person.lines.filter((line) => {
			const last = lastSeen.get(line.participantId);
			return !last || last < cutoff;
		});
		if (fresh.length === 0) continue;

		const total = fresh.reduce((sum, l) => sum + l.amountSatang, 0);
		out.push({
			discordUid: person.discordUid,
			displayName: person.displayName,
			lines: fresh,
			total,
			message: composeStatement({ displayName: person.displayName, lines: fresh, total, baseUrl, now }),
		});
	}
	return out;
}

/**
 * A statement, in Megu's voice at the top and the bank's format underneath.
 * Plain text so it survives any channel; the adapter decides how to dress it.
 */
function composeStatement({ displayName, lines, total, baseUrl = '', now = new Date() }) {
	const head = lines.length === 1
		? `${displayName} มียอดค้างอยู่รายการนึงนะ`
		: `${displayName} มียอดค้างอยู่ ${lines.length} รายการนะ`;

	const body = lines.map((line) => {
		const when = line.periodLabel ? ` · ${line.periodLabel}` : '';
		const late = line.dueAt ? daysLate(line.dueAt, now) : null;
		const lateText = late && late > 0 ? `  (เลยกำหนด ${late} วัน)` : '';
		const link = baseUrl ? `\n   ${baseUrl}/a/${line.code}` : '';
		return `• ${line.title}${when}\n   ${formatTHB(line.amountSatang)}${lateText}${link}`;
	}).join('\n');

	const foot = lines.length > 1
		? `\n\nรวมทั้งหมด ${formatTHB(total)}`
		: '';

	return `${head}\n\n${body}${foot}\n\nจ่ายแล้วกดแจ้งในลิงก์ได้เลย เดี๋ยวเราบอกเจ้าของให้`;
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
	outstandingByPerson,
	due,
	composeStatement,
	daysLate,
	markSent,
};
