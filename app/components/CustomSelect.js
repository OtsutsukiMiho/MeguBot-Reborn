'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Hash, Search } from 'lucide-react';
import styles from './customSelect.module.css';

/**
 * Searchable single-value select used throughout the server workspace.
 * Options support: { value, label, color, subtitle, badge, avatar }.
 */
export default function CustomSelect({
	value,
	onChange,
	options = [],
	placeholder = 'Select an option…',
	type = 'default',
	searchable = true,
	disabled = false,
	style = {},
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [openUpward, setOpenUpward] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');
	const rootRef = useRef(null);
	const triggerRef = useRef(null);
	const searchInputRef = useRef(null);
	const listboxId = useId();

	useEffect(() => {
		if (!isOpen || !rootRef.current) return;
		const rect = rootRef.current.getBoundingClientRect();
		const spaceBelow = window.innerHeight - rect.bottom;
		setOpenUpward(spaceBelow < 300 && rect.top > spaceBelow);
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) {
			setSearchQuery('');
			return undefined;
		}

		const handlePointerDown = event => {
			if (rootRef.current && !rootRef.current.contains(event.target)) setIsOpen(false);
		};
		const handleKeyDown = event => {
			if (event.key !== 'Escape') return;
			setIsOpen(false);
			triggerRef.current?.focus();
		};

		document.addEventListener('mousedown', handlePointerDown);
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('mousedown', handlePointerDown);
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [isOpen]);

	useEffect(() => {
		if (isOpen && searchable && options.length > 5) searchInputRef.current?.focus();
	}, [isOpen, options.length, searchable]);

	const selectedOption = useMemo(
		() => options.find(option => String(option.value) === String(value)),
		[options, value],
	);

	const filteredOptions = useMemo(() => {
		const query = searchQuery.trim().toLocaleLowerCase();
		if (!query) return options;
		return options.filter(option => {
			const label = String(option.label || '').toLocaleLowerCase();
			const subtitle = String(option.subtitle || '').toLocaleLowerCase();
			return label.includes(query) || subtitle.includes(query);
		});
	}, [options, searchQuery]);

	function optionColor(option) {
		if (!option?.color || option.color === '#000000') return null;
		if (typeof option.color === 'string' && option.color.startsWith('#')) return option.color;
		if (typeof option.color === 'number') return `#${option.color.toString(16).padStart(6, '0')}`;
		return null;
	}

	function selectOption(option) {
		onChange?.(option.value, option);
		setIsOpen(false);
		triggerRef.current?.focus();
	}

	const selectedColor = optionColor(selectedOption);

	return (
		<div ref={rootRef} className={styles.root} style={style}>
			<button
				ref={triggerRef}
				type="button"
				className={`${styles.trigger} ${isOpen ? styles.triggerOpen : ''}`.trim()}
				onClick={() => setIsOpen(open => !open)}
				disabled={disabled}
				aria-haspopup="listbox"
				aria-expanded={isOpen}
				aria-controls={isOpen ? listboxId : undefined}
			>
				<span className={styles.triggerValue}>
					{selectedOption ? (
						<>
							<OptionMark option={selectedOption} type={type} color={selectedColor} />
							<span className={styles.selectedText}>
								<span className={styles.selectedLabel} style={type === 'role' && selectedColor ? { color: selectedColor } : undefined}>
									{selectedOption.label}
								</span>
								{selectedOption.subtitle ? <span className={styles.selectedMeta}>{selectedOption.subtitle}</span> : null}
							</span>
						</>
					) : (
						<span className={styles.placeholder}>{placeholder}</span>
					)}
				</span>
				<ChevronDown className={styles.chevron} size={17} aria-hidden="true" />
			</button>

			{isOpen ? (
				<div className={`${styles.menu} ${openUpward ? styles.menuUpward : ''}`.trim()}>
					{searchable && options.length > 5 ? (
						<label className={styles.searchField}>
							<Search size={15} aria-hidden="true" />
							<span className={styles.srOnly}>Search options</span>
							<input
								ref={searchInputRef}
								type="search"
								value={searchQuery}
								onChange={event => setSearchQuery(event.target.value)}
								placeholder="Search options…"
							/>
						</label>
					) : null}

					<div id={listboxId} className={styles.options} role="listbox" tabIndex="-1">
						{filteredOptions.length ? filteredOptions.map(option => {
							const color = optionColor(option);
							const isSelected = String(option.value) === String(value);
							return (
								<button
									key={option.value}
									type="button"
									className={`${styles.option} ${isSelected ? styles.optionSelected : ''}`.trim()}
									onClick={() => selectOption(option)}
									role="option"
									aria-selected={isSelected}
								>
									<OptionMark option={option} type={type} color={color} />
									<span className={styles.optionCopy}>
										<span className={styles.optionLabel} style={type === 'role' && color ? { color } : undefined}>{option.label}</span>
										{option.subtitle ? <span className={styles.optionSubtitle}>{option.subtitle}</span> : null}
									</span>
									{option.badge ? <span className={styles.badge}>{option.badge}</span> : null}
									{isSelected ? <Check className={styles.check} size={16} aria-hidden="true" /> : null}
								</button>
							);
						}) : (
							<p className={styles.empty}>No matching options</p>
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}

function OptionMark({ option, type, color }) {
	if (type === 'member' && option.avatar) {
		return <img className={styles.avatar} src={option.avatar} alt="" />;
	}
	if (type === 'role') {
		return <span className={styles.colorDot} style={{ background: color || 'var(--accent)' }} aria-hidden="true" />;
	}
	if (type === 'channel') {
		return <Hash className={styles.channelIcon} size={15} aria-hidden="true" />;
	}
	return null;
}
