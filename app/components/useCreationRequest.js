'use client';

import { useEffect, useRef, useState } from 'react';

const PREFIX = 'megu:creation:v1:';
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
function fingerprint(payload) {
	return JSON.stringify(Object.fromEntries(Object.keys(payload).sort().filter(key => key !== 'requestKey').map(key => [key,
		typeof payload[key] === 'string' ? payload[key].trim() : payload[key]])));
}

export default function useCreationRequest(url, { actorId, scope = 'directory' }) {
	const parentOf = payload => (url.endsWith('/projects') ? payload.teamId : payload.discordGuildId)?.trim() || null;
	const keyFor = parent => PREFIX + JSON.stringify([actorId, url, parent]);
	const storageKey = keyFor(scope === 'directory' ? null : scope);
	const pending = useRef(false), attempt = useRef(null), uncertain = useRef(false);
	const [busy, setBusy] = useState(false), [frozen, setFrozen] = useState(false);
	const [ready, setReady] = useState(false), [restored, setRestored] = useState(null);
	useEffect(() => {
		attempt.current = null; uncertain.current = false; pending.current = false;
		setBusy(false); setFrozen(false); setReady(false); setRestored(null);
		try {
			if (!actorId) return;
			// Bound retained drafts, including those under other actor/form scopes.
			for (const key of Object.keys(sessionStorage)) {
				if (!key.startsWith(PREFIX)) continue;
				let record;
				try { record = JSON.parse(sessionStorage.getItem(key)); } catch {}
				if (!record || record.actorId !== actorId || !Number.isFinite(record.createdAt) || Date.now() - record.createdAt > MAX_AGE || record.createdAt > Date.now()) sessionStorage.removeItem(key);
			}
			let selectedKey = storageKey;
			if (scope === 'directory') {
				const candidates = Object.keys(sessionStorage).filter(key => key.startsWith(PREFIX)).map(key => [key, JSON.parse(sessionStorage.getItem(key))])
					.filter(([, record]) => record.actorId === actorId && record.kind === url).sort((a, b) => b[1].createdAt - a[1].createdAt);
				if (candidates.length) selectedKey = candidates[0][0];
			}
			const record = JSON.parse(sessionStorage.getItem(selectedKey) || 'null');
			if (record && record.actorId === actorId && record.kind === url && record.parent === parentOf(record.payload || {}) && selectedKey === keyFor(record.parent) && record.state === 'unresolved'
				&& /^[A-Za-z0-9_-]{16,160}$/.test(record.requestKey) && record.payload && record.fingerprint === fingerprint(record.payload)) {
				attempt.current = record; uncertain.current = true; setRestored(record.payload);
			} else if (record) sessionStorage.removeItem(selectedKey);
			setReady(true);
		} catch { /* Storage unavailable: no creation request may be sent. */ }
	}, [storageKey, actorId, url, scope]);
	const retire = () => {
		const key = keyFor(attempt.current?.parent ?? null);
		const stored = JSON.parse(sessionStorage.getItem(key) || 'null');
		if (stored?.requestKey === attempt.current?.requestKey) sessionStorage.removeItem(key);
		attempt.current = null; uncertain.current = false; setRestored(null);
	};
	const abandon = () => {
		if (pending.current) return false;
		try { retire(); setFrozen(false); return true; } catch { return false; }
	};
	const submit = async payload => {
		if (pending.current) return null;
		if (!ready || !actorId) throw { code: 'creation_storage_unavailable' };
		pending.current = true; setBusy(true); setFrozen(true);
		let sent = false;
		try {
			// A restored draft is editable; changing its intent explicitly replaces it.
			if (!attempt.current || (!frozen && attempt.current.fingerprint !== fingerprint(payload))) {
				const prior = JSON.parse(sessionStorage.getItem(keyFor(parentOf(payload))) || 'null');
				if (prior && prior.actorId === actorId && prior.kind === url && prior.parent === parentOf(payload) && prior.state === 'unresolved'
					&& /^[A-Za-z0-9_-]{16,160}$/.test(prior.requestKey) && prior.createdAt <= Date.now() && Date.now() - prior.createdAt <= MAX_AGE
					&& prior.fingerprint === fingerprint(payload) && prior.fingerprint === fingerprint(prior.payload)) {
					attempt.current = prior; uncertain.current = true;
				} else {
					attempt.current = { actorId, kind: url, parent: parentOf(payload), payload: JSON.parse(JSON.stringify(payload)), fingerprint: fingerprint(payload),
						requestKey: crypto.randomUUID(), state: 'unresolved', createdAt: Date.now() };
					uncertain.current = false;
				}
			}
			// Persist BEFORE fetch. Reload/navigation during the request is ambiguous.
			sessionStorage.setItem(keyFor(attempt.current.parent), JSON.stringify(attempt.current));
			sent = true;
			const response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...attempt.current.payload, requestKey: attempt.current.requestKey }) });
			const data = await response.json();
			if (!response.ok) {
				if (!uncertain.current && response.status >= 400 && response.status < 500) { retire(); setFrozen(false); }
				throw data;
			}
			retire(); setBusy(false);
			// Stay latched until navigation, but confirmed success retires persisted intent.
			return data;
		} catch (error) {
			if (sent && attempt.current) uncertain.current = true;
			if (!sent) { attempt.current = null; uncertain.current = false; setFrozen(false); setRestored(null); }
			pending.current = false; setBusy(false);
			throw error;
		}
	};
	return { submit, abandon, pending, busy, frozen, ready, restored };
}
