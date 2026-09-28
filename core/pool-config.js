'use strict';

const DEFAULT_POOL_MAX = 1;

function poolMax(value = process.env.PG_POOL_MAX) {
	if (value === undefined || value === null || String(value).trim() === '') return DEFAULT_POOL_MAX;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_POOL_MAX;
}

module.exports = { DEFAULT_POOL_MAX, poolMax };
