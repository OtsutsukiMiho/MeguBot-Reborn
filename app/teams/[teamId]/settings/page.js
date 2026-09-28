import TeamManage from '../../../components/teams/TeamManage';

export default async function TeamSettingsPage({ params, searchParams }) {
	const { teamId } = await params;
	const { section: requested } = await searchParams;
	const section = requested === 'lifecycle' ? 'lifecycle' : 'general';
	return <TeamManage key={`${teamId}:${section}`} teamId={teamId} section={section} goalsEnabled={process.env.MEGU_TEAM_GOALS_ENABLED === '1' && process.env.MEGU_PROJECT_TEAMS_ENABLED !== '0'} />;
}
