// Paying by typing in a bill's private thread: "จ่าย ต.ค. 2569" with a slip.
// Real core and a disposable database; Discord is a stand-in, and the slip
// reader is replaced so the test checks what reaches it, not the OCR.
require('dotenv').config();
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const core = require('../core/index.js');
const event = require('../commands/utility/event.js');
const { handleThreadPayment, parsePaymentMessage, normalizeYear } = require('../adapters/discord/thread-pay.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

const snowflake = () => `1${Date.now()}${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;
const GUILD = '123456789012345678';

// The words people type, read the same way whatever the calendar.
{
	const now = new Date('2026-10-27T12:00:00+07:00');
	const read = text => parsePaymentMessage(text, now);
	assert.equal(normalizeYear('2569', now), 2026);
	assert.equal(normalizeYear('2026', now), 2026);
	assert.equal(normalizeYear('69', now), 2026, 'a two-digit Buddhist year');
	assert.equal(normalizeYear('26', now), 2026, 'a two-digit common-era year');
	for (const text of ['จ่าย ต.ค. 2569', 'จ่าย ตค 69', 'pay 10/2026', 'pay 27/10/2569', 'จ่ายแล้ว 27 ต.ค. 69', 'paid Oct 2026', 'โอนแล้ว ๑๐/๒๕๖๙', 'จ่าย ตุลาคม']) {
		assert.equal(read(text).periodKey, '2026-10', text);
	}
	assert.equal(read('จ่าย มกราคม 2570').periodKey, '2027-01');
	assert.deepEqual(read('จ่าย'), { periodKey: null, amountSatang: null, lang: 'th' });
	assert.equal(read('paid Oct 2026').lang, 'en', 'an English keyword gets an English reply');
	assert.equal(read('จ่าย 150').amountSatang, 15000);
	assert.equal(read('pay ฿1,200.50 Oct 2026').amountSatang, 120050);
	assert.equal(read('จ่าย 27 ต.ค. 69').amountSatang, null, 'the day and year beside a month are not an amount');
	assert.equal(read('pay 10/2026').amountSatang, null);
	assert.equal(read('จ่ายค่าไฟก่อนนะ'), null, 'a word that only starts like the keyword is conversation');
	assert.equal(read('เดี๋ยวจ่าย'), null, 'the keyword has to come first');
	ok('months in Thai or English, Buddhist or common era, and an amount when one is given');
}

// A monthly bill with its private thread, made the way /sub makes it.
const threads = new Map();
const parent = {
	type: ChannelType.GuildText,
	threads: {
		async create() {
			const thread = { id: snowflake(), type: ChannelType.PrivateThread, members: { add: async () => undefined } };
			thread.send = async () => ({ id: 'card1' });
			threads.set(thread.id, thread);
			return thread;
		},
	},
};

function subSubmit(user, people) {
	const log = { replies: [], edits: [], followUps: [] };
	return {
		log,
		customId: 'evt:subcreate',
		locale: 'th', guildLocale: 'th', guildId: GUILD, channelId: '223456789012345678',
		user: { id: user.id, username: user.name, globalName: user.name, displayAvatarURL: () => null, send: async () => undefined },
		member: { displayName: user.name },
		isModalSubmit: () => true, isButton: () => false, isStringSelectMenu: () => false,
		fields: {
			getTextInputValue: id => ({ title: 'Netflix', guests: '', amount: '300', dueDay: '15' }[id] ?? ''),
			getSelectedUsers: () => new Map(people.map(p => [p.id, { id: p.id, username: p.name, globalName: p.name }])),
			getSelectedMembers: () => new Map(people.map(p => [p.id, { displayName: p.name }])),
		},
		async reply(value) { log.replies.push(value); },
		async deferReply() { this.deferred = true; },
		async editReply(value) { log.edits.push(value); return { id: 'card1' }; },
		async followUp(value) { log.followUps.push(value); },
		channel: parent,
		client: { users: { fetch: async () => ({ send: async () => undefined }) }, channels: { cache: threads } },
	};
}

const discordCall = async (label, run, fallback) => {
	try {
		return await run();
	}
	catch {
		return fallback;
	}
};

function payMessage({ user, text, channel, image = true, bot = false }) {
	const log = { deleted: false, sent: [] };
	const room = {
		id: channel.id,
		isThread: () => channel.type === ChannelType.PrivateThread,
		send: async value => log.sent.push(value),
	};
	return {
		log,
		guild: { id: GUILD, preferredLocale: 'th' },
		author: { id: user.id, username: user.name, bot },
		member: { displayName: user.name },
		channel: room,
		channelId: channel.id,
		content: text,
		attachments: new Map(image ? [['a', { url: 'https://cdn.example/slip.png', contentType: 'image/png', size: 1000 }]] : []),
		async delete() { log.deleted = true; },
		client: { users: { fetch: async () => ({ send: async () => undefined }) } },
	};
}

async function main() {
	await core.initCoreSchema();
	const fig = { id: snowflake(), name: 'Alex' };
	const om = { id: snowflake(), name: 'Mina' };
	let code;

	try {
		await event.handleComponent(subSubmit(fig, [om]), { core });
		const thread = [...threads.values()].at(-1);
		code = await core.activities.getActivityCodeByChannel(thread.id);
		assert.ok(code, 'the thread leads back to its bill');
		const activity = await core.activities.getActivityByCode(code);
		const period = core.activities.currentPeriod(activity);
		const [year, month] = period.key.split('-');

		// The real thing: Mina pays this month from the thread.
		const submitted = [];
		const submit = async input => {
			submitted.push(input);
			return 'บันทึกว่า **ชำระแล้ว ฿150.00** ให้ **Netflix**';
		};
		let message = payMessage({ user: om, text: `จ่าย ${month}/${Number(year) + 543}`, channel: thread });
		assert.equal(await handleThreadPayment(message, { core, discordCall, submit }), true);
		assert.equal(submitted.length, 1);
		assert.equal(submitted[0].candidate.code, code);
		assert.deepEqual(submitted[0].candidate.periods.map(p => p.key), [period.key], 'only the month that was named');
		assert.equal(submitted[0].amountSatang, 15000, 'with no amount typed, the share for that month');
		assert.equal(submitted[0].senderDiscordUid, om.id);
		assert.equal(submitted[0].attachment.url, 'https://cdn.example/slip.png');
		assert.ok(message.log.deleted, 'the slip message is removed from the thread');
		assert.match(message.log.sent[0].content, /^\*\*Mina\*\* ของ.*: บันทึกว่า/);
		assert.match(message.log.sent[0].content, /ลบข้อความที่มีสลิปออกแล้ว/);
		assert.deepEqual(message.log.sent[0].allowedMentions, { parse: [] });
		ok('a payment typed in the bill thread is sent for checking, and the slip message is removed');

		// A month with nothing owed is refused, and the slip still goes.
		message = payMessage({ user: om, text: 'จ่าย ม.ค. 2560', channel: thread });
		assert.equal(await handleThreadPayment(message, { core, discordCall, submit }), true);
		assert.equal(submitted.length, 1, 'nothing was recorded');
		assert.match(message.log.sent[0].content, /ไม่มียอดค้างของ/);
		assert.ok(message.log.deleted);
		ok('a month with nothing owed is refused, and its slip is still taken out of the thread');

		// Someone not on the bill.
		message = payMessage({ user: { id: snowflake(), name: 'Ken' }, text: 'จ่าย', channel: thread });
		assert.equal(await handleThreadPayment(message, { core, discordCall, submit }), true);
		assert.equal(submitted.length, 1);
		assert.match(message.log.sent[0].content, /\*\*Ken\*\* ไม่มียอดค้างในบิลนี้/);
		ok('someone with nothing owed on the bill is told so');

		// Everything else is conversation and passes through untouched.
		const passes = [
			payMessage({ user: om, text: 'จ่ายค่าไฟก่อนนะ', channel: thread }),
			payMessage({ user: om, text: 'จ่าย', channel: thread, image: false }),
			payMessage({ user: om, text: 'จ่าย', channel: thread, bot: true }),
			payMessage({ user: om, text: 'จ่าย', channel: { id: snowflake(), type: ChannelType.PrivateThread } }),
			payMessage({ user: om, text: 'จ่าย', channel: { id: thread.id, type: ChannelType.GuildText } }),
		];
		for (const pass of passes) {
			assert.equal(await handleThreadPayment(pass, { core, discordCall, submit }), false);
			assert.equal(pass.log.deleted, false);
			assert.equal(pass.log.sent.length, 0);
		}
		assert.equal(submitted.length, 1);
		ok('without the keyword, an image, a person, or a bill thread, the message is left alone');

		for (const sent of [message.log.sent[0].content]) assert.doesNotMatch(sent, /[·→←—]/);
		ok('the replies use no middle dot, arrow or em dash');
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
