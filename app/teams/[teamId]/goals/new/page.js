import { notFound } from 'next/navigation';
import CreateTeamGoal from '../../../../components/teams/CreateTeamGoal';

export const metadata = { title: 'New goal' };

export default async function NewGoalPage({ params }) {
	if (process.env.MEGU_TEAM_GOALS_ENABLED !== '1' || process.env.MEGU_PROJECT_TEAMS_ENABLED === '0') notFound();
	const { teamId } = await params;
	return <CreateTeamGoal key={teamId} teamId={teamId} />;
}
