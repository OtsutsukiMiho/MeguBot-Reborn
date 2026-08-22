require('dotenv').config();
const assert = require('node:assert');
const core = require('../core/index.js');

const created = [];

function track(...ids) {
	for (const id of ids) if (id) created.push(id);
}

/**
 * The ledger must read identically before and after. Everything else the merge
 * does is bookkeeping; this is the promise.
 */
function settlementFingerprint(activity) {
	const sum = core.activities.settlement(activity);
	return JSON.stringify({
		state: sum.state,
		rows: [...sum.rows]
			.sort((a, b) => a.participantId.localeCompare(b.participantId))
			.map(row => [row.participantId, row.owed, row.paid, row.outstanding]),
	});
}

async function unionTable() {
	const { unionMode } = core.accountMerge;
	const cases = [
		['off', 'off', 'off'],
		['off', 'discord', 'discord'],
		['email', 'off', 'email'],
		['email', 'discord', 'both'],
		['discord', 'email', 'both'],
		['both', 'off', 'both'],
		['both', 'discord', 'both'],
		['discord', 'discord', 'discord'],
	];
	for (const [a, b, expected] of cases) {
		assert.strictEqual(unionMode(a, b), expected, `union(${a}, ${b}) must be ${expected}`);
	}
	// The rule that motivated a union rather than a precedence order: an
	// explicit `off` on one side must not be talked into a channel by the other
	// side's silence, and a channel that was delivering must not go quiet.
	assert.strictEqual(unionMode('off', 'off'), 'off', 'two explicit opt-outs stay opted out');
	assert.strictEqual(unionMode('email', 'discord'), 'both', 'neither channel may go silent');
	console.log('  union of delivery channels — 8 pairs, no channel invented or lost');
}

/**
 * A new table with a foreign key to `users` and no thought about merging must
 * stop a merge, loudly.
 *
 * This is the test that matters most in a year's time. Almost every foreign key
 * pointing at `users` is `ON DELETE SET NULL` or `ON DELETE CASCADE`, so a
 * column nobody taught the merge about does not raise a constraint error — it
 * silently nulls or deletes. The catalogue sweep is what turns that into a
 * refusal instead of missing evidence.
 */
async function unknownReferenceIsRefused(userIdA, userIdB) {
	await core.db.query(`
		CREATE TABLE IF NOT EXISTS merge_probe (
			id TEXT PRIMARY KEY,
			user_id TEXT REFERENCES users(id) ON DELETE SET NULL
		)
	`);
	try {
		await assert.rejects(
			core.accountMerge.mergeAccounts({ userIdA, userIdB }),
			error => /^merge_unknown_reference:.*merge_probe\.user_id/.test(error.message),
			'a table the merge does not know about must refuse the merge',
		);
	}
	finally {
		await core.db.query('DROP TABLE IF EXISTS merge_probe');
	}
	console.log('  an unknown users reference refuses the merge instead of silently dropping it');
}

async function main() {
	await core.initCoreSchema();

	// Two accounts, one person: a Discord account that has been organising for a
	// year, and a Google account made last week on a laptop.
	const discord = await core.users.loginWithIdentity({
		provider: 'discord', providerUid: '__merge_discord__',
		username: 'merge-discord', displayName: 'Merge Discord',
	});
	const google = await core.users.loginWithIdentity({
		provider: 'google', providerUid: '__merge_google__',
		email: 'merge@example.test', emailVerified: true,
		username: 'merge@example.test', displayName: 'Merge Google',
	});
	track(discord.user.id, google.user.id);

	assert.strictEqual(
		(await core.users.linkIdentity(google.user.id, {
			provider: 'discord', providerUid: '__merge_discord__',
		})).reason,
		'claimed-by-another-user',
		'linking must still refuse on its own — the merge is a deliberate step above it',
	);

	// The Discord account owns an activity with real money in it. Both accounts
	// sit on its roster, which is the duplicate case.
	const activity = await core.activities.createActivity({
		ownerUserId: discord.user.id,
		title: 'Badminton',
		participants: [
			{ displayName: 'Discord me', userId: discord.user.id },
			{ displayName: 'Google me', userId: google.user.id },
			{ displayName: 'Ohm' },
		],
	});
	const loaded = await core.activities.getActivity(activity.id);
	const [discordRow, googleRow, ohmRow] = loaded.participants;

	await core.activities.addExpense(activity.id, {
		label: 'Court', amountSatang: 90000, paidBy: discordRow.id,
		shareParticipantIds: [discordRow.id, googleRow.id, ohmRow.id],
	});
	await core.activities.recordPayment(activity.id, googleRow.id, { amountSatang: 30000 });

	const before = await core.activities.getActivity(activity.id);
	const ledgerBefore = settlementFingerprint(before);

	await core.users.setNotificationPreferences(discord.user.id, { mode: 'discord', locale: 'th' });
	await core.users.setNotificationPreferences(google.user.id, { mode: 'email', locale: 'en' });

	// --- the plan, which writes nothing ------------------------------------
	const plan = await core.accountMerge.planMerge(google.user.id, discord.user.id);
	assert.strictEqual(plan.blockedBy, null, 'disjoint providers must not block');
	assert.strictEqual(plan.survivorId, discord.user.id, 'the account owning activities keeps its id');
	assert.strictEqual(plan.mergedId, google.user.id);
	assert.strictEqual(plan.notificationMode.result, 'both', 'discord + email is both');
	assert.strictEqual(plan.duplicateParticipants.length, 1, 'the shared activity must be reported');
	assert.strictEqual(plan.duplicateParticipants[0].code, before.code);
	assert.strictEqual(
		(await core.users.getUser(google.user.id))?.id,
		google.user.id,
		'planning must not delete anything',
	);

	await unionTable();
	await unknownReferenceIsRefused(google.user.id, discord.user.id);

	// --- the merge ----------------------------------------------------------
	const result = await core.accountMerge.mergeAccounts({
		userIdA: google.user.id,
		userIdB: discord.user.id,
		profileSource: 'google',
		proof: { signedInUserId: google.user.id, authenticatedProvider: 'discord' },
	});
	assert.strictEqual(result.survivorId, discord.user.id);
	assert.strictEqual(result.mergedId, google.user.id);
	assert.strictEqual(result.notificationMode, 'both');

	// The promise: not one satang moved.
	const after = await core.activities.getActivity(activity.id);
	assert.strictEqual(settlementFingerprint(after), ledgerBefore, 'a merge must not change what anybody owes');

	// Both roster rows survive, now pointing at one account. Merging them would
	// have meant adding their shares together, which is the ledger rewrite the
	// line above forbids.
	const mine = after.participants.filter(p => p.userId === discord.user.id);
	assert.strictEqual(mine.length, 2, 'both roster rows survive, under one account');
	assert.deepStrictEqual(
		mine.map(p => p.displayName).sort(),
		['Discord me', 'Google me'],
		'neither nameplate is rewritten',
	);
	assert.strictEqual(
		after.participants.find(p => p.id === ohmRow.id).userId,
		null,
		'nobody else on the roster is touched',
	);

	// Nothing survives pointing at the old id, and the old id still resolves.
	assert.strictEqual(await core.users.getUser(google.user.id), null, 'the merged account row is gone');
	assert.strictEqual(
		await core.accountMerge.resolveUserId(google.user.id),
		discord.user.id,
		'an old id resolves to the account that absorbed it',
	);
	assert.strictEqual(
		await core.accountMerge.resolveUserId(discord.user.id),
		discord.user.id,
		'a live id resolves to itself',
	);

	// Both providers still sign in — which is the whole point of "primary"
	// meaning a display preference and nothing more.
	const survivor = await core.users.getUserWithIdentities(discord.user.id);
	assert.deepStrictEqual(
		survivor.identities.map(i => i.provider).sort(),
		['discord', 'google'],
		'both providers remain usable for sign-in after the merge',
	);
	assert.strictEqual(survivor.profileSource, 'google');
	assert.strictEqual(survivor.displayName, 'Merge Google', 'the chosen provider supplies the profile');

	assert.strictEqual((await core.users.getNotificationPreferences(discord.user.id)).mode, 'both');

	// Signing in through the account that no longer exists lands on the survivor
	// rather than creating a third account.
	const reLogin = await core.users.loginWithIdentity({
		provider: 'google', providerUid: '__merge_google__',
		email: 'merge@example.test', emailVerified: true,
		username: 'merge@example.test', displayName: 'Merge Google',
	});
	assert.strictEqual(reLogin.created, false);
	assert.strictEqual(reLogin.user.id, discord.user.id, 'the old provider signs into the survivor');

	// --- the notice, crossed over -------------------------------------------
	const notices = await core.db.query(
		`SELECT e.event_type, d.channel, e.payload
		   FROM notification_events e
		   JOIN notification_deliveries d ON d.event_id = e.id
		  WHERE e.user_id = $1 AND e.event_type LIKE 'account_merged%'
		  ORDER BY e.event_type`,
		[discord.user.id],
	);
	assert.strictEqual(notices.rows.length, 2, 'both channels are told');
	const emailNotice = notices.rows.find(row => row.channel === 'email');
	const discordNotice = notices.rows.find(row => row.channel === 'discord');
	assert.ok(emailNotice, 'the email channel is notified');
	assert.ok(discordNotice, 'the Discord channel is notified');
	// Each channel names the *other* one. That crossing is what makes an
	// unauthorized merge visible to the person who did not perform it.
	assert.ok(
		emailNotice.payload.bodyEn.includes('Merge Discord'),
		'the email names the Discord account that was attached',
	);
	assert.ok(
		discordNotice.payload.bodyEn.includes('merge@example.test'),
		'the Discord message names the email address that was attached',
	);
	assert.strictEqual(emailNotice.payload.locale, 'th', 'the locale of the surviving account is kept');

	// --- an audit row that outlives the session that made it ----------------
	const audit = await core.db.query(
		'SELECT * FROM account_merges WHERE survivor_user_id = $1',
		[discord.user.id],
	);
	assert.strictEqual(audit.rows.length, 1);
	assert.strictEqual(audit.rows[0].merged_user_id, google.user.id);
	assert.strictEqual(audit.rows[0].provider_proof.authenticatedProvider, 'discord');
	assert.strictEqual(audit.rows[0].moved_counts.before.merged.participant_rows, 1);
	assert.ok(
		!JSON.stringify(audit.rows[0].provider_proof).match(/token|refresh|[Cc]ode/),
		'the audit row must not carry anything replayable',
	);

	// --- a provider collision is refused, not guessed at ---------------------
	const third = await core.users.loginWithIdentity({
		provider: 'google', providerUid: '__merge_third_google__',
		email: 'third@example.test', emailVerified: true, displayName: 'Third',
	});
	track(third.user.id);
	const collisionPlan = await core.accountMerge.planMerge(third.user.id, discord.user.id);
	assert.deepStrictEqual(collisionPlan.blockedBy, { reason: 'provider-collision', providers: ['google'] });
	await assert.rejects(
		core.accountMerge.mergeAccounts({ userIdA: third.user.id, userIdB: discord.user.id }),
		/^Error: merge_provider_collision:google$/,
		'two accounts holding the same provider must not be merged silently',
	);
	assert.ok(await core.users.getUser(third.user.id), 'a refused merge leaves both accounts intact');

	await assert.rejects(
		core.accountMerge.mergeAccounts({ userIdA: discord.user.id, userIdB: discord.user.id }),
		/merge_same_account/,
	);

	console.log('account merge passed — one ledger untouched, both logins kept, every reference accounted for');
}

async function cleanup() {
	await core.db.query('DROP TABLE IF EXISTS merge_probe').catch(() => undefined);
	// The merge notices go first and by name.
	//
	// `claimPending` takes the twenty oldest deliveries that are due, so rows
	// left behind by a suite that never drains them sit at the front of that
	// queue and starve every later suite's notifications — which is exactly how
	// this test broke `notification-integration` before it cleaned up properly.
	// Deleting the users would cascade to these anyway; doing it explicitly
	// means a failed run part way through still leaves the queue clean.
	await core.db.query(
		'DELETE FROM notification_events WHERE event_type LIKE \'account_merged%\' AND user_id = ANY($1::text[])',
		[created],
	).catch(() => undefined);
	for (const id of created) {
		await core.db.query('DELETE FROM account_merges WHERE survivor_user_id = $1', [id]).catch(() => undefined);
		await core.db.query('DELETE FROM user_aliases WHERE user_id = $1 OR old_user_id = $1', [id]).catch(() => undefined);
		await core.db.query('DELETE FROM activities WHERE owner_user_id = $1', [id]).catch(() => undefined);
		await core.db.query('DELETE FROM users WHERE id = $1', [id]).catch(() => undefined);
	}
}

main().then(cleanup).then(() => core.db.close()).catch(async error => {
	console.error(error);
	await cleanup().catch(() => undefined);
	await core.db.close().catch(() => undefined);
	process.exitCode = 1;
});
