// Put a real Discord account one sweep away from a due-date reminder, so the
// buttons on it can actually be pressed.
//
// Everything below the notification outbox is covered by `payment-due.test.js`.
// What no test can reach is the last hop: a DM with two components on it, a
// modal that opens when the second one is pressed, and the reply that lands in
// the organizer's channel afterwards. That needs Discord, a running bot, and a
// person with a thumb.
//
// Two fixtures are seeded because the reminder has two different delivery paths
// and they fail differently:
//
//   · outbox  — the payer holds a Megu account with Discord linked. The sweep
//               only enqueues; the web process delivers, and the account's own
//               notification preference decides whether it arrives at all. This
//               is the path every real signed-up user takes.
//   · direct  — the payer is a roster row carrying a Discord id and nothing
//               else. There is no account to hold a preference, so the sweep
//               hands the DM straight to the bot. This is the path for someone
//               added from a Discord roster who never signed up.
//
// The direct fixture also carries an unclaimed name, which is what produces the
// organizer digest, and its owner is the tester — so one run puts all three
// messages this feature can send into one person's DMs.
//
//   node scripts/seed-discord-due-test.js <discordUserId> [--set-notifications]
//   node scripts/seed-discord-due-test.js <discordUserId> --report
//
// `--report` reads back what the sweep and the buttons actually did. Run it
// after pressing them.

require('dotenv').config();
const core = require('../core/index.js');

// Reserved titles. Everything this script deletes, it deletes by these, so a
// rerun replaces its own fixtures and never touches a real activity.
const PREFIX = 'Discord due · ';
const OUTBOX_TITLE = `${PREFIX}outbox`;
const DIRECT_TITLE = `${PREFIX}direct`;

// A deadline an hour in the past: already due, and well inside the 72-hour
// window `paymentDueNow()` will look back through. Seeding it further back
// would be seeding something the sweep is designed to ignore.
const DUE_AT = () => new Date(Date.now() - 60 * 60 * 1000);

function usage(message) {
	throw new Error(`${message}\n\nusage: node scripts/seed-discord-due-test.js <discordUserId> [--set-notifications] [--report]`);
}

/**
 * The tester's Megu account, without overwriting the profile OAuth already
 * stored. The fixture needs the snowflake; the names stay whatever they are.
 */
async function accountFor(discordUid) {
	const existing = await core.db.query(
		`SELECT i.username, u.display_name, u.avatar_url
		 FROM identities i JOIN users u ON u.id = i.user_id
		 WHERE i.provider = 'discord' AND i.provider_uid = $1`,
		[discordUid],
	);
	const profile = existing.rows[0];
	const { user } = await core.users.loginWithIdentity({
		provider: 'discord',
		providerUid: discordUid,
		username: profile?.username || 'discord-due-tester',
		displayName: profile?.display_name || 'Discord due tester',
		avatarUrl: profile?.avatar_url || null,
	});
	return user;
}

/**
 * Clear the fixtures and everything downstream of them.
 *
 * Deleting the activities takes their participants, reminders and deferrals
 * with them by cascade. The outbox does not cascade — it has no foreign key to
 * an activity, by design, because a notification outlives the thing it is about
 * — so its rows are matched on the title the payload carries. Without this a
 * second run enqueues nothing: the sweep would find the old `payment_reminders`
 * rows gone with the old activity, but the outbox would still be holding a
 * matching dedupe key.
 */
async function clearFixtures() {
	await core.db.query('DELETE FROM activities WHERE title LIKE $1', [`${PREFIX}%`]);
	const events = await core.db.query(
		'DELETE FROM notification_events WHERE payload->>\'activityTitle\' LIKE $1 RETURNING id',
		[`${PREFIX}%`],
	);
	return events.rowCount;
}

async function seedOutboxFixture(tester) {
	// The organizer is a separate synthetic account on purpose. Megu does not
	// announce a deferral to the person who just made it, so if the tester owned
	// this one, pressing "not now" would look like it did nothing.
	const { user: organizer } = await core.users.loginWithIdentity({
		provider: 'discord',
		providerUid: '__discord_due_fixture_owner__',
		username: 'discord-due-organizer',
		displayName: 'Fixture organizer',
	});
	await core.users.setPromptPay(organizer.id, {
		promptpayId: '081-234-5678',
		promptpayName: 'MR FIXTURE ORGANIZER',
	});

	const activity = await core.activities.createActivity({
		ownerUserId: organizer.id,
		title: OUTBOX_TITLE,
		startsAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
		paymentDueAt: DUE_AT(),
		location: 'ทดสอบ',
		participants: [
			{ displayName: 'Fixture organizer', userId: organizer.id },
			// Linked account, so the sweep queues rather than DMs, and the
			// account's own channel preference decides delivery.
			{ displayName: 'คุณ (ผู้ทดสอบ)', userId: tester.id },
		],
	});
	const full = await core.activities.getActivity(activity.id);
	await core.activities.addExpense(activity.id, {
		label: 'ค่าคอร์ท',
		amountSatang: 24000,
		paidBy: full.participants[0].id,
		shareParticipantIds: full.participants.map(p => p.id),
	});
	await core.activities.setPayee(activity.id, full.participants[0].id);
	return { code: activity.code, expectSatang: 12000 };
}

async function seedDirectFixture(tester, discordUid) {
	const activity = await core.activities.createActivity({
		ownerUserId: tester.id,
		title: DIRECT_TITLE,
		startsAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
		paymentDueAt: DUE_AT(),
		participants: [
			{ displayName: 'คุณ (เจ้าของกิจกรรม)', userId: tester.id },
			// A Discord id and nothing else: no account, no preference, no
			// outbox row. The sweep DMs this one itself.
			{ displayName: 'คุณ (ผู้ทดสอบ · ไม่มีบัญชี)', discordUid },
			// Nobody at all. This is the row that produces the organizer digest,
			// which is the whole answer to "what about people who never log in".
			{ displayName: 'สมชาย (ยังไม่ผูกบัญชี)' },
		],
	});
	const full = await core.activities.getActivity(activity.id);
	await core.activities.addExpense(activity.id, {
		label: 'ค่าอาหาร',
		amountSatang: 45000,
		paidBy: full.participants[0].id,
		shareParticipantIds: full.participants.map(p => p.id),
	});
	await core.activities.setPayee(activity.id, full.participants[0].id);
	return { code: activity.code, expectSatang: 15000 };
}

async function report(tester) {
	const deliveries = await core.db.query(
		`SELECT e.event_type, e.payload->>'activityTitle' AS title, d.channel, d.status,
		        d.attempts, d.sent_at, d.last_error
		 FROM notification_events e
		 LEFT JOIN notification_deliveries d ON d.event_id = e.id
		 WHERE e.payload->>'activityTitle' LIKE $1
		 ORDER BY e.created_at`,
		[`${PREFIX}%`],
	);
	const deferrals = await core.db.query(
		`SELECT a.title, p.display_name, f.reason, f.source, f.snooze_until
		 FROM payment_deferrals f
		 JOIN activities a ON a.id = f.activity_id
		 JOIN participants p ON p.id = f.participant_id
		 WHERE a.title LIKE $1
		 ORDER BY f.created_at`,
		[`${PREFIX}%`],
	);
	const reminders = await core.db.query(
		`SELECT a.title, p.display_name, r.channel, r.sent_at
		 FROM payment_reminders r
		 JOIN activities a ON a.id = r.activity_id
		 JOIN participants p ON p.id = r.participant_id
		 WHERE a.title LIKE $1
		 ORDER BY r.sent_at`,
		[`${PREFIX}%`],
	);

	console.log('\nannounced (payment_reminders — what the sweep decided it had said)');
	if (reminders.rowCount === 0) console.log('  nothing yet — the sweep has not run, or nothing was due');
	for (const row of reminders.rows) {
		console.log(`  ${row.title} · ${row.display_name} · via ${row.channel} · ${new Date(row.sent_at).toISOString()}`);
	}

	console.log('\ndeliveries (outbox — only accounts appear here)');
	if (deliveries.rowCount === 0) console.log('  nothing queued');
	for (const row of deliveries.rows) {
		const state = row.channel ? `${row.channel}: ${row.status}${row.attempts ? ` after ${row.attempts}` : ''}` : 'no channel selected — check the account preference';
		console.log(`  ${row.event_type} · ${row.title} · ${state}${row.last_error ? ` · ${row.last_error}` : ''}`);
	}

	console.log('\n"not now" answers');
	if (deferrals.rowCount === 0) console.log('  none pressed yet');
	for (const row of deferrals.rows) {
		console.log(`  ${row.title} · ${row.display_name} · "${row.reason}" · from ${row.source} · quiet until ${new Date(row.snooze_until).toISOString()}`);
	}

	const preference = await core.users.getNotificationPreferences(tester.id);
	console.log(`\ntester notification mode: ${preference.mode} (${preference.locale})`);
	console.log('');
}

async function main() {
	const args = process.argv.slice(2);
	const discordUid = args.find(arg => !arg.startsWith('--'));
	const setNotifications = args.includes('--set-notifications');
	const wantsReport = args.includes('--report');

	if (!/^\d{16,22}$/.test(discordUid || '')) usage('a Discord user id is required');

	await core.initCoreSchema();
	const tester = await accountFor(discordUid);

	if (wantsReport) {
		await report(tester);
		return;
	}

	const clearedEvents = await clearFixtures();
	const outbox = await seedOutboxFixture(tester);
	const direct = await seedDirectFixture(tester, discordUid);

	// The outbox obeys the account, not this script. Saying so beats a tester
	// waiting ten minutes for a DM that was never going to be sent.
	let preference = await core.users.getNotificationPreferences(tester.id);
	if (setNotifications && !['discord', 'both'].includes(preference.mode)) {
		await core.users.setNotificationPreferences(tester.id, { mode: 'discord', locale: preference.locale });
		preference = await core.users.getNotificationPreferences(tester.id);
	}

	const baseUrl = process.env.FRONTEND_URL || '';
	console.log(`
Seeded two due-date fixtures${clearedEvents ? ` (cleared ${clearedEvents} outbox event(s) from a previous run)` : ''}.

  ${OUTBOX_TITLE}
    ${baseUrl}/a/${outbox.code}
    you owe ฿${(outbox.expectSatang / 100).toFixed(2)} · delivered through the outbox, honouring your account preference

  ${DIRECT_TITLE}
    ${baseUrl}/a/${direct.code}
    you owe ฿${(direct.expectSatang / 100).toFixed(2)} · DMed straight from the sweep, no account involved
    you own this one, so the organizer digest and the deferral reply come back to you

Your notification mode is "${preference.mode}".${['discord', 'both'].includes(preference.mode)
	? ''
	: `\n  ⚠ The outbox fixture will not be delivered on this setting.
    Change it at ${baseUrl || 'the website'}/account, or rerun with --set-notifications.`}

What to expect, once the sweep runs:

  1. Two DMs, one per fixture, each carrying a "จ่ายเงิน" link button and a
     "ยังไม่จ่ายตอนนี้" button.
  2. A third DM: the organizer digest for "${DIRECT_TITLE}", naming
     สมชาย, who has no account and cannot be reached.
  3. Press "จ่ายเงิน" — it opens ${baseUrl || '<FRONTEND_URL>'}/a/<code>/pay, and nothing else.
  4. Press "ยังไม่จ่ายตอนนี้" — a modal asks why. Type something and submit.
     For "${DIRECT_TITLE}" a fourth DM arrives with your own reason
     quoted back, because you are that activity's organizer.

The sweep runs a minute after the web process boots, then every five minutes.
To not wait, restart with a shorter interval:

  MEGU_PAYMENT_DUE_INTERVAL_MS=60000 npm start

Then read back what actually happened:

  node scripts/seed-discord-due-test.js ${discordUid} --report
`);
}

main()
	.then(() => core.db.close())
	.catch(async (error) => {
		console.error(error.message);
		await core.db.close().catch(() => undefined);
		process.exitCode = 1;
	});
