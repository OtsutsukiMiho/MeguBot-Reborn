import TeamManage from '../../../components/teams/TeamManage';

export default async function TeamManagePage({ params }) {
	const { teamId } = await params;
	return <TeamManage teamId={teamId} />;
}
