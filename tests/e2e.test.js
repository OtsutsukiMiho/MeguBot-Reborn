const path = require('node:path');
const projectRoot = path.join(__dirname, '..');
process.chdir(projectRoot);
require('dotenv').config({ path: path.join(projectRoot, '.env') });

const core = require('../core/index.js');
const { users, activities, money, voice, db } = core;
const assert = require('node:assert');

const THB = money.formatTHB;
const created = { users: [], activities: [] };

async function main() {
	await core.initCoreSchema();
	console.log('schema ok\n');

	const fig = await users.loginWithIdentity({
		provider: 'discord', providerUid: '__test_fig__', username: 'fig', displayName: 'ฟิก',
	});
	created.users.push(fig.user.id);
	assert.strictEqual(fig.created, true);

	const again = await users.loginWithIdentity({ provider: 'discord', providerUid: '__test_fig__', username: 'fig2' });
	assert.strictEqual(again.created, false);
	assert.strictEqual(again.user.id, fig.user.id);
	console.log('login: new user created, second login reuses it');

	const linked = await users.linkIdentity(fig.user.id, {
		provider: 'google', providerUid: '__test_fig_google__', email: 'fig@example.com',
	});
	assert.strictEqual(linked.linked, true);
	const withIds = await users.getUserWithIdentities(fig.user.id);
	assert.strictEqual(withIds.identities.length, 2);
	console.log('account linking: discord + google on one account\n');

	const act = await activities.createActivity({
		ownerUserId: fig.user.id,
		title: 'ตีแบด',
		location: 'คอร์ท 3',
		startsAt: new Date('2026-08-22T17:00:00+07:00'),
		guildId: '467655562658578432',
		participants: [
			{ displayName: 'ฟิก', userId: fig.user.id },
			{ displayName: 'โอม', discordUid: '__test_ohm__' },
			{ displayName: 'นัท', discordUid: '__test_nut__' },
			{ displayName: 'A' },
		],
	});
	created.activities.push(act.id);
	console.log(`activity created  →  /a/${act.code}`);
	console.log(voice.say('activityCreated', { title: act.title }, { seed: act.id }));

	let full = await activities.getActivityByCode(act.code);
	assert.strictEqual(full.participants.length, 4);

	const P = Object.fromEntries(full.participants.map(p => [p.displayName, p]));


	const tok = core.tokens.issueDeviceToken();
	await activities.claimParticipant(P['นัท'].id, { deviceToken: tok });
	await activities.setRsvp(P['ฟิก'].id, 'yes');
	await activities.setRsvp(P['โอม'].id, 'yes');
	await activities.setRsvp(P['นัท'].id, 'yes');
	await activities.setRsvp(P['A'].id, 'yes');

	full = await activities.getActivity(act.id);
	const nut = full.participants.find(p => p.displayName === 'นัท');
	assert.strictEqual(core.access.activityRole({ deviceToken: tok }, full), 'participant');
	assert.ok(nut.claimedAt);
	console.log('นัท claimed their slot with a device token, no signup');

	await activities.setPlanState(act.id, 'confirmed');
	await activities.setPlanState(act.id, 'done');
	for (const p of full.participants) await activities.setAttended(p.id, true);
	console.log('activity confirmed → happened, attendance recorded\n');

	const exp = await activities.addExpense(act.id, {
		label: 'ค่าคอร์ท',
		amountSatang: money.toSatang(400),
		paidBy: P['ฟิก'].id,
		shareParticipantIds: Object.values(P).map(p => p.id),
	});
	console.log(voice.say('expenseAdded', {
		label: 'ค่าคอร์ท', amount: exp.amountSatang, perHead: exp.split[P['โอม'].id],
	}, { seed: exp.id }));

	full = await activities.getActivity(act.id);
	assert.strictEqual(activities.settlement(full).state, 'open');

	const pay = await activities.recordPayment(act.id, P['โอม'].id, { amountSatang: money.toSatang(100) });
	let s = activities.settlement(await activities.getActivity(act.id));
	assert.strictEqual(s.rows.find(r => r.displayName === 'โอม').outstanding, 10000);
	console.log('โอม claims paid → still outstanding (pending is not paid)');

	await activities.confirmPayment(pay.id, fig.user.id);
	full = await activities.getActivity(act.id);
	s = activities.settlement(full);
	assert.strictEqual(s.rows.find(r => r.displayName === 'โอม').outstanding, 0);
	console.log(voice.say('paymentConfirmed', { name: 'โอม', amount: 10000 }, { seed: pay.id }));

	console.log('\n  settlement');
	for (const r of s.rows) {
		const mark = r.outstanding > 0 ? '✗' : r.net < 0 ? '↩' : '✓';
		console.log(`    ${mark} ${r.displayName.padEnd(6)} ค้าง ${THB(Math.max(r.outstanding, 0)).padStart(9)}   net ${THB(r.net)}`);
	}
	assert.strictEqual(s.total, 40000);
	assert.strictEqual(s.unpaid.length, 2);
	console.log(`\n  ${voice.say('waitingOn', { names: s.unpaid.map(r => r.displayName) }, { seed: act.id })}`);

	for (const r of s.unpaid) {
		const p = await activities.recordPayment(act.id, r.participantId, { amountSatang: r.outstanding });
		await activities.confirmPayment(p.id, fig.user.id);
	}
	full = await activities.getActivity(act.id);
	s = activities.settlement(full);
	assert.strictEqual(s.fullySettled, true);
	assert.strictEqual(activities.settlement(full).state, 'settled');
	console.log(`\n${voice.say('allSettled', { title: act.title }, { seed: act.id })}`);

	await assert.rejects(() => activities.setPlanState(act.id, 'cancelled'));
	console.log('a finished plan cannot be cancelled after the fact');

	const stranger = await users.loginWithIdentity({ provider: 'discord', providerUid: '__test_mod__', displayName: 'mod' });
	created.users.push(stranger.user.id);
	const role = core.access.activityRole({ userId: stranger.user.id }, full);
	assert.strictEqual(role, 'none');
	assert.strictEqual(core.access.can(role, 'viewAmounts'), false);
	console.log('a server mod outside the activity still cannot see the amounts');

	const ohmAccount = await users.loginWithIdentity({ provider: 'discord', providerUid: '__test_ohm__', displayName: 'โอม' });
	created.users.push(ohmAccount.user.id);
	const claimed = await users.claimParticipants(ohmAccount.user.id);
	assert.strictEqual(claimed.claimed, 1);
	console.log(`โอม signed up later → ${claimed.claimed} past activity merged into the account automatically`);
}

async function cleanup() {
	for (const id of created.activities) {
		await db.query('DELETE FROM activities WHERE id = $1', [id]).catch(() => undefined);
	}
	await db.query(`
		DELETE FROM participants WHERE discord_uid LIKE '\\_\\_test\\_%'
	`).catch(() => undefined);
	for (const id of created.users) {
		await db.query('DELETE FROM users WHERE id = $1', [id]).catch(() => undefined);
	}
	const left = await db.query('SELECT count(*)::int n FROM activities');
	const lu = await db.query('SELECT count(*)::int n FROM users');
	console.log(`\ncleanup done — activities: ${left.rows[0].n} rows, users: ${lu.rows[0].n} rows`);
}

main()
	.then(() => cleanup())
	.then(() => db.close())
	.then(() => console.log('\nend-to-end passed\n'))
	.catch(async (err) => {
		console.error('\nFAILED:', err.message);
		await cleanup().catch(() => undefined);
		await db.close().catch(() => undefined);
		process.exitCode = 1;
	});
