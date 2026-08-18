require('dotenv').config();
const core = require('../core/index.js');

async function main() {
	await core.initCoreSchema();
	const { user } = await core.users.loginWithIdentity({
		provider: 'discord',
		providerUid: '__payment_browser_owner__',
		username: 'payment-demo-owner',
		displayName: 'บี เจ้าหนี้',
	});
	await core.db.query('DELETE FROM activities WHERE owner_user_id = $1', [user.id]);
	await core.users.setPromptPay(user.id, {
		promptpayId: '081-234-5678',
		promptpayName: 'MR B CREDITOR',
	});
	const activity = await core.activities.createActivity({
		ownerUserId: user.id,
		title: 'ค่าสมาชิกรายเดือน · Payment Test',
		kind: 'recurring',
		recurrence: 'monthly',
		dueDay: 5,
		participants: [
			{ displayName: 'บี เจ้าหนี้', userId: user.id },
			{ displayName: 'คุณ (ผู้ทดสอบ)' },
		],
	});
	const full = await core.activities.getActivity(activity.id);
	const owner = full.participants.find(participant => participant.userId === user.id);
	for (const month of ['2026-04-05', '2026-05-05', '2026-06-05', '2026-07-05', '2026-08-05']) {
		const ensured = await core.activities.ensurePeriod(activity.id, new Date(`${month}T12:00:00+07:00`));
		await core.activities.addExpense(activity.id, {
			label: 'ค่าสมาชิกรายเดือน',
			// ฿400 split between owner and tester = ฿200 owed per month;
			// five months totals ฿1,000, matching the local sample-slip fixture.
			amountSatang: 40000,
			paidBy: owner.id,
			periodId: ensured.period.id,
		});
	}
	console.log(JSON.stringify({ code: activity.code, url: `/a/${activity.code}`, ownerUserId: user.id }));
}

main()
	.then(() => core.db.close())
	.catch(async (error) => {
		console.error(error);
		await core.db.close().catch(() => undefined);
		process.exitCode = 1;
	});
