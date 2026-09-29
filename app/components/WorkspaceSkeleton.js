'use client';

import { useCopy } from '../copy';
import styles from './workspaceSkeleton.module.css';

export default function WorkspaceSkeleton({ kind = 'list', compact = false, label }) {
	const { t } = useCopy();
	return <div className={`${styles.skeleton} ${compact ? styles.compact : ''}`} role="status" aria-label={label || t.teams.workspace.loading}>
		<span className={styles.srOnly}>{label || t.teams.workspace.loading}</span>
		<div className={styles.shape} aria-hidden="true">
			{kind === 'detail' && <><span className={styles.heading} /><span className={styles.status} /><span className={styles.wide} /></>}
			{kind === 'overview' && <div className={styles.columns}><span className={styles.panel} /><span className={styles.panel} /></div>}
			{kind === 'cards' && <div className={styles.cards}><div className={styles.card}><span className={styles.rowMeta} /><span className={styles.rowTitle} /><span className={styles.rowMeta} /><span className={styles.cardFooter} /></div></div>}
			{!['overview', 'cards'].includes(kind) && <div className={styles.rows}>{[0, 1, 2].map(index => <div className={styles.row} key={index}><span className={styles.rowTitle} /><span className={styles.rowMeta} /></div>)}</div>}
			{kind === 'detail' && <span className={styles.wide} />}
		</div>
	</div>;
}

export function WorkspaceHeaderSkeleton() {
	return <div className={styles.header} aria-hidden="true"><span /><span /></div>;
}
