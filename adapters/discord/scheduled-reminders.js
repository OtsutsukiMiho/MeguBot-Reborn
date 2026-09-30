'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;
// Only explicit Discord destination/permission failures retire a schedule.
const TERMINAL_CODES = new Set([10003, 10004, 50001, 50013]);

function nextOccurrence(time, now = Date.now()) {
	if (!Number.isFinite(now)) throw new Error('reminder_clock_invalid');
	const at = Number(time);
	if (!Number.isFinite(at)) throw new Error('reminder_time_invalid');
	return at > now ? at : at + (Math.floor((now - at) / DAY_MS) + 1) * DAY_MS;
}

function createReminderRunner({ database, deliver, afterDelivery = async () => {}, isBlocked = () => false, now = Date.now, onError = () => {} }) {
	// ponytail: one bot process, not a distributed claim. A crash after sending
	// but before persistence can replay; multiple bot replicas need DB claims.
	let running = false;
	const attempts = new Map();
	return async function tick() {
		if (running || isBlocked()) return;
		running = true;
		try {
			const reminders = await database.getActiveReminders({ throwOnError: true });
			const active = new Set(reminders.map(r => `${r.id}:${r.reminder_time}`));
			for (const key of attempts.keys()) if (!active.has(key)) attempts.delete(key);
			for (const reminder of reminders) {
				if (isBlocked()) break;
				const key = `${reminder.id}:${reminder.reminder_time}`;
				let attempt = attempts.get(key);
				if (!(Number(reminder.reminder_time) <= now()) || attempt?.retryAt > now()) continue;
				if (!attempt?.delivered && !attempt?.terminal) {
					try {
						const result = await deliver(reminder);
						attempt = { delivered: true, result };
					}
					catch (error) {
						// A shared Discord circuit break always leaves the occurrence due.
						if (isBlocked()) break;
						attempt = { terminal: TERMINAL_CODES.has(Number(error?.code)), retryAt: now() + RETRY_MS };
						onError(error, reminder, attempt.terminal ? 'terminal' : 'retryable');
					}
					attempts.set(key, attempt);
				}
				if (!attempt.delivered && !attempt.terminal) continue;
				try {
					const recurring = reminder.recurring === true || reminder.recurring === 'true';
					const persisted = recurring && !attempt.terminal
						? await database.updateReminderTime(reminder.id, nextOccurrence(reminder.reminder_time, now()))
						: await database.deleteReminder(reminder.id);
					if (persisted !== true) throw new Error('reminder_persistence_failed');
					attempts.delete(key);
				}
				catch (error) {
					// Retry persistence without sending an already accepted message again.
					attempt.retryAt = now() + RETRY_MS;
					onError(error, reminder, 'persistence');
					continue;
				}
				if (attempt.delivered) {
					try { await afterDelivery(reminder, attempt.result); }
					catch (error) { onError(error, reminder, 'voice'); }
				}
			}
		}
		catch (error) { onError(error, null, 'tick'); }
		finally { running = false; }
	};
}

module.exports = { createReminderRunner, nextOccurrence, DAY_MS, RETRY_MS };
