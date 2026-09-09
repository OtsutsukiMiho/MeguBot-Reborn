'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import AuthGate from '../AuthGate';
import MeguMark from '../MeguMark';
import { useCopy } from '../../copy';
import styles from './projectInvitation.module.css';

export default function ProjectJoin({ token }) {
	const { t } = useCopy(); const p = t.projects;
	const [auth,setAuth] = useState('loading');
	const [result,setResult] = useState(null);
	const [busy,setBusy] = useState(false);
	const [error,setError] = useState('');
	useEffect(() => { fetch('/api/megu/me').then(r => { if (!r.ok) throw Error(); return r.json(); }).then(b => setAuth(b.loggedIn ? 'ready' : 'signed-out')).catch(() => setAuth('signed-out')); }, []);
	const request = async () => {
		setBusy(true); setError('');
		try { const r = await fetch('/api/megu/projects/join/'+encodeURIComponent(token), { method:'POST' }); const b = await r.json(); if (!r.ok) throw b; setResult(b); }
		catch(e) { setError(p.errors[e?.code] || p.joinFailed); }
		finally { setBusy(false); }
	};
	if(auth === 'signed-out') return <AuthGate title={p.requestJoinTitle} lede={p.requestJoinHint} action={p.requestJoin} href={'/api/auth/login?returnTo='+encodeURIComponent('/projects/join/'+token)} />;
	return <main className={styles.page}><section className={styles.panel} aria-busy={busy || auth === 'loading'}><MeguMark size={58} /><h1>{p.requestJoinTitle}</h1><p>{result?.status === 'pending' ? p.joinPending : result?.status === 'rejected' ? p.joinRejected : p.requestJoinHint}</p><div className={styles.action}>{error && <p role="alert" className={styles.error}>{error}</p>}{result?.project ? <Link className="btn btn-primary" href={'/p/'+result.project.code}>{p.backToProject}</Link> : <button type="button" className="btn btn-primary" disabled={busy || auth === 'loading' || result?.status === 'rejected'} onClick={request}>{busy ? p.loadingMore : result ? p.checkJoin : p.requestJoin}</button>}</div></section></main>;
}
