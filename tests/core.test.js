const assert = require('node:assert');
const money = require('../core/money.js');
const access = require('../core/auth/access.js');
const tokens = require('../core/auth/tokens.js');
const voice = require('../core/megu/voice.js');
const activities = require('../core/activities.js');
const ids = require('../core/ids.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

console.log('\nmoney');
assert.strictEqual(money.toSatang(66.5), 6650);
assert.strictEqual(money.formatTHB(6650), '฿66.50');
assert.strictEqual(money.formatTHB(40000), '฿400.00');
ok('satang conversion + formatting');

assert.deepStrictEqual(money.splitEvenly(40000, 4), [10000, 10000, 10000, 10000]);
ok('400 / 4 = 100 each');

const three = money.splitEvenly(40000, 3);
assert.strictEqual(three.reduce((a, b) => a + b, 0), 40000);
assert.deepStrictEqual(three, [13334, 13333, 13333]);
ok('400 / 3 sums back to exactly 400');

const sub = money.splitEvenly(39900, 6);
assert.strictEqual(sub.reduce((a, b) => a + b, 0), 39900);
assert.strictEqual(sub[0], 6650);
ok('YouTube Premium 399 / 6 = 66.50 each');

const keyed = money.splitEvenlyBy(10000, ['par_c', 'par_a', 'par_b']);
const keyed2 = money.splitEvenlyBy(10000, ['par_b', 'par_c', 'par_a']);
assert.deepStrictEqual(keyed, keyed2);
assert.strictEqual(Object.values(keyed).reduce((a, b) => a + b, 0), 10000);
ok('keyed split is order-independent');

const dupes = money.splitEvenlyBy(40000, ['par_a', 'par_b', 'par_c', 'par_c']);
assert.strictEqual(Object.keys(dupes).length, 3);
assert.strictEqual(Object.values(dupes).reduce((a, b) => a + b, 0), 40000);
assert.throws(() => money.splitEvenlyBy(100, []));
ok('a duplicated id does not quietly lose money from the total');

console.log('\nplan axis');
assert.ok(activities.canTransition('open', 'confirmed'));
assert.ok(activities.canTransition('open', 'done'), 'some things just happen without being confirmed first');
assert.ok(activities.canTransition('confirmed', 'cancelled'));
assert.ok(!activities.canTransition('cancelled', 'done'));
ok('plan transitions allow real paths and block impossible ones');

assert.ok(!Object.keys(activities.PLAN_TRANSITIONS).includes('settling'), 'money is not a plan state');
assert.deepStrictEqual(activities.MONEY_STATES, ['none', 'open', 'settled']);
ok('money lives on its own axis, not in the plan pipeline');

console.log('\naccess: server scope');
assert.ok(access.hasGuildManagePermission('8'));
assert.ok(access.hasGuildManagePermission('32'));
assert.ok(!access.hasGuildManagePermission('0'));
assert.ok(!access.hasGuildManagePermission(undefined));
ok('ADMINISTRATOR and MANAGE_GUILD detected, plain member is not');

const servers = access.visibleServers(
	[
		{ id: '1', name: 'Megu HQ', permissions: '8' },
		{ id: '2', name: 'Random server', permissions: '0' },
		{ id: '3', name: 'Bot not here', permissions: '8' },
	],
	['1', '2'],
);
assert.strictEqual(servers.length, 2);
assert.strictEqual(servers[0].canManage, true);
assert.strictEqual(servers[1].canManage, false);
ok('only guilds where the bot lives are visible; canManage follows roles');

console.log('\naccess: activity scope');
const activity = {
	ownerUserId: 'usr_fig',
	participants: [
		{ id: 'par_fig', userId: 'usr_fig', displayName: 'ฟิก' },
		{ id: 'par_ohm', discordUid: '111', displayName: 'โอม' },
		{ id: 'par_nut', deviceToken: 'tok_nut', displayName: 'นัท' },
	],
};

assert.strictEqual(access.activityRole({ userId: 'usr_fig' }, activity), 'owner');
assert.strictEqual(access.activityRole({ discordUid: '111' }, activity), 'participant');
assert.strictEqual(access.activityRole({ deviceToken: 'tok_nut' }, activity), 'participant');
assert.strictEqual(access.activityRole({ userId: 'usr_stranger' }, activity), 'none');
ok('owner / participant / stranger resolve by any identity kind');

assert.ok(access.can('owner', 'confirmPayment'));
assert.ok(!access.can('participant', 'confirmPayment'));
assert.ok(access.can('participant', 'viewAmounts'));
assert.ok(!access.can('none', 'viewAmounts'));
ok('a participant cannot mark themselves paid');

const serverAdmin = { userId: 'usr_mod', discordUid: '999' };
assert.strictEqual(access.activityRole(serverAdmin, activity), 'none');
assert.ok(!access.can(access.activityRole(serverAdmin, activity), 'viewAmounts'));
ok('a guild admin outside the activity sees no amounts');

console.log('\ntokens');
const t = tokens.issueDeviceToken();
assert.ok(tokens.verifyDeviceToken(t));
assert.strictEqual(tokens.verifyDeviceToken(t + 'x'), null);
assert.strictEqual(tokens.verifyDeviceToken('garbage'), null);
assert.strictEqual(tokens.verifyDeviceToken(null), null);
ok('device tokens verify, tampered ones do not');

console.log('\nids');
const code = ids.newActivityCode();
assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{7}$/);
assert.ok(!/[01OIL]/.test(code));
ok(`public code has no ambiguous characters (${code})`);

console.log('\nvoice');
const line = voice.say('nudgeUnpaid', { name: 'นัท', amount: 10000, days: 6 }, { seed: 'pay_1' });
assert.ok(line.includes('นัท') && line.includes('฿100.00'));
assert.strictEqual(voice.say('nudgeUnpaid', { name: 'นัท', amount: 10000 }, { seed: 'pay_1' }), voice.say('nudgeUnpaid', { name: 'นัท', amount: 10000 }, { seed: 'pay_1' }));
ok(`same seed gives the same line — "${line}"`);

assert.throws(() => voice.say('nonexistentSituation', {}));
ok('missing lines fail loudly instead of rendering undefined');

console.log('\nsettlement');
const settled = activities.settlement({
	participants: [
		{ id: 'par_fig', displayName: 'ฟิก' },
		{ id: 'par_ohm', displayName: 'โอม' },
		{ id: 'par_nut', displayName: 'นัท' },
		{ id: 'par_a', displayName: 'A' },
	],
	expenses: [{ id: 'exp_1', label: 'ค่าคอร์ท', amountSatang: 40000, paidBy: 'par_fig' }],
	shares: [
		{ expenseId: 'exp_1', participantId: 'par_fig', amountSatang: 10000 },
		{ expenseId: 'exp_1', participantId: 'par_ohm', amountSatang: 10000 },
		{ expenseId: 'exp_1', participantId: 'par_nut', amountSatang: 10000 },
		{ expenseId: 'exp_1', participantId: 'par_a', amountSatang: 10000 },
	],
	payments: [
		{ participantId: 'par_ohm', amountSatang: 10000, status: 'confirmed' },
		{ participantId: 'par_a', amountSatang: 10000, status: 'pending' },
	],
});

assert.strictEqual(settled.state, 'open');
const by = Object.fromEntries(settled.rows.map(r => [r.participantId, r]));
assert.strictEqual(by.par_fig.net, -30000);
assert.strictEqual(by.par_ohm.outstanding, 0);
assert.strictEqual(by.par_nut.outstanding, 10000);
assert.strictEqual(by.par_a.outstanding, 10000);
assert.strictEqual(settled.total, 40000);
assert.strictEqual(settled.fullySettled, false);
ok('ฟิก is owed ฿300, โอม is clear, นัท and A still owe ฿100 each');

assert.deepStrictEqual(settled.unpaid.map(r => r.displayName).sort(), ['A', 'นัท']);
ok('a pending claim does not count as paid');

console.log(`\n${n} checks passed\n`);
