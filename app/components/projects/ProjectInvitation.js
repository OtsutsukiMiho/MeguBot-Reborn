'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import AuthGate from '../AuthGate';
import MeguMark from '../MeguMark';
import { useCopy } from '../../copy';
import styles from './projectInvitation.module.css';

export default function ProjectInvitation({ token }) {
	const { t } = useCopy();
	const p = t.projects;
	const [auth, setAuth] = useState('loading');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [result, setResult] = useState(null);

	useEffect(() => {
		fetch('/api/megu/me', { credentials: 'same-origin' })
			.then(response => response.json())
			.then(body => setAuth(body.loggedIn ? 'ready' : 'signed-out'))
			.catch(() => setAuth('ready'));
	}, []);

	if (auth === 'loading') return <main className={styles.page} aria-busy="true"><span className="skeleton-line" style={{ width: '22ch' }} /></main>;
	if (auth === 'signed-out') {
		const returnTo = `/projects/invitations/${encodeURIComponent(token)}`;
		return <AuthGate title={p.acceptInviteTitle} lede={p.acceptInviteLede} action={p.acceptInvite} href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`} />;
	}

	const accept = async () => {
		setBusy(true); setError('');
		try {
			const response = await fetch(`/api/megu/projects/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST', credentials: 'same-origin' });
			const body = await response.json();
			if (!response.ok) throw body;
			setResult(body);
		}
		catch (problem) { setError(p.errors[problem?.code] || p.errors.failed); }
		finally { setBusy(false); }
	};

	return <main className={styles.page}><section className={styles.panel}>
		<MeguMark size={58} mood={result ? 'happy' : 'neutral'} />
		{result ? <><span className={styles.success}><Check size={16} />{p.inviteAccepted}</span><h1>{p.acceptInviteTitle}</h1><Link className="btn btn-primary" href={`/p/${result.project.code}`}>{p.backToProject}<ArrowRight size={16} /></Link></> : <><h1>{p.acceptInviteTitle}</h1><p>{p.acceptInviteLede}</p><div className={styles.action}><div className={styles.privacy}><ShieldCheck size={17} /><span>{p.private}</span></div>{error && <p className={styles.error} role="alert">{error}</p>}<button className="btn btn-primary" type="button" disabled={busy} onClick={accept}>{busy ? p.acceptingInvite : p.acceptInvite}</button></div></>}
	</section></main>;
}
