import TeamDirectory from '../components/teams/TeamDirectory';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Teams' };

export default async function TeamsPage({ searchParams }) {
	const { server } = await searchParams;
	if (typeof server === 'string' && /^\d{17,20}$/.test(server)) redirect(`/teams/server/${server}`);
	return <TeamDirectory />;
}
