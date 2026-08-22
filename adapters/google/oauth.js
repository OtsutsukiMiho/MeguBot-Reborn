const { OAuth2Client } = require('google-auth-library');

const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

function clientId() {
	return process.env.GOOGLE_CLIENT_ID || '';
}

function clientSecret() {
	return process.env.GOOGLE_CLIENT_SECRET || '';
}

function redirectUri() {
	if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
	const site = process.env.FRONTEND_URL || `http://localhost:${process.env.NEXT_PORT || 3000}`;
	return `${site}/api/auth/google/callback`;
}

function authorizeUrl({ state }) {
	const params = new URLSearchParams({
		client_id: clientId(),
		redirect_uri: redirectUri(),
		response_type: 'code',
		scope: 'openid profile email',
		state,
		prompt: 'select_account',
	});
	return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

async function exchangeCode(code) {
	const response = await fetch(TOKEN_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: clientId(),
			client_secret: clientSecret(),
			code: String(code),
			grant_type: 'authorization_code',
			redirect_uri: redirectUri(),
		}),
	});
	if (!response.ok) throw new Error(`Google token exchange failed (${response.status})`);
	return response.json();
}

async function verifyIdToken(idToken) {
	if (!idToken) throw new Error('Google did not return an ID token');
	const ticket = await new OAuth2Client(clientId()).verifyIdToken({
		idToken,
		audience: clientId(),
	});
	const payload = ticket.getPayload();
	if (!payload?.sub) throw new Error('Google ID token has no subject');
	return payload;
}

function toIdentityProfile(payload) {
	return {
		provider: 'google',
		providerUid: payload.sub,
		email: payload.email || null,
		emailVerified: payload.email_verified === true,
		username: payload.email || null,
		displayName: payload.name || payload.email || 'Megu user',
		avatarUrl: payload.picture || null,
	};
}

module.exports = { authorizeUrl, exchangeCode, verifyIdToken, toIdentityProfile, redirectUri, clientId, clientSecret };
