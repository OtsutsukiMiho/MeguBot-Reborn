import styles from '../../teams/teams.module.css';

export default function TeamMark({ name, color = 'indigo', size = 'default' }) {
	const initials = String(name || 'Team').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
	return <span className={`${styles.teamMark} ${styles[`teamMark_${color}`] || ''} ${size === 'large' ? styles.teamMarkLarge : ''}`} aria-hidden="true">{initials}</span>;
}
