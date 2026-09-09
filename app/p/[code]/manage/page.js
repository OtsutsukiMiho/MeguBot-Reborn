import ProjectManage from '../../../components/projects/ProjectManage';

export default async function ProjectManagePage({ params }) {
	const { code } = await params;
	return <ProjectManage code={code} />;
}
