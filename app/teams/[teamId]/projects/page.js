import TeamOverview from '../../../components/teams/TeamOverview';

export const metadata = { title: 'Team projects' };

export default async function TeamProjectsPage({ params, searchParams }) {
	const { teamId } = await params;
	const query = await searchParams;
	const cursor = typeof query.cursor === 'string' && query.cursor.length <= 500 ? query.cursor : '';
	return <TeamOverview key={`${teamId}:projects:${cursor}`} teamId={teamId} section="projects" cursor={cursor}
		goalsEnabled={process.env.MEGU_TEAM_GOALS_ENABLED === '1' && process.env.MEGU_PROJECT_TEAMS_ENABLED !== '0'} />;
}
