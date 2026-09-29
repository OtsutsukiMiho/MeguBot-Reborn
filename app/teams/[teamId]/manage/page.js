import { redirect } from 'next/navigation';

export default async function TeamManagePage({ params, searchParams }) {
	const { teamId } = await params;
	const { tab } = await searchParams;
	const destination = tab === 'people' ? tab : tab === 'requests' ? 'join-requests' : tab === 'lifecycle' ? 'settings?section=lifecycle' : 'settings';
	redirect(`/teams/${encodeURIComponent(teamId)}/${destination}`);
}
