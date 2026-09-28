import { notFound, redirect } from 'next/navigation';

export const metadata = { title: 'Server teams' };
export default async function ServerTeamsPage({ params, searchParams }) {
	const { guildId } = await params;
	if (!/^\d{17,20}$/.test(guildId) || process.env.MEGU_PROJECT_TEAMS_ENABLED === '0' || process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED === '0') notFound();
	const query = await searchParams;
	redirect(`/teams/server/${guildId}/${query?.view === 'projects' ? 'projects' : 'teams'}`);
}
