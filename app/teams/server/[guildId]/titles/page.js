import { notFound } from 'next/navigation';
import ServerTitleSettings from '../../../../components/teams/ServerTitleSettings';

export const metadata = { title: 'Discord titles · Megu' };

export default async function ServerTitleSettingsPage({ params }) {
	const { guildId } = await params;
	if (!/^\d{17,20}$/.test(guildId) || process.env.MEGU_PROJECT_TEAMS_ENABLED === '0' || process.env.MEGU_PROJECT_TEAMS_DISCORD_ENABLED === '0') notFound();
	return <ServerTitleSettings key={guildId} guildId={guildId} />;
}
