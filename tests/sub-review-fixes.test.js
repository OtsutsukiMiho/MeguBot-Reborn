// The edges a review of the subscription work found: the first hours of a new
// month, a payer who changed while an old month was still owed, a booking to
// join that someone takes back, a refused panel change, and a waiting change
// that can no longer apply. Real core and a disposable database.
require('dotenv').config();
const assert = require('node:assert/strict');
const core = require('../core/index.js');
const event = require('../commands/utility/event.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

const snowflake = () => `1${Date.now()}${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;
const GUILD = '123456789012345678';

function fake({ customId, user, kind, fields = null, users = null }) {
	const log = { replies: [], edits: [], followUps: [] };
	return {
		log, customId,
		locale: 'th', guildLocale: 'th', guildId: GUILD, channelId: '223456789012345678',
		user: { id: user.id, username: user.name, globalName: user.name, displayAvatarURL: () => null },
		member: { displayName: user.name },
		fields,
		users: users ? new Map(users.map(u => [u.id, { id: u.id, username: u.name, globalName: u.name, bot: false }])) : null,
		members: users ? new Map(users.map(u => [u.id, { displayName: u.name }])) : null,
		deferred: false, replied: false,
		isModalSubmit: () => kind === 'modal', isButton: () => kind === 'button',
		isStringSelectMenu: () => kind === 'select', isUserSelectMenu: () => kind === 'users',
		async reply(value) { this.replied = true; log.replies.push(value); },
		async deferReply() { this.deferred = true; },
		async deferUpdate() { this.deferred = true; },
		async editReply(value) { log.edits.push(value); return { id: 'card1' }; },
		async followUp(value) { log.followUps.push(value); },
		async showModal() {},
		message: { id: 'card1', content: '', editable: true, edit: async () => undefined },
		channel: { messages: { edit: async () => undefined } },
		client: { users: { fetch: async () => ({ send: async () => undefined }) } },
	};
}

const text = call => {
	const value = call.log.edits.at(-1) ?? call.log.followUps.at(-1) ?? call.log.replies.at(-1);
	return typeof value === 'string' ? value : value?.content;
};

async function monthly(owner, names, { start }) {
	const created = await core.activities.createActivity({
		ownerUserId: owner.id, title: 'Netflix', kind: 'recurring', recurrence: 'monthly', dueDay: 28, guildId: GUILD,
		participants: names.map(name => (name === 'ฟิก' ? { displayName: name, userId: owner.id } : { displayName: name })),
	});
	const activity = await core.activities.getActivity(created.id);
	await core.activities.ensurePeriod(created.id, start, {
		expense: { label: 'Netflix', amountSatang: 30000, paidBy: activity.participants[0].id },
	});
	return core.activities.getActivity(created.id);
}

async function main() {
	await core.initCoreSchema();
	const figDiscord = { id: snowflake(), name: 'ฟิก' };
	const { user: fig } = await core.users.loginWithIdentity({ provider: 'discord', providerUid: figDiscord.id, username: 'fig', displayName: 'ฟิก' });
	const made = [];
	const september = new Date('2026-09-10T12:00:00+07:00');
	const firstOfOctober = new Date('2026-10-01T00:20:00+07:00');

	try {
		// The first minutes of a month, before any rollover: a change still works.
		let activity = await monthly(fig, ['ฟิก', 'โอม', 'มิว'], { start: september });
		made.push(activity.id);
		const row = name => activity.participants.find(p => p.displayName === name);
		assert.ok(!activity.periods.some(p => p.key === '2026-10'), 'October is not open yet');
		const joined = await core.activities.changeSubscription(activity.id, { leave: [row('มิว').id] }, { now: firstOfOctober });
		assert.equal(joined.when, 'now');
		assert.equal(joined.periodKey, '2026-10');
		activity = await core.activities.getActivity(activity.id);
		const october = activity.periods.find(p => p.key === '2026-10');
		assert.ok(october, 'the change opened October itself');
		assert.deepEqual(activity.shares.filter(s => s.periodId === october.id).map(s => s.amountSatang), [15000, 15000]);
		ok('on the 1st, before the rollover, a change opens the new month instead of failing');

		// The payer changes on the 1st: October moves, September stays as it was paid.
		const sepPeriod = activity.periods.find(p => p.key === '2026-09');
		const sepPaidBy = () => activity.expenses.find(e => e.periodId === sepPeriod.id).paidBy;
		assert.equal(sepPaidBy(), row('ฟิก').id);
		await core.activities.setRecurringPayer(activity.id, row('โอม').id, { now: firstOfOctober });
		activity = await core.activities.getActivity(activity.id);
		assert.equal(sepPaidBy(), row('ฟิก').id, 'last month keeps its payer');
		assert.equal(activity.expenses.find(e => e.periodId === october.id).paidBy, row('โอม').id);
		ok('a new payer on the 1st changes this month, never last month');

		// Mew still owes September to Fig. A slip from Discord goes to Om now,
		// so it may only pay Om's months.
		const mewUid = snowflake();
		await core.db.query('UPDATE participants SET discord_uid = $2 WHERE id = $1', [row('มิว').id, mewUid]);
		const [candidate] = await core.activities.listPaymentCandidatesForDiscord(mewUid, null, activity.code);
		assert.equal(candidate, undefined, 'Mew owes only September, which was paid by Fig, not Om');
		ok('a Discord slip never pays a month whose bill someone other than the payee paid');

		// A booking to join next month can be taken back.
		const tonDiscord = { id: snowflake(), name: 'ต้น' };
		const omPays = await core.activities.recordPayment(activity.id, row('โอม').id, { amountSatang: 15000, method: 'bank_transfer', periodId: october.id });
		assert.ok(omPays.id);
		let call = fake({ customId: `evt:addp:${activity.code}:card1`, user: figDiscord, kind: 'users', users: [tonDiscord] });
		await event.handleComponent(call, { core });
		activity = await core.activities.getActivity(activity.id);
		const ton = activity.participants.find(p => p.discordUid === tonDiscord.id);
		assert.ok(activity.recurringChange.join.includes(ton.id), 'Ton is booked from next month');
		call = fake({ customId: `evt:leave:${activity.code}`, user: tonDiscord, kind: 'button' });
		await event.handleComponent(call, { core });
		assert.match(call.log.replies[0].content, /ยกเลิกการเข้าร่วม/);
		call = fake({ customId: `evt:leaveok:${activity.code}:card1`, user: tonDiscord, kind: 'button' });
		await event.handleComponent(call, { core });
		assert.match(text(call), /ยกเลิกแล้ว/);
		activity = await core.activities.getActivity(activity.id);
		assert.ok(!activity.recurringChange.join.includes(ton.id), 'the booking is gone');
		ok('someone booked to join next month can take it back from the card');

		// A refused panel change leaves no new rows behind.
		const second = await monthly(fig, ['ฟิก', 'โอม'], { start: september });
		made.push(second.id);
		const secondPeriod = second.periods[0];
		await core.activities.addExpense(second.id, { label: 'ภาษี', amountSatang: 1000, paidBy: second.participants[0].id, periodId: secondPeriod.id, shareParticipantIds: second.participants.map(p => p.id) });
		const mewDiscord = { id: snowflake(), name: 'มิว' };
		call = fake({ customId: `evt:addp:${second.code}:card1`, user: figDiscord, kind: 'users', users: [mewDiscord] });
		await event.handleComponent(call, { core });
		assert.match(text(call), /หลายรายการต่อเดือน/);
		const after = await core.activities.getActivity(second.id);
		assert.equal(after.participants.length, 2, 'Mew was not left on the roster');
		ok('when the panel cannot apply a change, the people it added are removed again');

		// A waiting change for a month that grew a second cost is dropped at the rollover.
		const third = await monthly(fig, ['ฟิก', 'โอม'], { start: september });
		made.push(third.id);
		const thirdSep = third.periods[0];
		await core.activities.recordPayment(third.id, third.participants[1].id, { amountSatang: 15000, method: 'bank_transfer', periodId: thirdSep.id });
		await core.activities.changeSubscription(third.id, { amountSatang: 40000 }, { now: september });
		await core.activities.addExpense(third.id, { label: 'ภาษี', amountSatang: 1000, paidBy: third.participants[0].id, periodId: thirdSep.id, shareParticipantIds: third.participants.map(p => p.id) });
		await core.activities.ensurePeriod(third.id, firstOfOctober, { rollover: true });
		const thirdAfter = await core.activities.getActivity(third.id);
		assert.equal(thirdAfter.recurringChange, null, 'nothing is left waiting for a month it can never apply to');
		ok('a waiting change that no longer fits is dropped at the rollover, not kept forever');
	}
	finally {
		for (const id of made) await core.db.query('DELETE FROM activities WHERE id = $1', [id]).catch(() => undefined);
	}
	console.log(`\n${n} checks passed`);
	await core.db.close?.();
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
