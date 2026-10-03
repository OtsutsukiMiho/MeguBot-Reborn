'use strict';

const DEFAULT_BATCH_WINDOW_MS = 1500;
const MIN_BATCH_WINDOW_MS = 500;
const MAX_BATCH_WINDOW_MS = 5000;

function validBatchWindow(value) {
	return typeof value === 'number' && Number.isInteger(value)
		&& value >= MIN_BATCH_WINDOW_MS && value <= MAX_BATCH_WINDOW_MS;
}
function resolveBatchWindow(value) {
	return validBatchWindow(value) ? value : DEFAULT_BATCH_WINDOW_MS;
}
function batchWindowFromSeconds(value) {
	if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return '';
	const ms = Number(value) * 1000;
	return Number.isFinite(ms) ? Math.round(ms) : '';
}

module.exports = { DEFAULT_BATCH_WINDOW_MS, MIN_BATCH_WINDOW_MS, MAX_BATCH_WINDOW_MS,
	validBatchWindow, resolveBatchWindow, batchWindowFromSeconds };
