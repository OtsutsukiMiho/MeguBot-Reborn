// Discord OAuth plumbing. Everything here is about talking to Discord;
// the permission maths lives in core/auth/access.js so it stays testable
// without a network.

const API = 'https://discord.com/api/v10';

function clientId() {
	return process.env.DISCORD_CLIENT_ID || '';
}

function clientSecret() {
	return process.env.DISCORD_CLIENT_SECRET || '';
}

// The callback is reached through the site, so FRONTEND_URL names it. The port
// argument is only the last resort, for a caller with no FRONTEND_URL set.
function redirectUri(fallbackPort) {
	if (process.env.DISCORD_REDIRECT_URI) return process.env.DISCORD_REDIRECT_URI;
	const site = process.env.FRONTEND_URL || `http://localhost:${fallbackPort}`;
	return `${site}/api/auth/callback`;
}

/**
 * `guilds` gives us each guild's permission bitfield in the same response,
 * so membership and role checks cost no extra API calls.
 */
function authorizeUrl({ state, port, scope = 'identify guilds' }) {
	const params = new URLSearchParams({
		client_id: clientId(),
		redirect_uri: redirectUri(port),
		response_type: 'code',
		scope,
		state,
	});
	return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function exchangeCode(code, port) {
	const res = await fetch(`${API}/oauth2/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: clientId(),
			client_secret: clientSecret(),
			grant_type: 'authorization_code',
			code: String(code),
			redirect_uri: redirectUri(port),
		}),
	});

	if (!res.ok) {
		throw new Error(`Discord token exchange failed: ${await res.text()}`);
	}
	return res.json();
}

async function fetchMe(accessToken) {
	const res = await fetch(`${API}/users/@me`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!res.ok) throw new Error('Failed to read Discord profile.');
	return res.json();
}

async function fetchMyGuilds(accessToken) {
	const res = await fetch(`${API}/users/@me/guilds`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!res.ok) throw new Error('Failed to read Discord servers.');
	const data = await res.json();
	return Array.isArray(data) ? data : [];
}

function avatarUrl(user) {
	if (!user || !user.id) return null;
	if (user.avatar) {
		const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
		return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
	}
	const index = (BigInt(user.id) >> 22n) % 6n;
	return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/**
 * Shape a Discord profile into the identity core expects.
 */
function toIdentityProfile(user) {
	return {
		provider: 'discord',
		providerUid: user.id,
		email: user.email || null,
		username: user.username,
		displayName: user.global_name || user.username,
		avatarUrl: avatarUrl(user),
	};
}

module.exports = {
	API,
	authorizeUrl,
	exchangeCode,
	fetchMe,
	fetchMyGuilds,
	avatarUrl,
	toIdentityProfile,
	redirectUri,
};
