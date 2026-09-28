'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Hash, Search } from 'lucide-react';
import { useCopy } from '../copy';
import styles from './customSelect.module.css';

/**
 * Searchable single-value select used throughout the server workspace.
 * Options support: { value, label, color, subtitle, badge, avatar }.
 */
export default function CustomSelect({
	value,
	onChange,
	options = [],
	placeholder,
	type = 'default',
	searchable = true,
	disabled = false,
	required = false,
	size = 'default',
	className = '',
	style = {},
	ariaLabel,
	ariaDescribedBy,
	unavailableLabel,
}) {
	const { t } = useCopy();
	const selectCopy = t.serverTabs.shared;
	const resolvedPlaceholder = placeholder || selectCopy.selectOption;
	const resolvedUnavailableLabel = unavailableLabel || selectCopy.unavailableSelection;
	const [isOpen, setIsOpen] = useState(false);
	const [openUpward, setOpenUpward] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');
	const [activeValue, setActiveValue] = useState(null);
	const rootRef = useRef(null);
	const triggerRef = useRef(null);
	const searchInputRef = useRef(null);
	const listboxRef = useRef(null);
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
		document.addEventListener('mousedown', handlePointerDown);
		return () => {
			document.removeEventListener('mousedown', handlePointerDown);
		};
	}, [isOpen]);

	useEffect(() => {
		if (isOpen) (searchable && options.length > 5 ? searchInputRef : listboxRef).current?.focus();
	}, [isOpen, options.length, searchable]);

	useEffect(() => { if (disabled) setIsOpen(false); }, [disabled]);

	const selectedOption = useMemo(() => {
		const selected = options.find(option => String(option.value) === String(value));
		if (selected || value === undefined || value === null || value === '') return selected;
		return { value, label: resolvedUnavailableLabel, subtitle: String(value), unavailable: true };
	}, [options, resolvedUnavailableLabel, value]);

	const filteredOptions = useMemo(() => {
		const query = searchQuery.trim().toLocaleLowerCase();
		if (!query) return options;
		return options.filter(option => {
			const label = String(option.label || '').toLocaleLowerCase();
			const subtitle = String(option.subtitle || '').toLocaleLowerCase();
			return label.includes(query) || subtitle.includes(query);
		});
	}, [options, searchQuery]);
	const enabledOptions = filteredOptions.filter(option => !option.disabled);
	const activeIndex = filteredOptions.findIndex(option => !option.disabled && String(option.value) === String(activeValue));
	const focusedOption = activeIndex >= 0 ? filteredOptions[activeIndex] : enabledOptions[0];
	const focusedIndex = filteredOptions.indexOf(focusedOption);
	const optionId = index => `${listboxId}-option-${index}`;
	const activeId = focusedIndex >= 0 ? optionId(focusedIndex) : undefined;
	useEffect(() => { if (isOpen && focusedIndex >= 0) listboxRef.current?.children?.[focusedIndex]?.scrollIntoView?.({ block: 'nearest' }); }, [isOpen, focusedIndex]);

	function openSelect(key) {
		const available = options.filter(option => !option.disabled);
		const selected = available.find(option => String(option.value) === String(value));
		setActiveValue(key === 'End' || key === 'ArrowUp' ? available.at(-1)?.value : key === 'Home' ? available[0]?.value : selected?.value ?? available[0]?.value);
		setIsOpen(true);
	}

	function handleMenuKeyDown(event) {
		if (event.key === 'Escape') { event.preventDefault(); setIsOpen(false); triggerRef.current?.focus(); return; }
		if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
			event.preventDefault();
			if (!enabledOptions.length) return;
			const current = enabledOptions.findIndex(option => String(option.value) === String(focusedOption?.value));
			const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabledOptions.length - 1
				: (current + (event.key === 'ArrowDown' ? 1 : -1) + enabledOptions.length) % enabledOptions.length;
			setActiveValue(enabledOptions[next].value);
			return;
		}
		if (event.key === 'Enter' || (event.key === ' ' && event.target !== searchInputRef.current)) {
			event.preventDefault();
			if (focusedOption) selectOption(focusedOption);
		}
	}

	function optionColor(option) {
		if (!option?.color || option.color === '#000000') return null;
		if (typeof option.color === 'string' && option.color.startsWith('#')) return option.color;
		if (typeof option.color === 'number') return `#${option.color.toString(16).padStart(6, '0')}`;
		return null;
	}

	function selectOption(option) {
		if (disabled || option.disabled) return;
		onChange?.(option.value, option);
		setIsOpen(false);
		triggerRef.current?.focus();
	}

	const selectedColor = optionColor(selectedOption);

	return (
		<div ref={rootRef} className={`${styles.root} ${size === 'compact' ? styles.compact : ''} ${className}`.trim()} style={style} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false); }}>
			<button
				ref={triggerRef}
				type="button"
				className={`${styles.trigger} ${isOpen ? styles.triggerOpen : ''}`.trim()}
				onClick={() => isOpen ? setIsOpen(false) : openSelect()}
				onKeyDown={event => {
					if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); isOpen ? handleMenuKeyDown(event) : openSelect(event.key); }
					else if (isOpen && event.key === 'Escape') handleMenuKeyDown(event);
				}}
				disabled={disabled}
				aria-haspopup="listbox"
				aria-label={ariaLabel || resolvedPlaceholder}
				aria-describedby={ariaDescribedBy}
				aria-required={required || undefined}
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
						<span className={styles.placeholder}>{resolvedPlaceholder}</span>
					)}
				</span>
				<ChevronDown className={styles.chevron} size={17} aria-hidden="true" />
			</button>

			{isOpen ? (
				<div className={`${styles.menu} ${openUpward ? styles.menuUpward : ''}`.trim()} onKeyDown={handleMenuKeyDown}>
					{searchable && options.length > 5 ? (
						<label className={styles.searchField}>
							<Search size={15} aria-hidden="true" />
							<span className={styles.srOnly}>{selectCopy.searchOptions}</span>
							<input
								ref={searchInputRef}
								type="search"
								value={searchQuery}
								onChange={event => setSearchQuery(event.target.value)}
								placeholder={selectCopy.searchOptionsPlaceholder}
								aria-controls={listboxId}
								aria-activedescendant={activeId}
							/>
						</label>
					) : null}

					<div ref={listboxRef} id={listboxId} className={styles.options} role="listbox" aria-label={ariaLabel || resolvedPlaceholder} aria-activedescendant={activeId} tabIndex={searchable && options.length > 5 ? -1 : 0}>
						{filteredOptions.length ? filteredOptions.map((option, index) => {
							const color = optionColor(option);
							const isSelected = String(option.value) === String(value);
							return (
								<button
									key={option.value}
									id={optionId(index)}
									type="button"
									className={`${styles.option} ${isSelected ? styles.optionSelected : ''} ${focusedIndex === index ? styles.optionActive : ''}`.trim()}
									onClick={() => selectOption(option)}
									role="option"
									aria-selected={isSelected}
									aria-disabled={option.disabled || undefined}
									disabled={option.disabled}
									tabIndex={-1}
									onMouseEnter={() => { if (!option.disabled) setActiveValue(option.value); }}
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
							<p className={styles.empty}>{selectCopy.noMatchingOptions}</p>
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
