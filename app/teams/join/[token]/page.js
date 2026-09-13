import TeamJoin from '../../../components/teams/TeamJoin';

export default async function TeamJoinPage({ params }) {
	const { token } = await params;
	return <TeamJoin token={token} />;
}
