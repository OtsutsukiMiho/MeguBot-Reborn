require('dotenv').config();
const assert = require('node:assert');
const core = require('../core/index.js');

const { users, activities, voice, db } = core;
const created = { users: [] };
let n = 0;
function ok(msg) {
	n++;
	console.log(`  ok  ${msg}`);
}

const SAT_17 = '2026-08-22T17:00:00+07:00';
const SAT_19 = '2026-08-22T19:00:00+07:00';
const SUN_17 = '2026-08-23T17:00:00+07:00';

async function main() {
	await core.initCoreSchema();

	const fig = await users.loginWithIdentity({
		provider: 'discord', providerUid: '__poll_fig__', username: 'fig', displayName: 'ฟิก',
	});
	created.users.push(fig.user.id);

	const act = await activities.createActivity({
		ownerUserId: fig.user.id,
		title: 'ตีแบด',
		participants: [
			{ displayName: 'ฟิก', userId: fig.user.id },
			{ displayName: 'โอม' },
			{ displayName: 'นัท' },
			{ displayName: 'A' },
		],
	});

	let full = await activities.getActivity(act.id);
	assert.strictEqual(full.startsAt, null, 'nobody has picked a time yet');
	assert.strictEqual(full.slots.length, 0);
	ok('activity starts with no time — exactly the state a group chat gets stuck in');

	await activities.proposeSlots(act.id, [SAT_17, SAT_19, SUN_17]);
	full = await activities.getActivity(act.id);
	assert.strictEqual(full.slots.length, 3);
	assert.strictEqual(activities.pollReady(full), false);
	ok('three times on the table, poll not ready — nobody answered');

	const P = Object.fromEntries(full.participants.map(p => [p.displayName, p.id]));
	const S = Object.fromEntries(full.slots.map((s, i) => [['sat17', 'sat19', 'sun17'][i], s.id]));

	// โอม can only do Saturday evening; นัท cannot do Saturday at all.
	await activities.voteSlot(S.sat17, P['ฟิก'], 'yes');
	await activities.voteSlot(S.sat19, P['ฟิก'], 'yes');
	await activities.voteSlot(S.sun17, P['ฟิก'], 'maybe');

	await activities.voteSlot(S.sat17, P['โอม'], 'no');
	await activities.voteSlot(S.sat19, P['โอม'], 'yes');
	await activities.voteSlot(S.sun17, P['โอม'], 'no');

	await activities.voteSlot(S.sat17, P['นัท'], 'no');
	await activities.voteSlot(S.sat19, P['นัท'], 'no');
	await activities.voteSlot(S.sun17, P['นัท'], 'yes');

	full = await activities.getActivity(act.id);
	assert.strictEqual(activities.pollReady(full), false, 'A has still not answered');
	ok('poll waits for the last person instead of guessing');

	const silent = full.participants.filter(p => !full.slotVotes.some(v => v.participantId === p.id));
	assert.deepStrictEqual(silent.map(p => p.displayName), ['A']);
	ok(`Megu knows exactly who is holding it up — ${voice.say('pollWaiting', { names: silent.map(p => p.displayName) }, { seed: act.id })}`);

	await activities.voteSlot(S.sat17, P['A'], 'maybe');
	await activities.voteSlot(S.sat19, P['A'], 'yes');
	await activities.voteSlot(S.sun17, P['A'], 'no');

	full = await activities.getActivity(act.id);
	assert.strictEqual(activities.pollReady(full), true);
	ok('everyone answered, poll is ready');

	const standing = activities.slotStanding(full);
	console.log('\n  standing:');
	for (const s of standing) {
		const when = new Date(s.startsAt).toLocaleString('th-TH', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
		console.log(`    ${when}   ไป ${s.yes}  อาจ ${s.maybe}  ไม่ ${s.no}   คะแนน ${s.score}`);
	}

	const winner = activities.bestSlot(full);
	assert.strictEqual(winner.slotId, S.sat19, 'Saturday 19:00 is the only slot with a single objection');
	assert.strictEqual(winner.no, 1);
	ok('Megu picks เสาร์ 19:00 — the time fewest people are blocked on, not the most popular');

	const sat17 = standing.find(s => s.slotId === S.sat17);
	assert.ok(standing.indexOf(winner) < standing.indexOf(sat17));
	assert.ok(sat17.no > winner.no);
	ok('a slot two people vetoed sinks below one with a single veto');

	await activities.lockBestSlot(act.id);
	full = await activities.getActivity(act.id);
	assert.strictEqual(new Date(full.startsAt).toISOString(), new Date(SAT_19).toISOString());
	assert.strictEqual(full.planState, 'confirmed');
	ok('locking the winner sets the time and confirms the plan — the decision nobody wanted to make');

	const rsvp = Object.fromEntries(full.participants.map(p => [p.displayName, p.rsvp]));
	assert.deepStrictEqual(rsvp, { 'ฟิก': 'yes', 'โอม': 'yes', 'นัท': 'no', 'A': 'yes' });
	ok('นัท said no to that time, so Megu marks them out without anyone having to ask');

	console.log(`\n  ${voice.say('pollDecided', { when: 'เสาร์ 19:00', count: 3 }, { seed: act.id })}`);

	// Re-proposing wipes the old poll rather than leaving stale half-answers.
	await activities.proposeSlots(act.id, [SUN_17]);
	full = await activities.getActivity(act.id);
	assert.strictEqual(full.slots.length, 1);
	assert.strictEqual(full.slotVotes.length, 0);
	ok('re-proposing clears the old votes instead of mixing them in');

	await assert.rejects(() => activities.proposeSlots(act.id, []));
	ok('an empty proposal is refused, not silently accepted');
}

async function cleanup() {
	await db.query('DELETE FROM activities WHERE owner_user_id = ANY($1::text[])', [created.users]).catch(() => undefined);
	for (const id of created.users) {
		await db.query('DELETE FROM users WHERE id = $1', [id]).catch(() => undefined);
	}
}

main()
	.then(cleanup)
	.then(() => db.close())
	.then(() => console.log(`\n${n} checks passed\n`))
	.catch(async (err) => {
		console.error('\nFAILED:', err.message, '\n', err.stack);
		await cleanup().catch(() => undefined);
		await db.close().catch(() => undefined);
		process.exitCode = 1;
	});
