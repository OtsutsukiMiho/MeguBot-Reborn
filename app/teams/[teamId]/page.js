import TeamOverview from '../../components/teams/TeamOverview';

export async function generateMetadata() { return { title: 'Team' }; }

export default async function TeamPage({ params }) {
	const { teamId } = await params;
	return <TeamOverview teamId={teamId} />;
}
