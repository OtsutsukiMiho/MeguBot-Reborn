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
				`**${core.money.formatTHB(line.amountSatang)}**`,
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
		footer: { text: `รวมทั้งหมด ${core.money.formatTHB(person.total)}` },
		timestamp: new Date().toISOString(),
	};
}

/**
 * Send one round of reminders. Records each line only after Discord accepts
 * the message, so a closed DM or an outage simply retries next time.
 */
async function runOnce(client, { baseUrl = '', cooldownHours } = {}) {
	const batch = await core.reminders.due({ baseUrl, cooldownHours });
	if (batch.length === 0) return { people: 0, sent: 0, failed: 0 };

	let sent = 0;
	let failed = 0;

	for (const person of batch) {
		try {
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
			// Closed DMs are the normal case, not an incident.
			failed++;
			log('Megu', `Could not DM ${person.discordUid}: ${error.message}`);
		}
	}

	log('Megu', `Reminders: ${sent} sent, ${failed} unreachable, out of ${batch.length} people due`);
	return { people: batch.length, sent, failed };
}

/**
 * Start the hourly loop. Returns a stop function.
 */
function start(client, { intervalMs = DEFAULT_INTERVAL_MS, baseUrl = '', cooldownHours } = {}) {
	const tick = () => runOnce(client, { baseUrl, cooldownHours }).catch((error) => {
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
