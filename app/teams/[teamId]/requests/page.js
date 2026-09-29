import { redirect } from 'next/navigation';

export default async function TeamRequestsLegacyPage({ params }) {
	const { teamId } = await params;
	redirect(`/teams/${encodeURIComponent(teamId)}/join-requests`);
}
