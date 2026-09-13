'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AuthGate from '../AuthGate';
import { useCopy } from '../../copy';
import TeamMark from './TeamMark';
import styles from '../../teams/teams.module.css';

export default function TeamJoin({ token }) {
	const { t } = useCopy();
	const c = t.teams;
	const [preview, setPreview] = useState(null);
	const [auth, setAuth] = useState('loading');
	const [result, setResult] = useState(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	useEffect(() => {
		Promise.all([fetch(`/api/megu/teams/join/${encodeURIComponent(token)}`), fetch('/api/megu/me')])
			.then(async ([previewResponse, meResponse]) => {
				const body = await previewResponse.json();
				if (!previewResponse.ok) throw body;
				setPreview(body);
				const me = await meResponse.json();
				setAuth(me.loggedIn ? 'ready' : 'signed-out');
			})
			.catch(problem => { setError(c.errors[problem?.code] || c.errors.failed); setAuth('error'); });
	}, [c.errors, token]);
	const request = async () => {
		setBusy(true); setError('');
		try {
			const response = await fetch(`/api/megu/teams/join/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
			const body = await response.json();
			if (!response.ok) throw body;
			setResult(body);
		}
		catch (problem) { setError(c.errors[problem?.code] || c.errors.failed); }
		finally { setBusy(false); }
	};
	if (auth === 'signed-out') return <AuthGate title={preview ? c.joinPageTitle(preview.team.name) : c.title} lede={c.joinPageLede} action={c.requestAccess} href={`/api/auth/login?returnTo=${encodeURIComponent(`/teams/join/${token}`)}`} />;
	return <main className={styles.joinPage}><section className={styles.joinPanel} aria-busy={auth === 'loading' || busy}>{preview && <TeamMark name={preview.team.name} color={preview.team.color} size="large" />}<h1>{preview ? c.joinPageTitle(preview.team.name) : c.title}</h1><p>{error || (result?.status === 'pending' ? c.joinPending : result?.status === 'approved' ? c.joinApproved : c.joinPageLede)}</p>{result?.status === 'approved' && result.team ? <Link className="btn btn-primary" href={`/teams/${result.team.id}`}>{c.openTeam}</Link> : <button type="button" className="btn btn-primary" disabled={busy || auth !== 'ready' || Boolean(error)} onClick={request}>{busy ? c.requesting : c.requestAccess}</button>}</section></main>;
}
