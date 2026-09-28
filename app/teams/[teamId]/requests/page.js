import TeamManage from '../../../components/teams/TeamManage';

export default async function TeamRequestsPage({ params }) {
	const { teamId } = await params;
	return <TeamManage key={`${teamId}:requests`} teamId={teamId} section="requests" goalsEnabled={process.env.MEGU_TEAM_GOALS_ENABLED === '1' && process.env.MEGU_PROJECT_TEAMS_ENABLED !== '0'} />;
}
