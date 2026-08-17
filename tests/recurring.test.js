require('dotenv').config();
const assert = require('node:assert');
const core = require('../core/index.js');

const { users, activities, reminders, money, db } = core;
const created = { users: [] };
let n = 0;
function ok(msg) {
	n++;
	console.log(`  ok  ${msg}`);
}

async function main() {
	await core.initCoreSchema();

	const megu = await users.loginWithIdentity({
		provider: 'discord', providerUid: '__rec_owner__', username: 'megu', displayName: 'Megu',
	});
	created.users.push(megu.user.id);

	console.log('\nplan and money are independent');

	const badminton = await activities.createActivity({
		ownerUserId: megu.user.id,
		title: 'ตีแบด',
		participants: [{ displayName: 'Megu', userId: megu.user.id }, { displayName: 'โอม' }, { displayName: 'นัท' }],
	});
	let full = await activities.getActivity(badminton.id);
	assert.strictEqual(full.planState, 'open');
	assert.strictEqual(activities.settlement(full).state, 'none');

	// The court price is known before anyone plays — bill it now.
	for (const p of full.participants) await activities.setRsvp(p.id, 'yes');
	await activities.addExpense(badminton.id, {
		label: 'ค่าคอร์ท',
		amountSatang: money.toSatang(300),
		paidBy: full.participants[0].id,
	});
	full = await activities.getActivity(badminton.id);
	assert.strictEqual(full.planState, 'open', 'billing must not drag the plan forward');
	assert.strictEqual(activities.settlement(full).state, 'open');
	ok('money opened while the plan is still gathering answers — the old model could not do this');

	await activities.setPlanState(badminton.id, 'confirmed');
	await activities.setPlanState(badminton.id, 'done');
	full = await activities.getActivity(badminton.id);
	assert.strictEqual(activities.settlement(full).state, 'open', 'finishing the event does not pay the bill');
	ok('plan reached done with money still outstanding');

	console.log('\nmonthly agreement');

	const yt = await activities.createActivity({
		ownerUserId: megu.user.id,
		title: 'YouTube Premium',
		kind: 'recurring',
		recurrence: 'monthly',
		dueDay: 5,
		participants: [
			{ displayName: 'Megu', userId: megu.user.id },
			{ displayName: 'นัท', discordUid: '__rec_nut__' },
			{ displayName: 'ฟิก' }, { displayName: 'โอม' }, { displayName: 'A' }, { displayName: 'B' },
		],
	});
	full = await activities.getActivity(yt.id);
	assert.strictEqual(full.planState, 'confirmed', 'a monthly agreement has nothing to RSVP to');
	assert.ok(full.participants.every(p => p.rsvp === 'yes'));
	ok('recurring activity skips the plan axis entirely');

	const aug = await activities.ensurePeriod(yt.id, new Date('2026-08-10T00:00:00Z'));
	assert.strictEqual(aug.created, true);
	assert.strictEqual(aug.period.key, '2026-08');
	assert.strictEqual(aug.period.label, 'สิงหาคม 2569');
	assert.strictEqual(new Date(aug.period.dueAt).getUTCDate(), 5);
	ok(`period "${aug.period.label}" created, due on day 5`);

	const again = await activities.ensurePeriod(yt.id, new Date('2026-08-28T00:00:00Z'));
	assert.strictEqual(again.created, false);
	assert.strictEqual(again.period.id, aug.period.id);
	ok('asking twice in the same month does not duplicate the period');

	full = await activities.getActivity(yt.id);
	const owner = full.participants[0];
	await activities.addExpense(yt.id, {
		label: 'YouTube Premium',
		amountSatang: money.toSatang(399),
		paidBy: owner.id,
		periodId: aug.period.id,
	});

	const sep = await activities.ensurePeriod(yt.id, new Date('2026-09-03T00:00:00Z'));
	await activities.addExpense(yt.id, {
		label: 'YouTube Premium',
		amountSatang: money.toSatang(399),
		paidBy: owner.id,
		periodId: sep.period.id,
	});

	full = await activities.getActivity(yt.id);
	const augSum = activities.settlement(full, aug.period.id);
	const sepSum = activities.settlement(full, sep.period.id);
	const allSum = activities.settlement(full);

	assert.strictEqual(augSum.total, 39900);
	assert.strictEqual(sepSum.total, 39900);
	assert.strictEqual(allSum.total, 79800);
	assert.strictEqual(augSum.rows.find(r => r.displayName === 'นัท').outstanding, 6650);
	ok('each month settles separately — สิงหาคม ฿66.50 each, and ฿798.00 across both');

	const nutAug = augSum.rows.find(r => r.displayName === 'นัท');
	const pay = await activities.recordPayment(yt.id, nutAug.participantId, {
		amountSatang: nutAug.outstanding, periodId: aug.period.id,
	});
	await activities.confirmPayment(pay.id, megu.user.id);

	full = await activities.getActivity(yt.id);
	assert.strictEqual(activities.settlement(full, aug.period.id).rows.find(r => r.displayName === 'นัท').outstanding, 0);
	assert.strictEqual(activities.settlement(full, sep.period.id).rows.find(r => r.displayName === 'นัท').outstanding, 6650);
	ok('paying สิงหาคม leaves กันยายน untouched');

	console.log('\nreminders');

	const future = new Date('2026-08-01T00:00:00Z');
	const beforeDue = await reminders.due({ now: future, baseUrl: 'https://megu.app' });
	assert.strictEqual(beforeDue.length, 0);
	ok('nobody is nagged before the due date');

	const late = new Date('2026-09-20T00:00:00Z');
	const batch = await reminders.due({ now: late, baseUrl: 'https://megu.app' });
	const nut = batch.find(p => p.discordUid === '__rec_nut__');
	assert.ok(nut, 'นัท has a linked Discord account and owes กันยายน');
	assert.strictEqual(nut.total, 6650);
	assert.ok(nut.message.includes('YouTube Premium'));
	assert.ok(nut.message.includes('฿66.50'));
	assert.ok(nut.message.includes('กันยายน 2569'));
	assert.ok(nut.message.includes('เลยกำหนด'));
	ok('statement names the item, the month, the amount and how late it is');

	assert.ok(!batch.some(p => p.displayName === 'ฟิก'), 'ฟิก never linked Discord, so cannot be reached');
	ok('unreachable people are skipped, not silently counted as reminded');

	for (const line of nut.lines) await reminders.markSent(line, { sentAt: late });
	const second = await reminders.due({ now: late, baseUrl: 'https://megu.app' });
	assert.ok(!second.some(p => p.discordUid === '__rec_nut__'));
	ok('cooldown stops Megu sending the same nag twice in a day');

	const tomorrow = new Date('2026-09-22T00:00:00Z');
	const third = await reminders.due({ now: tomorrow, baseUrl: 'https://megu.app' });
	assert.ok(third.some(p => p.discordUid === '__rec_nut__'));
	ok('but she comes back the next day');

	console.log(`\n  statement preview:\n${nut.message.split('\n').map(l => `    ${l}`).join('\n')}`);
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
