// Posting the bill back to Discord: the message says who sends what to whom,
// never pings anyone, and the route only lets the organiser post, once a
// minute, into the channel the activity is linked to.
require('dotenv').config();
const assert = require('node:assert/strict');
const express = require('express');
const core = require('../core/index.js');
const meguApi = require('../adapters/http/megu-api.js');
const { billSummaryMessage } = require('../core/bill-summary.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

// --- The message, from literals --------------------------------------------
{
	const settlement = {
		total: 69300,
		rows: [
			{ participantId: 'fig', displayName: 'ฟิก', owesTo: [] },
			{ participantId: 'om', displayName: 'โอม', owesTo: [{ creditorId: 'fig', outstandingSatang: 10725 }] },
			{ participantId: 'a', displayName: '@everyone *A*', owesTo: [{ creditorId: 'fig', outstandingSatang: 825 }] },
		],
	};
	const th = billSummaryMessage({ title: 'ตีแบด', settlement, lang: 'th' });
	assert.equal(th.message.split('\n')[0], '💸 **ตีแบด** · สรุปบิล ฿693.00');
	assert.equal(th.message.split('\n')[1], '• โอม โอน ฿107.25 ให้ ฟิก', 'largest transfer first');
	assert.ok(!th.message.includes('@everyone'), 'a name can never become a mention');
	assert.ok(th.message.includes('\\*A\\*'), 'a name can never become formatting');
	assert.equal(th.lines, 2);
	const en = billSummaryMessage({ title: 'Badminton', settlement, lang: 'en' });
	assert.match(en.message, /• โอม sends ฿107\.25 to ฟิก/);
	assert.equal(en.ctaLabel, 'View bill / pay');
	ok('who sends how much to whom, in Thai or English, with names made inert');

	const settled = billSummaryMessage({ title: 'x', settlement: { total: 100, rows: [{ participantId: 'a', displayName: 'A', owesTo: [] }] } });
	assert.match(settled.message, /ทุกคนเคลียร์กันครบแล้ว/);
	const many = billSummaryMessage({ title: 'x', maxLines: 2, settlement: { total: 1, rows: Array.from({ length: 5 }, (_, i) => ({ participantId: `p${i}`, displayName: `P${i}`, owesTo: [{ creditorId: 'p0', outstandingSatang: 100 + i }] })) } });
	assert.match(many.message, /…และอีก 3 รายการ/);
	ok('a settled bill says so, and a long one is cut short with a count');
}

// --- The route, against a real database ------------------------------------
async function main() {
	await core.initCoreSchema();
	const stamp = `${Date.now()}`;
	const owner = (await core.users.loginWithIdentity({ provider: 'discord', providerUid: `__sum_owner_${stamp}__`, username: `o${stamp}`, displayName: 'ฟิก' })).user;
	const other = (await core.users.loginWithIdentity({ provider: 'discord', providerUid: `__sum_other_${stamp}__`, username: `x${stamp}`, displayName: 'โอม' })).user;
	const linked = await core.activities.createActivity({
		ownerUserId: owner.id, title: 'ตีแบด', guildId: '123456789012345678', channelId: '223456789012345678',
		participants: [{ displayName: 'ฟิก', userId: owner.id }, { displayName: 'โอม', userId: other.id }],
	});
	const unlinked = await core.activities.createActivity({ ownerUserId: owner.id, title: 'ไม่มีช่อง', participants: [{ displayName: 'ฟิก', userId: owner.id }] });
	const full = await core.activities.getActivity(linked.id);
	await core.activities.addExpense(linked.id, { label: 'คอร์ท', amountSatang: 40000, paidBy: full.participants[0].id, shareParticipantIds: full.participants.map(p => p.id) });

	const posted = [];
	let deliver = true;
	let whoAmI = owner;
	const app = express();
	app.use(express.json());
	app.use((req, res, next) => {
		req.session = { meguUserId: whoAmI.id, user: { id: 'x' }, allGuilds: [] };
		next();
	});
	app.use('/api/megu', meguApi.router({
		frontendUrl: 'https://megu.test',
		postChannelNotice: async notice => {
			posted.push(notice);
			return { delivered: deliver };
		},
	}));
	const server = await new Promise(resolve => {
		const s = app.listen(0, () => resolve(s));
	});
	const base = `http://127.0.0.1:${server.address().port}/api/megu`;
	const post = async (code, body = {}) => {
		const res = await fetch(`${base}/a/${code}/summary/discord`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
		return { status: res.status, body: await res.json().catch(() => null) };
	};

	try {
		whoAmI = other;
		assert.equal((await post(linked.code)).status, 403);
		assert.equal(posted.length, 0);
		ok('only the organiser can post the bill');

		whoAmI = owner;
		assert.equal((await post(unlinked.code)).body.code, 'summary_no_channel');
		ok('an activity with no Discord channel is refused before anything is sent');

		deliver = false;
		assert.equal((await post(linked.code)).body.code, 'summary_not_delivered');
		deliver = true;
		const first = await post(linked.code, { lang: 'th' });
		assert.equal(first.status, 200, 'a failed delivery does not start the cooldown');
		assert.equal(posted.at(-1).guildId, '123456789012345678');
		assert.equal(posted.at(-1).channelId, '223456789012345678');
		assert.match(posted.at(-1).message, /• โอม โอน ฿200\.00 ให้ ฟิก/);
		assert.equal(posted.at(-1).cta.url, `https://megu.test/a/${linked.code}`);
		ok('the organiser posts one summary to the linked channel, with a link to pay');

		assert.equal((await post(linked.code)).body.code, 'summary_too_soon');
		assert.equal(posted.length, 2, 'the second click sent nothing');
		ok('a second post inside a minute is refused, not sent');

		const page = await fetch(`${base}/a/${linked.code}`).then(res => res.json());
		assert.equal(page.activity.postsToDiscord, true);
		assert.ok(!JSON.stringify(page).includes('223456789012345678'), 'the channel id never reaches the page');
		ok('the page learns only that it can post, not where');
	}
	finally {
		server.close();
		for (const id of [linked.id, unlinked.id]) await core.db.query('DELETE FROM activities WHERE id=$1', [id]).catch(() => undefined);
	}
	console.log(`\n${n} checks passed\n`);
}

main()
	.catch(error => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(() => core.db.close?.());
