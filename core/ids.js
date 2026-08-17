const crypto = require('node:crypto');

// Crockford-style alphabet: no 0/O/1/I/L so codes survive being read aloud
// or retyped from a screenshot in a group chat.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomFrom(alphabet, length) {
	const bytes = crypto.randomBytes(length);
	let out = '';
	for (let i = 0; i < length; i++) {
		out += alphabet[bytes[i] % alphabet.length];
	}
	return out;
}

/**
 * Internal identifier, e.g. act_9f2c1a4b8e0d3567.
 */
function newId(prefix) {
	return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Public activity code used in /a/<code>. Short enough to paste in a chat,
 * long enough that guessing one is not worth anyone's time.
 */
function newActivityCode() {
	return randomFrom(CODE_ALPHABET, 7);
}

function newDeviceToken() {
	return crypto.randomBytes(24).toString('base64url');
}

module.exports = { newId, newActivityCode, newDeviceToken, CODE_ALPHABET };
