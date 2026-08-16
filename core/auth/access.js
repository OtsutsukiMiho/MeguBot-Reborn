// Two permission domains that must never leak into each other:
//
//   server scope   — Discord roles decide who configures the bot in a guild
//   activity scope — Megu's own rows decide who sees money between friends
//
// A guild administrator has no standing inside an activity they are not part
// of. That separation is the point of this file.

const DISCORD_ADMINISTRATOR = 1n << 3n;
const DISCORD_MANAGE_GUILD = 1n << 5n;

function hasGuildManagePermission(permissions) {
	let bits;
	try {
		bits = BigInt(permissions ?? 0);
	}
	catch {
		return false;
	}
	return (bits & DISCORD_ADMINISTRATOR) !== 0n || (bits & DISCORD_MANAGE_GUILD) !== 0n;
}

/**
 * Intersect the guilds a user belongs to with the guilds the bot is in.
 * Pure function: the adapter fetches both lists, core only does the maths.
 *
 * `canManage` false is a normal outcome — an ordinary member still sees the
 * server in their list, just without the settings pages.
 */
function visibleServers(userGuilds, botGuildIds) {
	const inBot = botGuildIds instanceof Set ? botGuildIds : new Set(botGuildIds || []);

	return (userGuilds || [])
		.filter(g => inBot.has(g.id))
		.map(g => ({
			id: g.id,
			name: g.name,
			icon: g.icon || null,
			canManage: hasGuildManagePermission(g.permissions),
		}));
}

/**
 * Resolve who the caller is inside one activity.
 *
 * actor: { userId?, discordUid?, deviceToken? }
 * returns 'owner' | 'participant' | 'none'
 */
function activityRole(actor, activity) {
	if (!actor || !activity) return 'none';

	if (actor.userId && activity.ownerUserId === actor.userId) return 'owner';

	const me = matchParticipant(actor, activity.participants || []);
	return me ? 'participant' : 'none';
}

function matchParticipant(actor, participants) {
	if (!actor) return null;
	return participants.find(p => {
		if (actor.userId && p.userId && p.userId === actor.userId) return true;
		if (actor.discordUid && p.discordUid && p.discordUid === actor.discordUid) return true;
		if (actor.deviceToken && p.deviceToken && p.deviceToken === actor.deviceToken) return true;
		return false;
	}) || null;
}

const CAPABILITIES = {
	owner: {
		viewActivity: true,
		viewAmounts: true,
		editActivity: true,
		manageParticipants: true,
		recordExpense: true,
		confirmPayment: true,
		closeActivity: true,
	},
	participant: {
		viewActivity: true,
		viewAmounts: true,
		editActivity: false,
		manageParticipants: false,
		recordExpense: false,
		// Declaring yourself paid is never enough. Only the owner, or a
		// verified transaction, moves a payment to confirmed.
		confirmPayment: false,
		closeActivity: false,
	},
	none: {
		viewActivity: true,
		viewAmounts: false,
		editActivity: false,
		manageParticipants: false,
		recordExpense: false,
		confirmPayment: false,
		closeActivity: false,
	},
};

function can(role, capability) {
	const set = CAPABILITIES[role] || CAPABILITIES.none;
	return set[capability] === true;
}

module.exports = {
	hasGuildManagePermission,
	visibleServers,
	activityRole,
	matchParticipant,
	can,
	CAPABILITIES,
};
