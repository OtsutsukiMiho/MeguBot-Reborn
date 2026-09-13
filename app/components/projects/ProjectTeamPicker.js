'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Search, UserPlus, Users } from 'lucide-react';
import CustomSelect from '../CustomSelect';
import ProjectAvatar from './ProjectAvatar';
import { useCopy } from '../../copy';
import styles from './projectManage.module.css';

export default function ProjectTeamPicker({ project, projectMembers, me, p, readError, onChanged }) {
	const { t } = useCopy();
	const [open, setOpen] = useState(false);
	const [members, setMembers] = useState([]);
	const [nextOffset, setNextOffset] = useState(null);
	const [query, setQuery] = useState('');
	const [selected, setSelected] = useState([]);
	const [role, setRole] = useState('member');
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	useEffect(() => {
		if (!open || !project.teamId) return undefined;
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			setLoading(true); setError('');
			try { const response = await fetch(`/api/megu/teams/${project.teamId}/members?limit=100&q=${encodeURIComponent(query.trim())}`, { signal: controller.signal }); const body = await response.json(); if (!response.ok) throw body; setMembers(body.members || []); setNextOffset(body.nextOffset); }
			catch (problem) { if (problem?.name !== 'AbortError') setError(readError(problem)); }
			finally { if (!controller.signal.aborted) setLoading(false); }
		}, query.trim() ? 180 : 0);
		return () => { clearTimeout(timer); controller.abort(); };
	}, [open, project.teamId, query, readError]);
	const existing = useMemo(() => new Set(projectMembers.map(member => member.userId)), [projectMembers]);
	const eligible = members.filter(member => !existing.has(member.userId));
	const toggle = userId => setSelected(current => current.includes(userId) ? current.filter(id => id !== userId) : [...current, userId]);
	const loadMore = async () => {
		if (nextOffset == null) return;
		setLoading(true); setError('');
		try { const response = await fetch(`/api/megu/teams/${project.teamId}/members?limit=100&offset=${nextOffset}&q=${encodeURIComponent(query.trim())}`); const body = await response.json(); if (!response.ok) throw body; setMembers(current => [...current, ...(body.members || []).filter(member => !current.some(existingMember => existingMember.userId === member.userId))]); setNextOffset(body.nextOffset); }
		catch (problem) { setError(readError(problem)); }
		finally { setLoading(false); }
	};
	const submit = async () => {
		setBusy(true); setError('');
		try {
			const response = await fetch(`/api/megu/projects/${project.code}/members`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ members: selected.map(userId => ({ userId, role })), expectedRevision: project.revision }) });
			const body = await response.json(); if (!response.ok) throw body;
			setOpen(false); setSelected([]); await onChanged();
		}
		catch (problem) { setError(readError(problem)); }
		finally { setBusy(false); }
	};
	return <div className={styles.teamArea}><div className={styles.teamIdentity}><Users size={19} /><div><strong>{p.managedByTeam(project.team?.name || '')}</strong><p>{p.addFromTeamHint}</p></div><Link href={`/teams/${project.teamId}`} className="btn btn-secondary btn-sm">{p.manageTeam}</Link></div>{['owner', 'lead'].includes(me.role) && <button type="button" className="btn btn-primary" onClick={() => setOpen(value => !value)}><UserPlus size={16} />{p.addFromTeam}</button>}{open && <div className={styles.rosterPicker}><div className={styles.rosterTools}><label><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={p.search} aria-label={p.search} /></label><CustomSelect size="compact" searchable={false} value={role} onChange={setRole} options={(me.role === 'owner' ? ['member', 'viewer', 'lead'] : ['member', 'viewer']).map(value => ({ value, label: p.role[value] }))} ariaLabel={p.inviteRole} /></div>{error && <p className={styles.alert}>{error}</p>}<div className={styles.rosterList} aria-busy={loading}>{eligible.length ? eligible.map(member => <label key={member.userId} className={styles.rosterMember}><input type="checkbox" checked={selected.includes(member.userId)} onChange={() => toggle(member.userId)} /><ProjectAvatar name={member.displayName} avatarUrl={member.avatarUrl} className={styles.avatar} /><span><strong>{member.displayName}</strong><small>{t.teams.role[member.role]}</small></span></label>) : !loading && <p>{p.noEligibleTeamMembers}</p>}{nextOffset != null && <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={loadMore}>{t.teams.loadMore}</button>}</div><div className={styles.rosterActions}><button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>{p.cancel}</button><button type="button" className="btn btn-primary" disabled={!selected.length || busy} onClick={submit}>{p.addSelected}</button></div></div>}</div>;
}

export function ProjectTeamConversion({ project, me, p, readError, onChanged }) {
	const [teams, setTeams] = useState([]);
	const [teamId, setTeamId] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [unresolved, setUnresolved] = useState([]);
	useEffect(() => {
		if (me.role !== 'owner' || project.teamId) return;
		fetch('/api/megu/teams').then(response => response.ok ? response.json() : null).then(body => setTeams((body?.teams || []).filter(team => ['owner', 'admin'].includes(team.role) && !team.archivedAt))).catch(() => undefined);
	}, [me.role, project.teamId]);
	if (me.role !== 'owner' || project.teamId || !teams.length) return null;
	const convert = async () => {
		setBusy(true); setError(''); setUnresolved([]);
		try { const response = await fetch(`/api/megu/projects/${project.code}/team`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teamId, expectedRevision: project.revision }) }); const body = await response.json(); if (!response.ok) throw body; await onChanged(); }
		catch (problem) { setError(readError(problem)); setUnresolved(problem?.unresolvedMembers || []); }
		finally { setBusy(false); }
	};
	return <div className={styles.convertArea}><h3>{p.convertToTeam}</h3><p>{p.convertHint}</p><div className={styles.convertForm}><CustomSelect value={teamId} onChange={setTeamId} placeholder={p.selectTeam} options={teams.map(team => ({ value: team.id, label: team.name }))} /><button type="button" className="btn btn-secondary" disabled={!teamId || busy} onClick={convert}>{p.convert}</button></div>{error && <p className={styles.alert}>{error}</p>}{unresolved.length > 0 && <div className={styles.unresolved}><strong>{p.unresolvedMembers}</strong>{unresolved.map(member => <span key={member.userId}><ProjectAvatar name={member.displayName} avatarUrl={member.avatarUrl} className={styles.avatar} />{member.displayName}</span>)}</div>}</div>;
}
