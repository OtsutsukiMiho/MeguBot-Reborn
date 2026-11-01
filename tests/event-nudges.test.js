// Saying no to a bill, and the organiser asking Megu to remind people. Real core,
// real disposable database; only Discord is a stand-in.
require('dotenv').config();
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const core = require('../core/index.js');
const card = require('../core/event-card.js');
const event = require('../commands/utility/event.js');
const express = require('express');
const meguApi = require('../adapters/http/megu-api.js');

const { nudges } = core;

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

const snowflake = () => `1${Date.now()}${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;
const GUILD = '123456789012345678';

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

function press({ customId, user, kind = 'button', dm = false }) {
	const log = { replies: [], edits: [], followUps: [], posted: [], cardEdits: [], dms: [], modal: null };
	active = log;
	return {
		log,
		customId,
		locale: 'th',
		guildLocale: dm ? null : 'th',
		guildId: dm ? null : GUILD,
		channelId: room.id,
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
		message: { id: 'card1', editable: true, edit: async value => log.cardEdits.push(value) },
		channel: room,
		client: {
			user: { id: 'megu' },
			users: { fetch: async uid => ({ send: async value => log.dms.push({ uid, ...value }) }) },
			channels: { cache: threads, fetch: async id => threads.get(id) },
			guilds: { cache: new Map() },
		},
	};
}

async function createBill(owner, { people = [], guests = '', amount = '300', monthly = false }) {
	const call = press({ customId: monthly ? 'evt:subcreate' : 'evt:create', user: owner, kind: 'modal' });
	call.fields = {
		getTextInputValue: id => ({ title: 'ค่าเกม', guests, amount, dueDay: '5' }[id] ?? ''),
		getSelectedUsers: () => new Map(people.map(p => [p.id, { id: p.id, username: p.name, globalName: p.name }])),
		getSelectedMembers: () => new Map(people.map(p => [p.id, { displayName: p.name }])),
		getStringSelectValues: () => ['with_me'],
	};
	await event.handleComponent(call, { core });
	const code = call.log.edits[0].content.match(/\/a\/([A-Za-z0-9_-]+)/)[1];
	return { call, code };
}

function nudgeSubmit({ code, topic, user, note = '', who = [] }) {
	const call = press({ customId: `evt:nudgesave:${code}:${topic}`, user, kind: 'modal' });
	call.fields = {
		getTextInputValue: id => ({ note }[id] ?? ''),
		getStringSelectValues: () => who,
	};
	return call;
}

const labelsOf = message => message.components[0].components.map(c => c.data.label);
const rowOf = (activity, name) => activity.participants.find(p => p.displayName === name);
const shareOf = (activity, name) => activity.shares.find(s => s.participantId === rowOf(activity, name).id)?.amountSatang || 0;

async function main() {
	// ── what a typed message can and cannot do ─────────────────────────────────
	assert.equal(nudges.cleanText('hi @everyone <@123> [x](http://a)'), 'hi @\u200beveryone \\<@\u200b123\\> \\[x\\](http://a)');
	assert.equal(nudges.cleanText('a\n\n\nb'), 'a b');
	assert.equal(nudges.cleanText('x'.repeat(500), nudges.MAX_NOTE).length, nudges.MAX_NOTE);
	const words = composeOne => nudges.composeNudge({ activity: { title: 'ค่าเกม', currency: 'THB', slots: [] }, senderName: 'ฟิก', ...composeOne });
	const unpaid = words({ topic: 'unpaid', amountSatang: 10000, note: 'โอนก่อนศุกร์นะ' });
	assert.match(unpaid, /ฟิก ฝากเตือนเรื่อง "ค่าเกม"/);
	assert.match(unpaid, /ยอดของคุณ ฿100\.00/, 'the facts stay');
	assert.match(unpaid, /ข้อความจาก ฟิก: โอนก่อนศุกร์นะ/, 'the note says whose words it is');
	assert.match(words({ topic: 'unanswered', locale: 'en' }), /ฟิก is asking whether you are joining "ค่าเกม"/);
	assert.equal(nudges.plainText(nudges.cleanText('mew_99 @everyone <b>')), 'mew_99 @everyone <b>', 'an email shows it as typed');
	ok('a typed message cannot ping or dress up a link, and is added to the facts');

	await core.initCoreSchema();
	const fig = { id: snowflake(), name: 'ฟิก' };
	const om = { id: snowflake(), name: 'โอม' };
	const po = { id: snowflake(), name: 'ปอ' };
	const mew = { id: snowflake(), name: 'มิว' };
	const codes = [];
	const madeUsers = [];

	try {
		// ── the buttons on a card ─────────────────────────────────────────────
		const { call: made, code } = await createBill(fig, { people: [om, po], guests: 'เจ', amount: '400' });
		codes.push(code);
		assert.deepEqual(labelsOf(made.log.posted[0]), ['แนบสลิป', 'เข้าร่วม', 'ไม่เข้าร่วม', 'เตือน', 'เปิดบิล']);
		assert.match(made.log.posted[0].content, /กด \*\*ไม่เข้าร่วม\*\*/);
		const sub = await createBill(fig, { people: [om], amount: '419', monthly: true });
		codes.push(sub.code);
		assert.equal(labelsOf(sub.call.log.posted[0]).length, 5, 'a monthly card stays within the five buttons a row holds');
		assert.ok(!labelsOf(sub.call.log.posted[0]).includes('เตือน'));
		const panel = press({ customId: `evt:manage:${sub.code}`, user: fig });
		await event.handleComponent(panel, { core });
		assert.ok(labelsOf(panel.log.replies[0]).includes('เตือน'), 'it reaches the reminder through Manage instead');
		ok('a one-off card has decline and remind; a monthly card has remind under Manage');

		// ── saying no ─────────────────────────────────────────────────────────
		let activity = await core.activities.getActivityByCode(code);
		assert.equal(shareOf(activity, 'โอม'), 10000);
		let call = press({ customId: `evt:decline:${code}`, user: om });
		await event.handleComponent(call, { core });
		assert.match(call.log.edits[0], /ส่วนของคุณถูกหารให้คนที่เหลือแล้ว/);
		activity = await core.activities.getActivityByCode(code);
		assert.equal(rowOf(activity, 'โอม').rsvp, 'no');
		assert.equal(shareOf(activity, 'โอม'), 0);
		assert.ok(shareOf(activity, 'ปอ') >= 13333, 'the others carry it');
		const built = card.eventCardMessage({ activity, settlement: core.activities.settlement(activity, null), payee: activity.payee, locale: 'th' });
		assert.match(built.content, new RegExp(`<@${om.id}> \\(ไม่เข้าร่วม\\)`), 'the card says so');
		assert.ok(!built.mentionUids.includes(om.id));

		call = press({ customId: `evt:decline:${code}`, user: om });
		await event.handleComponent(call, { core });
		assert.match(call.log.edits[0], /บอกไว้แล้วว่าไม่เข้าร่วม/, 'pressing twice changes nothing');

		call = press({ customId: `evt:join:${code}`, user: om });
		await event.handleComponent(call, { core });
		activity = await core.activities.getActivityByCode(code);
		assert.equal(rowOf(activity, 'โอม').rsvp, 'yes');
		assert.equal(shareOf(activity, 'โอม'), 10000, 'coming back puts the share back');
		ok('no re-splits the bill, the card shows it, and yes undoes it');

		call = press({ customId: `evt:decline:${code}`, user: fig });
		await event.handleComponent(call, { core });
		assert.match(call.log.edits[0], /คุณเป็นคนรับเงิน/, 'the person collecting cannot walk away from the bill');
		call = press({ customId: `evt:decline:${code}`, user: mew });
		await event.handleComponent(call, { core });
		assert.match(call.log.replies[0].content, /ยังไม่อยู่ในบิลนี้/);
		call = press({ customId: `evt:decline:${sub.code}`, user: om });
		await event.handleComponent(call, { core });
		assert.match(call.log.replies[0].content, /ออกจากบิล/, 'a monthly bill has its own way out');
		ok('the receiver, a stranger and a monthly bill are each told why not');

		// Money has moved: the answer is saved, the amounts are not touched, and
		// the owner hears about it.
		const paid = await createBill(fig, { people: [om, po], amount: '300' });
		codes.push(paid.code);
		activity = await core.activities.getActivityByCode(paid.code);
		await core.activities.recordPayment(activity.id, rowOf(activity, 'ปอ').id, { amountSatang: 10000 });
		call = press({ customId: `evt:decline:${paid.code}`, user: om });
		await event.handleComponent(call, { core });
		assert.match(call.log.edits[0], /ยอดของคุณยังอยู่จนกว่าเจ้าของบิลจะปรับ/);
		activity = await core.activities.getActivityByCode(paid.code);
		assert.equal(rowOf(activity, 'โอม').rsvp, 'no');
		assert.equal(shareOf(activity, 'โอม'), 10000);
		const told = await core.db.query('SELECT payload FROM notification_events WHERE user_id = $1 AND event_type = \'participant_declined\'', [activity.ownerUserId]);
		assert.equal(told.rows.length, 1);
		assert.match(told.rows[0].payload.bodyTh, /โอม กดไม่เข้าร่วม/);
		ok('after money has moved, no is saved, the amounts stay, and the owner is told');

		// ── the remind button ─────────────────────────────────────────────────
		call = press({ customId: `evt:nudge:${code}`, user: om });
		await event.handleComponent(call, { core });
		assert.match(call.log.replies[0].content, /เฉพาะเจ้าของบิลหรือคนรับเงิน/);
		assert.equal(call.log.modal, null);

		call = press({ customId: `evt:nudge:${code}`, user: fig });
		await event.handleComponent(call, { core });
		const modal = call.log.modal.toJSON();
		assert.equal(modal.custom_id.split(':')[1], 'nudgesave');
		const ids = modal.components.map(c => c.component.custom_id);
		assert.ok(ids.includes('note'));
		assert.ok(ids.includes('who'), 'people can be picked');
		const whoOptions = modal.components.find(c => c.component.custom_id === 'who').component.options.map(o => o.label);
		assert.deepEqual(whoOptions.sort(), ['ปอ', 'โอม'].sort(), 'not the presser, and not someone with no way to be reached');
		ok('only the owner or receiver gets the modal, listing people Megu can reach');

		call = nudgeSubmit({ code, topic: 'unpaid', user: fig, note: 'โอนก่อนศุกร์ @everyone' });
		await event.handleComponent(call, { core });
		assert.equal(call.log.dms.length, 2, 'one DM each for two Discord rows');
		assert.match(call.log.dms[0].content, /ยอดของคุณ ฿100\.00/);
		assert.match(call.log.dms[0].content, /ข้อความจาก ฟิก: โอนก่อนศุกร์ @\u200beveryone/);
		assert.match(call.log.edits[0].content, /ส่งให้แล้ว: /);
		assert.match(call.log.edits[0].content, /เจ ไม่ได้ใช้ Discord ส่งลิงก์นี้ให้เอง/);
		ok('send DMs each person, and reports who heard and who to chase by hand');

		call = nudgeSubmit({ code, topic: 'unpaid', user: fig });
		await event.handleComponent(call, { core });
		assert.equal(call.log.dms.length, 0, 'pressing again sends nothing');
		assert.match(call.log.edits[0].content, /เพิ่งได้รับการเตือน/);
		ok('the same person cannot be reminded about the same bill twice inside the cooldown');

		// Directly, with the clock and the delivery in the test's hands.
		const fresh = await createBill(fig, { people: [om, po], guests: 'เจ', amount: '300' });
		codes.push(fresh.code);
		activity = await core.activities.getActivityByCode(fresh.code);
		const sender = { discordUid: fig.id, userId: activity.ownerUserId, displayName: 'ฟิก' };
		const sent = [];
		const deliver = async (notice) => {
			sent.push(notice);
			return { delivered: true };
		};
		const quick = { wait: async () => undefined };

		// Someone who said "not now" is left alone, and the reason is passed on.
		await core.activities.deferPayment({ activityId: activity.id, participantId: rowOf(activity, 'โอม').id, reason: 'เงินเดือนออกวันที่ 25' });
		let results = await nudges.send({ activity, topic: 'unpaid', sender, deliver, baseUrl: 'https://m.test', ...quick });
		assert.equal(results.find(r => r.displayName === 'โอม').state, 'deferred');
		assert.equal(results.find(r => r.displayName === 'ปอ').state, 'sent');
		assert.equal(results.find(r => r.displayName === 'เจ').state, 'unreachable');
		assert.deepEqual(sent.map(item => item.discordUid), [po.id]);
		assert.equal(sent[0].defer.participantId, rowOf(activity, 'ปอ').id, 'the DM offers Send slip and Not now');
		assert.match(sent[0].cta.url, new RegExp(`/a/${fresh.code}/pay$`));
		const report = nudges.composeNudgeReport(results, { shareUrl: 'https://m.test/a/x' });
		assert.match(report, /โอม ขอเลื่อนถึง .* เหตุผล: เงินเดือนออกวันที่ 25/);
		ok('someone who deferred is skipped, and the organiser sees why');

		// After the cooldown the same person can be reminded again.
		const later = new Date(Date.now() + (nudges.NUDGE_COOLDOWN_HOURS + 1) * 3600 * 1000);
		results = await nudges.send({ activity, topic: 'unpaid', sender, deliver, participantIds: [rowOf(activity, 'ปอ').id], now: later, ...quick });
		assert.deepEqual(results.map(r => r.state), ['sent']);
		ok('the cooldown ends, and picking one person reminds only them');

		// A refusal stops the loop and gives the slot back.
		const blockedBill = await createBill(fig, { people: [om, po, mew], amount: '400' });
		codes.push(blockedBill.code);
		activity = await core.activities.getActivityByCode(blockedBill.code);
		let attempts = 0;
		results = await nudges.send({ activity, topic: 'unpaid', sender, ...quick, deliver: async () => {
			attempts++;
			return { delivered: false, blocked: true };
		} });
		assert.equal(attempts, 1, 'nobody after the first refusal is tried');
		assert.deepEqual(results.map(r => r.state), ['blocked', 'blocked', 'blocked']);
		const held = await core.db.query('SELECT 1 FROM payment_reminders WHERE activity_id = $1', [activity.id]);
		assert.equal(held.rows.length, 0, 'nothing is written down as said');
		ok('a block stops the sweep at once, and nothing counts as sent');

		// A closed DM is not a block.
		results = await nudges.send({ activity, topic: 'unpaid', sender, ...quick, deliver: async notice => (notice.discordUid === om.id ? { delivered: false, closed: true } : { delivered: true }) });
		assert.equal(results.find(r => r.displayName === 'โอม').state, 'closed');
		assert.equal(results.find(r => r.displayName === 'ปอ').state, 'sent');
		ok('a closed DM skips one person and carries on');

		// Two presses at once: only one of them speaks.
		const raced = await createBill(fig, { people: [om], amount: '200' });
		codes.push(raced.code);
		activity = await core.activities.getActivityByCode(raced.code);
		sent.length = 0;
		await Promise.all([1, 2].map(() => nudges.send({ activity, topic: 'unpaid', sender, deliver, ...quick })));
		assert.equal(sent.length, 1);
		ok('two presses at the same moment send one message');

		// ── accounts go through the outbox and keep their own choice ──────────
		const { user: account } = await core.users.loginWithIdentity({ provider: 'discord', providerUid: mew.id, username: 'mew', displayName: 'มิว', avatarUrl: null });
		madeUsers.push(account.id);
		const withAccount = await createBill(fig, { people: [mew], amount: '200' });
		codes.push(withAccount.code);
		activity = await core.activities.getActivityByCode(withAccount.code);
		assert.equal(rowOf(activity, 'มิว').userId, account.id);
		sent.length = 0;
		results = await nudges.send({ activity, topic: 'unpaid', sender, deliver, ...quick });
		assert.deepEqual(results.map(r => r.state), ['sent']);
		assert.equal(sent.length, 0, 'no direct DM for someone with an account');
		const queued = await core.db.query('SELECT e.payload, d.channel FROM notification_events e JOIN notification_deliveries d ON d.event_id = e.id WHERE e.user_id = $1 AND e.event_type = \'activity_nudge\'', [account.id]);
		assert.equal(queued.rows.length, 1);
		assert.equal(queued.rows[0].channel, 'discord');
		const rendered = core.notifications.render({ payload: { ...queued.rows[0].payload, locale: 'th' } });
		assert.match(rendered.body, /ฝากเตือนเรื่อง/);
		assert.ok(rendered.emailBody, 'the email has its own unescaped copy');
		assert.equal(rendered.payLabel, 'แนบสลิป');

		const muted = await createBill(fig, { people: [mew], amount: '100' });
		codes.push(muted.code);
		activity = await core.activities.getActivityByCode(muted.code);
		await core.db.query(`INSERT INTO notification_preferences (user_id, mode, locale) VALUES ($1, 'off', 'th')
			ON CONFLICT (user_id) DO UPDATE SET mode = 'off'`, [account.id]);
		results = await nudges.send({ activity, topic: 'unpaid', sender, deliver, ...quick });
		assert.deepEqual(results.map(r => r.state), ['muted']);
		const none = await core.db.query('SELECT 1 FROM payment_reminders WHERE activity_id = $1', [activity.id]);
		assert.equal(none.rows.length, 0, 'someone who heard nothing has not used up their cooldown');
		ok('an account goes through the outbox, and notifications off is respected and reported');

		// ── answering and being reminded about the plan ───────────────────────
		const plan = await createBill(fig, { people: [om, po], amount: '' });
		codes.push(plan.code);
		activity = await core.activities.getActivityByCode(plan.code);
		await core.activities.setRsvp(rowOf(activity, 'โอม').id, 'pending');
		await assert.rejects(nudges.send({ activity, topic: 'attending', sender, deliver, ...quick }), { code: 'nudge_note_required' });
		await assert.rejects(nudges.send({ activity, topic: 'unanswered', sender, deliver, ...quick }), { code: 'nudge_nobody' }, 'nobody has been asked until there is a time');
		await core.activities.updateActivity(activity.id, { startsAt: new Date(Date.now() + 86400000).toISOString(), location: 'ดิสคอร์ด' });
		activity = await core.activities.getActivityByCode(plan.code);
		sent.length = 0;
		results = await nudges.send({ activity, topic: 'unanswered', sender, deliver, baseUrl: 'https://m.test', ...quick });
		assert.deepEqual(results.map(r => r.displayName), ['โอม']);
		assert.equal(sent[0].rsvp.code, plan.code, 'the DM can be answered from inside it');
		assert.match(sent[0].cta.url, /\/rsvp$/);

		const planCode = plan.code;
		call = press({ customId: `evt:rsvpno:${planCode}`, user: om, dm: true });
		await event.handleComponent(call, { core });
		activity = await core.activities.getActivityByCode(planCode);
		assert.equal(rowOf(activity, 'โอม').rsvp, 'no');
		call = press({ customId: `evt:rsvpyes:${planCode}`, user: om, dm: true });
		await event.handleComponent(call, { core });
		activity = await core.activities.getActivityByCode(planCode);
		assert.equal(rowOf(activity, 'โอม').rsvp, 'yes');
		ok('the DM buttons answer from a DM, where no server is attached');

		// The plan reminder has its own cooldown row, which the statement ignores.
		const both = await createBill(fig, { people: [po], amount: '100' });
		codes.push(both.code);
		activity = await core.activities.getActivityByCode(both.code);
		await core.activities.updateActivity(activity.id, { startsAt: new Date(Date.now() + 86400000).toISOString() });
		activity = await core.activities.getActivityByCode(both.code);
		const row = rowOf(activity, 'ปอ');
		sent.length = 0;
		await nudges.send({ activity, topic: 'attending', sender, deliver, ...quick });
		assert.match(sent[0].message, /เวลา /);
		let due = await core.reminders.due({});
		assert.ok(due.some(person => person.lines.some(line => line.participantId === row.id)), 'a plan reminder does not push the payment statement back');
		await core.db.query('DELETE FROM payment_reminders WHERE activity_id = $1', [activity.id]);
		await nudges.send({ activity, topic: 'unpaid', sender, deliver, ...quick });
		due = await core.reminders.due({});
		assert.ok(!due.some(person => person.lines.some(line => line.participantId === row.id)), 'a money reminder does, so nobody hears it twice in a day');
		ok('a reminder about money holds back the automatic statement; one about the plan does not');

		// ── the same thing from the web ───────────────────────────────────────
		const web = await createBill(fig, { people: [om, po], guests: 'เจ', amount: '300' });
		codes.push(web.code);
		activity = await core.activities.getActivityByCode(web.code);
		const dmed = [];
		const { user: stranger } = await core.users.loginWithIdentity({ provider: 'discord', providerUid: snowflake(), username: 'stranger', displayName: 'คนนอก', avatarUrl: null });
		madeUsers.push(stranger.id);
		let whoAmI = activity.ownerUserId;
		const app = express();
		app.use(express.json());
		app.use((req, res, next) => {
			req.session = { meguUserId: whoAmI, user: { id: 'x' }, allGuilds: [] };
			next();
		});
		app.use('/api/megu', meguApi.router({
			frontendUrl: 'https://megu.test',
			serverLang: async () => 'th',
			sendDiscordDm: async (notice) => {
				dmed.push(notice);
				return { delivered: true };
			},
		}));
		const server = await new Promise((resolve) => {
			const listening = app.listen(0, () => resolve(listening));
		});
		const base = `http://127.0.0.1:${server.address().port}/api/megu/a/${web.code}/nudge`;
		const post = async (body) => {
			const res = await fetch(`${base}?lang=th`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
			return { status: res.status, body: await res.json() };
		};
		try {
			const list = await (await fetch(base)).json();
			assert.deepEqual(list.topics.map(topic => topic.key), ['unpaid', 'attending']);
			const unpaidList = list.topics[0].people;
			assert.equal(unpaidList.find(person => person.displayName === 'เจ').state, 'unreachable');
			assert.ok(!unpaidList.some(person => person.displayName === 'ฟิก'), 'the owner is not offered themself');

			assert.equal((await post({ topic: 'nonsense' })).body.code, 'nudge_topic_invalid');
			assert.equal((await post({ topic: 'attending' })).body.code, 'nudge_note_required');
			assert.equal((await post({ topic: 'unpaid', participantIds: ['nobody'] })).body.code, 'nudge_picked_none');

			const only = activity.participants.find(p => p.displayName === 'โอม').id;
			const answer = await post({ topic: 'unpaid', participantIds: [only], note: 'โอนด้วยนะ' });
			assert.equal(answer.status, 200);
			assert.deepEqual(dmed.map(item => item.discordUid), [om.id], 'only the person picked');
			assert.match(dmed[0].message, /ข้อความจาก ฟิก: โอนด้วยนะ/);
			assert.match(dmed[0].cta.url, /^https:\/\/megu\.test\/a\//);
			assert.match(answer.body.report, /ส่งให้แล้ว: โอม/);
			assert.equal(answer.body.topics[0].people.find(person => person.id === only).state, 'cooldown', 'the panel comes back up to date');

			whoAmI = stranger.id;
			assert.equal((await fetch(base)).status, 403);
			assert.equal((await post({ topic: 'unpaid' })).status, 403);
			assert.equal(dmed.length, 1);
		}
		finally {
			await new Promise(resolve => server.close(resolve));
		}
		ok('the web panel lists, sends and reports through the same rules, for the owner only');
	}
	finally {
		for (const code of codes) {
			await core.db.query('DELETE FROM activities WHERE code = $1', [code]).catch(() => undefined);
		}
		for (const id of madeUsers) {
			await core.db.query('DELETE FROM users WHERE id = $1', [id]).catch(() => undefined);
		}
	}
	console.log(`\n${n} checks passed`);
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
