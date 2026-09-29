'use client';

import MeguMark from './MeguMark';
import styles from '../servers/servers.module.css';

export default function MainContextLoading({ title, description }) {
	return <div className={styles.loadingState} role="status" aria-live="polite"><MeguMark size={72} mood="asleep" /><strong>{title}</strong><span>{description}</span></div>;
}
