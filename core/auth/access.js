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

/**
 * Every roster row that belongs to this caller, not just the first.
 *
 * One person can legitimately hold two rows in one activity, and only since
 * account merging can they hold both knowingly: merging two Megu accounts
 * repoints both sets of `participants.user_id` at the survivor and leaves the
 * rows themselves alone, because combining them would mean adding their
 * `shares` together and rewriting a settled ledger.
 *
 * `matchParticipant` below still answers "am I on this roster", which is all a
 * permission check needs — both rows give the same role. Anything that names a
 * specific row instead, especially anything touching money, has to ask here or
 * it will silently pick whichever row sorts first and deny the person access to
 * their own other payment.
 */
function matchParticipants(actor, participants) {
	if (!actor) return [];
	return (participants || []).filter(p => {
		if (actor.userId && p.userId && p.userId === actor.userId) return true;
		if (actor.discordUid && p.discordUid && p.discordUid === actor.discordUid) return true;
		if (actor.deviceToken && p.deviceToken && p.deviceToken === actor.deviceToken) return true;
		return false;
	});
}

function matchParticipant(actor, participants) {
	return matchParticipants(actor, participants)[0] || null;
}

/**
 * Which of the caller's rows a money action applies to.
 *
 * With one row this is that row. With several it is the one carrying a debt,
 * because that is the only one anybody is trying to act on — and when more than
 * one does, it returns nothing rather than guessing, so the caller can ask.
 */
function selectParticipant(actor, participants, { participantId = null, outstandingFor = null } = {}) {
	const mine = matchParticipants(actor, participants);
	if (mine.length === 0) return { participant: null, choices: [], reason: 'not-on-roster' };

	if (participantId) {
		const chosen = mine.find(p => p.id === participantId);
		return chosen
			? { participant: chosen, choices: mine, reason: null }
			: { participant: null, choices: mine, reason: 'not-your-participant' };
	}
	if (mine.length === 1) return { participant: mine[0], choices: mine, reason: null };

	const owing = typeof outstandingFor === 'function'
		? mine.filter(p => Number(outstandingFor(p)) > 0)
		: [];
	if (owing.length === 1) return { participant: owing[0], choices: mine, reason: null };

	return { participant: null, choices: mine, reason: 'ambiguous-participant' };
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
	matchParticipants,
	selectParticipant,
	can,
	CAPABILITIES,
};
