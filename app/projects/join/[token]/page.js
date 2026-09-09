import ProjectJoin from '../../../components/projects/ProjectJoin';

export default async function ProjectJoinPage({ params }) {
	const { token } = await params;
	return <ProjectJoin token={token} />;
}
