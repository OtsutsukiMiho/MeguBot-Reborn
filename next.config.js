const { expressOrigin } = require('./app/lib/express-origin.js');

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
		// Both rewrites are built from one origin; see app/lib/express-origin.js
		// for why it once had to be read two ways and no longer does.
		const origin = expressOrigin();

		return [
			{
				source: '/health',
				destination: `${origin}/health`,
			},
			{
				source: '/api/:path*',
				destination: `${origin}/api/:path*`,
			},
		];
	},
};

module.exports = nextConfig;
