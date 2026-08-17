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
		const expressBase = (process.env.EXPRESS_API_URL || 'http://localhost:3001').replace(/\/api\/?$/, '');
		return [
			{
				source: '/health',
				destination: `${expressBase}/health`,
			},
			{
				source: '/api/:path*',
				destination: process.env.EXPRESS_API_URL || 'http://localhost:3001/api/:path*',
			},
		];
	},
};

module.exports = nextConfig;
