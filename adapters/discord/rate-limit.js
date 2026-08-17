// Everything about staying on the right side of Discord's rate limits lives
// here, so the bot process, the web process and the supervisor all agree on
// what "we are blocked" means and how long to wait.
//
// The block this guards against is NOT a normal 429. A 429 comes with a JSON
// error code and a retry_after and applies to one route. What takes the whole
// deploy down looks like this:
//
//   {"code":0,"message":"You are being blocked from accessing our API
//    temporarily due to exceeding global rate limits."}
//
// `code: 0` is not a Discord API error at all — it is Cloudflare, in front of
// discord.com, banning the egress IP. Not the token, not the application: the
// IP. Every request from the box fails at once, gateway included, which is why
// a single misbehaving interval can log every user out of the website.
//
// The ban is temporary, but it is extended by traffic. Retrying while blocked
// is the single worst thing the process can do, so everything here is built
// around one rule: once we see this, stop talking to Discord entirely until the
// cooldown expires. See DISCORD-RATE-LIMITS.md for the rules that keep us from
// getting here in the first place.

/** Long enough to outlast a typical Cloudflare block without guessing. */
const BLOCK_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Exit code the bot uses to tell index.js "I did not merely crash, Discord is
 * refusing this IP". The supervisor turns that into a long wait instead of its
 * usual quick restart. 75 is EX_TEMPFAIL, which is what this is.
 */
const BLOCK_EXIT_CODE = 75;

/**
 * Recognise the Cloudflare block in whatever we happen to be holding — a
 * response body, an Error, a discord.js rejection. Deliberately loose: a false
 * positive costs one unnecessary cooldown, a false negative costs the ban being
 * extended for another hour.
 */
function isGlobalBlock(value) {
	if (!value) return false;
	const text = typeof value === 'string'
		? value
		: (value.message || value.rawError && JSON.stringify(value.rawError) || String(value));
	return /blocked from accessing our API/i.test(text)
		|| /exceeding global rate limits/i.test(text);
}

/**
 * A one-line switch shared by anything that is about to call Discord. Callers
 * ask `blocked()` first and skip the call if it says yes, so a block never
 * turns into a retry storm that lengthens itself.
 */
function createBlockGuard({ cooldownMs = BLOCK_COOLDOWN_MS, onTrip = null } = {}) {
	let blockedUntil = 0;

	return {
		/** True while we should not touch Discord at all. */
		blocked() {
			return Date.now() < blockedUntil;
		},
		/** Whole seconds left, for telling a human when to come back. */
		retryAfterSeconds() {
			return Math.max(0, Math.ceil((blockedUntil - Date.now()) / 1000));
		},
		/**
		 * Feed every failed Discord response through this. Returns true if it
		 * recognised a block and started the cooldown.
		 */
		record(value) {
			if (!isGlobalBlock(value)) return false;
			const wasBlocked = Date.now() < blockedUntil;
			blockedUntil = Date.now() + cooldownMs;
			if (!wasBlocked && onTrip) onTrip(Math.ceil(cooldownMs / 1000));
			return true;
		},
		/** For tests and for a manual "we know it cleared" override. */
		clear() {
			blockedUntil = 0;
		},
	};
}

module.exports = {
	BLOCK_COOLDOWN_MS,
	BLOCK_EXIT_CODE,
	isGlobalBlock,
	createBlockGuard,
};
