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
		: (value.message || (value.rawError && JSON.stringify(value.rawError)) || String(value));
	return /blocked from accessing our API/i.test(text)
		|| /exceeding global rate limits/i.test(text)
		|| /ssl.*alert.*40/i.test(text)
		|| /tls.*alert/i.test(text)
		|| /1015/i.test(text)
		|| (/Cloudflare/i.test(text) && /rate.*limit/i.test(text))
		|| /"code":\s*0\b/.test(text)
		|| /DiscordAPIError\[0\]/i.test(text);
}

/** Longest per-route wait still worth sleeping through rather than failing. */
const RATE_LIMIT_WAIT_CEILING_MS = 3000;

/**
 * Is this rate limit one we must fail the call for, rather than wait out?
 *
 * @discordjs/rest decides between the two by calling `rejectOnRateLimit`, and
 * its default — wait, then send anyway — is unsafe here. Its retry path for an
 * unexpected 429 is:
 *
 *     await sleep(retryAfter);
 *     return this.runRequest(routeId, url, options, requestData, retries);
 *
 * `retries` is passed through, not incremented, so that path has no cap. As long
 * as Discord keeps answering 429 the request sleeps and sends again, forever,
 * and the promise never settles — so no `.catch()` above it ever runs. Against
 * an IP that is banned *because of traffic*, that is a machine for keeping the
 * ban alive with no trace in the logs.
 *
 * A short, known per-route wait is ordinary traffic management and fine to sleep
 * through. Everything else fails:
 *
 * - a global limit applies to the whole token and is the documented step before
 *   Cloudflare stops answering at all;
 * - a wait of more than a few seconds is not traffic management any more;
 * - a 429 with no usable wait attached is the Cloudflare signature. That block
 *   answers 429 without Discord's rate-limit headers, so the wait comes out
 *   zero — and a zero-length sleep in the loop above is a busy loop.
 *
 * Reads only public RateLimitData fields, so it does not depend on which
 * internal path produced the limit, and when in doubt it fails the call. That is
 * the safe direction: a dropped request costs one feature one refresh, a retry
 * loop costs everyone the hour.
 *
 * @param {{ global?: boolean, scope?: string, timeToReset?: number }} data
 */
function isSevereRateLimit(data) {
	if (!data) return true;
	if (data.global || data.scope === 'global') return true;

	const wait = Number(data.timeToReset);
	const shortAndKnown = Number.isFinite(wait) && wait > 0 && wait <= RATE_LIMIT_WAIT_CEILING_MS;
	return !shortAndKnown;
}

/**
 * A one-line switch shared by anything that is about to call Discord. Callers
 * ask `blocked()` first and skip the call if it says yes, so a block never
 * turns into a retry storm that lengthens itself.
 */
function createBlockGuard({ cooldownMs = BLOCK_COOLDOWN_MS, onTrip = null } = {}) {
	let until = 0;

	/**
	 * Start the cooldown. `record` goes through here once it has recognised a
	 * block, and the early-warning path calls it directly: a burst of *global*
	 * 429s says the ban is coming even though it has not arrived yet, and the
	 * cheapest way to not get banned is to stop before it does.
	 */
	function trip(untilMs = Date.now() + cooldownMs) {
		const wasBlocked = Date.now() < until;
		until = Math.max(until, untilMs);
		if (!wasBlocked && onTrip) onTrip(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
		return true;
	}

	return {
		/** True while we should not touch Discord at all. */
		blocked() {
			return Date.now() < until;
		},
		/** Whole seconds left, for telling a human when to come back. */
		retryAfterSeconds() {
			return Math.max(0, Math.ceil((until - Date.now()) / 1000));
		},
		/** The timestamp the cooldown ends at, for handing to another process. */
		blockedUntil() {
			return until;
		},
		/**
		 * Feed every failed Discord response through this. Returns true if it
		 * recognised a block and started the cooldown.
		 */
		record(value) {
			if (!isGlobalBlock(value)) return false;
			return trip();
		},
		trip,
		/**
		 * Adopt a block another process discovered. The ban is on the IP, so it
		 * applies to every process on the box — but each one holds its own
		 * guard in memory and would otherwise only learn about the block by
		 * making a request that fails. That request is exactly what we are
		 * trying not to send, so whoever finds out first tells the others
		 * through the supervisor (see index.js).
		 *
		 * Silent by design: `onTrip` is the "we caused this" announcement and
		 * belongs to the process that actually saw the refusal.
		 */
		adopt(untilMs) {
			const stamp = Number(untilMs) || 0;
			if (stamp <= until) return false;
			until = stamp;
			return true;
		},
		/** For tests and for a manual "we know it cleared" override. */
		clear() {
			until = 0;
		},
	};
}

module.exports = {
	BLOCK_COOLDOWN_MS,
	BLOCK_EXIT_CODE,
	RATE_LIMIT_WAIT_CEILING_MS,
	isGlobalBlock,
	isSevereRateLimit,
	createBlockGuard,
};
