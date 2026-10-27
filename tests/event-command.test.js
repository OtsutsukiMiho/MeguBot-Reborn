// `/event` against the real core and a disposable database. Only Discord is a
// stand-in: the modal submit, the buttons and the select menu are plain
// objects that record what the command answered.
require('dotenv').config();
const assert = require('node:assert/strict');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const core = require('../core/index.js');
const event = require('../commands/utility/event.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

const snowflake = () => `1${Date.now()}${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;
const GUILD = '123456789012345678';
const PARENT = '223456789012345678';

// The text channel /event is used in, and the private threads it opens.
// Edits to a card land in the log of whichever call is running.
const threads = new Map();
let active = null;
let threadsFail = false;
const channelPosts = [];
const textChannel = id => ({
	id,
	type: ChannelType.GuildText,
	threads: {
		async create(options) {
			if (threadsFail) throw new Error('Missing Permissions');
			const thread = {
				id: snowflake(),
				type: ChannelType.PrivateThread,
				parentId: id,
				options,
				added: [],
				sent: [],
				members: { add: async uid => thread.added.push(uid) },
				send: async value => {
					thread.sent.push(value);
					return { id: 'card1' };
				},
				messages: { edit: async (id, value) => active.cardEdits.push({ id, ...value }) },
				delete: async () => threads.delete(thread.id),
			};
			threads.set(thread.id, thread);
			return thread;
		},
	},
	send: async (value) => {
		channelPosts.push(value);
		return { id: 'pub1' };
	},
	messages: { edit: async (id, value) => active.cardEdits.push({ id, ...value }) },
});
const parent = textChannel(PARENT);

// A server where Megu may make channels: the bills channel it opens lands in
// the guild's channel cache, the way discord.js keeps it.
let roomsFail = false;
const roomsMade = [];
const guild = {
	id: GUILD,
	channels: {
		cache: new Map(),
		async create(options) {
			if (roomsFail) throw new Error('Missing Permissions');
			const room = { ...textChannel(snowflake()), options };
			guild.channels.cache.set(room.id, room);
			roomsMade.push(room);
			return room;
		},
	},
};

function base({ customId, user, kind, channel = parent, server = null }) {
	const log = { replies: [], edits: [], followUps: [], cardEdits: [], dms: [], deferred: null, modal: null };
	active = log;
	return {
		log,
		customId,
		locale: 'th',
		guildLocale: 'th',
		guildId: GUILD,
		channelId: channel.id,
		user: { id: user.id, username: user.name, globalName: user.name, displayAvatarURL: () => null, send: async value => log.dms.push(value) },
		member: { displayName: user.name },
		deferred: false,
		replied: false,
		isModalSubmit: () => kind === 'modal',
		isButton: () => kind === 'button',
		isStringSelectMenu: () => kind === 'select',
		async reply(value) { this.replied = true; log.replies.push(value); },
		async deferReply(value) { this.deferred = true; log.deferred = value || {}; },
		async deferUpdate() { this.deferred = true; },
		async editReply(value) { log.edits.push(value); },
		async followUp(value) { log.followUps.push(value); },
		async showModal(modal) { log.modal = modal; },
		message: { id: 'card1', editable: true, edit: async value => log.cardEdits.push(value) },
		channel,
		guild: server,
		client: { user: { id: 'megu' }, users: { fetch: async () => ({ send: async () => undefined }) }, channels: { cache: threads } },
	};
}

function createSubmit({ user, title, people = [], guests = '', amount = '', split = 'with_me', channel, server }) {
	const call = base({ customId: 'evt:create', user, kind: 'modal', channel, server });
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
		const thread = [...threads.values()].at(-1);
		assert.ok(thread, 'a private thread was opened');
		assert.equal(thread.options.type, ChannelType.PrivateThread);
		assert.equal(thread.options.invitable, false);
		assert.deepEqual(thread.added.sort(), [fig.id, om.id].sort(), 'only the people on the bill are added, not the bot');
		const card = thread.sent[0];
		const code = card.content && card.components[0].components[0].data.custom_id.split(':')[2];
		codes.push(code);
		let activity = await core.activities.getActivityByCode(code);
		assert.deepEqual(activity.participants.map(p => p.displayName), ['ฟิก', 'โอม', 'ต้น']);
		assert.equal(activity.guildId, GUILD);
		assert.equal(activity.channelId, thread.id, 'the thread is the bill\'s channel from now on');
		const organizer = await core.users.findByIdentity('discord', fig.id);
		assert.ok(organizer, 'the organiser got an account from the interaction itself');
		assert.equal(activity.ownerUserId, organizer.id);
		assert.deepEqual(activity.shares.map(s => s.amountSatang).sort(), [20000, 20000, 20000]);
		assert.match(card.content, /฿600\.00 หารเท่า 3 คน/);
		assert.deepEqual(card.allowedMentions, { parse: [], users: [om.id] }, 'only the people who owe are pinged');
		assert.equal(call.log.deferred.flags, 64, 'the reply in the channel is private');
		assert.equal(channelPosts.length, 0, 'nothing was posted where the whole server reads');
		const note = call.log.edits[0];
		assert.match(note.content, /เตือนผ่าน DM ได้ 1 จาก 2 คน/);
		assert.match(note.content, /\*\*ต้น\*\* ไม่ได้ใช้ Discord/);
		assert.ok(note.content.includes(`<#${thread.id}>`), 'the organiser is pointed to the thread');
		assert.equal(note.components[0].components[0].data.custom_id, 'evt:pp', 'no PromptPay yet: offered in place');
		ok('one modal: roster from Discord and typed names, ฿600 split three ways, card in a private thread');

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
		call = base({ customId: `evt:join:${code}`, user: ton, kind: 'button', channel: thread });
		await event.handleComponent(call, { core });
		const menu = call.log.replies[0].components[0].components[0].data;
		assert.equal(menu.custom_id, `evt:claim:${code}:card1`);
		const tonRow = activity.participants.find(p => p.displayName === 'ต้น');
		call = base({ customId: menu.custom_id, user: ton, kind: 'select', channel: thread });
		call.values = [tonRow.id];
		await event.handleComponent(call, { core });
		assert.match(call.log.edits[0].content, /ผูกชื่อ \*\*ต้น\*\*/);
		activity = await core.activities.getActivityByCode(code);
		assert.equal(activity.participants.length, 3, 'no second Ton');
		assert.equal(activity.participants.find(p => p.id === tonRow.id).discordUid, ton.id);
		assert.equal(call.log.cardEdits[0].id, 'card1', 'the card in the channel is refreshed');
		ok('a typed name is claimed from Discord instead of being added twice');

		// Om again: already in.
		call = base({ customId: `evt:join:${code}`, user: om, kind: 'button', channel: thread });
		await event.handleComponent(call, { core });
		assert.match(call.log.replies[0].content, /อยู่ในบิลนี้แล้ว/);

		// Mew joins late, before anyone paid: the ฿600 is re-divided by four.
		call = base({ customId: `evt:join:${code}`, user: mew, kind: 'button', channel: thread });
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
		call = base({ customId: `evt:join:${code}`, user: late, kind: 'button', channel: thread });
		await event.handleComponent(call, { core });
		assert.match(call.log.edits[0], /ไม่หารใหม่อัตโนมัติ/);
		activity = await core.activities.getActivityByCode(code);
		assert.equal(activity.participants.length, 5);
		assert.deepEqual(activity.shares.map(s => s.amountSatang), [15000, 15000, 15000, 15000]);
		ok('after a payment, a newcomer is listed but nobody\'s share changes silently');

		// Paying: someone outside the bill is told how to get in; Om gets the modal.
		call = base({ customId: `evt:pay:${code}`, user: { id: snowflake(), name: 'x' }, kind: 'button', channel: thread });
		await event.handleComponent(call, { core });
		assert.match(call.log.replies[0].content, /ยังไม่อยู่ในบิลนี้/);
		call = base({ customId: `evt:pay:${code}`, user: ton, kind: 'button', channel: thread });
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
		const langThread = [...threads.values()].at(-1);
		const langCard = langThread.sent[0];
		const langCode = langCard.components[0].components[0].data.custom_id.split(':')[2];
		codes.push(langCode);
		assert.match(langCard.content, /หารเท่า 2 คน/, 'a Thai server gets a Thai card whoever made it');
		assert.equal(langCard.components[0].components[0].data.label, 'แนบสลิป');
		assert.match(call.log.edits[0].content, /^Created \*\*ข้าวเย็น\*\*/, 'the note only the organiser sees is in their language');
		ok('a Thai server gets a Thai card even when an English client created it');

		// Pim's Discord is Thai, but she chose English on her account page.
		const pimAccount = (await core.users.loginWithIdentity({ provider: 'discord', providerUid: pim.id, username: 'pim', displayName: 'พิม' })).user;
		const untouched = await core.users.getLanguagePreference(pimAccount.id);
		assert.equal(untouched.localeSet, false, 'signing in is not choosing a language');
		await core.users.setNotificationPreferences(pimAccount.id, { mode: 'discord', locale: 'en', localeChosen: true });
		assert.equal((await core.users.getLanguagePreference(pimAccount.id)).localeSet, true);
		call = base({ customId: `evt:join:${langCode}`, user: pim, kind: 'button', channel: langThread });
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
			call = base({ customId: `evt:join:${langCode}`, user: tor, kind: 'button', channel: langThread });
			await event.handleComponent(call, { core });
			assert.equal(call.log.edits[0], 'เพิ่มคุณเข้าบิลแล้ว', 'the reply to a Thai client stays Thai');
			assert.match(call.log.cardEdits[0].content, /split evenly by 3/, 'the redrawn card follows the server');
			assert.equal(call.log.cardEdits[0].components[0].components[0].data.label, 'Send slip');
		}
		finally {
			event.useServerLangReader(async () => null);
		}
		ok('a server that chose English gets English cards from any client');
		// Nobody else on Discord: no thread, no channel, nothing public.
		const threadsBefore = threads.size;
		call = createSubmit({ user: fig, title: 'ค่าน้ำ', guests: 'Alex, Mina', amount: '300' });
		await event.handleComponent(call, { core });
		assert.equal(threads.size, threadsBefore, 'no thread for a bill only the organiser is on');
		assert.equal(channelPosts.length, 0);
		const dm = call.log.dms[0];
		codes.push(dm.components[0].components[0].data.url.split('/a/')[1]);
		activity = await core.activities.getActivityByCode(codes.at(-1));
		assert.equal(activity.channelId, null, 'no channel, so no due-day post anywhere');
		assert.match(dm.content, /฿300\.00 หารเท่า 3 คน/, 'the organiser keeps the full card in DMs');
		assert.match(call.log.edits[0].content, /LINE/);
		assert.match(call.log.edits[0].content, /```\nค่าน้ำ\nยอดรวม ฿300\.00 หาร 3 คน\n[^`]*Alex ฿100\.00/);
		assert.match(call.log.edits[0].content, /ส่งการ์ดบิลเข้า DM ของคุณแล้ว/);
		ok('a bill with nobody else on Discord goes to the organiser only, with text for LINE');

		// The thread cannot be opened: the channel card has no names or money.
		threadsFail = true;
		call = createSubmit({ user: fig, title: 'ข้าวเย็น', people: [om], amount: '900' });
		await event.handleComponent(call, { core });
		threadsFail = false;
		const open = channelPosts.at(-1);
		assert.ok(open, 'a card was posted in the channel');
		const openCode = open.components[0].components[0].data.custom_id.split(':')[2];
		codes.push(openCode);
		assert.doesNotMatch(open.content, /฿|\d{2,}|<@|Ken|โอม|ฟิก/, 'no amounts, names or mentions');
		assert.match(open.content, /\*\*ข้าวเย็น\*\* บิลของ 2 คน/);
		assert.deepEqual(open.allowedMentions, { parse: [] });
		assert.equal((await core.activities.getActivityByCode(openCode)).channelId, PARENT);
		assert.match(call.log.edits[0].content, /สร้างเธรดส่วนตัวไม่ได้/);
		ok('when no private thread can be made, the channel card shows no names or amounts');

		// Pressing on that public card redraws it public, and pay stays personal.
		call = base({ customId: `evt:join:${openCode}`, user: mew, kind: 'button' });
		await event.handleComponent(call, { core });
		assert.ok(call.log.cardEdits.length > 0);
		for (const edit of call.log.cardEdits) assert.doesNotMatch(edit.content, /฿|<@/);
		call = base({ customId: `evt:pay:${openCode}`, user: om, kind: 'button' });
		await event.handleComponent(call, { core });
		assert.match(JSON.stringify(call.log.modal.toJSON()), /300\.00/, 'Om sees his own share, privately');
		ok('a public card stays without amounts after a refresh, and pay shows each person their own share');

		// Started inside a thread, with no bills channel possible: a thread
		// cannot hold threads, so the new one opens in the thread's parent.
		const insideThread = { id: snowflake(), type: ChannelType.PrivateThread, isThread: () => true, parent };
		call = createSubmit({ user: fig, title: 'ค่าแท็กซี่', people: [om], amount: '200', channel: insideThread });
		await event.handleComponent(call, { core });
		let made = [...threads.values()].at(-1);
		codes.push(made.sent[0].components[0].components[0].data.custom_id.split(':')[2]);
		assert.equal(made.parentId, PARENT, 'the thread opens beside the one the command came from');
		assert.match(call.log.edits[0].content, /เธรดส่วนตัว/);
		ok('a bill started inside a thread gets its own private thread in the parent channel');

		// A server where Megu may make channels: one bills channel, made once.
		await core.db.query('DELETE FROM bill_channels WHERE guild_id = $1', [GUILD]);
		const roomBills = [];
		for (const title of ['ค่าเน็ต', 'ค่าไฟ']) {
			call = createSubmit({ user: fig, title, people: [om], amount: '100', channel: insideThread, server: guild });
			await event.handleComponent(call, { core });
			made = [...threads.values()].at(-1);
			roomBills.push(made);
			codes.push(made.sent[0].components[0].components[0].data.custom_id.split(':')[2]);
		}
		assert.equal(roomsMade.length, 1, 'the bills channel is made once and found after that');
		const room = roomsMade[0];
		assert.equal(room.options.name, 'บิล');
		assert.equal(room.options.type, ChannelType.GuildText);
		const everyone = room.options.permissionOverwrites.find(o => o.id === GUILD);
		assert.ok(everyone.allow.includes(PermissionFlagsBits.SendMessagesInThreads), 'people can talk inside their bill');
		assert.ok(everyone.deny.includes(PermissionFlagsBits.SendMessages), 'but the channel itself holds only threads');
		assert.ok(roomBills.every(t => t.parentId === room.id), 'every bill thread opens in the bills channel');
		assert.equal(await core.activities.getBillChannel(GUILD), room.id);
		ok('bills go to one bills channel, made once and remembered by id');

		// Somebody deleted it: the next bill makes a new one.
		guild.channels.cache.delete(room.id);
		call = createSubmit({ user: fig, title: 'ค่าน้ำมัน', people: [om], amount: '100', server: guild });
		await event.handleComponent(call, { core });
		made = [...threads.values()].at(-1);
		codes.push(made.sent[0].components[0].components[0].data.custom_id.split(':')[2]);
		assert.equal(roomsMade.length, 2);
		assert.equal(made.parentId, roomsMade[1].id);
		assert.equal(await core.activities.getBillChannel(GUILD), roomsMade[1].id);
		ok('a deleted bills channel is made again on the next bill');

		// No Manage Channels: the thread opens where the command was used.
		await core.db.query('DELETE FROM bill_channels WHERE guild_id = $1', [GUILD]);
		roomsFail = true;
		call = createSubmit({ user: fig, title: 'ค่าที่จอด', people: [om], amount: '100', server: guild });
		await event.handleComponent(call, { core });
		roomsFail = false;
		made = [...threads.values()].at(-1);
		codes.push(made.sent[0].components[0].components[0].data.custom_id.split(':')[2]);
		assert.equal(made.parentId, PARENT);
		assert.equal(await core.activities.getBillChannel(GUILD), null);
		ok('without permission to make a channel, the thread opens in the channel the command was used in');

		// Who paid first on a one-off bill: Fig made it, Om paid at the counter.
		call = createSubmit({ user: fig, title: 'ค่าตั๋ว', people: [om], amount: '400' });
		await event.handleComponent(call, { core });
		made = [...threads.values()].at(-1);
		const ticketCode = made.sent[0].components[0].components[0].data.custom_id.split(':')[2];
		codes.push(ticketCode);
		let ticket = await core.activities.getActivityByCode(ticketCode);
		assert.equal(ticket.cardMessageId, 'card1', 'the card message is remembered');
		const payerMenu = call.log.edits[0].components
			.map(row => row.components[0].toJSON())
			.find(item => String(item.custom_id).startsWith('evt:payer:'));
		assert.ok(payerMenu, 'a one-off bill offers the who-paid-first menu too');
		assert.match(payerMenu.placeholder, /ใครออกเงินไปก่อน/);
		const omTicket = ticket.participants.find(p => p.displayName === 'โอม');

		call = base({ customId: payerMenu.custom_id, user: om, kind: 'select', channel: made });
		call.values = [omTicket.id];
		await event.handleComponent(call, { core });
		assert.match(call.log.followUps[0].content, /เฉพาะเจ้าของบิล/);
		ticket = await core.activities.getActivityByCode(ticketCode);
		assert.notEqual(ticket.payee.participantId, omTicket.id, 'only the owner moves the money');

		call = base({ customId: payerMenu.custom_id, user: fig, kind: 'select', channel: made });
		call.values = [omTicket.id];
		await event.handleComponent(call, { core });
		ticket = await core.activities.getActivityByCode(ticketCode);
		assert.equal(ticket.payee.participantId, omTicket.id);
		assert.ok(ticket.expenses.every(e => e.paidBy === omTicket.id), 'the bill is now paid by Om');
		const figTicket = ticket.participants.find(p => p.displayName === 'ฟิก');
		assert.equal(core.activities.settlement(ticket).rows.find(r => r.participantId === figTicket.id).outstanding, 20000, 'Fig now owes Om his half');
		assert.ok(call.log.cardEdits.some(edit => edit.content.includes(`<@${om.id}>`)), 'the card is redrawn');
		ok('a one-off bill lets its owner say who paid first, and the card and the debts follow');

		// Money sent: who paid first is fixed.
		await core.activities.recordPayment(ticket.id, figTicket.id, { amountSatang: 20000, method: 'bank_transfer' });
		call = base({ customId: payerMenu.custom_id, user: fig, kind: 'select', channel: made });
		call.values = [figTicket.id];
		await event.handleComponent(call, { core });
		assert.match(call.log.followUps[0].content, /บิลนี้มีคนโอนเข้ามาแล้ว/);
		ok('once money has been sent, who paid first cannot change');

		// A payee changed on the web: the bot redraws the remembered card.
		const redrawn = [];
		const client = { channels: { cache: new Map([[made.id, { type: ChannelType.PrivateThread, messages: { edit: async (id, value) => redrawn.push({ id, ...value }) } }]]) }, guilds: { cache: new Map() } };
		await core.activities.setPayee(ticket.id, figTicket.id);
		assert.equal(await event.redrawBillCard(client, core, ticketCode), true);
		assert.equal(redrawn[0].id, 'card1');
		assert.match(redrawn[0].content, new RegExp(`<@${fig.id}>`));
		assert.equal(await event.redrawBillCard({ channels: { cache: new Map(), fetch: async () => null }, guilds: { cache: new Map() } }, core, ticketCode), false, 'a thread that is gone changes nothing');
		ok('a change made on the web redraws the card in the bill thread');
	}
	finally {
		for (const code of codes) {
			await core.db.query('DELETE FROM activities WHERE code = $1', [code]).catch(() => undefined);
		}
		await core.db.query('DELETE FROM bill_channels WHERE guild_id = $1', [GUILD]).catch(() => undefined);
	}
	console.log(`\n${n} checks passed`);
	await core.db.close?.();
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
