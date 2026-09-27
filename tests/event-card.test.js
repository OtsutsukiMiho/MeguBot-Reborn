// `/event`'s words and roster rules, from literals: who goes on the bill, who
// shares it, and what the channel is told — with typed names never becoming
// mentions and nobody pinged who does not owe anything.
const assert = require('node:assert/strict');
const card = require('../core/event-card.js');
const { parseBaht } = require('../adapters/discord/slip-submit.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

{
	assert.deepEqual(card.parseGuestNames('ต้น\nฝน, ต้น\n\n  ปอ  ,，มิว'), ['ต้น', 'ฝน', 'ปอ', 'มิว']);
	assert.deepEqual(card.parseGuestNames(''), []);
	assert.equal(card.parseGuestNames('x'.repeat(200))[0].length, 60);
	ok('typed names: one per line or comma separated, repeats and blanks dropped');
}

{
	assert.equal(parseBaht('1,200'), 120000);
	assert.equal(parseBaht('฿ 99.5'), 9950);
	assert.equal(parseBaht('120บาท'), 12000);
	assert.equal(parseBaht('12.345'), null);
	assert.equal(parseBaht('abc'), null);
	assert.equal(parseBaht('0'), null);
	ok('amounts are read the way people type them, and anything else is refused');
}

{
	const organizer = { discordUid: '100', displayName: 'ฟิก', userId: 'usr_fig' };
	const picked = [
		{ discordUid: '100', displayName: 'ฟิก again' },
		{ discordUid: '200', displayName: 'โอม' },
		{ discordUid: '300', displayName: 'Bot', bot: true },
		{ discordUid: '200', displayName: 'โอม twice' },
	];
	const plan = card.planRoster({ organizer, picked, guests: ['ต้น'], splitMode: 'with_me' });
	assert.deepEqual(plan.participants.map(p => p.displayName), ['ฟิก', 'โอม', 'ต้น']);
	assert.deepEqual(plan.sharerIndexes, [0, 1, 2]);
	assert.equal(plan.participants[2].discordUid, null);
	ok('the organiser is always first, picked once; bots and repeats are skipped');

	const treat = card.planRoster({ organizer, picked, guests: ['ต้น'], splitMode: 'without_me' });
	assert.deepEqual(treat.sharerIndexes, [1, 2], 'my treat: on the roster, out of the split');

	const crowd = card.planRoster({ organizer, guests: Array.from({ length: 30 }, (_, i) => `g${i}`) });
	assert.equal(crowd.participants.length, card.MAX_PEOPLE);
	assert.equal(crowd.dropped, 6);
	ok('"not me" keeps the payee row out of the split, and the roster is capped');
}

{
	const activity = {
		title: 'ตีแบด *เสาร์*',
		currency: 'THB',
		ownerUserId: 'usr_fig',
		participants: [
			{ id: 'p1', displayName: 'ฟิก', discordUid: '100', userId: 'usr_fig' },
			{ id: 'p2', displayName: 'โอม', discordUid: '200', userId: null },
			{ id: 'p3', displayName: '@everyone', discordUid: null, userId: null },
			{ id: 'p4', displayName: 'ปอ', discordUid: '400', userId: null },
		],
	};
	const settlement = {
		total: 60000,
		state: 'open',
		rows: [
			{ participantId: 'p1', owes: 15000, outstanding: -45000, pending: 0 },
			{ participantId: 'p2', owes: 15000, outstanding: 0, pending: 0 },
			{ participantId: 'p3', owes: 15000, outstanding: 15000, pending: 0 },
			{ participantId: 'p4', owes: 15000, outstanding: 15000, pending: 15000 },
		],
	};
	const th = card.eventCardMessage({ activity, settlement, payee: { participantId: 'p1' }, locale: 'th' });
	const lines = th.content.split('\n');
	assert.equal(lines[0], '🧾 **ตีแบด \\*เสาร์\\*** · ฿600.00 หารเท่า 4 คน');
	assert.match(lines[1], /^• <@100> ฿150\.00 · รับเงิน$/);
	assert.match(lines[2], /^• <@200> ฿150\.00 · ✅ จ่ายแล้ว$/);
	assert.ok(!th.content.includes('@everyone'), 'a typed name can never ping the server');
	assert.match(lines[3], /ไม่ได้ใช้ Discord/);
	assert.match(lines[4], /รอตรวจสลิป/);
	assert.match(th.content, /โอนให้ <@100>/);
	assert.deepEqual(th.mentionUids, ['200', '400'], 'people who owe are pinged; the organiser is not');
	ok('the card: who owes what, who has paid, whose slip is being checked');

	const noAmount = card.eventCardMessage({ activity, settlement: { total: 0, state: 'none', rows: [] }, locale: 'en-US' });
	assert.match(noAmount.content, /4 people · no amount yet/);
	assert.deepEqual(noAmount.mentionUids, [], 'nobody is pinged about a bill with no amount');
	const settled = card.eventCardMessage({ activity, settlement: { ...settlement, state: 'settled' }, locale: 'th' });
	assert.match(settled.content, /ทุกคนจ่ายครบแล้ว/);
	ok('a bill with no amount yet pings nobody, and a settled one says so');

	const note = card.organizerNote({ activity, payeeHasPromptPay: false, shareUrl: 'https://megu.test/a/X', locale: 'th' });
	assert.match(note, /Megu เตือนผ่าน DM ได้ 2 จาก 3 คน/);
	assert.ok(note.includes(`@${String.fromCharCode(0x200b)}everyone`), 'a typed @everyone is broken before it can ping');
	assert.match(note, /ยังไม่มีพร้อมเพย์/);
	ok('the organiser is told who Megu can remind, who needs the link, and about PromptPay');
}

{
	assert.equal(card.parseDueDay('5'), 5);
	assert.equal(card.parseDueDay('วันที่ 25'), 25);
	assert.equal(card.parseDueDay('1st'), 1);
	assert.equal(card.parseDueDay('31'), null, 'not every month has a 31st');
	assert.equal(card.parseDueDay('0'), null);
	assert.equal(card.parseDueDay('soon'), null);
	ok('the due day is 1–28, however it is written');

	const activity = {
		title: 'Netflix', kind: 'recurring', dueDay: 5, currency: 'THB', ownerUserId: 'u1',
		participants: [
			{ id: 'p1', displayName: 'ฟิก', discordUid: '100', userId: 'u1' },
			{ id: 'p2', displayName: 'โอม', discordUid: '200', userId: null },
			{ id: 'p3', displayName: 'แม่', discordUid: null, userId: null },
		],
	};
	const settlement = {
		total: 42000, state: 'open',
		rows: [
			{ participantId: 'p1', owes: 14000, outstanding: -28000, pending: 0 },
			{ participantId: 'p2', owes: 14000, outstanding: 14000, pending: 0 },
			{ participantId: 'p3', owes: 14000, outstanding: 14000, pending: 0 },
		],
	};
	const th = card.eventCardMessage({ activity, settlement, payee: { participantId: 'p1' }, period: { key: '2026-10' }, locale: 'th' });
	assert.equal(th.content.split('\n')[0], '🔁 **Netflix** · ฿420.00/เดือน หารเท่า 3 คน · ตุลาคม 2569 · ทุกวันที่ 5');
	assert.match(th.content, /Megu จะเตือนทุกเดือน/);
	const en = card.eventCardMessage({ activity, settlement, payee: { participantId: 'p1' }, period: { key: '2026-10' }, locale: 'en' });
	assert.match(en.content, /฿420\.00\/month split evenly by 3 · October 2026 · the 5th of every month/);
	ok('a monthly card names the month, the amount per month and the due day');

	const note = card.organizerNote({ activity, payeeHasPromptPay: true, shareUrl: 'u', period: { key: '2026-10' }, locale: 'th' });
	assert.equal(note.split('\n')[1], 'Megu จะเปิดรอบใหม่ให้ทุกเดือน และเตือนคนที่ยังไม่จ่าย ทุกวันที่ 5 (รอบแรก: ตุลาคม 2569)');

	const due = card.dueChannelMessage({
		title: 'Netflix', periodKey: '2026-10', locale: 'th',
		lines: [{ displayName: 'โอม', discordUid: '200', amountSatang: 14000 }, { displayName: '@here แม่', discordUid: null, amountSatang: 14000 }],
	});
	assert.equal(due.split('\n')[0], '⏰ **Netflix** · ตุลาคม 2569 ครบกำหนดวันนี้');
	assert.equal(due.split('\n')[1], '• <@200> ยังค้าง ฿140.00');
	assert.ok(!due.includes('@here'), 'a typed name cannot ping the channel');
	assert.match(due, /กด \*\*แนบสลิป\*\*/);
	ok('the organiser is told when Megu will remind, and the due-day post lists who still owes');
}

console.log(`\n${n} checks passed`);
