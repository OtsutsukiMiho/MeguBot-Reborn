import ProjectWorkspace from '../../components/projects/ProjectWorkspace';

export async function generateMetadata({ params }) {
	const { code } = await params;
	return { title: `Project ${String(code).toUpperCase()}` };
}

export default async function ProjectPage({ params }) {
	const { code } = await params;
	return <ProjectWorkspace code={String(code).toUpperCase()} />;
}
