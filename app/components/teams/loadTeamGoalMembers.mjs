export async function loadTeamGoalMembers(teamId, read) {
	const members = []; let offset = 0;
	do {
		const page = await read(`/api/megu/teams/${encodeURIComponent(teamId)}/members?limit=100&offset=${offset}`);
		if (!Array.isArray(page.members) || page.members.length > 100 || members.length + page.members.length > 500) throw { status: 503 };
		members.push(...page.members);
		if (page.nextOffset != null && (!Number.isInteger(page.nextOffset) || page.nextOffset <= offset || page.nextOffset >= 500)) throw { status: 503 };
		offset = page.nextOffset;
	} while (offset != null);
	return members;
}
