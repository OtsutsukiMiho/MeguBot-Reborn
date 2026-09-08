'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ChevronDown, X } from 'lucide-react';
import { useCopy } from '../../copy';
import styles from './tabWorkspace.module.css';

export function TabWorkspace({ children, className = '', labelledBy }) {
	return (
		<div className={`${styles.workspace} ${className}`.trim()} aria-labelledby={labelledBy}>
			{children}
		</div>
	);
}

export function TabActionBar({ children, actions, className = '' }) {
	return (
		<div className={`${styles.actionBar} ${className}`.trim()}>
			<div className={styles.actionBarBody}>{children}</div>
			{actions ? <div className={styles.actions}>{actions}</div> : null}
		</div>
	);
}

export function TabSection({
	title,
	description,
	meta,
	actions,
	children,
	className = '',
	tone = 'plain',
	id,
}) {
	return (
		<section
			className={`${styles.section} ${styles[`section_${tone}`] || ''} ${className}`.trim()}
			aria-labelledby={id}
		>
			{title || description || meta || actions ? (
				<header className={styles.sectionHeader}>
					<div className={styles.sectionHeading}>
						{title ? <h3 id={id}>{title}</h3> : null}
						{description ? <p>{description}</p> : null}
					</div>
					{meta || actions ? (
						<div className={styles.sectionAside}>
							{meta}
							{actions}
						</div>
					) : null}
				</header>
			) : null}
			<div className={styles.sectionBody}>{children}</div>
		</section>
	);
}

export function TabStatus({ children, tone = 'neutral', title }) {
	return (
		<span className={`${styles.status} ${styles[`status_${tone}`] || ''}`} title={title} aria-live="polite">
			<span className={styles.statusDot} aria-hidden="true" />
			{children}
		</span>
	);
}

export function TabNotice({ title, children, tone = 'info', actions }) {
	return (
		<div className={`${styles.notice} ${styles[`notice_${tone}`] || ''}`} role={tone === 'danger' ? 'alert' : 'status'}>
			<div>
				{title ? <strong>{title}</strong> : null}
				{children ? <div className={styles.noticeText}>{children}</div> : null}
			</div>
			{actions ? <div className={styles.noticeActions}>{actions}</div> : null}
		</div>
	);
}

export function TabEmpty({ title, description, action }) {
	return (
		<div className={styles.emptyState}>
			<div className={styles.emptyMark} aria-hidden="true" />
			<strong>{title}</strong>
			{description ? <p>{description}</p> : null}
			{action ? <div className={styles.emptyAction}>{action}</div> : null}
		</div>
	);
}

export function TabFieldGrid({ children, columns = 2, className = '' }) {
	return (
		<div
			className={`${styles.fieldGrid} ${className}`.trim()}
			style={{ '--tab-grid-columns': columns }}
		>
			{children}
		</div>
	);
}

export function TabSettingsList({ children, className = '' }) {
	return <div className={`${styles.settingsList} ${className}`.trim()}>{children}</div>;
}

export function TabSettingRow({ label, description, control, children, className = '', stacked = false }) {
	return (
		<div className={`${styles.settingRow} ${stacked ? styles.settingRowStacked : ''} ${className}`.trim()}>
			<div className={styles.settingCopy}>
				{label ? <strong>{label}</strong> : null}
				{description ? <span>{description}</span> : null}
			</div>
			<div className={styles.settingControl}>{control || children}</div>
		</div>
	);
}

export function TabSwitch({ checked, onChange, label, disabled = false }) {
	return (
		<label className={`${styles.switch} ${disabled ? styles.switchDisabled : ''}`.trim()}>
			<input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
			<span className={styles.switchTrack} aria-hidden="true"><span /></span>
			<span className={styles.srOnly}>{label}</span>
		</label>
	);
}

export function TabSegmented({ options, value, onChange, label, disabled = false }) {
	return (
		<fieldset className={styles.segmented} aria-label={label} disabled={disabled}>
			{options.map(option => (
				<label key={option.value}>
					<input type="radio" name={option.name || label} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
					<span>{option.label}</span>
				</label>
			))}
		</fieldset>
	);
}

export function TabFilterBar({ children, meta, actions, className = '' }) {
	return (
		<div className={`${styles.filterBar} ${className}`.trim()}>
			<div className={styles.filterFields}>{children}</div>
			{meta || actions ? (
				<div className={styles.filterAside}>
					{meta}
					{actions}
				</div>
			) : null}
		</div>
	);
}

export function TabInlineActions({ children, align = 'end', className = '' }) {
	return <div className={`${styles.inlineActions} ${styles[`inlineActions_${align}`] || ''} ${className}`.trim()}>{children}</div>;
}

export function TabLocalTabs({ tabs, value, onChange, label, className = '' }) {
	const refs = useRef(new Map());
	const enabledTabs = tabs.filter(tab => !tab.disabled);
	const selectByOffset = (currentId, offset) => {
		const index = enabledTabs.findIndex(tab => tab.id === currentId);
		if (index < 0 || !enabledTabs.length) return;
		const next = enabledTabs[(index + offset + enabledTabs.length) % enabledTabs.length];
		onChange(next.id);
		requestAnimationFrame(() => refs.current.get(next.id)?.focus());
	};

	return (
		<div className={`${styles.localTabs} ${className}`.trim()} role="tablist" aria-label={label}>
			{tabs.map(tab => (
				<button
					key={tab.id}
					ref={node => {
						if (node) refs.current.set(tab.id, node);
						else refs.current.delete(tab.id);
					}}
					type="button"
					role="tab"
					aria-selected={value === tab.id}
					aria-controls={tab.controls}
					id={tab.tabId}
					tabIndex={value === tab.id ? 0 : -1}
					disabled={tab.disabled}
					onClick={() => onChange(tab.id)}
					onKeyDown={event => {
						if (event.key === 'ArrowRight') { event.preventDefault(); selectByOffset(tab.id, 1); }
						if (event.key === 'ArrowLeft') { event.preventDefault(); selectByOffset(tab.id, -1); }
						if (event.key === 'Home' && enabledTabs.length) { event.preventDefault(); onChange(enabledTabs[0].id); requestAnimationFrame(() => refs.current.get(enabledTabs[0].id)?.focus()); }
						if (event.key === 'End' && enabledTabs.length) { event.preventDefault(); const last = enabledTabs.at(-1); onChange(last.id); requestAnimationFrame(() => refs.current.get(last.id)?.focus()); }
					}}
				>
					<span>{tab.label}</span>
					{tab.meta ? <small>{tab.meta}</small> : null}
				</button>
			))}
		</div>
	);
}

export function TabDisclosure({ summary, description, children, open, onToggle, invalid = false, className = '' }) {
	const detailsRef = useRef(null);
	useEffect(() => {
		if (invalid && detailsRef.current) detailsRef.current.open = true;
	}, [invalid]);

	return (
		<details ref={detailsRef} className={`${styles.disclosure} ${invalid ? styles.disclosureInvalid : ''} ${className}`.trim()} open={open} onToggle={onToggle}>
			<summary>
				<span>
					<strong>{summary}</strong>
					{description ? <small>{description}</small> : null}
				</span>
				<ChevronDown size={17} aria-hidden="true" />
			</summary>
			<div className={styles.disclosureBody}>{children}</div>
		</details>
	);
}

export function TabFieldMessage({ children, tone = 'help', id }) {
	return <p id={id} className={`${styles.fieldMessage} ${styles[`fieldMessage_${tone}`] || ''}`} role={tone === 'error' ? 'alert' : undefined} aria-live={tone === 'error' ? 'assertive' : undefined}>{children}</p>;
}

export function TabSplitLayout({ editor, preview, className = '' }) {
	return (
		<div className={`${styles.splitLayout} ${className}`.trim()}>
			<div className={styles.splitEditor}>{editor}</div>
			<aside className={styles.splitPreview}>{preview}</aside>
		</div>
	);
}

export function TabRecordList({ children, className = '' }) {
	return <div className={`${styles.recordList} ${className}`.trim()}>{children}</div>;
}

export function TabRecord({ children, className = '' }) {
	return <article className={`${styles.record} ${className}`.trim()}>{children}</article>;
}

export function TabResourceRow({ label, description, markerColor, leading, actions, children, className = '' }) {
	return (
		<div className={`${styles.resourceRow} ${className}`.trim()}>
			<div className={styles.resourceIdentity}>
				{leading || (markerColor ? <span className={styles.resourceMarker} style={{ '--resource-color': markerColor }} aria-hidden="true" /> : null)}
				<div>
					<strong>{label}</strong>
					{description ? <span>{description}</span> : null}
				</div>
			</div>
			{children ? <div className={styles.resourceContent}>{children}</div> : null}
			{actions ? <div className={styles.resourceActions}>{actions}</div> : null}
		</div>
	);
}


export function TabPagination({ page, totalPages, onPageChange, summary, previousLabel, nextLabel }) {
	const { t } = useCopy();
	const previous = previousLabel || t.serverTabs.shared.previous;
	const next = nextLabel || t.serverTabs.shared.next;
	return (
		<nav className={styles.pagination} aria-label={t.serverTabs.shared.paginationLabel}>
			<span>{summary}</span>
			<div>
				<button type="button" className="btn btn-secondary btn-sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>{previous}</button>
				<span aria-current="page">{page} / {totalPages}</span>
				<button type="button" className="btn btn-secondary btn-sm" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>{next}</button>
			</div>
		</nav>
	);
}

export function TabChoice({
	checked,
	onChange,
	label,
	description,
	type = 'checkbox',
	name,
	value,
	disabled = false,
}) {
	return (
		<label className={`${styles.choice} ${checked ? styles.choiceSelected : ''} ${disabled ? styles.choiceDisabled : ''}`}>
			<input
				type={type}
				name={name}
				value={value}
				checked={checked}
				onChange={onChange}
				disabled={disabled}
			/>
			<span className={styles.choiceCopy}>
				<strong>{label}</strong>
				{description ? <span>{description}</span> : null}
			</span>
		</label>
	);
}

export function TabTable({ children, label, className = '', mobileRecords = false }) {
	return (
		<div className={`${styles.tableFrame} ${mobileRecords ? styles.mobileRecords : ''} ${className}`.trim()} role="region" aria-label={label} tabIndex="0">
			{children}
		</div>
	);
}

export function TabMemberCard({ member, action, children }) {
	const [avatarFailed, setAvatarFailed] = useState(false);
	const [bannerFailed, setBannerFailed] = useState(false);
	const displayName = member?.displayName || member?.username || 'Unknown member';
	const initials = displayName.substring(0, 2).toUpperCase();

	useEffect(() => setAvatarFailed(false), [member?.avatar]);
	useEffect(() => setBannerFailed(false), [member?.banner]);

	return (
		<article className={styles.memberCard}>
			<div
				className={styles.memberBanner}
				style={{ '--member-banner-color': member?.accentColor || 'var(--sunk)' }}
				aria-hidden="true"
			>
				{member?.banner && !bannerFailed ? (
					<img src={member.banner} alt="" onError={() => setBannerFailed(true)} />
				) : null}
			</div>
			<header className={styles.memberCardHeader}>
				{member?.avatar && !avatarFailed ? (
					<img
						className={styles.memberCardAvatar}
						src={member.avatar}
						alt=""
						onError={() => setAvatarFailed(true)}
					/>
				) : (
					<span className={`${styles.memberCardAvatar} ${styles.memberCardAvatarFallback}`} aria-hidden="true">{initials}</span>
				)}
				<div className={styles.memberCardIdentity}>
					<h3 title={displayName}>{displayName}</h3>
					<p title={`@${member?.username || 'unknown'}`}>
						@{member?.username || 'unknown'}
						{member?.isBot ? <span>Bot</span> : null}
					</p>
				</div>
				{action ? <div className={styles.memberCardAction}>{action}</div> : null}
			</header>
			<div className={styles.memberCardBody}>{children}</div>
		</article>
	);
}

export function TabSkeleton({ rows = 3, label = 'Loading' }) {
	return (
		<div className={styles.skeleton} role="status" aria-label={label}>
			{Array.from({ length: rows }, (_, index) => (
				<span key={index} style={{ '--skeleton-width': `${96 - (index % 3) * 13}%` }} />
			))}
		</div>
	);
}

export function TabModalLayer({ children, onClose, closeOnBackdrop = true }) {
	const [portalRoot, setPortalRoot] = useState(null);

	useEffect(() => {
		setPortalRoot(document.body);
	}, []);

	useEffect(() => {
		if (!portalRoot) return undefined;

		const previousOverflow = document.body.style.overflow;
		const handleKeyDown = event => {
			if (event.key === 'Escape') onClose?.();
		};

		document.body.style.overflow = 'hidden';
		document.addEventListener('keydown', handleKeyDown);

		return () => {
			document.body.style.overflow = previousOverflow;
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [onClose, portalRoot]);

	if (!portalRoot) return null;

	return createPortal(
		<div
			className={styles.dialogBackdrop}
			onMouseDown={event => {
				if (closeOnBackdrop && event.target === event.currentTarget) onClose?.();
			}}
		>
			{children}
		</div>,
		portalRoot,
	);
}

export function TabDialog({
	open,
	onClose,
	title,
	description,
	children,
	footer,
	danger = false,
	closeLabel,
}) {
	const { t } = useCopy();
	const resolvedCloseLabel = closeLabel || t.serverTabs.shared.closeDialog;
	const titleId = useId();
	const descriptionId = useId();
	const dialogRef = useRef(null);
	const [portalRoot, setPortalRoot] = useState(null);

	useEffect(() => {
		setPortalRoot(document.body);
	}, []);

	useEffect(() => {
		if (!open || !portalRoot) return undefined;
		const previousFocus = document.activeElement;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		const dialog = dialogRef.current;
		const focusTarget = dialog?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
		(focusTarget || dialog)?.focus();

		const handleKeyDown = event => {
			if (event.key === 'Escape') {
				onClose?.();
				return;
			}
			if (event.key !== 'Tab' || !dialog) return;
			const focusable = Array.from(dialog.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'));
			if (!focusable.length) {
				event.preventDefault();
				dialog.focus();
				return;
			}
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('keydown', handleKeyDown);
			document.body.style.overflow = previousOverflow;
			if (previousFocus instanceof HTMLElement) previousFocus.focus();
		};
	}, [onClose, open, portalRoot]);

	if (!open || !portalRoot) return null;

	return createPortal(
		(
			<div
				className={styles.dialogBackdrop}
				onMouseDown={event => {
					if (event.target === event.currentTarget) onClose?.();
				}}
			>
				<div
					ref={dialogRef}
					className={`${styles.dialog} ${danger ? styles.dialogDanger : ''}`.trim()}
					role="dialog"
					aria-modal="true"
					aria-labelledby={titleId}
					aria-describedby={description ? descriptionId : undefined}
					tabIndex="-1"
				>
					<header className={styles.dialogHeader}>
						<div>
							<h3 id={titleId}>{title}</h3>
							{description ? <p id={descriptionId}>{description}</p> : null}
						</div>
						<button type="button" className={styles.dialogClose} onClick={onClose} aria-label={resolvedCloseLabel}>
							<X size={18} aria-hidden="true" />
						</button>
					</header>
					{children ? <div className={styles.dialogBody}>{children}</div> : null}
					{footer ? <footer className={styles.dialogFooter}>{footer}</footer> : null}
				</div>
			</div>
		),
		portalRoot,
	);
}

export function TabConfirmDialog({
	open,
	onClose,
	onConfirm,
	title,
	description,
	confirmLabel = 'Confirm',
	cancelLabel = 'Cancel',
	busyLabel,
	impactMessage,
	busy = false,
}) {
	const { t } = useCopy();
	const resolvedBusyLabel = busyLabel || t.serverTabs.shared.working;
	const resolvedImpactMessage = impactMessage || t.serverTabs.shared.immediateImpact;
	return (
		<TabDialog
			open={open}
			onClose={busy ? undefined : onClose}
			title={title}
			description={description}
			danger
			footer={(
				<>
					<button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>{cancelLabel}</button>
					<button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>
						{busy ? resolvedBusyLabel : confirmLabel}
					</button>
				</>
			)}
		>
			<div className={styles.confirmMessage}>
				<AlertTriangle size={20} aria-hidden="true" />
				<span>{resolvedImpactMessage}</span>
			</div>
		</TabDialog>
	);
}

export const tabWorkspaceStyles = styles;
