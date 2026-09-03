// Whether Megu says a name out loud, and when she keeps quiet.
//
// The join announcement is the reason a server keeps her: you hear who arrived
// without tabbing out of a game. It is also the fastest way to get her muted,
// and there are two different ways it goes wrong.
//
// The first is one person. Discord reports a dropped-and-restored connection as
// a fresh join, so somebody on bad wifi has their name read out six times in
// ninety seconds. That is what the cooldown is for: a name is announced at most
// once per window. Joining and leaving are counted apart, so someone who leaves
// and comes back gets the goodbye and no second hello, which is the reading
// people expect.
//
// The second is everybody at once — a raid, or a channel filling up before a
// match. Every one of those is a different person, so every one passes the
// cooldown, and Megu reads twenty names over the top of people who are trying
// to talk. A clip is roughly two seconds, so twenty of them is most of a minute
// of solid speech. The cooldown cannot see this, because no single name repeats.
//
// So there is a second limit on the total: past so many announcements inside a
// window she stops, says one short line so nobody thinks she has broken, and
// stays quiet until the burst is over. One clip instead of twenty.
//
// Free of Discord and of the database — the whole decision is (guild, user,
// event, clock), so it can be tested against literals. The state is in memory
// on purpose. It is worth nothing after a restart, and a database write per
// voice event is exactly the steady pointless load DISCORD-RATE-LIMITS.md
// exists to prevent.

/**
 * A reconnect inside two minutes is a dropped connection, not a decision.
 * Much longer and stepping away for a coffee stops being announced, which
 * loses the very information the feature exists to give.
 */
const DEFAULT_COOLDOWN_MS = 2 * 60 * 1000;

/**
 * Six friends arriving for a match should all be named — that is the feature
 * working. Past eight in half a minute it is an event or a raid, and the names
 * have stopped being information.
 */
const DEFAULT_FLOOD_COUNT = 8;
const DEFAULT_FLOOD_WINDOW_MS = 30 * 1000;

/**
 * Long enough for a pile-in to finish. When it lapses the count starts from
 * empty, so a burst that is still going simply trips it again rather than
 * resuming into the middle of one.
 */
const DEFAULT_QUIET_MS = 60 * 1000;

/**
 * A busy guild is bounded so a long-running process cannot accumulate a row
 * per person who has ever joined. Entries expire on their own; this is the
 * backstop for the case where nobody speaks again and so nothing is pruned.
 */
const MAX_ENTRIES_PER_GUILD = 1000;

/** The two things she announces. Kept apart so a leave does not silence a join. */
const EVENTS = ['join', 'leave'];

function isEvent(value) {
	return EVENTS.includes(value);
}

/**
 * Read a duration that arrived from a settings row, where it may be a string,
 * a blank, or nonsense. Anything unusable falls back rather than turning the
 * limit off — a broken setting must never become an un-throttled feature.
 *
 * `0` is meaningful and honoured: it means "no limit", which some small server
 * will genuinely want.
 */
function resolveMs(value, fallback) {
	if (value === undefined || value === null || value === '') return fallback;
	const ms = Number(value);
	if (!Number.isFinite(ms) || ms < 0) return fallback;
	return ms;
}

/** Kept under its old name because callers read as "how long is the cooldown". */
function resolveCooldownMs(value, fallback = DEFAULT_COOLDOWN_MS) {
	return resolveMs(value, fallback);
}

/** Same rules, for a count rather than a duration. */
function resolveCount(value, fallback) {
	if (value === undefined || value === null || value === '') return fallback;
	const count = Number(value);
	if (!Number.isFinite(count) || count < 0) return fallback;
	return Math.floor(count);
}

/**
 * A settings field asks a human for seconds; the guard counts milliseconds.
 * Unset stays unset, so an untouched server falls through to the default
 * rather than to zero.
 */
function cooldownMsFromSeconds(value) {
	if (value === undefined || value === null || value === '') return undefined;
	const seconds = Number(value);
	if (!Number.isFinite(seconds) || seconds < 0) return undefined;
	return seconds * 1000;
}

/** The three outcomes, so a caller never has to guess why it was refused. */
function decision(speak, reason, enteredQuiet = false) {
	return { speak, reason, enteredQuiet };
}

/**
 * One guard per process. `claim()` both asks and records, unlike the split
 * `blocked()` / `record()` in the Discord block guard — the voice handler
 * awaits several database reads between deciding and speaking, and two events
 * for one person can interleave across those awaits. A single atomic step is
 * the only shape that cannot double-announce.
 *
 * It returns `{ speak, reason, enteredQuiet }` rather than a boolean because
 * there are genuinely three outcomes: say the name, stay quiet, or stay quiet
 * *and* tell the channel why — and only the last one should ever be spoken.
 */
function createAnnounceGuard(defaults = {}) {
	const base = {
		cooldownMs: resolveMs(defaults.cooldownMs, DEFAULT_COOLDOWN_MS),
		floodCount: resolveCount(defaults.floodCount, DEFAULT_FLOOD_COUNT),
		floodWindowMs: resolveMs(defaults.floodWindowMs, DEFAULT_FLOOD_WINDOW_MS),
		quietMs: resolveMs(defaults.quietMs, DEFAULT_QUIET_MS),
	};

	/** guildId -> { announced: Map(key -> when), ticks: number[], quietUntil: number|null } */
	const guilds = new Map();

	function stateFor(guildId) {
		let state = guilds.get(guildId);
		if (!state) {
			state = { announced: new Map(), ticks: [], quietUntil: null };
			guilds.set(guildId, state);
		}
		return state;
	}

	function pruneAnnounced(announced, now, windowMs) {
		for (const [key, at] of announced) {
			if (now - at >= windowMs) announced.delete(key);
		}
		// Expiry alone cannot bound a guild nobody has spoken in for a while, so
		// drop the oldest once the cap is passed. Map iterates in insertion
		// order and every write is a fresh insert, so the front is the oldest.
		while (announced.size > MAX_ENTRIES_PER_GUILD) {
			const oldest = announced.keys().next();
			if (oldest.done) break;
			announced.delete(oldest.value);
		}
	}

	return {
		/**
		 * May Megu say this name right now?
		 *
		 * Bad input answers no. Silence on a malformed event is free; speaking
		 * on one is the bug this file exists to prevent.
		 */
		claim({ guildId, userId, event, now = Date.now(), ...limits } = {}) {
			if (!guildId || !userId || !isEvent(event)) return decision(false, 'invalid');
			if (!Number.isFinite(now)) return decision(false, 'invalid');

			const cooldownMs = resolveMs(limits.cooldownMs, base.cooldownMs);
			const floodCount = resolveCount(limits.floodCount, base.floodCount);
			const floodWindowMs = resolveMs(limits.floodWindowMs, base.floodWindowMs);
			const quietMs = resolveMs(limits.quietMs, base.quietMs);

			const state = stateFor(guildId);

			// Already riding out a burst. Nothing is recorded while quiet: a name
			// she never said must not start a cooldown, or the first arrival
			// after the burst would be swallowed too.
			if (state.quietUntil !== null) {
				if (now < state.quietUntil) return decision(false, 'flood');
				state.quietUntil = null;
				state.ticks.length = 0;
			}

			const key = `${event}:${userId}`;
			if (cooldownMs > 0) {
				const last = state.announced.get(key);
				if (last !== undefined && now - last < cooldownMs) return decision(false, 'cooldown');
			}

			if (floodCount > 0) {
				state.ticks = state.ticks.filter(at => now - at < floodWindowMs);
				if (state.ticks.length >= floodCount) {
					// This one tips it over. Refuse the name and let the caller
					// say the short notice instead — one clip, at the noisiest
					// possible moment, rather than two.
					state.quietUntil = now + quietMs;
					state.ticks.length = 0;
					return decision(false, 'flood', true);
				}
				state.ticks.push(now);
			}

			// Delete before setting so the key moves to the back of the
			// insertion order, keeping the oldest-first pruning above honest.
			state.announced.delete(key);
			state.announced.set(key, now);
			pruneAnnounced(state.announced, now, cooldownMs);
			return decision(true, 'ok');
		},

		/** Is this guild currently riding out a burst? For the dashboard. */
		isQuiet(guildId, now = Date.now()) {
			const state = guilds.get(guildId);
			if (!state || state.quietUntil === null) return false;
			return now < state.quietUntil;
		},

		/**
		 * Forget a guild — she has left its voice channels, so the next arrival
		 * is genuinely new and deserves a greeting whatever happened before.
		 */
		forget(guildId) {
			guilds.delete(guildId);
		},

		/** Sizes, for tests and for the dashboard to show what is being held. */
		size(guildId) {
			if (guildId === undefined) return guilds.size;
			return guilds.get(guildId)?.announced.size ?? 0;
		},
	};
}

module.exports = {
	createAnnounceGuard,
	resolveCooldownMs,
	resolveCount,
	cooldownMsFromSeconds,
	DEFAULT_COOLDOWN_MS,
	DEFAULT_FLOOD_COUNT,
	DEFAULT_FLOOD_WINDOW_MS,
	DEFAULT_QUIET_MS,
	MAX_ENTRIES_PER_GUILD,
	EVENTS,
};
