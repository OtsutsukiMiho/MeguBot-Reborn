// Amounts typed per person, from `/event` and `/sub`.
//
// Two ways in. "คนละ 65" in the amount box is an even bill whose total Megu
// works out. "Different amounts" (or an empty amount on /sub) creates the bill
// first and then asks for each person's amount, because a modal cannot open
// another modal. Real core, real disposable database; only Discord is a
// stand-in.
require('dotenv').config();
const assert = require('node:assert/strict');
const core = require('../core/index.js');
const card = require('../core/event-card.js');
const { ChannelType } = require('discord.js');
const event = require('../commands/utility/event.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

const snowflake = () => `1${Date.now()}${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;

// The channel /event is used in, and the private thread each bill's card lives
// in. Edits land in the log of whichever call is running.
const threads = new Map();
let active = null;
const room = {
	id: '223456789012345678',
	type: ChannelType.GuildText,
	threads: {
		async create() {
			const thread = {
				id: snowflake(),
				type: ChannelType.PrivateThread,
				members: { add: async () => undefined },
				send: async (value) => {
					active.posted.push(value);
					return { id: 'card1' };
				},
				messages: { edit: async (id, value) => active.cardEdits.push({ id, ...value }) },
				delete: async () => threads.delete(thread.id),
			};
			threads.set(thread.id, thread);
			return thread;
		},
	},
	messages: { edit: async (id, value) => active.cardEdits.push({ id, ...value }) },
};

function base({ customId, user, kind }) {
	const log = { replies: [], edits: [], followUps: [], posted: [], cardEdits: [], dms: [], modal: null };
	active = log;
	return {
		log,
		customId,
		locale: 'th',
		guildLocale: 'th',
		guildId: '123456789012345678',
		channelId: '223456789012345678',
		user: { id: user.id, username: user.name, globalName: user.name, displayAvatarURL: () => null, send: async value => log.dms.push(value) },
		member: { displayName: user.name },
		isModalSubmit: () => kind === 'modal',
		isButton: () => kind === 'button',
		isStringSelectMenu: () => false,
		async reply(value) { this.replied = true; log.replies.push(value); },
		async deferReply() { this.deferred = true; },
		async deferUpdate() { this.deferred = true; },
		async editReply(value) { log.edits.push(value); },
		async followUp(value) { log.followUps.push(value); },
		async showModal(modal) { log.modal = modal; },
		message: { id: 'panel1', editable: true, edit: async value => log.cardEdits.push(value) },
		channel: room,
		client: { user: { id: 'megu' }, users: { fetch: async () => ({ send: async () => undefined }) }, channels: { cache: threads } },
	};
}

function withFields(call, values, { people = [], split = null } = {}) {
	call.fields = {
		// discord.js throws for a field the modal did not have; so does this.
		getTextInputValue: (id) => {
			if (!(id in values)) throw new Error(`no field ${id}`);
			return values[id];
		},
		getSelectedUsers: () => new Map(people.map(p => [p.id, { id: p.id, username: p.name, globalName: p.name }])),
		getSelectedMembers: () => new Map(people.map(p => [p.id, { displayName: p.name }])),
		getStringSelectValues: () => (split ? [split] : []),
	};
	return call;
}

const createEvent = (user, { people = [], guests = '', amount = '', split = 'with_me' }) => withFields(
	base({ customId: 'evt:create', user, kind: 'modal' }), { title: 'ข้าวเย็น', guests, amount }, { people, split });
const createSub = (user, { people = [], guests = '', amount = '', dueDay = '5' }) => withFields(
	base({ customId: 'evt:subcreate', user, kind: 'modal' }), { title: 'Netflix', guests, amount, dueDay }, { people });

// The organiser's private note always carries the bill's link.
const codeOf = call => call.log.edits[0].content.match(/\/a\/([A-Za-z0-9_-]+)/)[1];
const cardMessage = call => call.log.cardEdits.filter(e => e.id === 'card1').at(-1);

async function main() {
	// ── the amount box, as people type it ────────────────────────────────────
	assert.deepEqual(card.parseAmountInput('419'), { satang: 41900, perPerson: false });
	for (const typed of ['คนละ 65', '65/คน', '65 ต่อคน', '65 บาท/คน', '65 บาท ต่อคน', 'คนละ 65 บาท', '65 each']) {
		assert.deepEqual(card.parseAmountInput(typed), { satang: 6500, perPerson: true }, typed);
	}
	assert.equal(card.parseAmountInput('เยอะ'), null);
	assert.equal(card.parseAmountInput('0'), null);
	assert.equal(card.parseShareAmount('0'), 0, 'a person can be on the bill and owe nothing');
	assert.deepEqual(card.parsePerPersonLines('มาลี: 65\nบอส : 0\nเจ:120.50 บาท', 3), [6500, 0, 12050]);
	assert.equal(card.parsePerPersonLines('มาลี: 65\nบอส:', 2), null, 'a line with no amount is refused, not read as 0');
	assert.equal(card.parsePerPersonLines('มาลี: 65', 2), null, 'a missing line is refused');
	ok('the amount box reads a total, a per-person amount and the per-line form');

	await core.initCoreSchema();
	const fig = { id: snowflake(), name: 'ฟิก' };
	const om = { id: snowflake(), name: 'โอม' };
	const po = { id: snowflake(), name: 'ปอ' };
	const codes = [];

	try {
		// ── /event, "คนละ 65" ───────────────────────────────────────────────────
		let call = createEvent(fig, { people: [om, po], amount: 'คนละ 65' });
		await event.handleComponent(call, { core });
		let code = codeOf(call);
		codes.push(code);
		let activity = await core.activities.getActivityByCode(code);
		assert.equal(activity.expenses[0].amountSatang, 19500);
		assert.deepEqual(activity.shares.map(s => s.amountSatang), [6500, 6500, 6500]);
		assert.match(call.log.edits[0].content, /คนละ ฿65\.00 จาก 3 คน รวมเป็น ฿195\.00/);
		assert.match(call.log.posted[0].content, /฿195\.00 หารเท่า 3 คน/);
		ok('/event "คนละ 65" for three people makes a ฿195 bill split evenly');

		// Not counting the organiser: two people at 65.
		call = createEvent(fig, { people: [om, po], amount: '65/คน', split: 'without_me' });
		await event.handleComponent(call, { core });
		code = codeOf(call);
		codes.push(code);
		activity = await core.activities.getActivityByCode(code);
		assert.equal(activity.expenses[0].amountSatang, 13000);
		ok('per person with "not me" multiplies by the people who share it');

		// ── /event, different amounts ─────────────────────────────────────────
		call = createEvent(fig, { people: [om, po], amount: '300', split: 'custom' });
		await event.handleComponent(call, { core });
		code = codeOf(call);
		codes.push(code);
		activity = await core.activities.getActivityByCode(code);
		assert.equal(activity.expenses.length, 0, 'nothing is billed until the amounts are in');
		const followUp = call.log.edits[0];
		assert.match(followUp.content, /ยอดที่พิมพ์ไว้ยังไม่ได้ใช้/);
		assert.match(followUp.content, /กด \*\*ใส่ยอดรายคน\*\*/);
		const amountsId = followUp.components[0].components[0].data.custom_id;
		assert.match(amountsId, new RegExp(`^evt:amts:${code}:`));

		// Somebody else pressing it is told no, before any modal.
		let press = base({ customId: amountsId, user: om, kind: 'button' });
		await event.handleComponent(press, { core });
		assert.match(press.log.replies[0].content, /เฉพาะเจ้าของบิลเท่านั้นที่ใส่ยอดรายคนได้/);
		assert.equal(press.log.modal, null);

		press = base({ customId: amountsId, user: fig, kind: 'button' });
		await event.handleComponent(press, { core });
		const modal = press.log.modal.toJSON();
		assert.equal(modal.custom_id, `evt:amtssave:${code}:card1`);
		assert.deepEqual(modal.components.map(c => c.label), ['ฟิก', 'โอม', 'ปอ'], 'one box per person, named');

		let save = withFields(base({ customId: modal.custom_id, user: fig, kind: 'modal' }), { p0: '', p1: '120', p2: 'เยอะ' });
		await event.handleComponent(save, { core });
		assert.match(save.log.edits[0], /อ่านยอดบางคนไม่ออก/);
		save = withFields(base({ customId: modal.custom_id, user: fig, kind: 'modal' }), { p0: '0', p1: '0', p2: '0' });
		await event.handleComponent(save, { core });
		assert.match(save.log.edits[0], /ยอดรวมเป็น 0/);
		activity = await core.activities.getActivityByCode(code);
		assert.equal(activity.expenses.length, 0, 'a refused submit writes nothing');

		save = withFields(base({ customId: modal.custom_id, user: fig, kind: 'modal' }), { p0: '0', p1: '120', p2: '75.50' });
		await event.handleComponent(save, { core });
		activity = await core.activities.getActivityByCode(code);
		assert.equal(activity.expenses[0].amountSatang, 19550);
		assert.equal(activity.expenses[0].splitMode, 'exact');
		const byName = Object.fromEntries(activity.participants.map(p => [p.displayName, activity.shares.find(s => s.participantId === p.id)?.amountSatang]));
		assert.deepEqual(byName, { ฟิก: 0, โอม: 12000, ปอ: 7550 });
		assert.match(save.log.edits[0].content, /^บันทึกแล้ว รวม ฿195\.50\nฟิก ฿0\.00\nโอม ฿120\.00\nปอ ฿75\.50$/);
		assert.match(cardMessage(save).content, /฿195\.50 แยกยอดรายคน 2 คน/, 'the card no longer says evenly');
		ok('/event with different amounts: created first, then each person typed in, total added up');

		// Someone joining a bill like this gets on it, not a silent even re-split.
		const late = { id: snowflake(), name: 'เจ' };
		press = base({ customId: `evt:join:${code}`, user: late, kind: 'button' });
		await event.handleComponent(press, { core });
		assert.match(press.log.edits[0], /เจ้าของบิลจะใส่ยอดของคุณให้/);
		activity = await core.activities.getActivityByCode(code);
		assert.equal(activity.expenses[0].amountSatang, 19550, 'the amounts already agreed are untouched');
		press = base({ customId: amountsId, user: fig, kind: 'button' });
		await event.handleComponent(press, { core });
		const again = press.log.modal.toJSON();
		assert.deepEqual(again.components.map(c => c.label), ['ฟิก', 'โอม', 'ปอ', 'เจ'], 'the newcomer gets a box');
		assert.deepEqual(again.components.map(c => c.component.value), ['0', '120', '75.5', undefined], 'amounts so far are filled in');
		ok('a newcomer on a per-person bill is added without re-splitting, and appears in the next edit');

		// ── more people than a modal has boxes ────────────────────────────────
		call = createEvent(fig, { guests: 'ก\nข\nค\nง\nจ\nฉ', split: 'custom' });
		await event.handleComponent(call, { core });
		code = codeOf(call);
		codes.push(code);
		const bigId = call.log.edits[0].components[0].components[0].data.custom_id;
		press = base({ customId: bigId, user: fig, kind: 'button' });
		await event.handleComponent(press, { core });
		const big = press.log.modal.toJSON();
		assert.equal(big.components.length, 1, 'one paragraph instead of seven boxes');
		assert.equal(big.components[0].component.value, 'ฟิก: \nก: \nข: \nค: \nง: \nจ: \nฉ: ');
		save = withFields(base({ customId: big.custom_id, user: fig, kind: 'modal' }), { lines: 'ฟิก: 0\nก: 10\nข: 20\nค: 30\nง: 40\nจ: 50\nฉ: 60' });
		await event.handleComponent(save, { core });
		activity = await core.activities.getActivityByCode(code);
		assert.equal(activity.expenses[0].amountSatang, 21000);
		ok('seven people are entered one line each and added up');

		// ── /sub, "คนละ 65" ─────────────────────────────────────────────────────
		call = createSub(fig, { people: [om, po], amount: 'คนละ 65' });
		await event.handleComponent(call, { core });
		code = codeOf(call);
		codes.push(code);
		activity = await core.activities.getActivityByCode(code);
		assert.deepEqual(activity.shares.map(s => s.amountSatang), [6500, 6500, 6500]);
		assert.match(call.log.posted[0].content, /฿195\.00\/เดือน หารเท่า 3 คน/);
		ok('/sub "คนละ 65" for three people is ฿195 a month split evenly');

		// ── /sub, different amounts ───────────────────────────────────────────
		call = createSub(fig, { people: [om, po], amount: '' });
		await event.handleComponent(call, { core });
		assert.equal(call.log.replies.length, 0, 'an empty amount is not refused any more');
		code = codeOf(call);
		codes.push(code);
		const subAmountsId = call.log.edits[0].components[0].components[0].data.custom_id;
		press = base({ customId: subAmountsId, user: fig, kind: 'button' });
		await event.handleComponent(press, { core });
		save = withFields(base({ customId: press.log.modal.toJSON().custom_id, user: fig, kind: 'modal' }), { p0: '199', p1: '110', p2: '110' });
		await event.handleComponent(save, { core });
		activity = await core.activities.getActivityByCode(code);
		const month = core.activities.currentPeriod(activity);
		assert.deepEqual(activity.shares.filter(s => s.periodId === month.id).map(s => s.amountSatang).sort(), [11000, 11000, 19900]);
		assert.match(cardMessage(save).content, /฿419\.00\/เดือน แยกยอดรายคน 3 คน/);

		// The panel's price change would re-split evenly, so it says why not.
		const panel = base({ customId: `evt:manage:${code}`, user: fig, kind: 'button' });
		panel.message = { id: 'card1', editable: true, edit: async () => undefined };
		await event.handleComponent(panel, { core });
		const labels = panel.log.replies[0].components[0].components.map(c => c.data.label);
		assert.ok(labels.includes('ใส่ยอดรายคน'), 'the manage panel offers it too');
		const price = withFields(base({ customId: `evt:pricesave:${code}:card1`, user: fig, kind: 'modal' }), { amount: '500' });
		await event.handleComponent(price, { core });
		assert.match(price.log.followUps[0].content, /บิลนี้ใส่ยอดแยกรายคน/);
		activity = await core.activities.getActivityByCode(code);
		assert.equal(activity.expenses.find(e => e.periodId === month.id).amountSatang, 41900, 'nothing was flattened');

		// Next month carries each person's own amount.
		const next = new Date(month.dueAt);
		next.setUTCMonth(next.getUTCMonth() + 1);
		await core.activities.ensurePeriod(activity.id, next, { rollover: true });
		activity = await core.activities.getActivityByCode(code);
		const later = activity.periods.find(p => p.id !== month.id);
		assert.deepEqual(activity.shares.filter(s => s.periodId === later.id).map(s => s.amountSatang).sort(), [11000, 11000, 19900]);
		ok('/sub with an empty amount takes each person\'s amount, keeps it from even changes, and carries it to next month');
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
