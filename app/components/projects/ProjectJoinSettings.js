'use client';
import { useCallback, useEffect, useState } from 'react';
import ProjectAvatar from './ProjectAvatar';
import styles from './projectManage.module.css';

export default function ProjectJoinSettings({ code, p, onChanged }) {
	const [data,setData] = useState(null);
	const [link,setLink] = useState('');
	const [busy,setBusy] = useState(false);
	const [error,setError] = useState('');
	const [copied,setCopied] = useState(false);
	const load = useCallback(async () => {
		try { const r = await fetch('/api/megu/projects/'+code+'/join-requests'); const b = await r.json(); if(!r.ok) throw b; setData(b); }
		catch(e) { setError(p.errors[e?.code] || p.joinFailed); }
	},[code,p]);
	useEffect(() => { load(); },[load]);
	const act = async (path,method,body) => {
		setBusy(true); setError('');
		try { const r = await fetch('/api/megu/projects/'+code+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body || {})}); const b = await r.json(); if(!r.ok) throw b;
			if(b.token) { setLink(window.location.origin+'/projects/join/'+b.token); setCopied(false); }
			if(method === 'DELETE') setLink('');
			await load(); if(path.startsWith('/join-requests/')) await onChanged();
		} catch(e) { setError(p.errors[e?.code] || p.joinFailed); }
		finally { setBusy(false); }
	};
	return <div className={styles.inviteArea}><h3>{p.joinTitle}</h3><p>{p.joinHint}</p>{data?.link && <p>{p.joinActive}</p>}<div className={styles.joinActions}><button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('/join-link','POST')}>{p.createJoinLink}</button>{data?.link && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => act('/join-link','DELETE')}>{p.revokeJoinLink}</button>}</div>{link && <div className={styles.joinLink}><input aria-label={p.joinTitle} readOnly value={link} onFocus={e => e.target.select()} /><button type="button" className="btn btn-secondary" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setError(p.joinFailed); } }}>{copied ? p.copied : p.copyLink}</button></div>}{error && <p role="alert" className={styles.alert}>{error}</p>}<div className={styles.pending}><h3>{p.joinRequests}</h3>{data && !data.requests.length && <p>{p.noJoinRequests}</p>}{data?.requests.map(request => <div key={request.id} className={styles.pendingRow}><ProjectAvatar name={request.displayName} avatarUrl={request.avatarUrl} className={styles.avatar} /><strong>{request.displayName}</strong><div className={styles.joinActions}><button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => act('/join-requests/'+request.id,'POST',{action:'approve'})}>{p.approveJoin}</button><button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act('/join-requests/'+request.id,'POST',{action:'reject'})}>{p.rejectJoin}</button></div></div>)}</div></div>;
}
