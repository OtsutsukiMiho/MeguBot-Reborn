require('dotenv').config();
const core = require('../core/index.js');

const TITLE = 'Discord Payment E2E';

async function main() {
	const [discordUid, guildId, channelId] = process.argv.slice(2);
	if (!/^\d{16,22}$/.test(discordUid || '')) throw new Error('discord user id is required');
	if (!/^\d{16,22}$/.test(guildId || '')) throw new Error('guild id is required');
	if (!/^\d{16,22}$/.test(channelId || '')) throw new Error('channel id is required');

	await core.initCoreSchema();
	// Reusing a real Discord identity must not replace the profile that OAuth
	// already stored with fixture labels. The fixture only needs the snowflake;
	// names remain the user's actual names when that identity already exists.
	const existingIdentity = await core.db.query(
		`SELECT i.username, u.display_name, u.avatar_url
		 FROM identities i
		 JOIN users u ON u.id = i.user_id
		 WHERE i.provider = 'discord' AND i.provider_uid = $1`,
		[discordUid],
	);
	const existingProfile = existingIdentity.rows[0];
	const { user } = await core.users.loginWithIdentity({
		provider: 'discord',
		providerUid: discordUid,
		username: existingProfile?.username || 'discord-payment-e2e',
		displayName: existingProfile?.display_name || 'Discord payment tester',
		avatarUrl: existingProfile?.avatar_url || null,
	});

	// Idempotent and narrowly scoped: the title is reserved for this fixture, so
	// rerunning it replaces stale copies left under an earlier test identity in
	// the selected guild, never activities with another title or in another
	// guild. Scoping by owner here left duplicate candidates after OAuth proved
	// the tester used a different Discord account than the initial seed.
	await core.db.query(
		'DELETE FROM activities WHERE guild_id = $1 AND title = $2',
		[guildId, TITLE],
	);
	await core.users.setPromptPay(user.id, {
		promptpayId: '081-234-5678',
		promptpayName: 'MR B CREDITOR',
	});

	const activity = await core.activities.createActivity({
		ownerUserId: user.id,
		title: TITLE,
		kind: 'recurring',
		recurrence: 'monthly',
		dueDay: 5,
		guildId,
		channelId,
		participants: [
			{ displayName: 'Discord payment owner', userId: user.id },
			{ displayName: 'Discord payment payer', discordUid },
		],
	});
	const full = await core.activities.getActivity(activity.id);
	const owner = full.participants.find(participant => participant.userId === user.id);
	for (const date of ['2026-04-05', '2026-05-05', '2026-06-05', '2026-07-05', '2026-08-05']) {
		const ensured = await core.activities.ensurePeriod(activity.id, new Date(`${date}T12:00:00+07:00`));
		await core.activities.addExpense(activity.id, {
			label: 'Discord monthly test',
			amountSatang: 40000,
			paidBy: owner.id,
			periodId: ensured.period.id,
		});
	}

	console.log(JSON.stringify({
		code: activity.code,
		url: `/a/${activity.code}`,
		title: TITLE,
		discordUid,
		guildId,
		channelId,
		amountSatang: 100000,
	}));
}

main()
	.then(() => core.db.close())
	.catch(async (error) => {
		console.error(error.message);
		await core.db.close().catch(() => undefined);
		process.exitCode = 1;
	});
