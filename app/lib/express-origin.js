// Where the Express API listens, as an origin: `http://localhost:3001`.
//
// The rewrites in next.config.js and the server components that read the API
// directly (the bill link preview) both need it, and they must agree.
//
// EXPRESS_API_URL used to be read two different ways, one stripping a trailing
// /api and one using it raw, and no single value satisfied both. It is an
// origin now; the old `.../api/:path*` form is still accepted so deployments
// that already set it that way keep working.
function expressOrigin() {
	return (
		process.env.EXPRESS_API_URL || `http://localhost:${process.env.EXPRESS_PORT || 3001}`
	)
		.replace(/\/api\/:path\*$/, '')
		.replace(/\/+$/, '');
}

module.exports = { expressOrigin };
