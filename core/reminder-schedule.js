// When a daily reminder goes out next.
//
// The obvious rule — "the time it just fired, plus a day" — is wrong the first
// time the bot is down for a while. A reminder for 08:00 that was due three
// days ago comes back as due two days ago, fires on the next tick, comes back
// as due yesterday, fires again: three copies of the same reminder five
// seconds apart, sent to someone who missed nothing by getting one.
//
// So a missed run is caught up once, and the next one is the first slot that
// is still in the future.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The first `time + k * periodMs` strictly after `now`, keeping the time of day
 * the reminder was set for. Bad input answers `now + periodMs` rather than a
 * time in the past, which would make the reminder fire on every tick.
 */
function nextOccurrence(time, now = Date.now(), periodMs = DAY_MS) {
	const at = Number(time);
	const current = Number(now);
	const period = Number(periodMs);
	if (!Number.isFinite(current)) throw new Error('reminder_clock_invalid');
	if (!Number.isFinite(at) || !Number.isFinite(period) || period <= 0) return current + DAY_MS;
	if (at > current) return at;
	const missed = Math.floor((current - at) / period) + 1;
	return at + missed * period;
}

module.exports = { nextOccurrence, DAY_MS };
