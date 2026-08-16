let sink = (scope, message) => console.log(`[${scope}] ${message}`);

/**
 * Adapters inject the host logger here so core stays free of platform imports.
 */
function setLogger(fn) {
	if (typeof fn === 'function') sink = fn;
}

function log(scope, message) {
	sink(scope, message);
}

module.exports = { setLogger, log };
