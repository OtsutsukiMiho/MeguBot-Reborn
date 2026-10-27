// The organiser confirms or rejects a slip from the DM that reported it.
//
// Real core and a disposable database; Discord is a stand-in that records what
// the command answered, the DM it edited and the DMs it sent.
require('dotenv').config();
const assert = require('node:assert/strict');
const core = require('../core/index.js');
const event = require('../commands/utility/event.js');
const { ownerDecisionButtons } = require('../adapters/discord/slip-submit.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

const snowflake = () => `1${Date.now()}${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;
const GUILD = '123456789012345678';
const ownerDm = 'โอม แจ้งจ่าย ฿150.00 ให้ Netflix';

function press({ customId, user, kind, reason = null, sent }) {
	const log = { replies: [], edits: [], followUps: [], modal: null };
	return {
		log,
		customId,
		locale: 'th',
		guildId: null,
		user: { id: user.id, username: user.name, globalName: user.name, displayAvatarURL: () => null },
		deferred: false,
		replied: false,
		isModalSubmit: () => kind === 'modal',
		isButton: () => kind === 'button',
		isStringSelectMenu: () => false,
		fields: { getTextInputValue: () => reason },
		async reply(value) { this.replied = true; log.replies.push(value); },
		async deferUpdate() { this.deferred = true; },
		async editReply(value) { log.edits.push(value); },
		async followUp(value) { log.followUps.push(value); },
		async showModal(modal) { log.modal = modal; },
		message: { content: ownerDm },
		client: { users: { fetch: async id => ({ send: async value => sent.push({ id, ...value }) }) } },
	};
}

function createSubmit({ user, title, people, amount }) {
	const users = new Map(people.map(p => [p.id, { id: p.id, username: p.name, globalName: p.name, bot: false }]));
	const members = new Map(people.map(p => [p.id, { displayName: p.name }]));
	const log = { replies: [], edits: [], followUps: [] };
	return {
		log,
		customId: 'evt:create',
		locale: 'th', guildLocale: 'th', guildId: GUILD, channelId: '223456789012345678',
		user: { id: user.id, username: user.name, globalName: user.name, displayAvatarURL: () => null },
		member: { displayName: user.name },
		isModalSubmit: () => true, isButton: () => false, isStringSelectMenu: () => false,
		fields: {
			getTextInputValue: id => ({ title, guests: '', amount }[id] ?? ''),
			getSelectedUsers: () => users,
			getSelectedMembers: () => members,
			getStringSelectValues: () => ['with_me'],
		},
		async reply(value) { log.replies.push(value); },
		async deferReply() { this.deferred = true; },
		async editReply(value) { log.edits.push(value); },
		async followUp(value) { log.followUps.push(value); },
	};
}

const idsOf = components => components[0].components.map(c => c.data.custom_id);

async function main() {
	await core.initCoreSchema();
	const fig = { id: snowflake(), name: 'ฟิก' };
	const om = { id: snowflake(), name: 'โอม' };
	const stranger = { id: snowflake(), name: 'แปลกหน้า' };
	let code;

	try {
		const create = createSubmit({ user: fig, title: 'Netflix', people: [om], amount: '300' });
		await event.handleComponent(create, { core });
		// No channel to open a thread in, so the code comes from the link in
		// the organiser's note.
		code = create.log.edits[0].content.match(/\/a\/([A-Z0-9]+)/)[1];
		let activity = await core.activities.getActivityByCode(code);
		const omRow = activity.participants.find(p => p.displayName === 'โอม');
		const pending = () => core.activities.recordPayment(activity.id, omRow.id, { amountSatang: 15000, method: 'bank_transfer' });
		const statusOf = async id => (await core.activities.getActivityByCode(code)).payments.find(p => p.id === id).status;

		// What the DM carries.
		assert.deepEqual(idsOf(ownerDecisionButtons(code, 'pay_x')), [`evt:pok:${code}:pay_x`, `evt:pno:${code}:pay_x`]);
		assert.deepEqual(idsOf(ownerDecisionButtons(code, 'pay_x', { autoConfirmed: true })), [`evt:pundo:${code}:pay_x`]);
		ok('a held slip offers confirm and reject; an automatic match offers only undo');

		// Somebody else pressing the owner's button changes nothing.
		let payment = await pending();
		let sent = [];
		let call = press({ customId: `evt:pok:${code}:${payment.id}`, user: stranger, kind: 'button', sent });
		await event.handleComponent(call, { core });
		assert.match(call.log.replies[0].content, /เฉพาะเจ้าของบิล/);
		assert.equal(await statusOf(payment.id), 'pending');
		ok('only the owner of the bill can decide');

		// Confirm: written, the DM keeps only a way back, the payer is told.
		call = press({ customId: `evt:pok:${code}:${payment.id}`, user: fig, kind: 'button', sent });
		await event.handleComponent(call, { core });
		assert.equal(await statusOf(payment.id), 'confirmed');
		assert.deepEqual(idsOf(call.log.edits[0].components), [`evt:pundo:${code}:${payment.id}`]);
		assert.match(call.log.edits[0].content, /^โอม แจ้งจ่าย[\s\S]*คุณยืนยันแล้วว่าได้รับเงิน$/);
		assert.equal(sent.length, 1);
		assert.equal(sent[0].id, om.id);
		assert.match(sent[0].content, /ยืนยันแล้วว่าได้รับเงิน ฿150\.00/);
		ok('confirm records the payment, leaves an undo button for a wrong tap, and tells the payer');

		// A second press of a decided payment is refused, not repeated.
		call = press({ customId: `evt:pok:${code}:${payment.id}`, user: fig, kind: 'button', sent });
		await event.handleComponent(call, { core });
		assert.match(call.log.replies[0].content, /ถูกจัดการไปแล้ว/);
		assert.equal(sent.length, 1);
		ok('a payment already decided is not decided again');

		// Undo the confirmation, with a reason, from the automatic-match button.
		call = press({ customId: `evt:pundo:${code}:${payment.id}`, user: fig, kind: 'button', sent });
		await event.handleComponent(call, { core });
		assert.equal(call.log.modal.data.custom_id, `evt:pundosave:${code}:${payment.id}`);
		call = press({ customId: `evt:pundosave:${code}:${payment.id}`, user: fig, kind: 'modal', reason: 'ยอดไม่เข้าบัญชี', sent });
		await event.handleComponent(call, { core });
		assert.equal(await statusOf(payment.id), 'reversed');
		assert.deepEqual(call.log.edits[0].components, []);
		assert.match(sent[1].content, /ย้อนผล[\s\S]*ยอดไม่เข้าบัญชี/);
		ok('undo asks for a reason, reverses the confirmation and tells the payer why');

		// Reject: the modal opens first, nothing is written until the reason arrives.
		payment = await pending();
		call = press({ customId: `evt:pno:${code}:${payment.id}`, user: fig, kind: 'button', sent });
		await event.handleComponent(call, { core });
		assert.equal(call.log.modal.data.custom_id, `evt:pnosave:${code}:${payment.id}`);
		assert.equal(await statusOf(payment.id), 'pending');
		call = press({ customId: `evt:pnosave:${code}:${payment.id}`, user: fig, kind: 'modal', reason: 'รูปที่แนบไม่ใช่สลิป', sent });
		await event.handleComponent(call, { core });
		assert.equal(await statusOf(payment.id), 'rejected');
		assert.match(call.log.edits[0].content, /คุณปฏิเสธรายการนี้แล้ว เหตุผล: รูปที่แนบไม่ใช่สลิป$/);
		assert.match(sent[2].content, /ยังไม่ได้รับเงิน ฿150\.00[\s\S]*รูปที่แนบไม่ใช่สลิป/);
		activity = await core.activities.getActivityByCode(code);
		const standing = core.activities.settlement(activity).rows.find(row => row.participantId === omRow.id);
		assert.equal(standing.outstanding, 15000);
		ok('reject asks for a reason first, then leaves the share owed and tells the payer why');

		// Written text follows the house style: no middle dots, arrows or em dashes.
		for (const message of [...sent.map(s => s.content), call.log.edits[0].content]) {
			assert.doesNotMatch(message, /[·→←—]/);
		}
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
