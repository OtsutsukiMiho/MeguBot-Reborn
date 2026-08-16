'use client';

import CustomSelect from '../CustomSelect';

export default function AutoroleTab({ config, roles, onChange }) {
	const humanRoles = Array.isArray(config.autorole_ids)
		? config.autorole_ids
		: (config.autorole_id ? [config.autorole_id] : []);

	const botRoles = Array.isArray(config.bot_autorole_ids)
		? config.bot_autorole_ids
		: [];

	const rolesMap = new Map((roles || []).map(r => [r.id, r]));

	const handleAddHumanRole = (rId) => {
		if (!rId || humanRoles.includes(rId)) return;
		const updated = [...humanRoles, rId];
		onChange('autorole_ids', updated);
		onChange('autorole_id', updated[0] || null);
	};

	const handleRemoveHumanRole = (rId) => {
		const updated = humanRoles.filter(id => id !== rId);
		onChange('autorole_ids', updated);
		onChange('autorole_id', updated[0] || null);
	};

	const handleAddBotRole = (rId) => {
		if (!rId || botRoles.includes(rId)) return;
		onChange('bot_autorole_ids', [...botRoles, rId]);
	};

	const handleRemoveBotRole = (rId) => {
		onChange('bot_autorole_ids', botRoles.filter(id => id !== rId));
	};

	const getRoleColorStyle = (role) => {
		if (!role) return '#8A8F9E';
		if (role.hexColor && role.hexColor !== '#000000') return role.hexColor;
		if (role.color !== undefined && role.color !== null && role.color !== 0 && role.color !== '#000000') {
			if (typeof role.color === 'string' && role.color.startsWith('#')) return role.color;
			return '#' + Number(role.color).toString(16).padStart(6, '0');
		}
		return '#8A8F9E';
	};

	return (
		<div>
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
				<div>
					<h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '0.25rem' }}>
						Automatic Autorole Assignment
					</h3>
					<p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
						Configure onboarding roles automatically granted to new members and bot accounts upon joining your Discord server.
					</p>
				</div>
				<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
					<span className="status-badge" style={{ background: 'var(--accent-soft)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)', color: 'var(--accent)' }}>
						{roles?.length || 0} Total Server Roles
					</span>
				</div>
			</div>

			{/* Section 1: Human Member Auto-Roles */}
			<div style={{ background: 'var(--surface-2)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem' }}>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
					<div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--ink)' }}>
						Human Member Auto-Roles
					</div>
					<span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
						{humanRoles.length} Active {humanRoles.length === 1 ? 'Role' : 'Roles'}
					</span>
				</div>
				<p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
					Assigned automatically to human users immediately upon joining the server.
				</p>

				{/* Active Human Role Badges */}
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.25rem', minHeight: '36px', alignItems: 'center' }}>
					{humanRoles.length === 0 ? (
						<span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
							No human autoroles configured. Select a role below to add.
						</span>
					) : (
						humanRoles.map(rId => {
							const r = rolesMap.get(rId);
							const roleColor = getRoleColorStyle(r);
							return (
								<span
									key={rId}
									className="tag-badge"
									style={{
										display: 'inline-flex',
										alignItems: 'center',
										gap: '0.5rem',
										background: `color-mix(in srgb, ${roleColor} 14%, transparent)`,
										border: `1px solid color-mix(in srgb, ${roleColor} 40%, transparent)`,
										padding: '0.4rem 0.8rem',
										borderRadius: '6px',
										fontSize: '0.85rem',
									}}
								>
									<span style={{ width: '8px', height: '8px', borderRadius: '50%', background: roleColor, boxShadow: `0 0 6px color-mix(in srgb, ${roleColor} 50%, transparent)` }}></span>
									<span style={{ color: 'var(--ink)', fontWeight: 600 }}>@{r ? r.name : `ID: ${rId}`}</span>
									<button
										onClick={() => handleRemoveHumanRole(rId)}
										title="Remove Role"
										style={{
											background: 'none',
											border: 'none',
											color: 'var(--text-muted)',
											cursor: 'pointer',
											fontSize: '0.85rem',
											lineHeight: 1,
											padding: '0 0.15rem',
											transition: 'color 0.15s ease',
										}}
										onMouseEnter={e => e.target.style.color = 'var(--due)'}
										onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}
									>
										✕
									</button>
								</span>
							);
						})
					)}
				</div>

				<div className="form-group" style={{ marginBottom: 0 }}>
					<label className="form-label">Add Human Auto-Role</label>
					<CustomSelect
						type="role"
						placeholder="Choose a role to assign to new human members..."
						value=""
						onChange={(val) => handleAddHumanRole(val)}
						options={(roles || [])
							.filter(r => !humanRoles.includes(r.id) && r.name !== '@everyone')
							.map(r => ({
								value: r.id,
								label: `@${r.name}`,
								color: r.hexColor || r.color,
							}))
						}
					/>
				</div>
			</div>

			{/* Section 2: Bot Account Auto-Roles */}
			<div style={{ background: 'var(--surface-2)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem' }}>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
					<div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--ink)' }}>
						Bot Account Auto-Roles
					</div>
					<span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
						{botRoles.length} Active {botRoles.length === 1 ? 'Role' : 'Roles'}
					</span>
				</div>
				<p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
					Assigned automatically when a bot integration account is added to the server.
				</p>

				{/* Active Bot Role Badges */}
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.25rem', minHeight: '36px', alignItems: 'center' }}>
					{botRoles.length === 0 ? (
						<span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
							No bot autoroles configured. Select a role below to add.
						</span>
					) : (
						botRoles.map(rId => {
							const r = rolesMap.get(rId);
							const roleColor = getRoleColorStyle(r);
							return (
								<span
									key={rId}
									className="tag-badge"
									style={{
										display: 'inline-flex',
										alignItems: 'center',
										gap: '0.5rem',
										background: `color-mix(in srgb, ${roleColor} 14%, transparent)`,
										border: `1px solid color-mix(in srgb, ${roleColor} 40%, transparent)`,
										padding: '0.4rem 0.8rem',
										borderRadius: '6px',
										fontSize: '0.85rem',
									}}
								>
									<span style={{ width: '8px', height: '8px', borderRadius: '50%', background: roleColor, boxShadow: `0 0 6px color-mix(in srgb, ${roleColor} 50%, transparent)` }}></span>
									<span style={{ color: 'var(--ink)', fontWeight: 600 }}>@{r ? r.name : `ID: ${rId}`}</span>
									<button
										onClick={() => handleRemoveBotRole(rId)}
										title="Remove Role"
										style={{
											background: 'none',
											border: 'none',
											color: 'var(--text-muted)',
											cursor: 'pointer',
											fontSize: '0.85rem',
											lineHeight: 1,
											padding: '0 0.15rem',
											transition: 'color 0.15s ease',
										}}
										onMouseEnter={e => e.target.style.color = 'var(--due)'}
										onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}
									>
										✕
									</button>
								</span>
							);
						})
					)}
				</div>

				<div className="form-group" style={{ marginBottom: 0 }}>
					<label className="form-label">Add Bot Auto-Role</label>
					<CustomSelect
						type="role"
						placeholder="Choose a role to assign to new bot accounts..."
						value=""
						onChange={(val) => handleAddBotRole(val)}
						options={(roles || [])
							.filter(r => !botRoles.includes(r.id) && r.name !== '@everyone')
							.map(r => ({
								value: r.id,
								label: `@${r.name}`,
								color: r.hexColor || r.color,
							}))
						}
					/>
				</div>
			</div>
		</div>
	);
}
