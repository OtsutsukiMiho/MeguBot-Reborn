require('dotenv').config();
const assert = require('node:assert');
const core = require('../core/index.js');
const { createPaymentDueSweep } = require('../adapters/notifications/payment-due.js');

// The deadline, and the two answers to it.
//
// Three things are being checked here and they fail in different ways:
//
//   1. A deadline that has not arrived is not a debt. The old sweep started
//      nagging the moment an expense existed, because a one-off activity had
//      nowhere to record when the money was actually due.
//   2. The deadline is announced once. It is announced by a timer, so "once"
//      has to survive the timer firing again a minute later — and it has to
//      survive it for a roster row that has no account and therefore no outbox
//      row to dedupe against.
//   3. "Not now" is an answer, not a mute. It stops the reminders for two days,
//      it reaches the organizer with the reason attached, and the money stays
//      outstanding the entire time.

const created = { users: [] };
let n = 0;
function ok(message) {
	n++;
	console.log(`  ok  ${message}`);
}

async function queued(userId, eventType) {
	const res = await core.db.query(
		`SELECT e.payload, e.dedupe_key, d.channel FROM notification_events e
		 LEFT JOIN notification_deliveries d ON d.event_id = e.id
		 WHERE e.user_id = $1 AND e.event_type = $2 ORDER BY e.created_at`,
		[userId, eventType],
	);
	return res.rows;
}

async function main() {
	await core.initCoreSchema();

	const host = await core.users.loginWithIdentity({
		provider: 'discord', providerUid: '__due_host__', username: 'host', displayName: 'เจ้าของกิจกรรม',
	});
	const payer = await core.users.loginWithIdentity({
		provider: 'discord', providerUid: '__due_payer__', username: 'payer', displayName: 'โอม',
	});
	created.users.push(host.user.id, payer.user.id);

	console.log('\na deadline is not the day it happens');

	// Played on the 20th, settled on the 21st — the case the whole column
	// exists for. `startsAt` and `paymentDueAt` are two different dates and the
	// second is the only one worth chasing anybody about.
	const activity = await core.activities.createActivity({
		ownerUserId: host.user.id,
		title: 'ตีแบด',
		startsAt: new Date('2026-08-20T17:00:00+07:00'),
		paymentDueAt: '2026-08-21',
		participants: [
			{ displayName: 'เจ้าของกิจกรรม', userId: host.user.id },
			{ displayName: 'โอม', userId: payer.user.id },
			// Nobody: a name typed into a roster that never became an account
			// and never linked Discord. There is no address to send anything to,
			// which is the entire reason the organizer digest exists.
			{ displayName: 'นัท' },
		],
	});
	let full = await core.activities.getActivity(activity.id);
	// End of the 21st in Bangkok, not the start of it. A bare date is a whole
	// day to the person who typed it, and the day is not over until it is over.
	assert.strictEqual(new Date(full.paymentDueAt).toISOString(), '2026-08-21T16:59:59.000Z');
	ok('a bare date becomes the end of that day in Bangkok, not 07:00 the morning of it');

	await core.activities.addExpense(activity.id, {
		label: 'ค่าคอร์ท',
		amountSatang: core.money.toSatang(300),
		paidBy: full.participants[0].id,
		shareParticipantIds: full.participants.map(p => p.id),
	});

	const beforeDue = new Date('2026-08-20T18:00:00+07:00');
	assert.deepStrictEqual(
		(await core.reminders.paymentDueNow({ now: beforeDue })).notices,
		[],
		'a deadline that has not arrived must not produce a reminder',
	);
	const statementBefore = await core.reminders.due({ now: beforeDue });
	assert.ok(
		!statementBefore.some(person => person.lines.some(line => line.activityId === activity.id)),
		'the hourly statement must respect the deadline too — it used to nag the moment a bill existed',
	);
	ok('nobody is chased before the 21st, by either sweep');

	console.log('\nthe deadline arrives');

	const afterDue = new Date('2026-08-22T09:00:00+07:00');
	const sent = [];
	const sweep = createPaymentDueSweep({
		baseUrl: 'https://megu.test',
		sendDiscord: async notice => sent.push(notice),
		log: message => console.log('    [sweep]', message),
	});

	const first = await sweep.runOnce({ now: afterDue });
	assert.strictEqual(first.queued, 1, 'only the person who still owes, and only through their account');
	assert.strictEqual(first.digests, 1, 'the unreachable name becomes an organizer digest');

	const notices = await queued(payer.user.id, 'payment_due');
	assert.strictEqual(notices.length, 1);
	const payload = notices[0].payload;
	assert.strictEqual(payload.ctaUrl, `https://megu.test/a/${activity.code}/pay`, 'the Pay button opens the payment screen itself, not an anchor on the activity page');
	assert.strictEqual(payload.secondaryUrl, `https://megu.test/a/${activity.code}/pay?defer=1`, 'and "not now" opens the same screen with its reason box already asking');
	assert.ok(payload.bodyTh.includes('100.00'), 'the amount is in the message, not only behind the link');
	assert.ok(payload.defer?.participantId, 'Discord needs a participant to hang the modal on');
	ok('the person who owes gets one notice, with a pay link and a "not now" link');

	const digest = (await queued(host.user.id, 'payment_due_host'))[0];
	assert.ok(digest, 'the organizer hears about the person Megu cannot reach');
	assert.ok(digest.payload.bodyTh.includes('นัท'));
	assert.ok(!digest.payload.bodyTh.includes('โอม'), 'only the unreachable ones — the rest were told directly');
	assert.ok(digest.payload.bodyTh.includes(`https://megu.test/a/${activity.code}`), 'with something to paste');
	ok('the organizer is handed the names Megu cannot reach, and a message to forward');

	// The part that only breaks in production: the sweep runs every five
	// minutes, so "announced once" has to survive being asked again.
	const second = await sweep.runOnce({ now: new Date(afterDue.getTime() + 5 * 60 * 1000) });
	assert.strictEqual(second.queued, 0);
	assert.strictEqual(second.digests, 0);
	assert.strictEqual((await queued(payer.user.id, 'payment_due')).length, 1);
	ok('the second sweep five minutes later says nothing — one deadline, one announcement');

	console.log('\na roster row with a Discord id and no account');

	// The one person the outbox cannot serve. There is no Megu account, so
	// there is no channel preference and no delivery row — the DM is the only
	// thing there is, and "announce once" has to hold without an outbox to
	// dedupe against. That is what `payment_reminders` is doing here.
	const dm = await core.activities.createActivity({
		ownerUserId: host.user.id,
		title: 'ค่าเน็ต',
		paymentDueAt: '2026-08-21',
		participants: [
			{ displayName: 'เจ้าของกิจกรรม', userId: host.user.id },
			{ displayName: 'ฟิก', discordUid: '__due_discord_only__' },
		],
	});
	const dmFull = await core.activities.getActivity(dm.id);
	await core.activities.addExpense(dm.id, {
		label: 'ค่าเน็ต',
		amountSatang: core.money.toSatang(200),
		paidBy: dmFull.participants[0].id,
		shareParticipantIds: dmFull.participants.map(p => p.id),
	});

	const dmRun = await sweep.runOnce({ now: afterDue });
	assert.strictEqual(dmRun.dmed, 1, 'no account means no outbox — the DM is the delivery');
	assert.strictEqual(sent[0].recipients[0], '__due_discord_only__');
	assert.ok(sent[0].cta?.url.endsWith('/pay'), 'the Pay button is a link Discord can render');
	assert.strictEqual(sent[0].defer.participantId, dmFull.participants[1].id, 'and "Not now" carries who is answering');
	ok('a Discord-only roster row is DMed directly, with both buttons');

	const dmAgain = await sweep.runOnce({ now: new Date(afterDue.getTime() + 5 * 60 * 1000) });
	assert.strictEqual(dmAgain.dmed, 0, 'and only once, with no outbox row to dedupe against');
	assert.strictEqual(sent.length, 1);
	ok('the reminder record alone keeps the direct DM from repeating');

	console.log('\n"not now" is an answer, not a mute');

	full = await core.activities.getActivity(activity.id);
	const me = full.participants.find(p => p.displayName === 'โอม');
	const deferral = await core.activities.deferPayment({
		activityId: activity.id,
		participantId: me.id,
		reason: 'เงินเดือนออกวันที่ 25 เดี๋ยวจ่ายเลย',
		source: 'discord',
		now: afterDue,
	});
	await core.reminders.announceDeferral({ activity: full, participantId: me.id, deferral, baseUrl: 'https://megu.test' });

	await assert.rejects(
		() => core.activities.deferPayment({ activityId: activity.id, participantId: me.id, reason: '   ' }),
		/defer_reason_required/,
		'an empty reason is the one thing the button exists to prevent',
	);
	ok('a deferral without a reason is refused');

	const told = (await queued(host.user.id, 'payment_deferred'))[0];
	assert.ok(told, 'the organizer hears it');
	assert.ok(told.payload.bodyTh.includes('เงินเดือนออกวันที่ 25'), 'in the payer\'s own words');
	ok('the reason reaches the organizer, on their own channel');

	// Two days of quiet, and not one satang moved.
	const nextDay = new Date('2026-08-23T09:00:00+07:00');
	const stillQuiet = await core.reminders.due({ now: nextDay });
	assert.ok(!stillQuiet.some(person => person.lines.some(line => line.participantId === me.id)));
	const settlement = core.activities.settlement(await core.activities.getActivity(activity.id));
	assert.ok(settlement.unpaid.some(row => row.participantId === me.id), 'deferring must never look like paying');
	ok('the snooze holds the nag off while the money stays outstanding');

	const afterSnooze = new Date('2026-08-25T09:00:00+07:00');
	const backAgain = await core.reminders.due({ now: afterSnooze });
	assert.ok(
		backAgain.some(person => person.lines.some(line => line.participantId === me.id)),
		'48 hours later Megu asks again — a deferral is not an opt-out',
	);
	ok('once the snooze runs out the reminders resume');

	console.log('\nmoving the deadline');

	// Moving the deadline is the organizer changing their mind out loud, so it
	// has to reach the people it applies to. The dedupe key carries the date
	// for exactly this reason: a new deadline is a different key, and therefore
	// a new announcement rather than a duplicate that gets swallowed.
	await core.activities.updateActivity(activity.id, { paymentDueAt: '2026-08-24' });
	const moved = await core.reminders.paymentDueNow({ now: afterSnooze, baseUrl: 'https://megu.test' });
	const again = moved.notices.find(notice => notice.participantId === me.id);
	assert.ok(again, 'the person who owes hears about the new deadline');
	assert.ok(again.dedupeKey.includes('2026-08-24'), 'and it is a different announcement, not the old one repeated');
	ok('moving the deadline announces it again rather than being swallowed as a duplicate');

	const cleared = await core.activities.updateActivity(activity.id, { paymentDueAt: null });
	assert.strictEqual(cleared.paymentDueAt, null, 'clearing the deadline is an edit, not a missing field');
	assert.deepStrictEqual(
		(await core.reminders.paymentDueNow({ now: afterSnooze })).notices,
		[],
		'with no deadline there is nothing to announce',
	);
	ok('clearing the deadline stops the announcements');

	console.log(`\npayment-due passed — ${n} checks`);
}

async function cleanup() {
	for (const id of created.users) {
		await core.db.query('DELETE FROM activities WHERE owner_user_id = $1', [id]).catch(() => undefined);
	}
	for (const id of created.users) {
		await core.db.query('DELETE FROM users WHERE id = $1', [id]).catch(() => undefined);
	}
}

main().then(cleanup).then(() => core.db.close()).catch(async (error) => {
	console.error(error);
	await cleanup().catch(() => undefined);
	await core.db.close().catch(() => undefined);
	process.exitCode = 1;
});
