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
// Discord now also documents code 40333 for this condition. Both are
// Cloudflare, in front of discord.com, restricting the egress IP. Not the token,
// not the application: the IP. Every request from the box fails at once,
// gateway included, which is why one invalid-request loop can log every user
// out of the website.
//
// The ban is temporary, but it is extended by traffic. Retrying while blocked
// is the single worst thing the process can do, so everything here is built
// around one rule: once we see this, stop talking to Discord entirely until the
// cooldown expires. See DISCORD-RATE-LIMITS.md for the rules that keep us from
// getting here in the first place.

/**
 * Discord does not publish how long a Cloudflare restriction lasts. The block
 * that prompted this guard was still live after 15 minutes, so the old
 * cooldown resumed traffic into the restriction and renewed it. Hold for an
 * hour plus a safety margin instead.
 */
const BLOCK_COOLDOWN_MS = 75 * 60 * 1000;

/** Ask @discordjs/rest to report progress toward its 10-minute invalid-request count. */
const INVALID_REQUEST_WARNING_INTERVAL = 25;

/**
 * Discord's published Cloudflare threshold is 10,000 invalid requests in ten
 * minutes. This bot should never be remotely close: 100 means a permission,
 * token, or retry loop is already broken. Stop at 1% of the hard limit so the
 * shared egress IP is protected before Discord has to protect itself.
 */
const INVALID_REQUEST_STOP_THRESHOLD = 100;

/** Stable code for calls skipped locally; callers may log or quietly discard it. */
const LOCAL_BLOCK_ERROR_CODE = 'MEGU_DISCORD_BLOCKED';

/** The same rolling window Discord and @discordjs/rest use for invalid requests. */
const INVALID_REQUEST_WINDOW_MS = 10 * 60 * 1000;

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
	const code = Number(value.code ?? value.rawError?.code ?? value.error?.code);
	if (code === 40333) return true;
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
		|| /DiscordAPIError\[0\]/i.test(text)
		|| /cloudflare is blocking your request/i.test(text);
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

/**
 * Put the block guard underneath discord.js itself.
 *
 * Feature-level wrappers are useful for returning shaped fallbacks, but they
 * are too easy to forget. Every manager method (`message.send`, `role.edit`,
 * `member.roles.add`, interaction replies, and direct `client.rest` calls)
 * eventually reaches `REST.request()`, so guarding that public method makes a
 * live block a hard process-wide circuit breaker. It also records failures
 * before a feature-level `.catch(() => undefined)` can swallow them.
 */
function guardRestClient(rest, guard) {
	if (!rest || typeof rest.request !== 'function') throw new TypeError('A Discord REST client is required.');
	if (!guard || typeof guard.blocked !== 'function' || typeof guard.record !== 'function') {
		throw new TypeError('A Discord block guard is required.');
	}
	if (rest.__meguBlockGuarded) return rest;

	const request = rest.request.bind(rest);
	Object.defineProperty(rest, '__meguBlockGuarded', { value: true });
	rest.request = async function guardedDiscordRequest(options) {
		if (guard.blocked()) {
			const error = new Error('Discord request skipped while the IP cooldown is active.');
			error.code = LOCAL_BLOCK_ERROR_CODE;
			throw error;
		}

		try {
			return await request(options);
		}
		catch (error) {
			guard.record(error);
			throw error;
		}
	};
	return rest;
}

/**
 * Consume @discordjs/rest's running invalid-request count. It already counts
 * exactly Discord's 401/403/429 set and resets the window after ten minutes.
 */
function recordInvalidRequestWarning(info, guard) {
	const count = Number(info?.count) || 0;
	if (count < INVALID_REQUEST_STOP_THRESHOLD || guard.blocked()) return false;
	guard.trip();
	return true;
}

/**
 * Keep route-level evidence for the aggregate invalid-request warning. Discord
 * only reports the total; without this, the log says danger is rising but not
 * whether the cause is a stale DM, missing role permission, or a member fetch.
 */
function createInvalidRequestDiagnostics({ windowMs = INVALID_REQUEST_WINDOW_MS } = {}) {
	let resetAt = 0;
	const routes = new Map();

	return {
		record(request, response, now = Date.now()) {
			const status = Number(response?.status);
			if (![401, 403, 429].includes(status)) return false;
			if (now >= resetAt) {
				routes.clear();
				resetAt = now + windowMs;
			}
			const method = String(request?.method || 'GET').toUpperCase();
			const route = String(request?.route || request?.path || 'unknown route');
			const key = `${status} ${method} ${route}`;
			routes.set(key, (routes.get(key) || 0) + 1);
			return true;
		},
		summary(limit = 3) {
			return [...routes]
				.sort((a, b) => b[1] - a[1])
				.slice(0, limit)
				.map(([route, count]) => `${route} ×${count}`)
				.join(', ');
		},
	};
}

module.exports = {
	BLOCK_COOLDOWN_MS,
	BLOCK_EXIT_CODE,
	INVALID_REQUEST_WARNING_INTERVAL,
	INVALID_REQUEST_STOP_THRESHOLD,
	LOCAL_BLOCK_ERROR_CODE,
	RATE_LIMIT_WAIT_CEILING_MS,
	isGlobalBlock,
	isSevereRateLimit,
	createBlockGuard,
	guardRestClient,
	recordInvalidRequestWarning,
	createInvalidRequestDiagnostics,
};
