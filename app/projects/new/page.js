import NewProject from '../../components/projects/NewProject';

export const metadata = { title: 'New project' };
export default async function NewProjectPage({ searchParams }) {
	const { team } = await searchParams;
	return <NewProject teamId={typeof team === 'string' ? team : ''} />;
}
