require('dotenv').config();
const core = require('../core/index.js');

async function main() {
	await core.initCoreSchema();

	const { user } = await core.users.loginWithIdentity({
		provider: 'discord', providerUid: '__seed_fig__', username: 'fig', displayName: 'ฟิก',
	});

	const act = await core.activities.createActivity({
		ownerUserId: user.id,
		title: 'ตีแบด',
		location: 'คอร์ท 3 · ซอยอารีย์',
		startsAt: new Date('2026-08-22T17:00:00+07:00'),
		participants: [
			{ displayName: 'ฟิก', userId: user.id },
			{ displayName: 'โอม' },
			{ displayName: 'นัท' },
			{ displayName: 'A' },
		],
	});

	const full = await core.activities.getActivity(act.id);
	const P = Object.fromEntries(full.participants.map(p => [p.displayName, p.id]));
	await core.activities.setRsvp(P['ฟิก'], 'yes');
	await core.activities.setRsvp(P['โอม'], 'yes');
	await core.activities.setRsvp(P['นัท'], 'yes');
	await core.activities.setRsvp(P['A'], 'yes');
	await core.activities.setPlanState(act.id, 'confirmed');
	await core.activities.setPlanState(act.id, 'done');
	await core.activities.addExpense(act.id, {
		label: 'ค่าคอร์ท 2 ชม.',
		amountSatang: core.money.toSatang(400),
		paidBy: P['ฟิก'],
	});
	const pay = await core.activities.recordPayment(act.id, P['โอม'], { amountSatang: core.money.toSatang(100) });
	await core.activities.confirmPayment(pay.id, user.id);

	console.log(`SEEDED /a/${act.code}`);
	console.log(`user=${user.id} activity=${act.id}`);
}

main().then(() => core.db.close()).catch(async (e) => {
	console.error(e);
	await core.db.close();
	process.exitCode = 1;
});
