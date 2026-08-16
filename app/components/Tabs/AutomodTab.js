'use client';

export default function AutomodTab({ automod, onChange }) {
	const badwordsText = Array.isArray(automod.badwords_list)
		? automod.badwords_list.join(', ')
		: (automod.badwords_list || '');

	return (
		<div>
			<h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '0.25rem' }}>
				Auto-Mod & Content Filtering
			</h3>
			<p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
				Protect your server from raid spam, unauthorized invite links, mass mention abuse, and blacklisted words.
			</p>

			<div className="form-group">
				<label className="form-label">Violation Punishment Action</label>
				<select
					className="form-control"
					value={automod.action || 'delete'}
					onChange={e => onChange('action', e.target.value)}
				>
					<option value="delete">Delete Message Only</option>
					<option value="warn">Delete & Warn User</option>
					<option value="kick">Kick User</option>
					<option value="ban">Ban User</option>
				</select>
			</div>

			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
				<label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--surface-2)', padding: '0.85rem 1rem', borderRadius: '12px', border: '1px solid var(--border-color)', cursor: 'pointer' }}>
					<input
						type="checkbox"
						checked={!!automod.antispam_enabled}
						onChange={e => onChange('antispam_enabled', e.target.checked)}
						style={{ width: '18px', height: '18px', cursor: 'pointer' }}
					/>
					<div>
						<div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--ink)' }}>Anti-Spam Filter</div>
						<div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Block rapid message spamming</div>
					</div>
				</label>

				<label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--surface-2)', padding: '0.85rem 1rem', borderRadius: '12px', border: '1px solid var(--border-color)', cursor: 'pointer' }}>
					<input
						type="checkbox"
						checked={!!automod.antiinvite_enabled}
						onChange={e => onChange('antiinvite_enabled', e.target.checked)}
						style={{ width: '18px', height: '18px', cursor: 'pointer' }}
					/>
					<div>
						<div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--ink)' }}>Anti-Invite Filter</div>
						<div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Block discord.gg invite links</div>
					</div>
				</label>

				<label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--surface-2)', padding: '0.85rem 1rem', borderRadius: '12px', border: '1px solid var(--border-color)', cursor: 'pointer' }}>
					<input
						type="checkbox"
						checked={!!automod.badwords_enabled}
						onChange={e => onChange('badwords_enabled', e.target.checked)}
						style={{ width: '18px', height: '18px', cursor: 'pointer' }}
					/>
					<div>
						<div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--ink)' }}>Bad Words Filter</div>
						<div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Filter blacklisted phrases</div>
					</div>
				</label>

				<label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--surface-2)', padding: '0.85rem 1rem', borderRadius: '12px', border: '1px solid var(--border-color)', cursor: 'pointer' }}>
					<input
						type="checkbox"
						checked={!!automod.mention_spam_enabled}
						onChange={e => onChange('mention_spam_enabled', e.target.checked)}
						style={{ width: '18px', height: '18px', cursor: 'pointer' }}
					/>
					<div>
						<div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--ink)' }}>Mass Mention Filter</div>
						<div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Block &gt;5 user mentions per message</div>
					</div>
				</label>
			</div>

			{automod.badwords_enabled && (
				<div className="form-group">
					<label className="form-label">Blacklisted Words / Phrases (Comma Separated)</label>
					<textarea
						className="form-control"
						value={badwordsText}
						onChange={e => onChange('badwords_list', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
						placeholder="badword1, badword2, spamphrase"
					/>
				</div>
			)}
		</div>
	);
}
