require('dotenv').config();
const assert = require('node:assert');
const core = require('../core/index.js');

const { users, activities, money, db } = core;
const created = { users: [] };
let n = 0;
function ok(msg) {
	n++;
	console.log(`  ok  ${msg}`);
}

function owed(activity, name) {
	return activities.settlement(activity).rows.find(r => r.displayName === name);
}

async function main() {
	await core.initCoreSchema();

	const fig = await users.loginWithIdentity({
		provider: 'discord', providerUid: '__fix_fig__', username: 'fig', displayName: 'ฟิก',
	});
	created.users.push(fig.user.id);

	const act = await activities.createActivity({
		ownerUserId: fig.user.id,
		title: 'ตีเเบด',
		participants: [
			{ displayName: 'ฟิก', userId: fig.user.id },
			{ displayName: 'โอม' },
			{ displayName: 'นััท' },
			{ displayName: 'A' },
		],
	});
	let full = await activities.getActivity(act.id);
	const P = Object.fromEntries(full.participants.map(p => [p.displayName, p.id]));

	console.log('\ntypos');

	await activities.updateActivity(act.id, { title: 'ตีแบด', location: 'คอร์ท 3' });
	await activities.renameParticipant(P['นััท'], 'นัท');
	full = await activities.getActivity(act.id);
	assert.strictEqual(full.title, 'ตีแบด');
	assert.strictEqual(full.location, 'คอร์ท 3');
	assert.ok(full.participants.some(p => p.displayName === 'นัท'));
	P['นัท'] = P['นััท'];
	ok('a misspelt title and a misspelt name are both fixable');

	console.log('\nremoving people');

	const extra = await activities.addParticipant(act.id, { displayName: 'คนที่ใส่ผิด' });
	assert.strictEqual(await activities.removeParticipant(extra.id), true);
	full = await activities.getActivity(act.id);
	assert.strictEqual(full.participants.length, 4);
	ok('someone added by mistake can be taken off the roster');

	for (const id of Object.values(P)) await activities.setRsvp(id, 'yes');
	const exp = await activities.addExpense(act.id, {
		label: 'ค่าคอร์ท',
		amountSatang: money.toSatang(4000),
		paidBy: P['ฟิก'],
	});

	await assert.rejects(
		() => activities.removeParticipant(P['โอม']),
		/มีรายการเงินอยู่/,
		'removing someone mid-settlement would silently change what everyone else owes',
	);
	ok('refuses to remove someone who has money attached, instead of quietly rewriting the split');

	await assert.rejects(() => activities.removeParticipant(P['ฟิก']), /ออกเงินให้กลุ่ม/);
	ok('refuses to remove the person who fronted the money');

	console.log('\nthe wrong amount');

	full = await activities.getActivity(act.id);
	assert.strictEqual(owed(full, 'โอม').outstanding, 100000);
	ok('฿4,000 typed instead of ฿400 — everyone owes ฿1,000 and the ledger is lying');

	await activities.updateExpense(exp.id, { amountSatang: money.toSatang(400) });
	full = await activities.getActivity(act.id);
	assert.strictEqual(owed(full, 'โอม').outstanding, 10000);
	assert.strictEqual(activities.settlement(full).total, 40000);
	const sum = activities.settlement(full).rows.reduce((s, r) => s + r.owes, 0);
	assert.strictEqual(sum, 40000);
	ok('corrected to ฿400 — shares recomputed from scratch and still sum back exactly');

	await activities.updateExpense(exp.id, { label: 'ค่าคอร์ท 2 ชม.', paidBy: P['โอม'] });
	full = await activities.getActivity(act.id);
	assert.strictEqual(full.expenses[0].label, 'ค่าคอร์ท 2 ชม.');
	assert.strictEqual(owed(full, 'โอม').net, -30000);
	assert.strictEqual(owed(full, 'ฟิก').net, 10000);
	ok('changing who fronted the money flips the credit to the right person');

	await activities.updateExpense(exp.id, { paidBy: P['ฟิก'], shareParticipantIds: [P['โอม'], P['นัท']] });
	full = await activities.getActivity(act.id);
	assert.strictEqual(owed(full, 'A').owes, 0);
	assert.strictEqual(owed(full, 'โอม').owes, 20000);
	ok('narrowing the split to two people leaves A owing nothing — uneven splits work');

	console.log('\nundo');

	await activities.updateExpense(exp.id, { shareParticipantIds: Object.values(P) });
	full = await activities.getActivity(act.id);
	const ohmRow = owed(full, 'โอม');
	const pay = await activities.recordPayment(act.id, ohmRow.participantId, { amountSatang: ohmRow.outstanding });
	await activities.confirmPayment(pay.id, fig.user.id);
	full = await activities.getActivity(act.id);
	assert.strictEqual(owed(full, 'โอม').outstanding, 0);

	await activities.unconfirmPayment(pay.id);
	full = await activities.getActivity(act.id);
	assert.strictEqual(owed(full, 'โอม').outstanding, 10000);
	assert.strictEqual(full.payments[0].status, 'pending');
	ok('confirming the wrong person is undoable — back to pending, money owed again');

	assert.strictEqual(await activities.removePayment(pay.id), true);
	full = await activities.getActivity(act.id);
	assert.strictEqual(full.payments.length, 0);
	ok('a payment logged by mistake can be deleted outright');

	console.log('\nclaims');

	const token = core.tokens.issueDeviceToken();
	await activities.claimParticipant(P['นัท'], { deviceToken: core.tokens.verifyDeviceToken(token) });
	full = await activities.getActivity(act.id);
	assert.ok(full.participants.find(p => p.id === P['นัท']).claimedAt);

	await activities.resetClaim(P['นัท']);
	full = await activities.getActivity(act.id);
	const nut = full.participants.find(p => p.id === P['นัท']);
	assert.strictEqual(nut.claimedAt, null);
	assert.strictEqual(nut.deviceToken, null);
	ok('the wrong person tapped a name — the owner can hand it back');

	console.log('\ndeleting the expense');

	assert.strictEqual(await activities.removeExpense(exp.id), true);
	full = await activities.getActivity(act.id);
	assert.strictEqual(full.expenses.length, 0);
	assert.strictEqual(full.shares.length, 0);
	assert.strictEqual(activities.settlement(full).state, 'none');
	ok('deleting an expense clears its shares and returns the money axis to none');

	assert.strictEqual(await activities.removeParticipant(P['A']), true);
	ok('with the money gone, that person can now be removed');

	await assert.rejects(() => activities.updateExpense('exp_nope', { amountSatang: 100 }));
	await assert.rejects(() => activities.renameParticipant(P['โอม'], '   '));
	ok('unknown ids and blank names are refused, not half-applied');

	const exp2 = await activities.addExpense(act.id, {
		label: 'ลูกแบด', amountSatang: money.toSatang(200), paidBy: P['โอม'],
		shareParticipantIds: [P['โอม'], P['นัท']],
	});
	await assert.rejects(
		() => activities.updateExpense(exp2.id, { shareParticipantIds: [P['โอม'], 'par_someone_else'] }),
		/is not in this activity/,
	);
	ok('an id from another activity is caught with a readable message, not a foreign key error');
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
