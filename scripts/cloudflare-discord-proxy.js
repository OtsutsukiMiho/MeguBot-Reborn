/**
 * Cloudflare Worker: Discord API Reverse Proxy for MeguBot
 *
 * Why this exists:
 * Shared cloud hosts (like Render free tier) share outbound IPs among thousands
 * of users. When other tenants get that IP banned by Discord's Cloudflare WAF,
 * MeguBot's server-to-server calls (OAuth token exchange, /users/@me, etc.) fail.
 *
 * This worker acts as a transparent, high-speed reverse proxy running on
 * Cloudflare's global edge network (which Discord never bans).
 *
 * Setup (Takes ~2 minutes):
 * 1. Log in to Cloudflare Dashboard: https://dash.cloudflare.com/
 * 2. Navigate to "Compute (Workers & Pages)" -> Click "Create Application" -> "Create Worker".
 * 3. Name your worker (e.g. `megubot-discord-proxy`) and click "Deploy".
 * 4. Click "Edit code", replace all code with the contents of this file, and click "Deploy".
 * 5. (Recommended) Go to Worker "Settings" -> "Variables and Secrets" -> Add Secret:
 *    Name: PROXY_SECRET
 *    Value: <generate a random string, e.g. "megu_sec_987654321">
 * 6. In your Render.com Dashboard -> MeguBot Web Service -> "Environment":
 *    Add Variable:
 *    DISCORD_API_ENDPOINT = https://<your-worker-name>.<your-subdomain>.workers.dev/api/v10
 *    (If you set PROXY_SECRET above):
 *    DISCORD_PROXY_SECRET = <your-secret>
 */

export default {
	async fetch(request, env) {
		// 1. Optional Secret Protection: verify x-proxy-secret header if PROXY_SECRET is set
		if (env && env.PROXY_SECRET) {
			const incomingSecret = request.headers.get('x-proxy-secret');
			if (incomingSecret !== env.PROXY_SECRET) {
				return new Response('Unauthorized proxy request', { status: 401 });
			}
		}

		// 2. Health check route
		const url = new URL(request.url);
		if (url.pathname === '/' || url.pathname === '/health') {
			return new Response(JSON.stringify({ status: 'healthy', proxy: 'megu-discord-proxy' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// 3. Rewrite host to discord.com
		url.hostname = 'discord.com';
		url.port = '443';
		url.protocol = 'https:';

		// 4. Clone headers and prepare for Discord
		const forwardHeaders = new Headers(request.headers);
		forwardHeaders.delete('x-proxy-secret');
		forwardHeaders.set('Host', 'discord.com');

		// 5. Forward request directly to Discord
		try {
			const response = await fetch(url.toString(), {
				method: request.method,
				headers: forwardHeaders,
				body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
				redirect: 'manual',
			});

			return response;
		}
		catch (error) {
			return new Response(JSON.stringify({ error: 'Proxy upstream failure', message: error.message }), {
				status: 502,
				headers: { 'Content-Type': 'application/json' },
			});
		}
	},
};
