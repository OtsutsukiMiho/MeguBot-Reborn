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
		if (!role) return '#a5b4fc';
		if (role.hexColor && role.hexColor !== '#000000') return role.hexColor;
		if (role.color !== undefined && role.color !== null && role.color !== 0 && role.color !== '#000000') {
			if (typeof role.color === 'string' && role.color.startsWith('#')) return role.color;
			return '#' + Number(role.color).toString(16).padStart(6, '0');
		}
		return '#a5b4fc';
	};

	return (
		<div>
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
				<div>
					<h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ffffff', marginBottom: '0.25rem' }}>
						Automatic Autorole Assignment
					</h3>
					<p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
						Configure onboarding roles automatically granted to new members and bot accounts upon joining your Discord server.
					</p>
				</div>
				<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
					<span className="status-badge" style={{ background: 'rgba(79, 70, 229, 0.1)', border: '1px solid rgba(79, 70, 229, 0.25)', color: '#a5b4fc' }}>
						{roles?.length || 0} Total Server Roles
					</span>
				</div>
			</div>

			{/* Section 1: Human Member Auto-Roles */}
			<div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem' }}>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
					<div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#ffffff' }}>
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
										background: `${roleColor}14`,
										border: `1px solid ${roleColor}40`,
										padding: '0.4rem 0.8rem',
										borderRadius: '6px',
										fontSize: '0.85rem',
									}}
								>
									<span style={{ width: '8px', height: '8px', borderRadius: '50%', background: roleColor, boxShadow: `0 0 6px ${roleColor}80` }}></span>
									<span style={{ color: roleColor, fontWeight: 600 }}>@{r ? r.name : `ID: ${rId}`}</span>
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
										onMouseEnter={e => e.target.style.color = '#f87171'}
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
			<div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem' }}>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
					<div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#ffffff' }}>
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
										background: `${roleColor}14`,
										border: `1px solid ${roleColor}40`,
										padding: '0.4rem 0.8rem',
										borderRadius: '6px',
										fontSize: '0.85rem',
									}}
								>
									<span style={{ width: '8px', height: '8px', borderRadius: '50%', background: roleColor, boxShadow: `0 0 6px ${roleColor}80` }}></span>
									<span style={{ color: roleColor, fontWeight: 600 }}>@{r ? r.name : `ID: ${rId}`}</span>
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
										onMouseEnter={e => e.target.style.color = '#f87171'}
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
