import TeamWorkspaceShell from '../../components/teams/TeamWorkspaceShell';

export default async function TeamLayout({ children, params }) {
	const { teamId } = await params;
	return <TeamWorkspaceShell teamId={teamId} goalsEnabled={process.env.MEGU_TEAM_GOALS_ENABLED === '1' && process.env.MEGU_PROJECT_TEAMS_ENABLED !== '0'}>{children}</TeamWorkspaceShell>;
}
