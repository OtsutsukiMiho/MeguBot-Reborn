'use client';

import { useState, useEffect } from 'react';

const DISCORD_ROLE_PALETTE = [
	{ name: 'Discord Blurple', hex: '#5865F2' },
	{ name: 'Green', hex: '#57F287' },
	{ name: 'Yellow', hex: '#FEE75C' },
	{ name: 'Fuchsia', hex: '#EB459E' },
	{ name: 'Red', hex: '#ED4245' },
	{ name: 'Emerald', hex: '#3BA55D' },
	{ name: 'Electric Cyan', hex: '#00AFF4' },
	{ name: 'Coral', hex: '#F47B67' },
	{ name: 'Purple', hex: '#9B59B6' },
	{ name: 'Hot Pink', hex: '#E91E63' },
	{ name: 'Turquoise', hex: '#1ABC9C' },
	{ name: 'Ocean Blue', hex: '#3498DB' },
	{ name: 'Sunset Orange', hex: '#E67E22' },
	{ name: 'Ruby', hex: '#E74C3C' },
	{ name: 'Silver', hex: '#95A5A6' },
	{ name: 'Dark Slate', hex: '#4F545C' },
];

export default function ColorPicker({
	// A hex literal, not a token: this value is shown in the hex field and sent
	// to Discord as the role colour.
	color = '#9ca3af',
	onChange,
	roleName = 'Role Preview',
	label = 'Role Color',
}) {
	const [inputHex, setInputHex] = useState(color || '#9ca3af');

	useEffect(() => {
		if (color) setInputHex(color);
	}, [color]);

	const handleHexChange = (val) => {
		let formatted = val.trim();
		if (!formatted.startsWith('#')) formatted = '#' + formatted;
		setInputHex(formatted);
		if (/^#[0-9A-Fa-f]{6}$/.test(formatted)) {
			if (onChange) onChange(formatted.toUpperCase());
		}
	};

	const handleSwatchClick = (hex) => {
		setInputHex(hex);
		if (onChange) onChange(hex);
	};

	const activeColor = inputHex && inputHex.startsWith('#') ? inputHex : 'var(--muted)';

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
				<label className="form-label" style={{ marginBottom: 0 }}>
					{label}
				</label>
				{/* Live Discord Role Badge Simulator */}
				<span
					style={{
						display: 'inline-flex',
						alignItems: 'center',
						gap: '0.45rem',
						background: `${activeColor}18`,
						border: `1px solid ${activeColor}50`,
						padding: '0.25rem 0.65rem',
						borderRadius: '6px',
						fontSize: '0.8rem',
						fontWeight: 700,
						color: activeColor,
						boxShadow: `0 0 12px ${activeColor}25`,
					}}
				>
					<span
						style={{
							width: '8px',
							height: '8px',
							borderRadius: '50%',
							background: activeColor,
							boxShadow: `0 0 6px ${activeColor}`,
						}}
					/>
					@{roleName || 'Preview'}
				</span>
			</div>

			{/* Color Presets Grid */}
			<div
				style={{
					display: 'grid',
					gridTemplateColumns: 'repeat(8, 1fr)',
					gap: '0.45rem',
					background: 'rgba(0, 0, 0, 0.25)',
					padding: '0.65rem',
					borderRadius: '10px',
					border: '1px solid var(--border-color)',
				}}
			>
				{DISCORD_ROLE_PALETTE.map((swatch) => {
					const isSelected = activeColor.toUpperCase() === swatch.hex.toUpperCase();
					return (
						<button
							key={swatch.hex}
							type="button"
							title={swatch.name}
							onClick={() => handleSwatchClick(swatch.hex)}
							style={{
								height: '28px',
								borderRadius: '6px',
								background: swatch.hex,
								border: isSelected ? '2px solid var(--ink)' : '1px solid var(--line-2)',
								boxShadow: isSelected ? `0 0 10px ${swatch.hex}, 0 0 0 2px rgba(255,255,255,0.8)` : 'none',
								cursor: 'pointer',
								transform: isSelected ? 'scale(1.1)' : 'scale(1)',
								transition: 'all 0.15s ease',
							}}
						/>
					);
				})}
			</div>

			{/* Custom Hex Picker Input & Eye-Dropper */}
			<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
				{/* Native Color Wheel Trigger */}
				<div
					style={{
						position: 'relative',
						width: '38px',
						height: '38px',
						borderRadius: '8px',
						background: activeColor,
						border: '1px solid var(--border-color)',
						boxShadow: `0 0 8px ${activeColor}40`,
						overflow: 'hidden',
						flexShrink: 0,
						cursor: 'pointer',
					}}
				>
					<input
						type="color"
						value={activeColor.length === 7 ? activeColor : '#5865F2'}
						onChange={(e) => handleSwatchClick(e.target.value.toUpperCase())}
						style={{
							position: 'absolute',
							top: '-8px',
							left: '-8px',
							width: '60px',
							height: '60px',
							opacity: 0,
							cursor: 'pointer',
						}}
					/>
				</div>

				<div style={{ flex: 1 }}>
					<input
						type="text"
						className="form-control"
						value={inputHex}
						onChange={(e) => handleHexChange(e.target.value)}
						placeholder="#5865F2"
						maxLength={7}
						style={{
							fontFamily: 'var(--font-mono)',
							fontSize: '0.85rem',
							letterSpacing: '0.05em',
							fontWeight: 600,
						}}
					/>
				</div>

				<button
					type="button"
					onClick={() => handleSwatchClick('#99AAB5')}
					className="btn btn-secondary btn-sm"
					style={{ fontSize: '0.75rem', padding: '0.5rem 0.8rem', whiteSpace: 'nowrap' }}
				>
					Default
				</button>
			</div>
		</div>
	);
}
