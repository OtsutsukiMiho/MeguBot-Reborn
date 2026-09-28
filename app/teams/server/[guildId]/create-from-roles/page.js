import { notFound } from 'next/navigation';
import CreateTeamsFromRoles from '../../../../components/teams/CreateTeamsFromRoles';

export const metadata = { title: 'Create teams from Discord roles · Megu' };

export default async function CreateRoleTeamsPage({ params }) {
	const { guildId } = await params;
	if (!/^\d{17,20}$/.test(guildId) || process.env.MEGU_PROJECT_TEAMS_ENABLED === '0' || process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED === '0') notFound();
	return <CreateTeamsFromRoles key={guildId} guildId={guildId} />;
}
