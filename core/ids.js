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

/**
 * The reference printed on a receipt.
 *
 * Derived from the payment's own id rather than stored, so it needs no column,
 * cannot drift from the row it names, and is the same on the screen, in the
 * export and in a message six months later when somebody is disputing it.
 *
 * Rendered in the same no-confusable alphabet as an activity code, because this
 * is the string somebody reads down a phone or types into a bank's reference
 * box — `pay_9f2c1a4b8e0d3567` is neither of those things, and hex would put an
 * O next to a 0 in the one place that matters.
 */
function publicReference(id, prefix = 'MEGU-PAY') {
	const hex = String(id || '').split('_').pop().replace(/[^0-9a-f]/gi, '');
	let value = BigInt(`0x${hex.slice(-12) || '0'}`);
	const size = BigInt(CODE_ALPHABET.length);

	let out = '';
	for (let i = 0; i < 8; i++) {
		out = CODE_ALPHABET[Number(value % size)] + out;
		value /= size;
	}
	return `${prefix}-${out}`;
}

function newDeviceToken() {
	return crypto.randomBytes(24).toString('base64url');
}

module.exports = { newId, newActivityCode, newDeviceToken, publicReference, CODE_ALPHABET };
