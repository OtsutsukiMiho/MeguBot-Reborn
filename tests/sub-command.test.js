// `/sub`: a monthly bill from one modal, carried into the next month by
// itself, and announced in its channel once on each due day. Real core, real
// disposable database; only Discord is a stand-in.
require('dotenv').config();
const assert = require('node:assert/strict');
const core = require('../core/index.js');
const event = require('../commands/utility/event.js');
const sub = require('../commands/utility/sub.js');
const { createPaymentDueSweep } = require('../adapters/notifications/payment-due.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

const snowflake = () => `1${Date.now()}${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;

function fake({ customId, user, kind, fields = null }) {
	const log = { replies: [], edits: [], followUps: [], cardEdits: [], modal: null };
	return {
		log,
		customId,
		locale: 'th',
		guildLocale: 'th',
		guildId: '123456789012345678',
		channelId: '223456789012345678',
		user: { id: user.id, username: user.name, globalName: user.name, displayAvatarURL: () => null },
		member: { displayName: user.name },
		fields,
		options: { getString: () => 'Netflix' },
		isModalSubmit: () => kind === 'modal',
		isButton: () => kind === 'button',
		isStringSelectMenu: () => false,
		async reply(value) { this.replied = true; log.replies.push(value); },
		async deferReply() { this.deferred = true; },
		async editReply(value) { log.edits.push(value); },
		async followUp(value) { log.followUps.push(value); },
		async showModal(modal) { log.modal = modal; },
		message: { id: 'card1', editable: true, edit: async value => log.cardEdits.push(value) },
		channel: { messages: { edit: async () => undefined } },
	};
}

function subSubmit(user, { people = [], guests = '', amount = '420', dueDay = '5' } = {}) {
	return fake({
		customId: 'evt:subcreate', user, kind: 'modal',
		fields: {
			getTextInputValue: id => ({ title: 'Netflix', guests, amount, dueDay }[id] ?? ''),
			getSelectedUsers: () => new Map(people.map(p => [p.id, { id: p.id, username: p.name, globalName: p.name }])),
			getSelectedMembers: () => new Map(people.map(p => [p.id, { displayName: p.name }])),
		},
	});
}

function nextMonth(date) {
	const d = new Date(date);
	d.setUTCMonth(d.getUTCMonth() + 1);
	return d;
}

async function main() {
	await core.initCoreSchema();
	const fig = { id: snowflake(), name: 'ฟิก' };
	const om = { id: snowflake(), name: 'โอม' };
	const codes = [];

	try {
		// The command opens the monthly modal.
		let call = fake({ customId: '', user: fig, kind: 'command' });
		await sub.execute(call);
		const modal = call.log.modal.toJSON();
		assert.equal(modal.custom_id, 'evt:subcreate');
		assert.match(JSON.stringify(modal), /Netflix/, 'the service typed after /sub is filled in');
		ok('/sub opens the monthly modal with the service already filled in');

		// A monthly bill that bills nobody is refused, not created.
		call = subSubmit(fig, { people: [om], amount: 'เยอะ' });
		await event.handleComponent(call, { core });
		assert.match(call.log.replies[0].content, /อ่านยอด "เยอะ" ไม่ออก/);
		call = subSubmit(fig, { people: [om], dueDay: '31' });
		await event.handleComponent(call, { core });
		assert.match(call.log.replies[0].content, /ใส่ 1–28/);
		ok('an unreadable amount or a day not every month has is refused before anything is written');

		call = subSubmit(fig, { people: [om], guests: 'แม่', amount: '420', dueDay: '5' });
		await event.handleComponent(call, { core });
		const card = call.log.edits[0];
		const code = card.components[0].components[0].data.custom_id.split(':')[2];
		codes.push(code);
		let activity = await core.activities.getActivityByCode(code);
		assert.equal(activity.kind, 'recurring');
		assert.equal(activity.dueDay, 5);
		assert.equal(activity.periods.length, 1, 'this month is open');
		const thisMonth = activity.periods[0];
		assert.deepEqual(activity.shares.filter(s => s.periodId === thisMonth.id).map(s => s.amountSatang), [14000, 14000, 14000]);
		assert.match(card.content, /^🔁 \*\*Netflix\*\* · ฿420\.00\/เดือน หารเท่า 3 คน · .+ · ทุกวันที่ 5/);
		assert.equal(card.components[0].components[1].data.label, 'ขอหารด้วย');
		assert.match(call.log.followUps[0].content, /เปิดรอบใหม่ให้ทุกเดือน/);
		ok('one modal: a monthly bill, this month opened and split three ways, one card');

		// Next month opens by itself on the sweep, copying this month's bill.
		const due = new Date(new Date(thisMonth.dueAt).getTime() + 60_000);
		const nextDue = nextMonth(due);
		await core.reminders.paymentDueNow({ now: nextDue, baseUrl: 'https://megu.test' });
		activity = await core.activities.getActivityByCode(code);
		assert.equal(activity.periods.length, 2, 'next month opened without anyone visiting');
		const later = activity.periods.find(p => p.id !== thisMonth.id);
		assert.deepEqual(activity.shares.filter(s => s.periodId === later.id).map(s => s.amountSatang), [14000, 14000, 14000]);
		ok('the next month opens on its own and carries the same bill');

		// Due day: the channel is told once, with who still owes and a slip button.
		const posts = [];
		const sweep = createPaymentDueSweep({
			baseUrl: 'https://megu.test',
			sendDiscord: async () => undefined,
			postChannel: async notice => {
				posts.push(notice);
				return { delivered: true };
			},
		});
		await sweep.runOnce({ now: due });
		const mine = posts.filter(p => p.defer?.code === code);
		assert.equal(mine.length, 1);
		assert.equal(mine[0].channelId, '223456789012345678');
		assert.match(mine[0].message, /^⏰ \*\*Netflix\*\* · .+ ครบกำหนดวันนี้/);
		assert.match(mine[0].message, new RegExp(`<@${om.id}> ยังค้าง ฿140\\.00`));
		assert.match(mine[0].message, /แม่ ยังค้าง ฿140\.00/, 'the person Megu cannot DM is listed for the group');
		assert.ok(!mine[0].message.includes(`<@${fig.id}>`), 'the organiser is collecting, not owing');
		await sweep.runOnce({ now: new Date(due.getTime() + 5 * 60_000) });
		assert.equal(posts.filter(p => p.defer?.code === code).length, 1, 'once per due date, not once per sweep');
		ok('on the due day the channel gets one post: who still owes, and a send-slip button');

		// A block leaves it due; the post goes out on the first sweep after.
		const blockedPosts = [];
		const blocked = createPaymentDueSweep({
			baseUrl: '', sendDiscord: async () => undefined,
			postChannel: async notice => {
				blockedPosts.push(notice);
				return { delivered: false, blocked: true };
			},
		});
		await blocked.runOnce({ now: new Date(nextDue.getTime() + 60_000) });
		await blocked.runOnce({ now: new Date(nextDue.getTime() + 6 * 60_000) });
		assert.equal(blockedPosts.filter(p => p.defer?.code === code).length, 2, 'not recorded while Discord was refusing');
		ok('while Discord is blocking, the due-day post is kept for later instead of being lost');

		// Someone joins mid-month before anyone paid: this month is re-divided.
		const late = { id: snowflake(), name: 'ปอ' };
		call = fake({ customId: `evt:join:${code}`, user: late, kind: 'button' });
		// "แม่" is unclaimed, so the join asks first; answer "add me".
		await event.handleComponent(call, { core });
		const select = fake({ customId: call.log.replies[0].components[0].components[0].data.custom_id, user: late, kind: 'select' });
		select.isStringSelectMenu = () => true;
		select.values = ['new'];
		select.deferUpdate = async () => undefined;
		await event.handleComponent(select, { core });
		activity = await core.activities.getActivityByCode(code);
		const current = core.activities.currentPeriod(activity);
		assert.deepEqual(activity.shares.filter(s => s.periodId === current.id).map(s => s.amountSatang), [10500, 10500, 10500, 10500]);
		ok('a newcomer mid-month is added to this month\'s split');
	}
	finally {
		for (const code of codes) {
			await core.db.query('DELETE FROM activities WHERE code = $1', [code]).catch(() => undefined);
		}
	}
	console.log(`\n${n} checks passed`);
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
