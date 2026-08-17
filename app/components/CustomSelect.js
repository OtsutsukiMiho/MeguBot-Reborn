'use client';

import { useState, useRef, useEffect, useMemo } from 'react';

/**
 * CustomSelect - Modern glassmorphic dropdown with color dots, search, and smart auto-upward positioning
 * @param {string|number} value - Selected value
 * @param {function} onChange - Change callback (val, item)
 * @param {Array} options - [{ value, label, color, icon, subtitle, badge }]
 * @param {string} placeholder - Default placeholder text
 * @param {string} type - 'role' | 'channel' | 'member' | 'default'
 * @param {boolean} searchable - Show search input inside dropdown
 * @param {boolean} disabled - Disable input
 */
export default function CustomSelect({
	value,
	onChange,
	options = [],
	placeholder = 'Select an option...',
	type = 'default',
	searchable = true,
	disabled = false,
	style = {},
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [openUpward, setOpenUpward] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');
	const dropdownRef = useRef(null);
	const searchInputRef = useRef(null);

	// Smart position calculation on open
	useEffect(() => {
		if (isOpen && dropdownRef.current) {
			const rect = dropdownRef.current.getBoundingClientRect();
			const spaceBelow = window.innerHeight - rect.bottom;
			if (spaceBelow < 280 && rect.top > spaceBelow) {
				setOpenUpward(true);
			} else {
				setOpenUpward(false);
			}
		}
	}, [isOpen]);

	// Close when clicking outside
	useEffect(() => {
		const handleClickOutside = (e) => {
			if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
				setIsOpen(false);
			}
		};
		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside);
		}
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [isOpen]);

	// Auto-focus search input when opening
	useEffect(() => {
		if (isOpen && searchable && searchInputRef.current) {
			searchInputRef.current.focus();
		}
		if (!isOpen) {
			setSearchQuery('');
		}
	}, [isOpen, searchable]);

	const selectedOption = useMemo(() => {
		return options.find(opt => String(opt.value) === String(value));
	}, [options, value]);

	const filteredOptions = useMemo(() => {
		if (!searchQuery.trim()) return options;
		const q = searchQuery.toLowerCase().trim();
		return options.filter(opt => {
			const labelMatch = (opt.label || '').toLowerCase().includes(q);
			const subtitleMatch = (opt.subtitle || '').toLowerCase().includes(q);
			return labelMatch || subtitleMatch;
		});
	}, [options, searchQuery]);

	const handleSelect = (option) => {
		if (onChange) onChange(option.value, option);
		setIsOpen(false);
	};

	const getOptionColor = (opt) => {
		if (!opt) return null;
		if (opt.color && opt.color !== '#000000' && opt.color !== 0) {
			if (typeof opt.color === 'string' && opt.color.startsWith('#')) return opt.color;
			if (typeof opt.color === 'number') return '#' + opt.color.toString(16).padStart(6, '0');
		}
		return null;
	};

	const selectedColor = getOptionColor(selectedOption);

	return (
		<div
			ref={dropdownRef}
			style={{
				position: 'relative',
				width: '100%',
				userSelect: 'none',
				...style,
			}}
		>
			{/* Trigger Button */}
			<div
				onClick={() => !disabled && setIsOpen(!isOpen)}
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: '0.65rem',
					background: 'var(--surface)',
					border: isOpen ? '1px solid var(--color-accent)' : '1px solid var(--border-color)',
					borderRadius: '8px',
					padding: '0.6rem 0.9rem',
					cursor: disabled ? 'not-allowed' : 'pointer',
					opacity: disabled ? 0.6 : 1,
					transition: 'all 0.15s ease',
					boxShadow: isOpen ? '0 0 0 3px var(--accent-soft)' : 'none',
				}}
			>
				<div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0, flex: 1, overflow: 'hidden' }}>
					{selectedOption ? (
						<>
							{/* Role Color Dot */}
							{type === 'role' && selectedColor && (
								<span
									style={{
										width: '10px',
										height: '10px',
										borderRadius: '50%',
										background: selectedColor,
										boxShadow: `0 0 8px ${selectedColor}80`,
										flexShrink: 0,
									}}
								/>
							)}

							{/* Channel Icon */}
							{type === 'channel' && (
								<span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', flexShrink: 0 }}>
									{selectedOption.icon || '#'}
								</span>
							)}

							{/* Member Avatar */}
							{type === 'member' && selectedOption.avatar && (
								<img
									src={selectedOption.avatar}
									alt=""
									style={{ width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
								/>
							)}

							<span
								style={{
									fontSize: '0.875rem',
									fontWeight: 600,
									color: (type === 'role' && selectedColor) ? selectedColor : 'var(--ink)',
									whiteSpace: 'nowrap',
									overflow: 'hidden',
									textOverflow: 'ellipsis',
								}}
							>
								{selectedOption.label}
							</span>

							{selectedOption.subtitle && (
								<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
									({selectedOption.subtitle})
								</span>
							)}
						</>
					) : (
						<span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
							{placeholder}
						</span>
					)}
				</div>

				{/* Arrow Dropdown Indicator */}
				<span
					style={{
						color: 'var(--text-secondary)',
						fontSize: '0.75rem',
						transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
						transition: 'transform 0.2s ease',
						flexShrink: 0,
					}}
				>
					▼
				</span>
			</div>

			{/* Dropdown Menu (Smart Upward or Downward) */}
			{isOpen && (
				<div
					style={{
						position: 'absolute',
						top: openUpward ? 'auto' : 'calc(100% + 6px)',
						bottom: openUpward ? 'calc(100% + 6px)' : 'auto',
						left: 0,
						right: 0,
						background: 'var(--surface)',
						border: '1px solid var(--border-color)',
						borderRadius: '10px',
						boxShadow: '0 16px 36px rgba(22, 24, 31, .28)',
						zIndex: 9999,
						overflow: 'hidden',
						animation: 'fadeIn 0.15s ease-out',
						display: 'flex',
						flexDirection: 'column',
						maxHeight: '260px',
					}}
				>
					{/* Search Bar if enabled */}
					{searchable && options.length > 5 && (
						<div style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-color)', background: 'var(--surface-2)' }}>
							<input
								ref={searchInputRef}
								type="text"
								placeholder="Search..."
								value={searchQuery}
								onChange={e => setSearchQuery(e.target.value)}
								onClick={e => e.stopPropagation()}
								style={{
									width: '100%',
									background: 'var(--sunk)',
									border: '1px solid var(--border-color)',
									borderRadius: '6px',
									padding: '0.4rem 0.65rem',
									color: 'var(--ink)',
									fontSize: '0.8rem',
									outline: 'none',
								}}
							/>
						</div>
					)}

					{/* Options List */}
					<div style={{ overflowY: 'auto', flex: 1, padding: '0.35rem' }}>
						{filteredOptions.length === 0 ? (
							<div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
								No matches found
							</div>
						) : (
							filteredOptions.map((opt) => {
								const optColor = getOptionColor(opt);
								const isSelected = String(opt.value) === String(value);

								return (
									<div
										key={opt.value}
										onClick={() => handleSelect(opt)}
										style={{
											display: 'flex',
											alignItems: 'center',
											justifyContent: 'space-between',
											gap: '0.65rem',
											padding: '0.5rem 0.75rem',
											borderRadius: '6px',
											cursor: 'pointer',
											background: isSelected ? 'var(--accent-soft)' : 'transparent',
											transition: 'background 0.12s ease',
										}}
										onMouseEnter={e => {
											if (!isSelected) e.currentTarget.style.background = 'var(--sunk)';
										}}
										onMouseLeave={e => {
											if (!isSelected) e.currentTarget.style.background = 'transparent';
										}}
									>
										<div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0, flex: 1 }}>
											{/* Role Color Dot */}
											{type === 'role' && (
												<span
													style={{
														width: '8px',
														height: '8px',
														borderRadius: '50%',
														background: optColor || 'var(--accent)',
														boxShadow: optColor ? `0 0 6px ${optColor}80` : 'none',
														flexShrink: 0,
													}}
												/>
											)}

											{/* Channel Icon */}
											{type === 'channel' && (
												<span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', flexShrink: 0 }}>
													{opt.icon || '#'}
												</span>
											)}

											{/* Member Avatar */}
											{type === 'member' && opt.avatar && (
												<img
													src={opt.avatar}
													alt=""
													style={{ width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
												/>
											)}

											<span
												style={{
													fontSize: '0.85rem',
													fontWeight: isSelected ? 700 : 500,
													color: (type === 'role' && optColor) ? optColor : (isSelected ? 'var(--ink)' : 'var(--text-primary)'),
													whiteSpace: 'nowrap',
													overflow: 'hidden',
													textOverflow: 'ellipsis',
												}}
											>
												{opt.label}
											</span>

											{opt.subtitle && (
												<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
													{opt.subtitle}
												</span>
											)}
										</div>

										{opt.badge && (
											<span
												style={{
													fontSize: '0.7rem',
													padding: '0.1rem 0.4rem',
													borderRadius: '4px',
													background: 'var(--sunk)',
													color: 'var(--text-secondary)',
													flexShrink: 0,
												}}
											>
												{opt.badge}
											</span>
										)}
									</div>
								);
							})
						)}
					</div>
				</div>
			)}
		</div>
	);
}
