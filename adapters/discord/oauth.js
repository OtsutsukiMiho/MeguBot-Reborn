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
 * Keep the response body for Cloudflare detection, plus enough structured
 * metadata for the web process to honour an ordinary OAuth route cooldown.
 */
async function discordResponseError(res, label) {
	const body = await res.text();
	const error = new Error(`${label}: ${body}`);
	error.name = 'DiscordHttpError';
	error.status = res.status;
	error.body = body;

	if (res.status === 429) {
		const payload = (() => {
			try { return JSON.parse(body); }
			catch { return null; }
		})();
		const bodySeconds = Number(payload?.retry_after);
		const headerSeconds = Number(res.headers.get('retry-after') || res.headers.get('x-ratelimit-reset-after'));
		const seconds = Number.isFinite(bodySeconds) && bodySeconds > 0 ? bodySeconds : headerSeconds;
		error.retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 60_000;
		error.rateLimitGlobal = payload?.global === true || res.headers.get('x-ratelimit-global') === 'true';
	}

	return error;
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
		throw await discordResponseError(res, 'Discord token exchange failed');
	}
	return res.json();
}

async function refreshToken(refreshTokenValue) {
	const res = await fetch(`${API}/oauth2/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: clientId(),
			client_secret: clientSecret(),
			grant_type: 'refresh_token',
			refresh_token: String(refreshTokenValue),
		}),
	});
	if (!res.ok) throw await discordResponseError(res, 'Discord token refresh failed');
	return res.json();
}

// The body is the only place a Cloudflare block identifies itself — it arrives
// as an ordinary failed response carrying
// {"code":0,"message":"You are being blocked from accessing our API ..."}.
// Throwing a tidy summary instead threw that sentence away, so the caller's
// block guard could not recognise it, the user got a generic error, and the
// obvious response to a generic error is to click sign in again. Every one of
// those clicks is another request into a block that lengthens under traffic.
// Keep the body: rate-limit.js reads it, and the guard exists to be tripped.
async function fetchMe(accessToken) {
	const res = await fetch(`${API}/users/@me`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!res.ok) throw await discordResponseError(res, 'Failed to read Discord profile');
	return res.json();
}

async function fetchMyGuilds(accessToken) {
	const res = await fetch(`${API}/users/@me/guilds`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!res.ok) throw await discordResponseError(res, 'Failed to read Discord servers');
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
	refreshToken,
	fetchMe,
	fetchMyGuilds,
	avatarUrl,
	toIdentityProfile,
	redirectUri,
	discordResponseError,
};
