// `/event` against the real core and a disposable database. Only Discord is a
// stand-in: the modal submit, the buttons and the select menu are plain
// objects that record what the command answered.
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

function base({ customId, user, kind }) {
	const log = { replies: [], edits: [], followUps: [], cardEdits: [], modal: null };
	return {
		log,
		customId,
		locale: 'th',
		guildLocale: 'th',
		guildId: GUILD,
		channelId: '223456789012345678',
		user: { id: user.id, username: user.name, globalName: user.name, displayAvatarURL: () => null },
		member: { displayName: user.name },
		deferred: false,
		replied: false,
		isModalSubmit: () => kind === 'modal',
		isButton: () => kind === 'button',
		isStringSelectMenu: () => kind === 'select',
		async reply(value) { this.replied = true; log.replies.push(value); },
		async deferReply() { this.deferred = true; },
		async deferUpdate() { this.deferred = true; },
		async editReply(value) { log.edits.push(value); },
		async followUp(value) { log.followUps.push(value); },
		async showModal(modal) { log.modal = modal; },
		message: { id: 'card1', editable: true, edit: async value => log.cardEdits.push(value) },
		channel: { messages: { edit: async (id, value) => log.cardEdits.push({ id, ...value }) } },
		client: { users: { fetch: async () => ({ send: async () => undefined }) } },
	};
}

function createSubmit({ user, title, people = [], guests = '', amount = '', split = 'with_me' }) {
	const call = base({ customId: 'evt:create', user, kind: 'modal' });
	const users = new Map(people.map(p => [p.id, { id: p.id, username: p.name, globalName: p.name, bot: Boolean(p.bot) }]));
	const members = new Map(people.map(p => [p.id, { displayName: p.name }]));
	call.fields = {
		getTextInputValue: id => ({ title, guests, amount }[id] ?? ''),
		getSelectedUsers: () => users,
		getSelectedMembers: () => members,
		getStringSelectValues: () => [split],
	};
	return call;
}

async function main() {
	await core.initCoreSchema();
	const fig = { id: snowflake(), name: 'ฟิก' };
	const om = { id: snowflake(), name: 'โอม' };
	const ton = { id: snowflake(), name: 'ต้น' };
	const mew = { id: snowflake(), name: 'มิว' };
	const codes = [];

	try {
		// Nobody but me: refused before anything is written.
		let call = createSubmit({ user: fig, title: 'ว่าง' });
		await event.handleComponent(call, { core });
		assert.match(call.log.replies[0].content, /ยังไม่มีใครในบิล/);
		ok('a bill with nobody else on it is refused, not created');

		// The real thing: two people from Discord, one typed name, ฿600 even.
		call = createSubmit({
			user: fig, title: 'ตีแบดเสาร์',
			people: [om, { id: snowflake(), name: 'SomeBot', bot: true }, fig],
			guests: 'ต้น', amount: '600',
		});
		await event.handleComponent(call, { core });
		const card = call.log.edits[0];
		const code = card.content && card.components[0].components[0].data.custom_id.split(':')[2];
		codes.push(code);
		let activity = await core.activities.getActivityByCode(code);
		assert.deepEqual(activity.participants.map(p => p.displayName), ['ฟิก', 'โอม', 'ต้น']);
		assert.equal(activity.guildId, GUILD);
		const organizer = await core.users.findByIdentity('discord', fig.id);
		assert.ok(organizer, 'the organiser got an account from the interaction itself');
		assert.equal(activity.ownerUserId, organizer.id);
		assert.deepEqual(activity.shares.map(s => s.amountSatang).sort(), [20000, 20000, 20000]);
		assert.match(card.content, /฿600\.00 หารเท่า 3 คน/);
		assert.deepEqual(card.allowedMentions, { parse: [], users: [om.id] }, 'only the people who owe are pinged');
		assert.match(call.log.followUps[0].content, /เตือนผ่าน DM ได้ 1 จาก 2 คน/);
		assert.match(call.log.followUps[0].content, /\*\*ต้น\*\* ไม่ได้ใช้ Discord/);
		assert.equal(call.log.followUps[0].flags, 64, 'the organiser note is private');
		assert.equal(call.log.followUps[0].components[0].components[0].data.custom_id, 'evt:pp', 'no PromptPay yet: offered in place');
		ok('one modal: roster from Discord and typed names, ฿600 split three ways, one card');

		// PromptPay set from the button, without the web.
		call = base({ customId: 'evt:ppsave', user: fig, kind: 'modal' });
		call.fields = { getTextInputValue: id => ({ id: '0812345678', name: 'FIG' }[id]) };
		await event.handleComponent(call, { core });
		assert.match(call.log.edits[0], /บันทึกพร้อมเพย์แล้ว/);
		activity = await core.activities.getActivityByCode(code);
		assert.equal(activity.payee.promptpayId, '0812345678');
		call = base({ customId: 'evt:ppsave', user: fig, kind: 'modal' });
		call.fields = { getTextInputValue: id => ({ id: '12', name: '' }[id]) };
		await event.handleComponent(call, { core });
		assert.match(call.log.edits[0], /ไม่ใช่พร้อมเพย์/);
		ok('the organiser sets PromptPay from the button, and a wrong number is refused');

		// Ton presses "I'm in": there is a typed "ต้น" — ask, do not duplicate.
		call = base({ customId: `evt:join:${code}`, user: ton, kind: 'button' });
		await event.handleComponent(call, { core });
		const menu = call.log.replies[0].components[0].components[0].data;
		assert.equal(menu.custom_id, `evt:claim:${code}:card1`);
		const tonRow = activity.participants.find(p => p.displayName === 'ต้น');
		call = base({ customId: menu.custom_id, user: ton, kind: 'select' });
		call.values = [tonRow.id];
		await event.handleComponent(call, { core });
		assert.match(call.log.edits[0].content, /ผูกชื่อ \*\*ต้น\*\*/);
		activity = await core.activities.getActivityByCode(code);
		assert.equal(activity.participants.length, 3, 'no second Ton');
		assert.equal(activity.participants.find(p => p.id === tonRow.id).discordUid, ton.id);
		assert.equal(call.log.cardEdits[0].id, 'card1', 'the card in the channel is refreshed');
		ok('a typed name is claimed from Discord instead of being added twice');

		// Om again: already in.
		call = base({ customId: `evt:join:${code}`, user: om, kind: 'button' });
		await event.handleComponent(call, { core });
		assert.match(call.log.replies[0].content, /อยู่ในบิลนี้แล้ว/);

		// Mew joins late, before anyone paid: the ฿600 is re-divided by four.
		call = base({ customId: `evt:join:${code}`, user: mew, kind: 'button' });
		await event.handleComponent(call, { core });
		assert.equal(call.log.edits[0], 'เพิ่มคุณเข้าบิลแล้ว');
		activity = await core.activities.getActivityByCode(code);
		assert.deepEqual(activity.shares.map(s => s.amountSatang), [15000, 15000, 15000, 15000]);
		assert.match(call.log.cardEdits[0].content, /หารเท่า 4 คน/);
		ok('a late joiner is added and the even split is redone while nobody has paid');

		// Once money has moved, joining no longer rewrites anyone's share.
		const omRow = activity.participants.find(p => p.discordUid === om.id);
		await core.activities.recordPayment(activity.id, omRow.id, { amountSatang: 15000 });
		const late = { id: snowflake(), name: 'ปอ' };
		call = base({ customId: `evt:join:${code}`, user: late, kind: 'button' });
		await event.handleComponent(call, { core });
		assert.match(call.log.edits[0], /ไม่หารใหม่อัตโนมัติ/);
		activity = await core.activities.getActivityByCode(code);
		assert.equal(activity.participants.length, 5);
		assert.deepEqual(activity.shares.map(s => s.amountSatang), [15000, 15000, 15000, 15000]);
		ok('after a payment, a newcomer is listed but nobody\'s share changes silently');

		// Paying: someone outside the bill is told how to get in; Om gets the modal.
		call = base({ customId: `evt:pay:${code}`, user: { id: snowflake(), name: 'x' }, kind: 'button' });
		await event.handleComponent(call, { core });
		assert.match(call.log.replies[0].content, /ยังไม่อยู่ในบิลนี้/);
		call = base({ customId: `evt:pay:${code}`, user: ton, kind: 'button' });
		await event.handleComponent(call, { core });
		assert.ok(call.log.modal, 'the slip modal opens');
		const modal = call.log.modal.toJSON();
		assert.equal(modal.custom_id, `evt:slip:${code}`);
		assert.match(JSON.stringify(modal), /081\S*678|xxx|\*\*\*/i, 'the PromptPay number is shown masked');
		assert.match(JSON.stringify(modal), /150\.00/, 'the amount is filled in');
		ok('the pay button opens a slip upload for people on the bill, and explains itself to others');

		// A guest who tapped a name on the web, then signed in with Discord.
		const guest = await core.activities.addParticipant(activity.id, { displayName: 'นุ่น' });
		await core.activities.claimParticipant(guest.id, { deviceToken: `dev_${Date.now()}` });
		const claimedRow = (await core.activities.getActivity(activity.id)).participants.find(p => p.id === guest.id);
		const nunDiscord = snowflake();
		const nun = (await core.users.loginWithIdentity({ provider: 'discord', providerUid: nunDiscord, username: 'nun', displayName: 'นุ่น' })).user;
		const { claimed } = await core.users.claimParticipants(nun.id, { deviceToken: claimedRow.deviceToken });
		assert.equal(claimed, 1);
		const adopted = (await core.activities.getActivity(activity.id)).participants.find(p => p.id === guest.id);
		assert.equal(adopted.userId, nun.id);
		assert.equal(adopted.discordUid, nunDiscord, 'now reachable by DM');
		ok('signing in after tapping a name on the web makes that row remindable');

		// Language. The bug this answers: in a Thai server, an organiser with an
		// English Discord client got an English card, while the link preview of
		// the same bill was Thai. The card follows the server; the private note
		// follows the person.
		const eng = { id: snowflake(), name: 'Alex' };
		const pim = { id: snowflake(), name: 'พิม' };
		call = createSubmit({ user: eng, title: 'ข้าวเย็น', people: [pim], amount: '400' });
		call.locale = 'en-US';
		await event.handleComponent(call, { core });
		const langCode = call.log.edits[0].components[0].components[0].data.custom_id.split(':')[2];
		codes.push(langCode);
		assert.match(call.log.edits[0].content, /หารเท่า 2 คน/, 'a Thai server gets a Thai card whoever made it');
		assert.equal(call.log.edits[0].components[0].components[0].data.label, 'แนบสลิป');
		assert.match(call.log.followUps[0].content, /^Created \*\*ข้าวเย็น\*\*/, 'the note only the organiser sees is in their language');
		ok('a Thai server gets a Thai card even when an English client created it');

		// Pim's Discord is Thai, but she chose English on her account page.
		const pimAccount = (await core.users.loginWithIdentity({ provider: 'discord', providerUid: pim.id, username: 'pim', displayName: 'พิม' })).user;
		const untouched = await core.users.getLanguagePreference(pimAccount.id);
		assert.equal(untouched.localeSet, false, 'signing in is not choosing a language');
		await core.users.setNotificationPreferences(pimAccount.id, { mode: 'discord', locale: 'en', localeChosen: true });
		assert.equal((await core.users.getLanguagePreference(pimAccount.id)).localeSet, true);
		call = base({ customId: `evt:join:${langCode}`, user: pim, kind: 'button' });
		await event.handleComponent(call, { core });
		assert.equal(call.log.replies[0].content, 'You are already on this bill.', 'her own choice beats her Thai client');
		ok('a person who chose English gets English private replies from a Thai client');

		// Changing only the delivery channel does not make the default a choice.
		const quiet = (await core.users.loginWithIdentity({ provider: 'discord', providerUid: snowflake(), username: 'q', displayName: 'q' })).user;
		await core.users.setNotificationPreferences(quiet.id, { mode: 'off', locale: 'en' });
		assert.equal((await core.users.getLanguagePreference(quiet.id)).localeSet, false);
		ok('saving a delivery channel alone leaves the language unchosen');

		// The server chose English: every redraw is English, even from a Thai press.
		event.useServerLangReader(async guildId => (guildId === GUILD ? 'en' : null));
		try {
			const tor = { id: snowflake(), name: 'ต่อ' };
			call = base({ customId: `evt:join:${langCode}`, user: tor, kind: 'button' });
			await event.handleComponent(call, { core });
			assert.equal(call.log.edits[0], 'เพิ่มคุณเข้าบิลแล้ว', 'the reply to a Thai client stays Thai');
			assert.match(call.log.cardEdits[0].content, /split evenly by 3/, 'the redrawn card follows the server');
			assert.equal(call.log.cardEdits[0].components[0].components[0].data.label, 'Send slip');
		}
		finally {
			event.useServerLangReader(async () => null);
		}
		ok('a server that chose English gets English cards from any client');
	}
	finally {
		for (const code of codes) {
			await core.db.query('DELETE FROM activities WHERE code = $1', [code]).catch(() => undefined);
		}
	}
	console.log(`\n${n} checks passed`);
	await core.db.close?.();
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
