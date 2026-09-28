'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCopy } from '../copy';
import styles from '../teams/teams.module.css';
import workspaceStyles from './teams/serverWorkspace.module.css';

const drafts = new Set();
let showDraftDialog = null;

export function requestDraftNavigation(resume) {
	const dirty = [...drafts].filter(draft => draft.active.current);
	if (!dirty.length) return true;
	if (dirty.some(draft => draft.blocked.current)) return false;
	showDraftDialog?.({ discard: () => { for (const draft of dirty) { draft.active.current = false; draft.onDiscard.current?.(); } resume?.(); } });
	return false;
}

// Reuse the existing discard-dialog presentation for SPA navigation.
// Form-owned cancel dialogs may opt their link out with data-draft-navigation.
export default function useDraftGuard(dirty, busy = false, onDiscard = null) {
	const active = useRef(dirty || busy), blocked = useRef(busy), discard = useRef(onDiscard);
	active.current = dirty || busy; blocked.current = busy; discard.current = onDiscard;
	const release = () => { active.current = false; };
	useEffect(() => {
		if (!dirty && !busy) return;
		const draft = { active, blocked, onDiscard: discard, href: window.location.href, state: window.history.state };
		drafts.add(draft);
		return () => { drafts.delete(draft); };
	}, [dirty, busy]);
	return release;
}

// Mount once in the persistent shell, before the router's history listener.
// A page-local popstate listener can be removed by a cached traversal before it runs.
export function useWorkspaceDraftNavigation(setPending, router) {
	useEffect(() => {
		showDraftDialog = setPending;
		const unload = event => { if ([...drafts].some(draft => draft.active.current)) { event.preventDefault(); event.returnValue = ''; } };
		const click = event => {
			if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			const anchor = event.target.closest?.('a[href]');
			if (!anchor || anchor.hasAttribute('download') || anchor.hasAttribute('data-draft-navigation') || (anchor.target && anchor.target !== '_self')) return;
			const next = new URL(anchor.href), current = new URL(window.location.href);
			if (!['http:', 'https:'].includes(next.protocol)) return;
			if (next.pathname === current.pathname && next.search === current.search && next.origin === current.origin) return;
			if (!requestDraftNavigation(() => next.origin === current.origin ? router.push(`${next.pathname}${next.search}${next.hash}`) : window.location.assign(next.href))) { event.preventDefault(); event.stopPropagation(); }
		};
		const pop = event => {
			const draft = [...drafts].find(draft => draft.active.current);
			if (!draft || window.location.href === draft.href) return;
			const destination = new URL(window.location.href);
			if (!requestDraftNavigation(() => router.push(`${destination.pathname}${destination.search}${destination.hash}`))) { event.stopImmediatePropagation(); window.history.pushState(draft.state, '', draft.href); }
		};
		window.addEventListener('beforeunload', unload);
		document.addEventListener('click', click, true);
		window.addEventListener('popstate', pop, true);
		return () => { showDraftDialog = null; window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true); window.removeEventListener('popstate', pop, true); };
	}, [setPending, router]);
}

export function WorkspaceDraftNavigation() {
	const { t } = useCopy(), p = t.projects, router = useRouter();
	const [pending, setPending] = useState(null);
	const dialog = useRef(null), keep = useRef(null);
	useWorkspaceDraftNavigation(setPending, router);
	useEffect(() => {
		if (!pending) return;
		const trigger = document.activeElement, modal = dialog.current, overflow = document.body.style.overflow;
		modal.showModal(); document.body.style.overflow = 'hidden'; keep.current?.focus();
		return () => { modal.close(); document.body.style.overflow = overflow; if (trigger?.isConnected) trigger.focus(); };
	}, [pending]);
	return <dialog ref={dialog} className={`${styles.confirmation} ${workspaceStyles.discardDialog}`} aria-labelledby="workspace-draft-title" aria-describedby="workspace-draft-detail" onCancel={event => { event.preventDefault(); setPending(null); }}>
		<div><strong id="workspace-draft-title">{p.unsavedTitle}</strong><p id="workspace-draft-detail">{p.unsavedDetail}</p></div>
		<div className={styles.confirmationActions}><button ref={keep} type="button" className="btn btn-secondary" onClick={() => setPending(null)}>{p.keepEditing}</button><button type="button" className="btn btn-danger" onClick={() => { const action = pending; setPending(null); action?.discard(); }}>{p.discardChanges}</button></div>
	</dialog>;
}
