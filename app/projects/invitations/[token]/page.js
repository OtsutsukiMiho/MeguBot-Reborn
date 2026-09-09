import ProjectInvitation from '../../../components/projects/ProjectInvitation';

export default async function ProjectInvitationPage({ params }) {
	const { token } = await params;
	return <ProjectInvitation token={token} />;
}
