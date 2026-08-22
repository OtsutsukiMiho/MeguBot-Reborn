/**
 * Account merging, end to end, with the messages printed instead of sent.
 *
 * This is the answer to "does it actually reach my inbox and my DMs, and does
 * it obey the setting?" — it runs the real merge, the real notification queue
 * and the real dispatcher, and swaps only the last inch: `sendEmail` and
 * `sendDiscord` print what they were handed rather than calling Resend or
 * Discord. Everything upstream of that is production code.
 *
 * Nothing here touches Discord, so it is safe to run while blocked.
 *
 *   node scripts/merge-demo.js
 *
 * It insists on a local database and creates its own accounts, then deletes
 * them. Run it against the test database, never the live one.
 */
require('dotenv').config();

const { resolveTestDatabaseUrl, ensureTestDatabase, describeDatabase } = require('../tests/test-database.js');

const C = {
	reset: '[0m', dim: '[2m', bold: '[1m',
	green: '[32m', yellow: '[33m', blue: '[36m',
	red: '[31m', grey: '[90m', magenta: '[35m',
};

function heading(text) {
	console.log(`\n${C.bold}${C.blue}${'━'.repeat(72)}${C.reset}`);
	console.log(`${C.bold}${C.blue}  ${text}${C.reset}`);
	console.log(`${C.bold}${C.blue}${'━'.repeat(72)}${C.reset}`);
}

function step(text) {
	console.log(`\n${C.bold}▸ ${text}${C.reset}`);
}

function note(text) {
	console.log(`${C.grey}  ${text}${C.reset}`);
}

function pass(text) {
	console.log(`  ${C.green}✓${C.reset} ${text}`);
}

function fail(text) {
	console.log(`  ${C.red}✗ ${text}${C.reset}`);
	process.exitCode = 1;
}

/** Satang as baht, right-aligned so a column of them reads as a column. */
function money(satang) {
	return (Number(satang || 0) / 100).toFixed(2).padStart(9);
}

function check(condition, text) {
	if (condition) pass(text);
	else fail(text);
}

/** What the dispatcher handed to each channel, rendered exactly as it would go out. */
function printDelivery(item) {
	if (item.channel === 'email') {
		console.log(`\n  ${C.magenta}✉  EMAIL${C.reset} ${C.dim}→${C.reset} ${C.bold}${item.to}${C.reset}`);
		console.log(`     ${C.dim}Subject:${C.reset} ${item.subject}`);
		for (const line of wrap(item.body, 64)) console.log(`     ${line}`);
		if (item.ctaUrl) console.log(`     ${C.dim}${item.ctaLabel}:${C.reset} ${item.ctaUrl}`);
	}
	else {
		console.log(`\n  ${C.yellow}⌁  DISCORD DM${C.reset} ${C.dim}→${C.reset} ${C.bold}uid ${item.recipients[0]}${C.reset}`);
		for (const line of wrap(item.message, 64)) console.log(`     ${line}`);
	}
}

/** Thai has no spaces between words, so break on width rather than on spaces. */
function wrap(text, width) {
	const out = [];
	for (const paragraph of String(text || '').split('\n')) {
		let line = '';
		for (const word of paragraph.split(' ')) {
			if (line && (line.length + word.length + 1) > width) {
				out.push(line);
				line = '';
			}
			if (word.length > width) {
				for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width));
				continue;
			}
			line = line ? `${line} ${word}` : word;
		}
		if (line) out.push(line);
	}
	return out;
}

// Every provider id this script invents. Nothing outside this list is touched.
const DEMO_PROVIDER_UIDS = [
	'900000000000000001', '900000000000000002',
	'demo-google-uid-1', 'demo-google-uid-2', 'demo-google-uid-3',
	'demo-line-uid-1',
];

async function resetDemoAccounts(core) {
	const owners = await core.db.query(
		'SELECT DISTINCT user_id FROM identities WHERE provider_uid = ANY($1::text[])',
		[DEMO_PROVIDER_UIDS],
	);
	const ids = owners.rows.map(row => row.user_id);
	if (ids.length === 0) return;
	await core.db.query('DELETE FROM account_merges WHERE survivor_user_id = ANY($1::text[])', [ids]);
	await core.db.query('DELETE FROM user_aliases WHERE user_id = ANY($1::text[]) OR old_user_id = ANY($1::text[])', [ids]);
	await core.db.query('DELETE FROM activities WHERE owner_user_id = ANY($1::text[])', [ids]);
	await core.db.query('DELETE FROM users WHERE id = ANY($1::text[])', [ids]);
}

async function main() {
	const url = resolveTestDatabaseUrl();
	await ensureTestDatabase(url);
	process.env.MEGU_DATABASE_URL = url;

	const core = require('../core/index.js');
	const { createDispatcher } = require('../adapters/notifications/dispatcher.js');
	await core.initCoreSchema();

	console.log(`\n${C.bold}Megu — account merge, with the messages printed instead of sent${C.reset}`);
	note(`database: ${describeDatabase(url)}`);
	note('sendEmail and sendDiscord are stubbed. Nothing leaves this machine.');

	const sent = [];
	const dispatcher = createDispatcher({
		sendDiscord: async notice => { sent.push({ channel: 'discord', ...notice }); },
		sendEmail: async notice => { sent.push({ channel: 'email', ...notice }); },
	});

	/** Drain the queue and return only what came out this time. */
	async function deliver() {
		const before = sent.length;
		await dispatcher.drain();
		return sent.slice(before);
	}

	const created = [];
	async function makeAccount(profile) {
		const { user } = await core.users.loginWithIdentity(profile);
		created.push(user.id);
		return user;
	}

	// The demo uses fixed provider ids so the output reads the same every time,
	// which means a run that was interrupted before its cleanup leaves accounts
	// behind — and the second run would then find both of its "separate"
	// identities already living on one merged account. Clear them first.
	await resetDemoAccounts(core);

	// ══════════════════════════════════════════════════════════════════════
	heading('1 · Two accounts, one person');

	const discordUser = await makeAccount({
		provider: 'discord', providerUid: '900000000000000001',
		username: 'ohm', displayName: 'โอม', avatarUrl: null,
	});
	const googleUser = await makeAccount({
		provider: 'google', providerUid: 'demo-google-uid-1',
		email: 'ohm@example.test', emailVerified: true,
		username: 'ohm@example.test', displayName: 'Ohm Teerapab',
	});

	step('Two separate Megu accounts exist');
	note(`Discord account  ${discordUser.id}  "${discordUser.displayName}"  uid 900000000000000001`);
	note(`Google account   ${googleUser.id}  "${googleUser.displayName}"  ohm@example.test`);

	step('Connecting Discord to the Google account is refused on its own');
	const refusal = await core.users.linkIdentity(googleUser.id, {
		provider: 'discord', providerUid: '900000000000000001',
	});
	check(refusal.reason === 'claimed-by-another-user',
		`linkIdentity answers "${refusal.reason}" — the merge is a deliberate step above this`);

	// ══════════════════════════════════════════════════════════════════════
	heading('2 · Money on the table before the merge');

	const activity = await core.activities.createActivity({
		ownerUserId: discordUser.id,
		title: 'ตีแบดวันเสาร์',
		participants: [
			{ displayName: 'โอม (Discord)', userId: discordUser.id },
			{ displayName: 'Ohm (เว็บ)', userId: googleUser.id },
			{ displayName: 'นัท' },
		],
	});
	const loaded = await core.activities.getActivity(activity.id);
	const [rowDiscord, rowGoogle, rowNut] = loaded.participants;

	await core.activities.addExpense(activity.id, {
		label: 'ค่าคอร์ท', amountSatang: 90000, paidBy: rowDiscord.id,
		shareParticipantIds: [rowDiscord.id, rowGoogle.id, rowNut.id],
	});
	await core.activities.recordPayment(activity.id, rowGoogle.id, { amountSatang: 30000 });

	const beforeActivity = await core.activities.getActivity(activity.id);
	const beforeSum = core.activities.settlement(beforeActivity);
	step(`"${beforeActivity.title}" · ${beforeActivity.code} — ค่าคอร์ท ฿900.00 หารสาม`);
	for (const row of beforeSum.rows) {
		const name = beforeActivity.participants.find(p => p.id === row.participantId).displayName;
		note(`${name.padEnd(16)} share ฿${money(row.owes)}  fronted ฿${money(row.paidOut)}  confirmed ฿${money(row.settled)}  outstanding ฿${money(row.outstanding)}`);
	}
	const ledgerBefore = JSON.stringify(beforeSum.rows.map(r => [r.participantId, r.owes, r.paidOut, r.settled, r.pending, r.outstanding]).sort());

	// ══════════════════════════════════════════════════════════════════════
	heading('3 · Notification settings, deliberately different on each side');

	await core.users.setNotificationPreferences(discordUser.id, { mode: 'discord', locale: 'th' });
	await core.users.setNotificationPreferences(googleUser.id, { mode: 'email', locale: 'en' });
	note('Discord account → discord (th)      Google account → email (en)');
	note('Union of the two is "both": neither channel that was delivering goes quiet.');

	// ══════════════════════════════════════════════════════════════════════
	heading('4 · The plan — read only, nothing written');

	const plan = await core.accountMerge.planMerge(googleUser.id, discordUser.id);
	step('What the confirmation screen is built from');
	note(`survivor            ${plan.survivorId}   ${C.dim}(owns the activity)${C.reset}`);
	note(`merged away         ${plan.mergedId}`);
	note(`blocked             ${plan.blockedBy ? JSON.stringify(plan.blockedBy) : 'no'}`);
	note(`notification mode   ${plan.notificationMode.survivor} + ${plan.notificationMode.merged} → ${C.bold}${plan.notificationMode.result}${C.reset}`);
	note(`appears twice in    ${plan.duplicateParticipants.map(d => `${d.title} (${d.code})`).join(', ') || 'nothing'}`);
	check(await core.users.getUser(plan.mergedId) !== null, 'planning wrote nothing — both accounts still exist');

	// ══════════════════════════════════════════════════════════════════════
	heading('5 · The merge');

	const result = await core.accountMerge.mergeAccounts({
		userIdA: googleUser.id,
		userIdB: discordUser.id,
		profileSource: 'google',
		proof: { signedInUserId: googleUser.id, authenticatedProvider: 'discord' },
	});

	step('What moved');
	note(`merge id            ${result.mergeId}`);
	note(`survivor            ${result.survivorId}`);
	note(`notification mode   ${result.notificationMode}`);

	const afterActivity = await core.activities.getActivity(activity.id);
	const afterSum = core.activities.settlement(afterActivity);
	const ledgerAfter = JSON.stringify(afterSum.rows.map(r => [r.participantId, r.owes, r.paidOut, r.settled, r.pending, r.outstanding]).sort());

	step('The ledger, after');
	for (const row of afterSum.rows) {
		const name = afterActivity.participants.find(p => p.id === row.participantId).displayName;
		note(`${name.padEnd(16)} share ฿${money(row.owes)}  fronted ฿${money(row.paidOut)}  confirmed ฿${money(row.settled)}  outstanding ฿${money(row.outstanding)}`);
	}
	check(ledgerAfter === ledgerBefore, 'not one satang changed');

	const mine = afterActivity.participants.filter(p => p.userId === result.survivorId);
	check(mine.length === 2, `both roster rows survive under one account: ${mine.map(p => `"${p.displayName}"`).join(' and ')}`);
	check(afterActivity.participants.find(p => p.id === rowNut.id).userId === null, 'nobody else on the roster is touched');

	const survivor = await core.users.getUserWithIdentities(result.survivorId);
	check(survivor.identities.map(i => i.provider).sort().join('+') === 'discord+google',
		'both providers still sign in — "primary" is a display choice, not a login one');
	check(survivor.profileSource === 'google' && survivor.displayName === 'Ohm Teerapab',
		`profile follows Google: "${survivor.displayName}"`);
	check(await core.users.getUser(googleUser.id) === null, 'the merged account row is gone');
	check(await core.accountMerge.resolveUserId(googleUser.id) === result.survivorId,
		'an old session id still resolves to the surviving account');

	const relogin = await core.users.loginWithIdentity({
		provider: 'google', providerUid: 'demo-google-uid-1',
		email: 'ohm@example.test', emailVerified: true, displayName: 'Ohm Teerapab',
	});
	check(relogin.created === false && relogin.user.id === result.survivorId,
		'signing in with Google lands on the merged account, not a third one');

	// ══════════════════════════════════════════════════════════════════════
	heading('6 · The merge notice — what actually goes out');

	const mergeNotices = await deliver();
	console.log(`\n  ${C.dim}Both channels are told, and each names the ${C.reset}${C.bold}other${C.reset}${C.dim} one.${C.reset}`);
	console.log(`  ${C.dim}That crossing is what makes a merge you did not perform findable.${C.reset}`);
	for (const item of mergeNotices) printDelivery(item);

	check(mergeNotices.length === 2, 'both channels received the notice');
	check(mergeNotices.some(i => i.channel === 'email' && i.body.includes('โอม')),
		'the email names the Discord account that was attached');
	check(mergeNotices.some(i => i.channel === 'discord' && i.message.includes('ohm@example.test')),
		'the Discord DM names the email address that was attached');
	// The Discord account's locale was th and the Google account's was en. The
	// survivor's wins, so both messages must come out Thai — including the one
	// going to the address that asked for English.
	const thai = /[฀-๿]/;
	check(mergeNotices.every(i => thai.test(i.body || i.message || '')),
		'both rendered in Thai — the surviving account\'s locale, not the channel\'s');

	// ══════════════════════════════════════════════════════════════════════
	heading('7 · Does an ordinary notification obey the setting?');

	async function ordinaryNotification(tag) {
		await core.notifications.enqueue({
			userId: result.survivorId,
			eventType: 'demo_payment_due',
			dedupeKey: `demo:${result.survivorId}:${tag}`,
			payload: {
				subjectEn: 'Badminton — ฿300.00 outstanding',
				subjectTh: 'ตีแบดวันเสาร์ — ค้าง ฿300.00',
				bodyEn: 'You still owe ฿300.00 for ตีแบดวันเสาร์.',
				bodyTh: 'คุณยังค้าง ฿300.00 สำหรับ ตีแบดวันเสาร์',
				ctaUrl: `https://megu.test/a/${afterActivity.code}`,
			},
		});
		return deliver();
	}

	for (const mode of ['both', 'discord', 'email', 'off']) {
		await core.users.setNotificationPreferences(result.survivorId, { mode, locale: 'th' });
		const out = await ordinaryNotification(mode);
		const channels = out.map(i => i.channel).sort();
		step(`setting = ${C.bold}${mode}${C.reset}`);
		if (out.length === 0) note('nothing sent');
		for (const item of out) printDelivery(item);
		const expected = { both: 'discord,email', discord: 'discord', email: 'email', off: '' }[mode];
		check(channels.join(',') === expected,
			`"${mode}" delivered to [${channels.join(', ') || 'nothing'}] — as configured`);
	}

	// ══════════════════════════════════════════════════════════════════════
	heading('8 · A muted account still gets the security notice');

	console.log(`\n  ${C.dim}The merge notice is not a product notification. An account set to${C.reset}`);
	console.log(`  ${C.dim}"off" that silently missed being merged would never find out.${C.reset}`);

	const mutedDiscord = await makeAccount({
		provider: 'discord', providerUid: '900000000000000002',
		username: 'quiet', displayName: 'เงียบ',
	});
	const mutedGoogle = await makeAccount({
		provider: 'google', providerUid: 'demo-google-uid-2',
		email: 'quiet@example.test', emailVerified: true, displayName: 'Quiet',
	});
	await core.users.setNotificationPreferences(mutedDiscord.id, { mode: 'off', locale: 'en' });
	await core.users.setNotificationPreferences(mutedGoogle.id, { mode: 'off', locale: 'en' });

	const mutedMerge = await core.accountMerge.mergeAccounts({
		userIdA: mutedGoogle.id, userIdB: mutedDiscord.id, profileSource: 'discord',
	});
	check(mutedMerge.notificationMode === 'off',
		'union of two explicit opt-outs is still off — the merge does not talk them into a channel');

	const mutedNotices = await deliver();
	for (const item of mutedNotices) printDelivery(item);
	check(mutedNotices.length === 2, 'the merge notice reached both channels anyway');

	await core.notifications.enqueue({
		userId: mutedMerge.survivorId,
		eventType: 'demo_payment_due',
		dedupeKey: `demo:${mutedMerge.survivorId}:muted`,
		payload: { subjectEn: 'Ordinary notification', bodyEn: 'This one should not arrive.' },
	});
	const mutedOrdinary = await deliver();
	check(mutedOrdinary.length === 0, 'an ordinary notification to the same account sends nothing');

	// ══════════════════════════════════════════════════════════════════════
	heading('9 · What the merge refuses to do');

	const collide = await makeAccount({
		provider: 'google', providerUid: 'demo-google-uid-3',
		email: 'third@example.test', emailVerified: true, displayName: 'Third',
	});
	const collisionPlan = await core.accountMerge.planMerge(collide.id, result.survivorId);
	step('Two accounts that both hold a Google sign-in');
	note(`plan.blockedBy = ${JSON.stringify(collisionPlan.blockedBy)}`);
	let refused = null;
	await core.accountMerge.mergeAccounts({ userIdA: collide.id, userIdB: result.survivorId })
		.catch(error => { refused = error.message; });
	check(refused === 'merge_provider_collision:google', `refused with "${refused}"`);
	check(await core.users.getUser(collide.id) !== null, 'a refused merge leaves both accounts intact');

	step('A table with a foreign key to users that the merge has never heard of');
	await core.db.query('CREATE TABLE IF NOT EXISTS merge_demo_probe (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL)');
	const spare = await makeAccount({
		provider: 'line', providerUid: 'demo-line-uid-1', displayName: 'Spare',
	});
	let swept = null;
	await core.accountMerge.mergeAccounts({ userIdA: spare.id, userIdB: mutedMerge.survivorId })
		.catch(error => { swept = error.message; });
	await core.db.query('DROP TABLE IF EXISTS merge_demo_probe');
	check(String(swept).includes('merge_unknown_reference') && String(swept).includes('merge_demo_probe.user_id'),
		`refused with "${swept}"`);
	note('Most foreign keys here are ON DELETE SET NULL, so a column nobody moved');
	note('would vanish silently rather than raise an error. This is the guard.');

	// ══════════════════════════════════════════════════════════════════════
	heading('10 · The audit row');

	const audit = await core.db.query(
		'SELECT * FROM account_merges WHERE survivor_user_id = $1 ORDER BY created_at DESC LIMIT 1',
		[result.survivorId],
	);
	const row = audit.rows[0];
	step('What was written, and what deliberately was not');
	note(`id              ${row.id}`);
	note(`survivor        ${row.survivor_user_id}`);
	note(`merged away     ${row.merged_user_id}`);
	note(`proof           ${JSON.stringify(row.provider_proof)}`);
	note(`moved           ${JSON.stringify(row.moved_counts.before)}`);
	check(!/token|refresh|"code"/i.test(JSON.stringify(row.provider_proof)),
		'no access token, no refresh token, no authorization code — this row outlives all of them');

	const alias = await core.db.query('SELECT * FROM user_aliases WHERE old_user_id = $1', [googleUser.id]);
	check(alias.rows[0]?.user_id === result.survivorId,
		`user_aliases: ${googleUser.id} → ${result.survivorId}`);

	console.log(`\n${C.bold}${process.exitCode ? `${C.red}Some checks failed.` : `${C.green}Every check passed.`}${C.reset}\n`);

	return created;
}

async function cleanup(ids) {
	const core = require('../core/index.js');
	await core.db.query('DROP TABLE IF EXISTS merge_demo_probe').catch(() => undefined);
	await core.db.query(
		'DELETE FROM notification_events WHERE event_type LIKE \'account_merged%\' OR event_type = \'demo_payment_due\'',
	).catch(() => undefined);
	for (const id of ids || []) {
		await core.db.query('DELETE FROM account_merges WHERE survivor_user_id = $1', [id]).catch(() => undefined);
		await core.db.query('DELETE FROM user_aliases WHERE user_id = $1 OR old_user_id = $1', [id]).catch(() => undefined);
		await core.db.query('DELETE FROM activities WHERE owner_user_id = $1', [id]).catch(() => undefined);
		await core.db.query('DELETE FROM users WHERE id = $1', [id]).catch(() => undefined);
	}
	await core.db.close().catch(() => undefined);
}

main()
	.then(cleanup)
	.catch(async (error) => {
		console.error(`\n${C.red}${error.stack || error.message}${C.reset}\n`);
		await cleanup([]).catch(() => undefined);
		process.exitCode = 1;
	});
