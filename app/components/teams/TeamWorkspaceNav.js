'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FolderKanban, Home, Link2, Settings2, Target, Users } from 'lucide-react';
import CustomSelect from '../CustomSelect';
import { requestDraftNavigation } from '../useDraftGuard';
import { useCopy } from '../../copy';
import styles from '../../teams/teams.module.css';

export default function TeamWorkspaceNav({ teamId, section, goalsEnabled = false }) {
	const { t } = useCopy();
	const router = useRouter();
	const c = t.teams.workspace;
	const base = `/teams/${encodeURIComponent(teamId)}`;
	const items = [['overview',base,Home],['projects',`${base}/projects`,FolderKanban],['people',`${base}/people`,Users],
		['requests',`${base}/requests`,Link2],...(goalsEnabled ? [['goals',`${base}/goals`,Target]] : []),['settings',`${base}/settings`,Settings2]];
	return <>
		<nav className={`${styles.sideNav} ${styles.routeNav}`} aria-label={c.label}>{items.map(([key,href,Icon]) =>
			<Link key={key} href={href} aria-current={section === key ? 'page' : undefined}><Icon size={17} aria-hidden="true" />{c[key]}</Link>)}</nav>
		<div className={styles.routeSelector}><CustomSelect ariaLabel={c.label} value={section} searchable={false}
			onChange={value => { const item=items.find(([key]) => key===value); if(item && value !== section && requestDraftNavigation(() => router.push(item[1]))) router.push(item[1]); }}
			options={items.map(([value]) => ({value,label:c[value]}))} /></div>
	</>;
}
