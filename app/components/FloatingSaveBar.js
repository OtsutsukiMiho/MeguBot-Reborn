'use client';

export default function FloatingSaveBar({ onSave, saving }) {
	return (
		<div className="floating-save-bar">
			<div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
				<span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--gold)', boxShadow: '0 0 10px rgba(245, 158, 11, 0.6)', flexShrink: 0 }}></span>
				<div>
					<div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--ink)' }}>Unsaved Changes</div>
					<div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Save settings to synchronize Megu with Discord in real-time.</div>
				</div>
			</div>
			<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
				<button onClick={onSave} disabled={saving} className="btn" style={{ padding: '0.6rem 1.4rem', fontWeight: 700 }}>
					{saving ? 'Saving...' : 'Save Changes'}
				</button>
			</div>
		</div>
	);
}
