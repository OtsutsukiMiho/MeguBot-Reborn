'use client';

import { useCopy } from '../../copy';
import WorkspaceSkeleton from '../WorkspaceSkeleton';

export default function TeamRouteLoading() {
	const { t } = useCopy();
	return <WorkspaceSkeleton kind="detail" label={t.teams.workspace.loading} />;
}
