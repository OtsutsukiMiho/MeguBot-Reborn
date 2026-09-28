'use client';

import Link from 'next/link';
import { FolderKanban, UsersRound } from 'lucide-react';
import { useCopy } from '../../copy';
import styles from './projectDirectoryNav.module.css';

export default function ProjectDirectoryNav({ current }) {
	const { t } = useCopy();
	return <nav className={styles.nav} aria-label={t.projects.workspaceNavigation}>
		<Link href="/projects" aria-current={current === 'projects' ? 'page' : undefined}><FolderKanban size={17} />{t.projects.title}</Link>
		<Link href="/teams" aria-current={current === 'teams' ? 'page' : undefined}><UsersRound size={17} />{t.teams.title}</Link>
	</nav>;
}
