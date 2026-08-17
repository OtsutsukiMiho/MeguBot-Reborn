const crypto = require('node:crypto');
const { newDeviceToken } = require('../ids.js');
const { log } = require('../log.js');

let secret = process.env.MEGU_TOKEN_SECRET || '';

if (!secret) {
	secret = crypto.randomBytes(32).toString('hex');
	log('Core', 'MEGU_TOKEN_SECRET is not set — using an ephemeral secret. Participant device tokens will not survive a restart.');
}

function sign(value) {
	return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

/**
 * Device tokens identify a returning participant who has never signed in.
 * They carry no personal data — just a random id the activity row points at —
 * so a leaked cookie reveals nothing on its own.
 */
function issueDeviceToken() {
	const value = newDeviceToken();
	return `${value}.${sign(value)}`;
}

function verifyDeviceToken(token) {
	if (typeof token !== 'string') return null;
	const dot = token.lastIndexOf('.');
	if (dot < 1) return null;

	const value = token.slice(0, dot);
	const mac = token.slice(dot + 1);
	const expected = sign(value);

	if (mac.length !== expected.length) return null;
	if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;

	return value;
}

module.exports = { issueDeviceToken, verifyDeviceToken };
