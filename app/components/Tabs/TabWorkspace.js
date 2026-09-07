'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
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

export function TabTable({ children, label, className = '' }) {
	return (
		<div className={`${styles.tableFrame} ${className}`.trim()} role="region" aria-label={label} tabIndex="0">
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
	closeLabel = 'Close dialog',
}) {
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
						<button type="button" className={styles.dialogClose} onClick={onClose} aria-label={closeLabel}>
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
	busy = false,
}) {
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
						{busy ? 'Working…' : confirmLabel}
					</button>
				</>
			)}
		>
			<div className={styles.confirmMessage}>
				<AlertTriangle size={20} aria-hidden="true" />
				<span>This action affects the current Discord server immediately.</span>
			</div>
		</TabDialog>
	);
}

export const tabWorkspaceStyles = styles;
