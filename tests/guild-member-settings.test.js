// Tests for member personal settings, guild filtering, and permission boundaries.

const assert = require('node:assert');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

console.log('\nreminder time parser tests');

function parseReminderTimeInput(timeStr) {
	if (!timeStr || typeof timeStr !== 'string') return null;
	timeStr = timeStr.trim().toLowerCase();

	const relativeRegex = /^(\d+)([smhd])$/;
	const relativeMatch = timeStr.match(relativeRegex);
	if (relativeMatch) {
		const value = parseInt(relativeMatch[1], 10);
		const unit = relativeMatch[2];
		let ms = 0;
		switch (unit) {
		case 's': ms = value * 1000; break;
		case 'm': ms = value * 60000; break;
		case 'h': ms = value * 3600000; break;
		case 'd': ms = value * 86400000; break;
		}
		return {
			targetTime: Date.now() + ms,
			recurring: false,
		};
	}

	const dailyRegex = /^(\d{1,2})[:.](\d{2})(?:\s*everyday)?$/;
	const dailyMatch = timeStr.match(dailyRegex);
	if (dailyMatch) {
		const hours = parseInt(dailyMatch[1], 10);
		const minutes = parseInt(dailyMatch[2], 10);

		if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
			return null;
		}

		const nowUTC = Date.now();
		const offsetMs = 7 * 60 * 60 * 1000;
		const nowICT = new Date(nowUTC + offsetMs);

		const targetICT = new Date(nowUTC + offsetMs);
		targetICT.setUTCHours(hours, minutes, 0, 0);

		if (targetICT.getTime() <= nowICT.getTime()) {
			targetICT.setUTCDate(targetICT.getUTCDate() + 1);
		}

		return {
			targetTime: targetICT.getTime() - offsetMs,
			recurring: true,
		};
	}

	return null;
}

{
	const now = Date.now();
	const parsed10m = parseReminderTimeInput('10m');
	assert.ok(parsed10m);
	assert.strictEqual(parsed10m.recurring, false);
	assert.ok(parsed10m.targetTime >= now + 590000 && parsed10m.targetTime <= now + 610000);
	ok('relative minutes (10m) parsed accurately');

	const parsed2h = parseReminderTimeInput('2h');
	assert.ok(parsed2h);
	assert.strictEqual(parsed2h.recurring, false);
	assert.ok(parsed2h.targetTime >= now + 7190000 && parsed2h.targetTime <= now + 7210000);
	ok('relative hours (2h) parsed accurately');

	const parsed1d = parseReminderTimeInput('1d');
	assert.ok(parsed1d);
	assert.strictEqual(parsed1d.recurring, false);
	ok('relative days (1d) parsed accurately');

	const parsedDaily = parseReminderTimeInput('18:00 everyday');
	assert.ok(parsedDaily);
	assert.strictEqual(parsedDaily.recurring, true);
	assert.ok(parsedDaily.targetTime > now);
	ok('daily recurring (18:00 everyday) parsed accurately');

	const parsedDotTime = parseReminderTimeInput('09.30');
	assert.ok(parsedDotTime);
	assert.strictEqual(parsedDotTime.recurring, true);
	ok('daily recurring with dot notation (09.30) parsed accurately');

	assert.strictEqual(parseReminderTimeInput(''), null);
	assert.strictEqual(parseReminderTimeInput('invalid text'), null);
	assert.strictEqual(parseReminderTimeInput('25:00 everyday'), null);
	assert.strictEqual(parseReminderTimeInput('12:60'), null);
	ok('invalid time formats rejected with null');
}

console.log('\nguild filtering logic tests');

{
	// Simulate the filtering logic from GET /api/guilds
	function filterUserGuilds({ adminGuilds, allGuilds, presenceMap, botOnline }) {
		const adminGuildMap = new Map((adminGuilds || []).map(g => [String(g.id), g]));
		const allUserGuilds = allGuilds || adminGuilds || [];
		const clientId = '1234567890';
		const seenIds = new Set();
		const enrichedGuilds = [];

		for (const g of allUserGuilds) {
			const gid = String(g.id);
			if (seenIds.has(gid)) continue;
			seenIds.add(gid);

			const adminGuild = adminGuildMap.get(gid);
			const isAdmin = Boolean(adminGuild);
			const isBotInGuild = botOnline ? !!presenceMap[gid] : null;

			// Non-admin servers: only include if the bot is present in the server
			if (!isAdmin && isBotInGuild === false) {
				continue;
			}

			const isOwner = Boolean((adminGuild && adminGuild.owner) || g.owner);
			let role = 'member';
			if (isOwner) role = 'owner';
			else if (isAdmin) role = 'admin';

			enrichedGuilds.push({
				...g,
				...(adminGuild || {}),
				owner: isOwner,
				isAdmin,
				role,
				isBotInGuild,
			});
		}

		for (const [gid, ag] of adminGuildMap) {
			if (seenIds.has(gid)) continue;
			seenIds.add(gid);

			const isBotInGuild = botOnline ? !!presenceMap[gid] : null;

			enrichedGuilds.push({
				...ag,
				isAdmin: true,
				role: ag.owner ? 'owner' : 'admin',
				isBotInGuild,
			});
		}

		return enrichedGuilds;
	}

	const adminGuilds = [
		{ id: '1001', name: 'Admin Server With Bot', owner: true },
		{ id: '1002', name: 'Admin Server Without Bot', owner: false },
	];

	const allGuilds = [
		{ id: '1001', name: 'Admin Server With Bot', owner: true },
		{ id: '1002', name: 'Admin Server Without Bot', owner: false },
		{ id: '2001', name: 'Member Server With Bot', owner: false },
		{ id: '2002', name: 'Member Server Without Bot', owner: false },
	];

	const presenceMap = {
		'1001': true,
		'1002': false,
		'2001': true,
		'2002': false,
	};

	const result = filterUserGuilds({ adminGuilds, allGuilds, presenceMap, botOnline: true });

	assert.strictEqual(result.length, 3, 'result contains 3 servers (omits member server where bot is absent)');

	const g1001 = result.find(g => g.id === '1001');
	assert.ok(g1001);
	assert.strictEqual(g1001.isAdmin, true);
	assert.strictEqual(g1001.role, 'owner');
	assert.strictEqual(g1001.isBotInGuild, true);
	ok('admin server with bot has role owner and isBotInGuild true');

	const g1002 = result.find(g => g.id === '1002');
	assert.ok(g1002);
	assert.strictEqual(g1002.isAdmin, true);
	assert.strictEqual(g1002.role, 'admin');
	assert.strictEqual(g1002.isBotInGuild, false);
	ok('admin server without bot is preserved so admin can invite');

	const g2001 = result.find(g => g.id === '2001');
	assert.ok(g2001);
	assert.strictEqual(g2001.isAdmin, false);
	assert.strictEqual(g2001.role, 'member');
	assert.strictEqual(g2001.isBotInGuild, true);
	ok('member server with bot is included with role member');

	const g2002 = result.find(g => g.id === '2002');
	assert.strictEqual(g2002, undefined);
	ok('member server without bot is omitted to prevent clutter');
}

console.log('\naccess control and scoping tests');

{
	// Test permission checker logic
	function checkGuildAccess(session, guildId) {
		if (!session || !session.user) return { status: 401, error: 'Unauthorized' };
		if (typeof guildId !== 'string' || !/^\d{17,20}$/.test(guildId)) return { status: 400, error: 'Invalid ID' };

		const isAdmin = Boolean(session.adminGuilds && session.adminGuilds.some(g => String(g.id) === String(guildId)));
		const isMember = Boolean(session.allGuilds && session.allGuilds.some(g => String(g.id) === String(guildId)));

		if (!isAdmin && !isMember) return { status: 403, error: 'Forbidden' };
		return { status: 200, access: { isAdmin, isMember } };
	}

	const session = {
		user: { id: '999999999999999999' },
		adminGuilds: [{ id: '111111111111111111' }],
		allGuilds: [{ id: '111111111111111111' }, { id: '222222222222222222' }],
	};

	assert.strictEqual(checkGuildAccess(null, '111111111111111111').status, 401);
	ok('missing session gives 401');

	assert.strictEqual(checkGuildAccess(session, 'invalid_id').status, 400);
	ok('non-snowflake guild ID gives 400');

	const adminCheck = checkGuildAccess(session, '111111111111111111');
	assert.strictEqual(adminCheck.status, 200);
	assert.strictEqual(adminCheck.access.isAdmin, true);
	assert.strictEqual(adminCheck.access.isMember, true);
	ok('admin guild yields isAdmin true');

	const memberCheck = checkGuildAccess(session, '222222222222222222');
	assert.strictEqual(memberCheck.status, 200);
	assert.strictEqual(memberCheck.access.isAdmin, false);
	assert.strictEqual(memberCheck.access.isMember, true);
	ok('member guild yields isAdmin false and isMember true');

	const outsiderCheck = checkGuildAccess(session, '333333333333333333');
	assert.strictEqual(outsiderCheck.status, 403);
	ok('outsider guild yields 403 Forbidden');
}

console.log('\nreminder deletion ownership test');

{
	function canDeleteReminder(userId, guildId, reminder) {
		if (!reminder) return { status: 404 };
		if (String(reminder.user_id) !== String(userId) || String(reminder.guild_id) !== String(guildId)) {
			return { status: 403 };
		}
		return { status: 200 };
	}

	const myReminder = { id: 'rem-1', user_id: 'user-100', guild_id: 'guild-500' };
	assert.strictEqual(canDeleteReminder('user-100', 'guild-500', myReminder).status, 200);
	ok('user can delete their own reminder in their guild');

	assert.strictEqual(canDeleteReminder('user-999', 'guild-500', myReminder).status, 403);
	ok('other users are forbidden from deleting this reminder');

	assert.strictEqual(canDeleteReminder('user-100', 'guild-999', myReminder).status, 403);
	ok('cannot delete reminder from a different guild scope');
}

console.log(`\nAll ${n} checks passed!`);
