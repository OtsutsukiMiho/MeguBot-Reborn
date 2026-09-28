import { notFound } from 'next/navigation';
import ServerTeamWorkspace from '../../../../components/teams/ServerTeamWorkspace';

export const metadata = { title: 'Server workspace' };

export default async function ServerWorkspaceSectionPage({ params, searchParams }) {
	const { guildId, section } = await params;
	if (!/^\d{17,20}$/.test(guildId) || !['teams', 'projects'].includes(section) || process.env.MEGU_PROJECT_TEAMS_ENABLED === '0' || process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED === '0') notFound();
	const query = await searchParams;
	const rawOffset = query?.offset;
	const offset = rawOffset == null ? 0 : Number(rawOffset);
	if (Array.isArray(rawOffset) || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) notFound();
	return <ServerTeamWorkspace key={`${guildId}:${section}:${offset}`} guildId={guildId} section={section} offset={offset} />;
}
