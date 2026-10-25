// The month-by-month screen's data: every month of a subscription, newest
// first, with who paid, whose slip is being checked and who still owes, and
// whoever was paid back that month. Real core and a disposable database.
require('dotenv').config();
const assert = require('node:assert/strict');
const core = require('../core/index.js');
const { serializeActivity } = require('../adapters/http/megu-api.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

async function main() {
	await core.initCoreSchema();
	const stamp = Date.now();
	const { user: fig } = await core.users.loginWithIdentity({ provider: 'discord', providerUid: `9${stamp}1`, username: `fig${stamp}`, displayName: 'ฟิก' });
	let activityId;

	try {
		const created = await core.activities.createActivity({
			ownerUserId: fig.id,
			title: 'Netflix',
			kind: 'recurring',
			recurrence: 'monthly',
			dueDay: 5,
			participants: [
				{ displayName: 'ฟิก', userId: fig.id },
				{ displayName: 'โอม' },
				{ displayName: 'มิว' },
			],
		});
		activityId = created.id;
		let activity = await core.activities.getActivity(activityId);
		const row = name => activity.participants.find(p => p.displayName === name);

		const september = new Date('2026-09-10T12:00:00+07:00');
		const october = new Date('2026-10-10T12:00:00+07:00');
		const { period: sep } = await core.activities.ensurePeriod(activityId, september, {
			expense: { label: 'Netflix', amountSatang: 42000, paidBy: row('ฟิก').id },
		});
		const { period: oct } = await core.activities.ensurePeriod(activityId, october, { rollover: true });

		// September: Om paid and was confirmed, Mew never paid.
		const omSep = await core.activities.recordPayment(activityId, row('โอม').id, { amountSatang: 14000, method: 'bank_transfer', periodId: sep.id });
		await core.activities.confirmPayment(omSep.id, fig.id);
		// October: Mew sent a slip that is still being checked, Om has not paid.
		await core.activities.recordPayment(activityId, row('มิว').id, { amountSatang: 14000, method: 'bank_transfer', periodId: oct.id });

		activity = await core.activities.getActivity(activityId);
		const view = serializeActivity(activity, { userId: fig.id, lang: 'th' }, { periodId: oct.id });
		assert.deepEqual(view.history.map(m => m.key), ['2026-10', '2026-09'], 'newest month first');

		const [octView, sepView] = view.history;
		const line = (month, name) => month.rows.find(r => r.participantId === row(name).id);
		assert.equal(sepView.totalSatang, 42000);
		assert.equal(sepView.receiverId, row('ฟิก').id);
		assert.equal(line(sepView, 'โอม').outstandingSatang, 0);
		assert.equal(line(sepView, 'มิว').outstandingSatang, 14000);
		assert.equal(sepView.toReceiveSatang, 14000);
		ok('a past month says who paid, who still owes, and what the receiver is still owed');

		assert.equal(line(octView, 'มิว').pendingSatang, 14000);
		assert.equal(line(octView, 'โอม').outstandingSatang, 14000);
		assert.equal(octView.toReceiveSatang, 28000, 'a slip being checked is not money received yet');
		ok('this month shows a slip being checked separately from money not sent at all');

		assert.equal(line(octView, 'ฟิก').outstandingSatang, 0, 'the receiver never reads as owing');
		ok('the receiver is listed without a negative balance');

		// A stranger holding the link sees none of it.
		const stranger = serializeActivity(activity, { userId: null, lang: 'th' }, { periodId: oct.id });
		assert.equal(stranger.history, null);
		ok('someone not on the bill gets no history at all');

		// A one-off bill has no months.
		const event = await core.activities.createActivity({ ownerUserId: fig.id, title: 'ตีแบด', kind: 'event', participants: [{ displayName: 'ฟิก', userId: fig.id }] });
		const eventView = serializeActivity(await core.activities.getActivity(event.id), { userId: fig.id, lang: 'th' });
		assert.equal(eventView.history, null);
		await core.db.query('DELETE FROM activities WHERE id = $1', [event.id]);
		ok('a one-off bill has no month history');
	}
	finally {
		if (activityId) await core.db.query('DELETE FROM activities WHERE id = $1', [activityId]).catch(() => undefined);
	}
	console.log(`\n${n} checks passed`);
	await core.db.close?.();
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
