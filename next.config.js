/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,
	devIndicators: false,
	// /dashboard used to mean two different products. It is split now, but old
	// links, bookmarks and anything already sent to a group chat still point here.
	async redirects() {
		return [
			{ source: '/dashboard', destination: '/activities', permanent: true },
			{ source: '/dashboard/:guildId', destination: '/servers/:guildId', permanent: true },
		];
	},
	async rewrites() {
		// EXPRESS_API_URL is an origin — `http://localhost:3001` — and both
		// rewrites below are built from it.
		//
		// They used to read it differently: /health stripped a trailing /api off
		// it, while /api/:path* used it raw as the whole destination. No single
		// value satisfied both. Set it to an origin and /api/:path* lost its
		// :path*, so every API call collapsed onto one URL; set it to the
		// `.../api/:path*` form the other default implied and /health went to
		// `.../api/:path*/health`. It only behaved when left unset, with each
		// rewrite falling back to its own literal.
		//
		// The `/api/:path*` suffix is still accepted so deployments that already
		// set it that way keep working.
		const expressOrigin = (
			process.env.EXPRESS_API_URL || `http://localhost:${process.env.EXPRESS_PORT || 3001}`
		)
			.replace(/\/api\/:path\*$/, '')
			.replace(/\/+$/, '');

		return [
			{
				source: '/health',
				destination: `${expressOrigin}/health`,
			},
			{
				source: '/api/:path*',
				destination: `${expressOrigin}/api/:path*`,
			},
		];
	},
};

module.exports = nextConfig;
