'use client';

import { useEffect, useState } from 'react';
import { useCopy } from '../../copy';
import styles from '../../teams/teams.module.css';

export async function loadMemberTitlePages(teamId, userIds, read, onPage) {
	const ids = [...new Set(userIds)];
	if (ids.length > 500) throw new Error('member_title_limit');
	for (let offset = 0; offset < ids.length; offset += 20) {
		const pageIds = ids.slice(offset, offset + 20);
		const query = new URLSearchParams();
		for (const id of pageIds) query.append('userId', id);
		const body = await read(`/api/megu/teams/${encodeURIComponent(teamId)}/member-titles?${query}`);
		if (!Array.isArray(body.members) || body.members.length !== pageIds.length || new Set(body.members.map(member => member.userId)).size !== pageIds.length || body.members.some(member => !pageIds.includes(member.userId) || !Array.isArray(member.titles))) throw new Error('member_titles_invalid');
		onPage(body.members);
	}
}

export function useTeamMemberTitles(teamId, members, enabled) {
	const [state, setState] = useState({ byUser: {}, loading: false, unavailable: false });
	const [attempt, setAttempt] = useState(0);
	const ids = JSON.stringify(members.map(member => member.userId));
	const scope = `${teamId}:${enabled}:${ids}`;
	useEffect(() => {
		const controller = new AbortController();
		setState({ scope, byUser: {}, loading: Boolean(enabled), unavailable: false });
		if (!enabled) return () => controller.abort();
		const read = async url => {
			const response = await fetch(url, { signal: controller.signal });
			if (!response.ok) throw new Error('member_titles_unavailable');
			return response.json();
		};
		loadMemberTitlePages(teamId, JSON.parse(ids), read, page => {
			if (!controller.signal.aborted) setState(current => ({ ...current, byUser: { ...current.byUser, ...Object.fromEntries(page.map(member => [member.userId, member.titles])) }, unavailable: current.unavailable || page.some(member => member.unavailable) }));
		}).then(() => { if (!controller.signal.aborted) setState(current => ({ ...current, loading: false })); })
			.catch(() => { if (!controller.signal.aborted) setState({ scope, byUser: {}, loading: false, unavailable: true }); });
		return () => controller.abort();
	}, [teamId, ids, enabled, attempt, scope]);
	return { ...(state.scope === scope ? state : { byUser: {}, loading: Boolean(enabled), unavailable: false }), reload: () => setAttempt(value => value + 1) };
}

export default function MemberTitleBadges({ titles }) {
	const { t } = useCopy();
	if (!titles?.length) return null;
	return <ul className={styles.titleBadges} aria-label={t.serverTitles.badgesLabel}>{titles.map(title => <li key={title.roleId} className={styles.titleBadge}>{title.name}</li>)}</ul>;
}
