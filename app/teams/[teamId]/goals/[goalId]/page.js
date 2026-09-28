import { notFound } from 'next/navigation';
import TeamGoalDetail from '../../../../components/teams/TeamGoalDetail';

export const metadata = { title: 'Goal' };

export default async function GoalPage({ params, searchParams }) {
	if (process.env.MEGU_TEAM_GOALS_ENABLED !== '1' || process.env.MEGU_PROJECT_TEAMS_ENABLED === '0') notFound();
	const { teamId, goalId } = await params;
	const query = await searchParams;
	const options = {};
	for (const key of ['version', 'updatesOffset', 'responsesOffset']) {
		if (query[key] === undefined) continue;
		if (typeof query[key] !== 'string' || !/^\d+$/.test(query[key])) notFound();
		const value = Number(query[key]);
		if (!Number.isSafeInteger(value) || value < (key === 'version' ? 1 : 0) || value > (key === 'version' ? 2147483647 : 100000)) notFound();
		options[key] = value;
	}
	return <TeamGoalDetail key={`${teamId}:${goalId}:${JSON.stringify(options)}`} teamId={teamId} goalId={goalId} options={options} />;
}
