import TeamOverview from '../../components/teams/TeamOverview';

export async function generateMetadata() { return { title: 'Team' }; }

export default async function TeamPage({ params }) {
	const { teamId } = await params;
	return <TeamOverview key={`${teamId}:overview`} teamId={teamId} goalsEnabled={process.env.MEGU_TEAM_GOALS_ENABLED === '1' && process.env.MEGU_PROJECT_TEAMS_ENABLED !== '0'} />;
}
