// Whose card a subscription is on: picked from the menu under the new bill,
// the money then goes to that person's PromptPay, this month and every month
// after. Real core and a disposable database; Discord is a stand-in.
require('dotenv').config();
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const core = require('../core/index.js');
const event = require('../commands/utility/event.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

const snowflake = () => `1${Date.now()}${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;
const GUILD = '123456789012345678';

// The bill's private thread, kept where the bot's channel cache would keep
// it. Edits to its card land in whichever call is running.
const threads = new Map();
let currentEdits = [];

function fake({ customId, user, kind, fields = null, values = null, sent = [], cardEdits = [] }) {
	const log = { replies: [], edits: [], followUps: [], modal: null };
	currentEdits = cardEdits;
	return {
		log,
		customId,
		locale: 'th', guildLocale: 'th',
		guildId: kind === 'dm' ? null : GUILD,
		channelId: '223456789012345678',
		user: { id: user.id, username: user.name, globalName: user.name, displayAvatarURL: () => null },
		member: { displayName: user.name },
		fields,
		values,
		deferred: false, replied: false,
		isModalSubmit: () => kind === 'modal' || kind === 'dm',
		isButton: () => kind === 'button',
		isStringSelectMenu: () => kind === 'select',
		async reply(value) { this.replied = true; log.replies.push(value); },
		async deferReply() { this.deferred = true; },
		async deferUpdate() { this.deferred = true; },
		// The card reply comes back as a message, the way discord.js returns it.
		async editReply(value) { log.edits.push(value); return { id: 'card1' }; },
		async followUp(value) { log.followUps.push(value); },
		async showModal(modal) { log.modal = modal; },
		message: { content: '', editable: true, edit: async () => undefined },
		channel: {
			type: ChannelType.GuildText,
			// The new bill's private thread; its card comes back as a message.
			threads: {
				async create() {
					const thread = {
						id: snowflake(),
						type: ChannelType.PrivateThread,
						members: { add: async () => undefined },
						send: async () => ({ id: 'card1' }),
						messages: { edit: async (id, value) => currentEdits.push({ id, ...value }) },
					};
					threads.set(thread.id, thread);
					return thread;
				},
			},
			messages: { edit: async (id, value) => cardEdits.push({ id, ...value }) },
		},
		client: { users: { fetch: async id => ({ send: async value => sent.push({ id, ...value }) }) }, channels: { cache: threads } },
	};
}

function subSubmit(user, people) {
	return fake({
		customId: 'evt:subcreate', user, kind: 'modal',
		fields: {
			getTextInputValue: id => ({ title: 'Youtube', guests: '', amount: '399', dueDay: '15' }[id] ?? ''),
			getSelectedUsers: () => new Map(people.map(p => [p.id, { id: p.id, username: p.name, globalName: p.name }])),
			getSelectedMembers: () => new Map(people.map(p => [p.id, { displayName: p.name }])),
		},
	});
}

const menuOf = followUp => followUp.components
	.map(row => row.components[0].toJSON())
	.find(item => String(item.custom_id).startsWith('evt:payer:'));

async function main() {
	await core.initCoreSchema();
	const fig = { id: snowflake(), name: 'ฟิก' };
	const om = { id: snowflake(), name: 'โอม' };
	const mew = { id: snowflake(), name: 'มิว' };
	let code;

	try {
		const create = subSubmit(fig, [om, mew]);
		await event.handleComponent(create, { core });
		const menu = menuOf(create.log.edits[0]);
		code = menu.custom_id.split(':')[2];
		let activity = await core.activities.getActivityByCode(code);
		const row = name => activity.participants.find(p => p.displayName === name);

		assert.equal(menu.custom_id, `evt:payer:${code}:card1`);
		assert.deepEqual(menu.options.map(o => o.label), ['ฟิก (คุณ)', 'โอม', 'มิว']);
		assert.equal(menu.options.find(o => o.default).label, 'ฟิก (คุณ)', 'the creator pays until told otherwise');
		ok('a new subscription asks whose card it is on, defaulting to its creator');

		// Somebody else cannot move the money.
		let sent = [];
		let cardEdits = [];
		let call = fake({ customId: menu.custom_id, user: mew, kind: 'select', values: [row('โอม').id], sent, cardEdits });
		await event.handleComponent(call, { core });
		assert.match(call.log.followUps[0].content, /เฉพาะเจ้าของบิล/);
		activity = await core.activities.getActivityByCode(code);
		assert.equal(activity.payee.participantId, row('ฟิก').id);
		ok('only the owner of the bill can change who pays');

		// Om's card pays. The bill, the card and the note follow; Om is asked for PromptPay.
		call = fake({ customId: menu.custom_id, user: fig, kind: 'select', values: [row('โอม').id], sent, cardEdits });
		await event.handleComponent(call, { core });
		activity = await core.activities.getActivityByCode(code);
		const period = core.activities.currentPeriod(activity);
		assert.equal(activity.payee.participantId, row('โอม').id);
		assert.ok(activity.expenses.filter(e => e.periodId === period.id).every(e => e.paidBy === row('โอม').id));
		const standing = core.activities.settlement(activity, period.id).rows;
		assert.equal(standing.find(r => r.participantId === row('ฟิก').id).outstanding, 13300, 'the creator now owes Om too');
		assert.equal(cardEdits[0].id, 'card1');
		assert.ok(cardEdits[0].content.includes(`โอนให้ <@${om.id}>`), 'the card now says to pay Om');
		assert.match(call.log.edits[0].content, /ทุกคนโอนคืนเข้าพร้อมเพย์ของ \*\*โอม\*\* ซึ่งยังไม่ได้ตั้ง/);
		assert.match(call.log.edits[0].content, /ส่ง DM ไปขอให้แล้ว/);
		assert.equal(menuOf(call.log.edits[0]).options.find(o => o.default).label, 'โอม');
		assert.equal(sent.length, 1);
		assert.equal(sent[0].id, om.id);
		assert.equal(sent[0].components[0].components[0].data.custom_id, 'evt:pp');
		ok('picking Om moves this month to his card, redraws the card and asks him for PromptPay once');

		// Om sets PromptPay from the DM; the bill now points at his number.
		call = fake({ customId: 'evt:ppsave', user: om, kind: 'dm', fields: { getTextInputValue: id => ({ id: '0898765432', name: 'OM' }[id]) } });
		await event.handleComponent(call, { core });
		activity = await core.activities.getActivityByCode(code);
		assert.equal(activity.payee.promptpayId, '0898765432');
		const [candidate] = await core.activities.listPaymentCandidatesForDiscord(fig.id, null, code);
		assert.equal(candidate.payee.promptpayId, '0898765432');
		assert.equal(candidate.payeeDiscordUid, om.id, 'slip DMs go to the person the money went to');
		ok('the payer sets PromptPay from that DM, and slips are now checked against his account');

		// Next month copies the bill, so Om still pays.
		const next = new Date(`${period.key}-20T12:00:00+07:00`);
		next.setUTCMonth(next.getUTCMonth() + 1);
		const { period: following } = await core.activities.ensurePeriod(activity.id, next, { rollover: true });
		activity = await core.activities.getActivityByCode(code);
		assert.ok(activity.expenses.filter(e => e.periodId === following.id).every(e => e.paidBy === row('โอม').id));
		ok('the next month carries the same payer without being told');

		// Om, receiving the money, can answer a slip himself.
		const payment = await core.activities.recordPayment(activity.id, row('มิว').id, { amountSatang: 13300, method: 'bank_transfer', periodId: period.id });
		call = fake({ customId: `evt:pok:${code}:${payment.id}`, user: om, kind: 'button', sent });
		await event.handleComponent(call, { core });
		activity = await core.activities.getActivityByCode(code);
		assert.equal(activity.payments.find(p => p.id === payment.id).status, 'confirmed');
		ok('the person receiving the money can confirm a slip, not only the owner');

		// Money has arrived for this month, so the payer is fixed now.
		call = fake({ customId: menu.custom_id, user: fig, kind: 'select', values: [row('ฟิก').id], sent, cardEdits });
		await event.handleComponent(call, { core });
		assert.match(call.log.followUps[0].content, /เดือนนี้มีคนโอนเข้ามาแล้ว/);
		activity = await core.activities.getActivityByCode(code);
		assert.equal(activity.payee.participantId, row('โอม').id);
		ok('once money has been sent for the month, the payer cannot be changed under it');

		for (const text of [call.log.followUps[0].content, sent[0].content]) assert.doesNotMatch(text, /[·→←—]/);
		ok('the new messages use no middle dot, arrow or em dash');
	}
	finally {
		if (code) await core.db.query('DELETE FROM activities WHERE code = $1', [code]).catch(() => undefined);
	}
	console.log(`\n${n} checks passed`);
	await core.db.close?.();
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
