'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useCopy } from '../../copy';
import { requestDraftNavigation } from '../useDraftGuard';
import TeamRoleMapping from './TeamRoleMapping';
import styles from '../../teams/teams.module.css';

export default function ServerRoleMappings({ guildId }) {
	const { t } = useCopy(), c = t.roleMappings;
	const [input, setInput] = useState(''), [teamId, setTeamId] = useState(''), [error, setError] = useState('');
	const readError = problem => c.errors[problem?.code] || t.teams.errors[problem?.code] || t.teams.errors.failed;
	const lookup = event => {
		event.preventDefault();
		let id = input.trim();
		if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
			try { const url = new URL(id, window.location.origin); id = url.origin === window.location.origin ? /^\/teams\/([A-Za-z0-9_-]+)(?:\/.*)?$/.exec(url.pathname)?.[1] || '' : ''; }
			catch { id = ''; }
		}
		if (!id || id.length > 200) { setError(c.invalidTeamLink); return; }
		if (id === teamId) return;
		const open = () => { setError(''); setTeamId(id); };
		if (requestDraftNavigation(open)) open();
	};
	return <main className={styles.shell}>
		<Link className={styles.back} href={`/teams/server/${encodeURIComponent(guildId)}/teams`}><ArrowLeft size={16} aria-hidden="true" />{t.serverTitles.back}</Link>
		<header className={styles.header}><div><h1>{c.manageExisting}</h1><p>{c.managementHint}</p></div></header>
		<form className={styles.form} onSubmit={lookup}>
			<label className={`${styles.field} ${styles.wide}`}><span>{c.teamLink}</span><input required maxLength={500} value={input} onChange={event => setInput(event.target.value)} /></label>
			<div className={`${styles.actions} ${styles.wide}`}><button type="submit" className="btn btn-secondary">{c.openConfiguration}</button></div>
			{error && <p className={`${styles.error} ${styles.wide}`} role="alert">{error}</p>}
		</form>
		{teamId && <TeamRoleMapping key={teamId} serverManagement team={{id:teamId,discordGuild:{id:guildId}}} readError={readError} />}
	</main>;
}
