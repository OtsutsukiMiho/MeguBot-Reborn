import { redirect } from 'next/navigation';

export default async function TeamManagePage({ params, searchParams }) {
	const { teamId } = await params;
	const { tab } = await searchParams;
	const destination = tab === 'people' || tab === 'requests' ? tab : tab === 'lifecycle' ? 'settings?section=lifecycle' : 'settings';
	redirect(`/teams/${encodeURIComponent(teamId)}/${destination}`);
}
