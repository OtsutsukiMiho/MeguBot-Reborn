// Automatic rollover only carries a monthly bill that was in use last month.
// Before automatic rollover existed, months only opened when the owner asked,
// so production holds monthly bills nobody has touched for months. None of
// the automatic paths may bring one back as this month's debt.
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
const august = new Date('2026-08-10T12:00:00+07:00');
const september = new Date('2026-09-10T12:00:00+07:00');
const october = new Date('2026-10-20T12:00:00+07:00');

function press({ customId, user }) {
	const log = { replies: [], edits: [], followUps: [] };
	return {
		log, customId, locale: 'th', guildLocale: 'th', guildId: '123456789012345678', channelId: '223456789012345678',
		user: { id: user.id, username: user.name, globalName: user.name, displayAvatarURL: () => null },
		member: { displayName: user.name },
		deferred: false, replied: false,
		isModalSubmit: () => false, isButton: () => true, isStringSelectMenu: () => false, isUserSelectMenu: () => false,
		async reply(value) { this.replied = true; log.replies.push(value); },
		async deferReply() { this.deferred = true; },
		async deferUpdate() { this.deferred = true; },
		async editReply(value) { log.edits.push(value); return { id: 'card1' }; },
		async followUp(value) { log.followUps.push(value); },
		message: { id: 'card1', content: '', editable: true, edit: async () => undefined },
		channel: { messages: { edit: async () => undefined } },
		client: { users: { fetch: async () => ({ send: async () => undefined }) } },
	};
}

async function monthlyBill(owner, lastUsed, { omDiscord = null } = {}) {
	const created = await core.activities.createActivity({
		ownerUserId: owner.id, title: 'Netflix', kind: 'recurring', recurrence: 'monthly', dueDay: 5,
		participants: [{ displayName: 'ฟิก', userId: owner.id }, { displayName: 'โอม', discordUid: omDiscord }],
	});
	const activity = await core.activities.getActivity(created.id);
	await core.activities.ensurePeriod(created.id, lastUsed, {
		expense: { label: 'Netflix', amountSatang: 30000, paidBy: activity.participants[0].id },
	});
	return core.activities.getActivity(created.id);
}

const keys = async id => (await core.activities.getActivity(id)).periods.map(p => p.key).sort();

async function main() {
	await core.initCoreSchema();
	const figDiscord = { id: snowflake(), name: 'ฟิก' };
	const { user: fig } = await core.users.loginWithIdentity({ provider: 'discord', providerUid: figDiscord.id, username: 'fig', displayName: 'ฟิก' });
	const made = [];

	try {
		// Last used in August; it is October now.
		const idle = await monthlyBill(fig, august);
		made.push(idle.id);
		const rolled = await core.activities.ensurePeriod(idle.id, october, { rollover: true });
		assert.equal(rolled.period, null);
		assert.equal(rolled.idle, true);
		assert.deepEqual(await keys(idle.id), ['2026-08']);
		ok('a bill last used two months ago is not carried into this month automatically');

		// Last used in September: October opens as a copy, as before.
		const live = await monthlyBill(fig, september);
		made.push(live.id);
		const next = await core.activities.ensurePeriod(live.id, october, { rollover: true });
		assert.equal(next.created, true);
		const liveNow = await core.activities.getActivity(live.id);
		assert.equal(liveNow.expenses.filter(e => e.periodId === next.period.id).length, 1);
		ok('a bill used last month still rolls into this month with its bill');

		// The hourly reminder sweep and the due-date sweep leave the idle bill alone.
		await core.reminders.due({ now: october });
		await core.reminders.paymentDueNow({ now: october });
		assert.deepEqual(await keys(idle.id), ['2026-08'], 'neither sweep opened October for the idle bill');
		ok('neither the reminder sweep nor the due-date sweep revives an idle bill');

		// The owner asking for a new month on the web still opens it after a gap.
		const asked = await core.activities.ensurePeriod(idle.id, october, { rollover: true, ownerAsked: true });
		assert.equal(asked.created, true);
		assert.deepEqual(await keys(idle.id), ['2026-08', '2026-10']);
		ok('the owner can still open a new month after a gap');

		// From Discord, an idle bill says so instead of failing.
		const omDiscord = { id: snowflake(), name: 'โอม' };
		const idleTwo = await monthlyBill(fig, august, { omDiscord: omDiscord.id });
		made.push(idleTwo.id);
		const change = core.activities.changeSubscription(idleTwo.id, { amountSatang: 40000 }, { now: october });
		await assert.rejects(change, error => error.code === 'period_missing');
		ok('a change on an idle bill is refused with a code, not applied to an old month');

		// And a cancelled one says it has ended.
		await core.db.query("UPDATE activities SET plan_state = 'cancelled' WHERE id = $1", [idleTwo.id]);
		const call = press({ customId: `evt:join:${idleTwo.code}`, user: { id: snowflake(), name: 'มิว' } });
		await event.handleComponent(call, { core });
		const said = [...call.log.edits, ...call.log.replies, ...call.log.followUps].map(v => (typeof v === 'string' ? v : v.content)).join('\n');
		assert.match(said, /ถูกยกเลิก/);
		ok('joining a cancelled bill from Discord is told it has ended');
	}
	finally {
		for (const id of made) await core.db.query('DELETE FROM activities WHERE id = $1', [id]).catch(() => undefined);
	}
	console.log(`\n${n} checks passed`);
	await core.db.close?.();
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
