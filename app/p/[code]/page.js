import ProjectWorkspace from '../../components/projects/ProjectWorkspace';

export async function generateMetadata({ params }) {
	await params;
	return { title: 'Projects' };
}

export default async function ProjectPage({ params }) {
	const { code } = await params;
	return <ProjectWorkspace code={String(code).toUpperCase()} />;
}
