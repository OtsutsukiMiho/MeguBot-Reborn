'use strict';

const invalid = code => { throw Object.assign(new Error(code), { code }); };
const finite = value => typeof value === 'number' && Number.isFinite(value);

function validateMeasurement(input) {
	if (!input || !['numeric', 'milestone'].includes(input.kind)) invalid('goal_measurement_invalid');
	if (input.kind === 'milestone') {
		if (typeof input.criteria !== 'string' || !input.criteria.trim() || input.criteria.length > 4000) invalid('goal_criteria_required');
		if (['baseline', 'target', 'current', 'direction', 'unit'].some(key => input[key] != null)) invalid('goal_measurement_invalid');
		return { kind: 'milestone', criteria: input.criteria.trim() };
	}
	if (!['increase', 'decrease'].includes(input.direction) || !finite(input.baseline) || !finite(input.target)) invalid('goal_measurement_invalid');
	if (input.direction === 'increase' ? input.target <= input.baseline : input.target >= input.baseline) invalid('goal_target_invalid');
	if (input.current != null && !finite(input.current)) invalid('goal_value_invalid');
	if (typeof input.unit !== 'string' || !input.unit.trim() || input.unit.length > 80) invalid('goal_unit_required');
	return { kind: 'numeric', direction: input.direction, unit: input.unit.trim(), baseline: input.baseline, target: input.target, current: input.current ?? null };
}

function achievement(input) {
	const measurement = validateMeasurement(input);
	if (measurement.kind === 'milestone' || measurement.current === null) return null;
	const { baseline, target, current, direction } = measurement;
	if (direction === 'increase' ? current >= target : current <= target) return 100;
	if (direction === 'increase' ? current <= baseline : current >= baseline) return 0;
	const span = target - baseline;
	if (Number.isFinite(span)) return 100 * ((current - baseline) / span);
	// Scale before subtraction so opposite-sign finite values cannot overflow.
	const scale = Math.max(Math.abs(baseline), Math.abs(target));
	return Math.min(100, Math.max(0, 100 * ((current / scale - baseline / scale) / (target / scale - baseline / scale))));
}

function validateEvidence(input, kind) {
	if (!input || !['numeric', 'milestone'].includes(kind)) invalid('goal_evidence_invalid');
	if (typeof input.note !== 'string' || !input.note.trim() || input.note.length > 4000) invalid('goal_evidence_note_required');
	if (input.value != null && (kind !== 'numeric' || !finite(input.value))) invalid('goal_value_invalid');
	const links = input.links ?? [];
	if (!Array.isArray(links) || links.length > 10) invalid('goal_evidence_links_invalid');
	for (const link of links) {
		if (typeof link !== 'string' || link.length > 2048) invalid('goal_evidence_links_invalid');
		let url;
		try { url = new URL(link); } catch { invalid('goal_evidence_links_invalid'); }
		if (url.protocol !== 'https:' || url.username || url.password) invalid('goal_evidence_links_invalid');
	}
	const result = { note: input.note.trim(), value: input.value ?? null, links: [...links] };
	if (input.reference != null) {
		const ref = input.reference;
		if (typeof ref !== 'object' || Array.isArray(ref) || Object.keys(ref).some(key => !['projectCode', 'topicId'].includes(key)) ||
			typeof ref.projectCode !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(ref.projectCode) ||
			(ref.topicId != null && (typeof ref.topicId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(ref.topicId)))) invalid('goal_reference_invalid');
		result.reference = { projectCode: ref.projectCode.toUpperCase(), topicId: ref.topicId ?? null };
	}
	return result;
}

module.exports = { validateMeasurement, achievement, validateEvidence };
