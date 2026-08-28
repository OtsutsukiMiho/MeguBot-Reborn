// A locale's words, with the base language underneath every gap.
//
// A translation lands one release behind the feature it describes, every time.
// Without a fallback that shows up as `undefined` rendered into the middle of a
// sentence, or — when the missing key was one of the many that are functions —
// as a page that throws on render. A line of copy nobody had translated yet
// could take a screen down.
//
// English is the base language of this product, so falling back to it is the
// honest failure: the reader sees a sentence in a language they may not have
// asked for, rather than a blank where an amount should be.
//
// Kept out of `index.js` because that file is a React module and this is plain
// arithmetic on objects — it should be testable without a renderer.

function isPlainObject(value) {
	return typeof value === 'object'
		&& value !== null
		&& !Array.isArray(value)
		&& typeof value !== 'function';
}

/**
 * `override` wins wherever it says anything; `base` fills in the rest.
 *
 * Recurses into plain objects only. Functions and arrays are leaves — a
 * dictionary entry like `count => \`${count} left\`` is one value, not a
 * structure to merge into, and a half-merged function is not a thing.
 *
 * `null` and `undefined` in the override are treated as "not translated"
 * rather than "translated to nothing", because the second is never what a
 * dictionary means and the first happens constantly.
 */
function withFallback(base, override) {
	if (!override) return base;
	if (!isPlainObject(base)) return override;

	const out = { ...base };
	for (const [key, value] of Object.entries(override)) {
		if (value === undefined || value === null) continue;
		out[key] = isPlainObject(value) && isPlainObject(base[key])
			? withFallback(base[key], value)
			: value;
	}
	return out;
}

module.exports = { withFallback };
