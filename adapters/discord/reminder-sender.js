const core = require('../../core/index.js');
const { log } = require('../../core/log.js');

// Megu's mouth on Discord. Core decides who is late and what to say; this file
// only knows how to open a DM and whether it worked.

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

function statementEmbed(person) {
	const fields = person.lines.slice(0, 20).map((line) => {
		const late = line.dueAt ? core.reminders.daysLate(line.dueAt) : 0;
		return {
			name: line.periodLabel ? `${line.title} · ${line.periodLabel}` : line.title,
			value: [
				`**${core.format.formatMoney(line.amountSatang, line.currency || person.currency)}**`,
				late > 0 ? `เลยกำหนด ${late} วัน` : null,
			].filter(Boolean).join('  ·  '),
			inline: false,
		};
	});

	return {
		color: 0x1C2260,
		author: { name: 'Megu' },
		title: person.lines.length === 1 ? 'ยอดค้างชำระ' : `ยอดค้างชำระ ${person.lines.length} รายการ`,
		description: `${person.displayName} — นี่คือยอดที่ยังค้างอยู่นะ`,
		fields,
		footer: { text: `รวมทั้งหมด ${core.format.formatMoney(person.total, person.currency)}` },
		timestamp: new Date().toISOString(),
	};
}

/**
 * Send one round of reminders. Records each line only after Discord accepts
 * the message, so a closed DM or an outage simply retries next time.
 *
 * `isBlocked` lets the bot pass its rate-limit guard in without this module
 * having to know what a Cloudflare block is. A sweep is a DM per person in a
 * loop, which during a block is the worst possible thing to run — every one of
 * them fails and every one of them extends the ban. Skipping the round entirely
 * costs nothing: nothing is marked sent, so the same people are still due an
 * hour later.
 */
async function runOnce(client, { baseUrl = '', cooldownHours, isBlocked = () => false, recordFailure = () => false } = {}) {
	if (isBlocked()) {
		log('Megu', 'Reminder sweep skipped: Discord is refusing requests from this server.');
		return { people: 0, sent: 0, failed: 0, skipped: true };
	}

	const batch = await core.reminders.due({ baseUrl, cooldownHours });
	if (batch.length === 0) return { people: 0, sent: 0, failed: 0 };

	let sent = 0;
	let failed = 0;

	for (const person of batch) {
		// Re-checked every person, not just once at the top: the first refused
		// DM is how a block announces itself, and the rest of the batch must not
		// follow it into the wall.
		if (isBlocked()) {
			log('Megu', `Reminder sweep stopped early: Discord is refusing requests. ${batch.length - sent - failed} people left for next time.`);
			break;
		}
		try {
			if (person.userId) {
				const day = new Date().toISOString().slice(0, 10);
				await core.notifications.enqueue({
					userId: person.userId,
					eventType: 'payment_due',
					dedupeKey: `payment-reminder:${person.userId}:${person.currency}:${day}:${person.lines.map(line => line.participantId).sort().join(',')}`,
					payload: {
						activityTitle: person.lines.length === 1 ? person.lines[0].title : 'Payment reminder',
						subjectEn: person.lines.length === 1 ? `Payment due · ${person.lines[0].title}` : `${person.lines.length} payments are due`,
						subjectTh: person.lines.length === 1 ? `มียอดค้าง · ${person.lines[0].title}` : `มียอดค้าง ${person.lines.length} รายการ`,
						bodyEn: core.reminders.composeStatement({ ...person, baseUrl, locale: 'en' }),
						bodyTh: core.reminders.composeStatement({ ...person, baseUrl, locale: 'th' }),
						ctaUrl: person.lines.length === 1 && baseUrl ? `${baseUrl}/a/${person.lines[0].code}` : baseUrl || null,
					},
				});
				for (const line of person.lines) await core.reminders.markSent(line, { channel: 'notification-outbox' });
				sent++;
				continue;
			}
			const user = await client.users.fetch(person.discordUid);
			await user.send({
				content: person.lines.length === 1
					? `${person.displayName} ยังค้างอยู่นิดนึงนะ 🙂`
					: `${person.displayName} มีของค้างอยู่หลายรายการเลย 🙂`,
				embeds: [statementEmbed(person)],
			});
			for (const line of person.lines) {
				await core.reminders.markSent(line, { channel: 'discord-dm' });
			}
			sent++;
		}
		catch (error) {
			// Closed DMs are the normal case, not an incident — but a block
			// arrives here looking exactly like one, and swallowing it is how a
			// sweep turns into a hundred requests into a closed door. The guard
			// tells the two apart; the loop above stops as soon as it does.
			failed++;
			recordFailure(error);
			log('Megu', `Could not DM ${person.discordUid}: ${error.message}`);
		}
	}

	log('Megu', `Reminders: ${sent} sent, ${failed} unreachable, out of ${batch.length} people due`);
	return { people: batch.length, sent, failed };
}

/**
 * Start the hourly loop. Returns a stop function.
 */
function start(client, { intervalMs = DEFAULT_INTERVAL_MS, baseUrl = '', cooldownHours, isBlocked, recordFailure } = {}) {
	const tick = () => runOnce(client, { baseUrl, cooldownHours, isBlocked, recordFailure }).catch((error) => {
		log('Megu', `Reminder run failed: ${error.message}`);
	});

	const timer = setInterval(tick, intervalMs);
	// Give the bot a moment to finish connecting before the first sweep.
	const kickoff = setTimeout(tick, 30 * 1000);

	return () => {
		clearInterval(timer);
		clearTimeout(kickoff);
	};
}

module.exports = { runOnce, start, statementEmbed, DEFAULT_INTERVAL_MS };
