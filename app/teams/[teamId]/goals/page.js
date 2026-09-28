import { notFound } from 'next/navigation';
import TeamGoals from '../../../components/teams/TeamGoals';

export const metadata = { title: 'Goals & reviews' };

export default async function TeamGoalsPage({ params, searchParams }) {
	if (process.env.MEGU_TEAM_GOALS_ENABLED !== '1' || process.env.MEGU_PROJECT_TEAMS_ENABLED === '0') notFound();
	const { teamId } = await params;
	const query = await searchParams;
	const offset = typeof query.offset === 'string' && /^\d+$/.test(query.offset) ? Number(query.offset) : 0;
	return <TeamGoals key={`${teamId}:${offset}`} teamId={teamId} offset={Number.isSafeInteger(offset) && offset <= 100000 ? offset : 0} />;
}
