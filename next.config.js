/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,
	devIndicators: false,
	async rewrites() {
		return [
			{
				source: '/api/:path*',
				destination: process.env.EXPRESS_API_URL || 'http://localhost:3001/api/:path*',
			},
		];
	},
};

module.exports = nextConfig;
