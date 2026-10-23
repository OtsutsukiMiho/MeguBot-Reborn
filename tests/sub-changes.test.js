// A subscription that changes while it runs: the price moves, people leave and
// join. Before anyone has paid for the month the month is rewritten; after,
// the month stays as paid and the change waits for the next one.
// Real core and a disposable database; Discord is a stand-in.
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

function fake({ customId, user, kind, fields = null, values = null, users = null, cardEdits = [] }) {
	const log = { replies: [], edits: [], followUps: [], modal: null };
	return {
		log,
		customId,
		locale: 'th', guildLocale: 'th', guildId: GUILD,
		channelId: '223456789012345678',
		user: { id: user.id, username: user.name, globalName: user.name, displayAvatarURL: () => null },
		member: { displayName: user.name },
		fields, values,
		users: users ? new Map(users.map(u => [u.id, { id: u.id, username: u.name, globalName: u.name, bot: false }])) : null,
		members: users ? new Map(users.map(u => [u.id, { displayName: u.name }])) : null,
		deferred: false, replied: false,
		isModalSubmit: () => kind === 'modal',
		isButton: () => kind === 'button',
		isStringSelectMenu: () => kind === 'select',
		isUserSelectMenu: () => kind === 'users',
		async reply(value) { this.replied = true; log.replies.push(value); },
		async deferReply() { this.deferred = true; },
		async deferUpdate() { this.deferred = true; },
		async editReply(value) { log.edits.push(value); return { id: 'card1' }; },
		async followUp(value) { log.followUps.push(value); },
		async showModal(modal) { log.modal = modal; },
		message: { id: 'card1', content: '', editable: true, edit: async () => undefined },
		channel: { messages: { edit: async (id, value) => cardEdits.push({ id, ...value }) } },
		client: { users: { fetch: async () => ({ send: async () => undefined }) } },
	};
}

function subSubmit(user, people) {
	return fake({
		customId: 'evt:subcreate', user, kind: 'modal',
		fields: {
			getTextInputValue: id => ({ title: 'Netflix', guests: '', amount: '300', dueDay: '15' }[id] ?? ''),
			getSelectedUsers: () => new Map(people.map(p => [p.id, { id: p.id, username: p.name, globalName: p.name }])),
			getSelectedMembers: () => new Map(people.map(p => [p.id, { displayName: p.name }])),
		},
	});
}

const idsOf = row => row.components.map(c => c.toJSON().custom_id || 'link');
const lastText = call => {
	const value = call.log.edits.at(-1) ?? call.log.replies.at(-1) ?? call.log.followUps.at(-1);
	return typeof value === 'string' ? value : value.content;
};

async function main() {
	await core.initCoreSchema();
	const fig = { id: snowflake(), name: 'ฟิก' };
	const om = { id: snowflake(), name: 'โอม' };
	const mew = { id: snowflake(), name: 'มิว' };
	const ton = { id: snowflake(), name: 'ต้น' };
	let code;

	try {
		const create = subSubmit(fig, [om, mew]);
		await event.handleComponent(create, { core });
		code = create.log.edits[0].components[0].components[0].data.custom_id.split(':')[2];
		assert.deepEqual(idsOf(create.log.edits[0].components[0]), [`evt:pay:${code}`, `evt:join:${code}`, `evt:leave:${code}`, `evt:manage:${code}`, 'link']);
		ok('a monthly card carries leave and manage next to pay and join');

		let activity = await core.activities.getActivityByCode(code);
		const row = name => activity.participants.find(p => p.displayName === name);
		const month = async () => {
			activity = await core.activities.getActivityByCode(code);
			const period = core.activities.currentPeriod(activity);
			const shares = activity.shares.filter(s => s.periodId === period.id);
			return { period, total: shares.reduce((sum, s) => sum + s.amountSatang, 0), shares: Object.fromEntries(shares.map(s => [activity.participants.find(p => p.id === s.participantId).displayName, s.amountSatang])) };
		};

		// Only the owner opens the panel.
		let call = fake({ customId: `evt:manage:${code}`, user: om, kind: 'button' });
		await event.handleComponent(call, { core });
		assert.match(call.log.replies[0].content, /เฉพาะเจ้าของบิล/);
		call = fake({ customId: `evt:manage:${code}`, user: fig, kind: 'button' });
		await event.handleComponent(call, { core });
		assert.match(call.log.replies[0].content, /เดือนนี้ ฿300\.00 หาร 3 คน/);
		ok('the manage panel is the owner\'s, and says what this month is');

		// Nobody has paid: a new price rewrites this month.
		let cardEdits = [];
		call = fake({ customId: `evt:pricesave:${code}:card1`, user: fig, kind: 'modal', fields: { getTextInputValue: () => '450' }, cardEdits });
		await event.handleComponent(call, { core });
		let now = await month();
		assert.equal(now.total, 45000);
		assert.deepEqual(Object.values(now.shares), [15000, 15000, 15000]);
		assert.equal(activity.recurringChange, null);
		assert.match(lastText(call), /เดือนนี้ ฿450\.00 หาร 3 คน/);
		assert.equal(cardEdits[0].id, 'card1');
		ok('before anyone pays, a new price changes this month straight away');

		// Mew leaves, after confirming; the others take his share this month.
		call = fake({ customId: `evt:leave:${code}`, user: mew, kind: 'button' });
		await event.handleComponent(call, { core });
		assert.equal(call.log.replies[0].components[0].components[0].data.custom_id, `evt:leaveok:${code}:card1`);
		cardEdits = [];
		call = fake({ customId: `evt:leaveok:${code}:card1`, user: mew, kind: 'button', cardEdits });
		await event.handleComponent(call, { core });
		now = await month();
		assert.deepEqual(now.shares, { 'ฟิก': 22500, 'โอม': 22500 });
		assert.match(lastText(call), /ส่วนของคุณถูกหารให้คนที่เหลือ/);
		assert.ok(!cardEdits[0].content.includes(`<@${mew.id}>`), 'someone who left is not on the card');
		ok('a friend leaves from the card after confirming, and the month is re-divided');

		// The payer cannot leave.
		call = fake({ customId: `evt:leave:${code}`, user: fig, kind: 'button' });
		await event.handleComponent(call, { core });
		assert.match(call.log.replies[0].content, /คนจ่ายค่าบริการออกจากบิลไม่ได้/);
		ok('whoever is being paid back cannot leave');

		// Money arrives for this month. From now on, changes wait for next month.
		await core.activities.recordPayment(activity.id, row('โอม').id, { amountSatang: 22500, method: 'bank_transfer', periodId: now.period.id });
		const next = core.activities.nextPeriodKey(now.period.key);

		call = fake({ customId: `evt:addp:${code}:card1`, user: fig, kind: 'users', users: [ton] });
		await event.handleComponent(call, { core });
		call = fake({ customId: `evt:rmp:${code}:card1`, user: fig, kind: 'select', values: [row('โอม').id] });
		await event.handleComponent(call, { core });
		cardEdits = [];
		call = fake({ customId: `evt:pricesave:${code}:card1`, user: fig, kind: 'modal', fields: { getTextInputValue: () => '500' }, cardEdits });
		await event.handleComponent(call, { core });
		now = await month();
		assert.deepEqual(now.shares, { 'ฟิก': 22500, 'โอม': 22500 }, 'this month stays as it was paid');
		assert.equal(activity.recurringChange.from, next);
		assert.equal(activity.recurringChange.amountSatang, 50000);
		assert.match(lastText(call), /เดือนนี้มีคนโอนเข้ามาแล้ว เลยเริ่มใช้ตั้งแต่[\s\S]*฿500\.00 หาร 2 คน/);
		const cardText = cardEdits[0].content;
		assert.match(cardText, new RegExp(`<@${om.id}> ฿225\\.00 .*\\(เดือนสุดท้าย\\)`));
		assert.match(cardText, new RegExp(`<@${ton.id}> \\(เริ่ม`));
		assert.match(cardText, /ตั้งแต่.*: ฿500\.00\/เดือน หาร 2 คน/);
		ok('once money has arrived, price, joins and removals wait for next month, and the card says so');

		// Om changes his mind: "Count me in" cancels his leaving.
		call = fake({ customId: `evt:join:${code}`, user: om, kind: 'button' });
		await event.handleComponent(call, { core });
		activity = await core.activities.getActivityByCode(code);
		assert.ok(!activity.recurringChange.leave.includes(row('โอม').id));
		assert.match(lastText(call), /เริ่มหารตั้งแต่/);
		ok('pressing Count me in while leaving cancels the leave');

		// Next month opens with the change: ฿500 between Fig, Om and Ton.
		const { period: following } = await core.activities.ensurePeriod(activity.id, new Date(`${next}-20T12:00:00+07:00`), { rollover: true });
		activity = await core.activities.getActivityByCode(code);
		const nextShares = activity.shares.filter(s => s.periodId === following.id);
		assert.equal(nextShares.reduce((sum, s) => sum + s.amountSatang, 0), 50000);
		assert.deepEqual(nextShares.map(s => activity.participants.find(p => p.id === s.participantId).displayName).sort(), ['ฟิก', 'ต้น', 'โอม'].sort());
		assert.equal(activity.recurringChange, null);
		assert.ok(activity.expenses.filter(e => e.periodId === following.id).every(e => e.paidBy === row('ฟิก').id));
		ok('next month opens with the waiting change applied, and nothing left waiting');

		for (const text of [lastText(call), cardText]) {
			for (const line of text.split('\n').filter(l => /เดือนสุดท้าย|เริ่ม|ตั้งแต่/.test(l))) {
				assert.doesNotMatch(line.replace(/ · /g, ''), /[→←—]/);
			}
		}
		ok('the new lines use no arrow or em dash');
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
