// The link preview under /a/{code}: it names the bill, says what kind it is,
// and never prints a name or an amount, because anyone with the link sees it.
const assert = require('node:assert/strict');
const { billPreview } = require('../core/bill-preview.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

const monthly = {
	title: 'Youtube Premium',
	kind: 'recurring',
	planState: 'confirmed',
	dueDay: 15,
	participants: [
		{ displayName: 'King Megu', rsvp: 'yes' },
		{ displayName: 'SIX SEVEN', rsvp: 'yes' },
		{ displayName: 'gohjiuuu', rsvp: 'yes' },
		{ displayName: 'ณัฏฐกร', rsvp: 'yes' },
	],
	owes: 6500,
};

{
	const { title, description } = billPreview(monthly);
	assert.equal(title, 'Youtube Premium');
	assert.equal(description, 'บิลรายเดือน หารกัน 4 คน ครบกำหนดวันที่ 15 ของทุกเดือน เปิดลิงก์เพื่อดูยอดของคุณและจ่ายผ่าน PromptPay');
	ok('a monthly bill says what it is, how many share it and when it is due');
}

{
	const { description } = billPreview(monthly, 'en');
	assert.equal(description, 'Monthly bill, split 4 ways, due on day 15 of each month. Open the link to see your share and pay by PromptPay.');
	ok('the English preview reads as sentences');
}

{
	const { description } = billPreview(monthly);
	for (const person of monthly.participants) assert.ok(!description.includes(person.displayName));
	assert.ok(!/฿|\d+\.\d{2}|65/.test(description));
	ok('no names and no amounts reach the preview');
}

{
	const trip = {
		title: 'ทริปเขาใหญ่',
		kind: 'event',
		planState: 'open',
		participants: [{ rsvp: 'yes' }, { rsvp: 'pending' }, { rsvp: 'no' }],
	};
	assert.equal(billPreview(trip).description, 'หารค่าใช้จ่าย หารกัน 2 คน เปิดลิงก์เพื่อดูยอดของคุณและจ่ายผ่าน PromptPay');
	ok('an event counts everyone except those who said no, and has no due day');
}

{
	const solo = { title: 'ค่าข้าว', kind: 'event', planState: 'open', participants: [{ rsvp: 'yes' }] };
	assert.equal(billPreview(solo).description, 'หารค่าใช้จ่าย เปิดลิงก์เพื่อดูยอดของคุณและจ่ายผ่าน PromptPay');
	ok('one person is not "split 1 way"');
}

{
	assert.equal(billPreview({ ...monthly, planState: 'cancelled' }).description, 'บิลนี้ถูกยกเลิกแล้ว');
	ok('a cancelled bill says so instead of inviting payment');
}

{
	for (const missing of [null, undefined, { title: '' }]) {
		const preview = billPreview(missing);
		assert.equal(preview.title, 'บิลที่หารกัน');
		assert.ok(preview.description.includes('PromptPay'));
	}
	ok('a missing or unreadable bill falls back to the bills wording, not the server-manager one');
}

{
	const long = billPreview({ ...monthly, title: 'ก'.repeat(120) }).title;
	assert.equal(Array.from(long).length, 70);
	assert.ok(long.endsWith('…'));
	ok('a long title is clipped by characters, not bytes');
}

{
	for (const lang of ['th', 'en']) {
		const { title, description } = billPreview(monthly, lang);
		assert.ok(!/[·→←—]/.test(title + description));
	}
	ok('no middle dots, arrows or em dashes');
}

console.log(`\n${n} passed`);
