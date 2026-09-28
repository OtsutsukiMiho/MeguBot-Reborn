import { notFound } from 'next/navigation';
import ServerRoleMappings from '../../../../components/teams/ServerRoleMappings';

export const metadata = { title: 'Discord role links · Megu' };
export default async function ServerRoleMappingsPage({ params }) {
	const { guildId } = await params;
	if (!/^\d{17,20}$/.test(guildId) || process.env.MEGU_PROJECT_TEAMS_ENABLED === '0' || process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED === '0') notFound();
	return <ServerRoleMappings key={guildId} guildId={guildId} />;
}
