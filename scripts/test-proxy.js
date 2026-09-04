/**
 * Quick Test Script for Cloudflare Discord Proxy
 * Usage:
 *   node scripts/test-proxy.js
 * Or:
 *   node scripts/test-proxy.js https://your-worker.workers.dev/api/v10 [secret]
 */

const dotenv = require('dotenv');
dotenv.config();

async function run() {
	const endpoint = process.argv[2] || process.env.DISCORD_API_ENDPOINT;
	const secret = process.argv[3] || process.env.DISCORD_PROXY_SECRET;

	console.log('\n🔍 --- Testing Cloudflare Discord Reverse Proxy ---');

	if (!endpoint) {
		console.error('❌ Error: No DISCORD_API_ENDPOINT provided.');
		console.log('Usage: node scripts/test-proxy.js https://<worker>.workers.dev/api/v10 [secret]');
		console.log('Or add DISCORD_API_ENDPOINT to your .env file.\n');
		process.exit(1);
	}

	let cleanEndpoint = endpoint.trim().replace(/\/+$/, '');
	const baseUrl = cleanEndpoint.replace(/\/api(\/v\d+)?$/, '');
	if (!cleanEndpoint.includes('/api')) {
		cleanEndpoint = `${cleanEndpoint}/api/v10`;
	}
	else if (!/\/v\d+$/.test(cleanEndpoint)) {
		cleanEndpoint = `${cleanEndpoint}/v10`;
	}

	console.log(`📡 Base Worker URL : ${baseUrl}`);
	console.log(`📡 API Endpoint    : ${cleanEndpoint}`);
	console.log(`🔑 Secret Provided : ${secret ? 'YES (***' + secret.slice(-6) + ')' : 'NO'}`);

	// 1. Test /health endpoint
	console.log('\n[1/3] Checking Worker /health...');
	try {
		const healthRes = await fetch(`${baseUrl}/health`);
		const healthText = await healthRes.text();
		if (healthRes.ok) {
			console.log(`  ✅ Health check OK (${healthRes.status}): ${healthText}`);
		}
		else {
			console.log(`  ⚠️ Worker returned status ${healthRes.status}: ${healthText}`);
		}
	}
	catch (err) {
		console.error(`  ❌ Failed to reach worker health check: ${err.message}`);
	}

	// 2. Test Secret Protection (if secret is expected)
	if (secret) {
		console.log('\n[2/3] Verifying Secret Protection (Request WITHOUT secret)...');
		try {
			const unauthRes = await fetch(`${cleanEndpoint}/gateway`);
			if (unauthRes.status === 401) {
				console.log('  ✅ Protection active: Request without secret was correctly rejected (401 Unauthorized)');
			}
			else {
				console.log(`  ⚠️ Expected 401 without secret, but got ${unauthRes.status}`);
			}
		}
		catch (err) {
			console.log(`  ℹ️ Request error: ${err.message}`);
		}
	}
	else {
		console.log('\n[2/3] Skipping Secret Protection test (no secret provided)');
	}

	// 3. Test Forwarding to Discord API (/gateway endpoint is public and needs no bot token)
	console.log('\n[3/3] Testing Discord API forwarding (/gateway)...');
	try {
		const headers = {};
		if (secret) headers['x-proxy-secret'] = secret;

		const res = await fetch(`${cleanEndpoint}/gateway`, { headers });
		const body = await res.json();

		if (res.ok && body && body.url) {
			console.log(`  🎉 SUCCESS! Discord API responded via Worker:`);
			console.log(`     Status: ${res.status} OK`);
			console.log(`     Gateway URL: ${body.url}`);
			console.log('\n✅ Your Cloudflare Proxy is working 100% and ready to use!\n');
		}
		else {
			console.error(`  ❌ Discord API check failed (status ${res.status}):`, body);
		}
	}
	catch (err) {
		console.error(`  ❌ Request failed: ${err.message}`);
	}
}

run();
