// When Megu says a name, and when she keeps quiet.
//
// Two failures are covered here, and they are not the same shape. One person on
// bad wifi reconnecting six times is caught by the cooldown. Twenty different
// people arriving at once is not — every one of them passes the cooldown, and
// only a limit on the total stops her reading names over the top of a match.
// Both are the reason a server switches the feature off.

const assert = require('node:assert');
const {
	createAnnounceGuard,
	createSpeakerTracker,
	shortSpeakerName,
	DEFAULT_REGROUP_MS,
	resolveCooldownMs,
	resolveCount,
	cooldownMsFromSeconds,
	DEFAULT_COOLDOWN_MS,
	DEFAULT_FLOOD_COUNT,
	MAX_ENTRIES_PER_GUILD,
} = require('../core/voice-announce.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

const G = 'guild_a';
const G2 = 'guild_b';
const FIG = 'user_fig';
const OHM = 'user_ohm';

/** Most checks only care whether she spoke. */
function spoke(result) {
	return result.speak;
}

console.log('\none person: the reconnect loop');

{
	const guard = createAnnounceGuard();
	const t = 1_000_000;

	assert.strictEqual(spoke(guard.claim({ guildId: G, userId: FIG, event: 'join', now: t })), true);
	ok('the first arrival is announced');

	// Six reconnects across ninety seconds — the shape that produced this file.
	let said = 0;
	for (let i = 1; i <= 6; i++) {
		if (spoke(guard.claim({ guildId: G, userId: FIG, event: 'join', now: t + i * 15_000 }))) said++;
	}
	assert.strictEqual(said, 0, 'a reconnect inside the window was announced');
	ok('six reconnects in ninety seconds say nothing at all');

	const refused = guard.claim({ guildId: G, userId: FIG, event: 'join', now: t + 20_000 });
	assert.strictEqual(refused.reason, 'cooldown');
	assert.strictEqual(refused.enteredQuiet, false);
	ok('the caller is told it was the cooldown, not a burst');

	// Past the window it is a real return, and silence would now be the bug.
	assert.strictEqual(
		spoke(guard.claim({ guildId: G, userId: FIG, event: 'join', now: t + DEFAULT_COOLDOWN_MS })),
		true,
	);
	ok('coming back after the window is announced again');
}

console.log('\njoining and leaving are counted apart');

{
	const guard = createAnnounceGuard();
	const t = 2_000_000;

	assert.strictEqual(spoke(guard.claim({ guildId: G, userId: FIG, event: 'join', now: t })), true);
	// Leaving ten seconds later is real information and must not be swallowed
	// by the join that just happened.
	assert.strictEqual(spoke(guard.claim({ guildId: G, userId: FIG, event: 'leave', now: t + 10_000 })), true);
	ok('a goodbye is not silenced by the hello before it');

	assert.strictEqual(spoke(guard.claim({ guildId: G, userId: FIG, event: 'join', now: t + 20_000 })), false);
	ok('but coming straight back gets no second hello');
}

console.log('\none person does not silence another');

{
	const guard = createAnnounceGuard();
	const t = 3_000_000;

	assert.strictEqual(spoke(guard.claim({ guildId: G, userId: FIG, event: 'join', now: t })), true);
	assert.strictEqual(spoke(guard.claim({ guildId: G, userId: OHM, event: 'join', now: t + 1_000 })), true);
	ok('two people arriving together are both announced');

	// The same person in a different server is a different conversation.
	assert.strictEqual(spoke(guard.claim({ guildId: G2, userId: FIG, event: 'join', now: t + 2_000 })), true);
	ok('a cooldown in one server does not reach another');
}

console.log('\neverybody at once: the pile-in');

{
	const guard = createAnnounceGuard();
	const t = 8_000_000;

	// Every one of these is a different person, so the cooldown lets them all
	// through. Only the total limit can stop this.
	let said = 0;
	let notice = null;
	for (let i = 0; i < 20; i++) {
		const out = guard.claim({ guildId: G, userId: `raider_${i}`, event: 'join', now: t + i * 500 });
		if (out.speak) said++;
		if (out.enteredQuiet) notice = i;
	}

	assert.strictEqual(said, DEFAULT_FLOOD_COUNT, `said ${said} names, expected ${DEFAULT_FLOOD_COUNT}`);
	ok('twenty arrivals in ten seconds produce eight names, not twenty');

	assert.strictEqual(notice, DEFAULT_FLOOD_COUNT, 'the notice did not fire on the name that tipped it over');
	ok('the moment it goes quiet is reported exactly once');

	// And exactly once — the nineteen after it must not each ask to speak.
	const after = guard.claim({ guildId: G, userId: 'raider_late', event: 'join', now: t + 11_000 });
	assert.strictEqual(after.speak, false);
	assert.strictEqual(after.reason, 'flood');
	assert.strictEqual(after.enteredQuiet, false, 'the notice repeated during the same burst');
	ok('later arrivals in the same burst are silent and say nothing about it');

	assert.strictEqual(guard.isQuiet(G, t + 11_000), true);
	ok('the guild reads as quiet while it rides the burst out');
}

console.log('\nafter the burst');

{
	const guard = createAnnounceGuard({ floodCount: 3, floodWindowMs: 10_000, quietMs: 30_000 });
	const t = 9_000_000;

	for (let i = 0; i < 4; i++) {
		guard.claim({ guildId: G, userId: `p_${i}`, event: 'join', now: t + i * 100 });
	}
	assert.strictEqual(guard.isQuiet(G, t + 1_000), true);

	// Still inside the quiet period.
	assert.strictEqual(spoke(guard.claim({ guildId: G, userId: 'p_late', event: 'join', now: t + 29_000 })), false);
	ok('nothing is announced while the quiet period runs');

	// Once it lapses she speaks again, from an empty count — otherwise the
	// stale ticks would trip it a second time immediately.
	assert.strictEqual(spoke(guard.claim({ guildId: G, userId: 'p_after', event: 'join', now: t + 31_000 })), true);
	assert.strictEqual(guard.isQuiet(G, t + 31_000), false);
	ok('when it lapses she resumes, counting from empty');

	// A name refused during the quiet period was never spoken, so it must not
	// be sitting on a cooldown afterwards.
	const guard2 = createAnnounceGuard({ floodCount: 2, floodWindowMs: 10_000, quietMs: 20_000 });
	const u = 10_000_000;
	guard2.claim({ guildId: G2, userId: 'a', event: 'join', now: u });
	guard2.claim({ guildId: G2, userId: 'b', event: 'join', now: u + 100 });
	assert.strictEqual(spoke(guard2.claim({ guildId: G2, userId: FIG, event: 'join', now: u + 200 })), false);
	assert.strictEqual(spoke(guard2.claim({ guildId: G2, userId: FIG, event: 'join', now: u + 21_000 })), true);
	ok('a name silenced by a burst is not then held down by a cooldown it never earned');
}

console.log('\na slow trickle never trips it');

{
	const guard = createAnnounceGuard();
	const t = 11_000_000;

	// One person a minute for an hour. Well past the flood count in total, but
	// never inside one window — a normal evening must never go quiet.
	let said = 0;
	for (let i = 0; i < 60; i++) {
		if (spoke(guard.claim({ guildId: G, userId: `slow_${i}`, event: 'join', now: t + i * 60_000 }))) said++;
	}
	assert.strictEqual(said, 60);
	assert.strictEqual(guard.isQuiet(G, t + 60 * 60_000), false);
	ok('sixty arrivals spread over an hour are all announced');
}

console.log('\nsettings that arrived from a database row');

{
	assert.strictEqual(resolveCooldownMs(undefined), DEFAULT_COOLDOWN_MS);
	assert.strictEqual(resolveCooldownMs(null), DEFAULT_COOLDOWN_MS);
	assert.strictEqual(resolveCooldownMs(''), DEFAULT_COOLDOWN_MS);
	assert.strictEqual(resolveCooldownMs('banana'), DEFAULT_COOLDOWN_MS);
	assert.strictEqual(resolveCooldownMs(-5), DEFAULT_COOLDOWN_MS);
	ok('a blank or broken setting falls back rather than disabling the guard');

	assert.strictEqual(resolveCooldownMs('30000'), 30_000);
	assert.strictEqual(resolveCount('12', 8), 12);
	assert.strictEqual(resolveCount('12.7', 8), 12);
	assert.strictEqual(resolveCount('banana', 8), 8);
	ok('a number stored as text is still a number');

	// Zero is a real choice, not a missing value.
	const chatty = createAnnounceGuard({ cooldownMs: 0, floodCount: 0 });
	const t = 4_000_000;
	assert.strictEqual(spoke(chatty.claim({ guildId: G, userId: FIG, event: 'join', now: t })), true);
	assert.strictEqual(spoke(chatty.claim({ guildId: G, userId: FIG, event: 'join', now: t + 1 })), true);
	for (let i = 0; i < 50; i++) {
		assert.strictEqual(spoke(chatty.claim({ guildId: G, userId: `z_${i}`, event: 'join', now: t + 2 })), true);
	}
	ok('zero means no limit, for both the cooldown and the burst count');

	// A per-call override is what lets one guild's setting win over the default.
	const strict = createAnnounceGuard({ cooldownMs: 1_000 });
	assert.strictEqual(spoke(strict.claim({ guildId: G, userId: OHM, event: 'join', now: t, cooldownMs: 60_000 })), true);
	assert.strictEqual(spoke(strict.claim({ guildId: G, userId: OHM, event: 'join', now: t + 5_000, cooldownMs: 60_000 })), false);
	ok('a per-guild window overrides the process default');
}

console.log('\nseconds in the settings, milliseconds in the guard');

{
	assert.strictEqual(cooldownMsFromSeconds(120), 120_000);
	assert.strictEqual(cooldownMsFromSeconds('90'), 90_000);
	assert.strictEqual(cooldownMsFromSeconds(0), 0);
	ok('seconds become milliseconds, and an explicit zero survives the trip');

	// Unset must stay unset rather than becoming zero, or an untouched server
	// would announce every reconnect — the exact failure this guard prevents.
	assert.strictEqual(cooldownMsFromSeconds(undefined), undefined);
	assert.strictEqual(cooldownMsFromSeconds(null), undefined);
	assert.strictEqual(cooldownMsFromSeconds(''), undefined);
	assert.strictEqual(cooldownMsFromSeconds('banana'), undefined);
	assert.strictEqual(cooldownMsFromSeconds(-1), undefined);
	ok('a missing or broken setting falls through to the default, never to zero');

	// The path the bot actually takes: guild var -> seconds -> guard.
	const guard = createAnnounceGuard();
	const windowMs = cooldownMsFromSeconds('30');
	const t = 4_500_000;
	assert.strictEqual(spoke(guard.claim({ guildId: G, userId: FIG, event: 'join', now: t, cooldownMs: windowMs })), true);
	assert.strictEqual(spoke(guard.claim({ guildId: G, userId: FIG, event: 'join', now: t + 20_000, cooldownMs: windowMs })), false);
	assert.strictEqual(spoke(guard.claim({ guildId: G, userId: FIG, event: 'join', now: t + 31_000, cooldownMs: windowMs })), true);
	ok('a stored "30" gives a thirty second window end to end');
}

console.log('\nmalformed events stay silent');

{
	const guard = createAnnounceGuard();
	const t = 5_000_000;

	assert.strictEqual(guard.claim({ userId: FIG, event: 'join', now: t }).reason, 'invalid');
	assert.strictEqual(guard.claim({ guildId: G, event: 'join', now: t }).reason, 'invalid');
	assert.strictEqual(guard.claim({ guildId: G, userId: FIG, event: 'sideways', now: t }).reason, 'invalid');
	assert.strictEqual(guard.claim({ guildId: G, userId: FIG, event: 'join', now: NaN }).reason, 'invalid');
	assert.strictEqual(spoke(guard.claim()), false);
	ok('a missing guild, user, clock or unknown event says nothing');
}

console.log('\nleaving a guild clears it');

{
	const guard = createAnnounceGuard({ floodCount: 2, quietMs: 60_000 });
	const t = 6_000_000;

	guard.claim({ guildId: G, userId: FIG, event: 'join', now: t });
	guard.claim({ guildId: G, userId: OHM, event: 'join', now: t + 100 });
	guard.claim({ guildId: G, userId: 'third', event: 'join', now: t + 200 });
	assert.strictEqual(guard.isQuiet(G, t + 300), true);

	// She was disconnected and has rejoined: whoever is in there now is new to
	// her, and greeting them is correct even though the clock says otherwise.
	guard.forget(G);
	assert.strictEqual(guard.size(G), 0);
	assert.strictEqual(guard.isQuiet(G, t + 300), false);
	assert.strictEqual(spoke(guard.claim({ guildId: G, userId: FIG, event: 'join', now: t + 1_000 })), true);
	ok('forgetting a guild clears both the cooldowns and the quiet period');
}

console.log('\nmemory is bounded');

{
	const guard = createAnnounceGuard({ cooldownMs: 60_000, floodCount: 0 });
	const t = 7_000_000;

	// A thousand people through one channel, all inside the window so none of
	// them expires. Without the cap this map only ever grows.
	for (let i = 0; i < MAX_ENTRIES_PER_GUILD + 500; i++) {
		guard.claim({ guildId: G, userId: `user_${i}`, event: 'join', now: t + i });
	}
	assert.ok(
		guard.size(G) <= MAX_ENTRIES_PER_GUILD,
		`held ${guard.size(G)} entries, cap is ${MAX_ENTRIES_PER_GUILD}`,
	);
	ok('a busy guild cannot grow without bound');

	// Expiry is the ordinary path: once everyone is past the window, the next
	// claim clears them out rather than leaving a thousand dead rows behind.
	const quiet = createAnnounceGuard({ cooldownMs: 1_000, floodCount: 0 });
	for (let i = 0; i < 50; i++) {
		quiet.claim({ guildId: G2, userId: `user_${i}`, event: 'join', now: t });
	}
	assert.strictEqual(quiet.size(G2), 50);
	quiet.claim({ guildId: G2, userId: FIG, event: 'join', now: t + 10_000 });
	assert.strictEqual(quiet.size(G2), 1, 'expired entries were not pruned');
	ok('entries past the window are dropped on the next claim');
}

console.log('\nthe short name, for attributing a message');

{
	// The case this exists for: a company Discord wants the whole title when he
	// arrives, and none of it while he is typing.
	assert.strictEqual(shortSpeakerName('CEO คุณสมชาย สุขใจ'), 'สมชาย');
	assert.strictEqual(shortSpeakerName('VP Sarah Chen'), 'Sarah');
	assert.strictEqual(shortSpeakerName('Mr. John Smith'), 'John');
	assert.strictEqual(shortSpeakerName('Prof.  Alice   Brown'), 'Alice');
	ok('titles and honorifics come off the front, however many are stacked');

	// Thai writes the honorific against the name far more often than apart from
	// it, so token stripping alone leaves exactly what it was meant to remove.
	assert.strictEqual(shortSpeakerName('นายธีรภาพ บุญศรี'), 'ธีรภาพ');
	assert.strictEqual(shortSpeakerName('ดร.ธีรภาพ บุญศรี'), 'ธีรภาพ');
	assert.strictEqual(shortSpeakerName('นางสาวสมหญิง ใจดี'), 'สมหญิง');
	assert.strictEqual(shortSpeakerName('พี่โอม'), 'โอม');
	ok('a Thai honorific written against the name is removed too');

	// "นางสาว" must win over "นาง", or the name becomes "สาวสมหญิง".
	assert.strictEqual(shortSpeakerName('นางสาวสมหญิง'), 'สมหญิง');
	ok('the longest honorific matches first');

	// Stripping must not eat the name. "นายก" is a word.
	assert.strictEqual(shortSpeakerName('นายก'), 'นายก');
	assert.strictEqual(shortSpeakerName('คุณ'), 'คุณ');
	ok('a name that would be left too short keeps its prefix');

	assert.strictEqual(shortSpeakerName('สมชาย'), 'สมชาย');
	assert.strictEqual(shortSpeakerName('ไอดำ เลเวล six seven'), 'ไอดำ');
	ok('an ordinary name is returned as it was, minus anything after the first word');

	assert.strictEqual(shortSpeakerName(''), '');
	assert.strictEqual(shortSpeakerName('   '), '');
	assert.strictEqual(shortSpeakerName(null), '');
	assert.strictEqual(shortSpeakerName(undefined), '');
	assert.strictEqual(shortSpeakerName(42), '');
	ok('nothing in gives nothing out, without throwing');
}

console.log('\nnaming the speaker only when it changes');

{
	const tracker = createSpeakerTracker();
	const t = 12_000_000;

	assert.strictEqual(tracker.shouldName({ guildId: G, userId: FIG, now: t }), true);
	ok('the first message of a conversation is attributed');

	// The whole point: five lines in a row from one person is one name, not
	// five. This is what lets the name stay long.
	let named = 0;
	for (let i = 1; i <= 5; i++) {
		if (tracker.shouldName({ guildId: G, userId: FIG, now: t + i * 2_000 })) named++;
	}
	assert.strictEqual(named, 0);
	ok('five more lines from the same person add no further names');

	assert.strictEqual(tracker.shouldName({ guildId: G, userId: OHM, now: t + 12_000 }), true);
	ok('somebody else speaking is named');

	assert.strictEqual(tracker.shouldName({ guildId: G, userId: FIG, now: t + 13_000 }), true);
	ok('and the first one coming back is named again');

	// Long enough after the last line and the speaker is no longer obvious,
	// which is the other reason a chat client starts a new group.
	assert.strictEqual(tracker.shouldName({ guildId: G, userId: FIG, now: t + 14_000 }), false);
	assert.strictEqual(
		tracker.shouldName({ guildId: G, userId: FIG, now: t + 14_000 + DEFAULT_REGROUP_MS }),
		true,
	);
	ok('the same person is named again after a long enough silence');
}

console.log('\nthe tracker keeps servers apart');

{
	const tracker = createSpeakerTracker();
	const t = 13_000_000;

	tracker.shouldName({ guildId: G, userId: FIG, now: t });
	assert.strictEqual(tracker.shouldName({ guildId: G2, userId: FIG, now: t + 100 }), true);
	ok('the same person in another server is a new conversation');

	// She left; whoever speaks next has not been introduced to the room she
	// came back to.
	tracker.forget(G);
	assert.strictEqual(tracker.shouldName({ guildId: G, userId: FIG, now: t + 200 }), true);
	ok('forgetting a guild attributes the next message again');

	assert.strictEqual(tracker.shouldName({ guildId: G, userId: null, now: t }), false);
	assert.strictEqual(tracker.shouldName({ userId: FIG, now: t }), false);
	assert.strictEqual(tracker.shouldName(), false);
	ok('a malformed call names nobody');

	// Zero means name every message, which a quiet server may genuinely prefer.
	const always = createSpeakerTracker({ regroupMs: 0 });
	assert.strictEqual(always.shouldName({ guildId: G, userId: FIG, now: t }), true);
	assert.strictEqual(always.shouldName({ guildId: G, userId: FIG, now: t + 1 }), true);
	ok('a regroup window of zero names every message');
}

console.log(`\n${n} checks passed\n`);
