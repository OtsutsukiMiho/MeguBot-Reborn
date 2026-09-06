'use client';

import { RotateCcw, Save } from 'lucide-react';
import { useCopy } from '../copy';
import styles from './FloatingSaveBar.module.css';

export default function FloatingSaveBar({ onSave, onDiscard, saving }) {
	const { t } = useCopy();
	const copy = t.servers;

	return (
		<div className={styles.saveBar} role="region" aria-label={copy.unsavedTitle}>
			<span className={styles.changeDot} aria-hidden="true" />
			<div className={styles.message} aria-live="polite">
				<strong>{copy.unsavedTitle}</strong>
				<span>{copy.unsavedLede}</span>
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
