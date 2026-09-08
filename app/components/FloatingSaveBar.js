'use client';

import { CircleAlert, RotateCcw, Save } from 'lucide-react';
import { useCopy } from '../copy';
import styles from './FloatingSaveBar.module.css';

export default function FloatingSaveBar({ onSave, onDiscard, saving, affectedTools = [], error = '' }) {
	const { t } = useCopy();
	const copy = t.servers;

	return (
		<div className={`${styles.saveBar} ${error ? styles.saveBarError : ''}`.trim()} role="region" aria-label={copy.unsavedTitle}>
			{error ? <CircleAlert className={styles.errorIcon} size={18} aria-hidden="true" /> : <span className={styles.changeDot} aria-hidden="true" />}
			<div className={styles.message} aria-live="polite">
				<strong>{error || copy.unsavedTitle}</strong>
				<span>{error ? copy.pendingTools(affectedTools) : `${copy.unsavedLede} ${copy.pendingTools(affectedTools)}`}</span>
			</div>
			<div className={styles.actions}>
				{onDiscard && (
					<button type="button" className={styles.discardButton} onClick={onDiscard} disabled={saving}>
						<RotateCcw size={15} />{copy.discardChanges}
					</button>
				)}
				<button type="button" className={styles.saveButton} onClick={onSave} disabled={saving}>
					<Save size={15} />{saving ? copy.savingChanges : copy.saveChanges}
				</button>
			</div>
		</div>
	);
}
