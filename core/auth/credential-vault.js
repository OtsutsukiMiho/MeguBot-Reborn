const crypto = require('node:crypto');

function resolveKey(source = process.env.MEGU_OAUTH_CREDENTIAL_KEY) {
	if (!source) return null;
	const text = String(source).trim();
	let key;
	if (/^[a-f0-9]{64}$/i.test(text)) key = Buffer.from(text, 'hex');
	else {
		try { key = Buffer.from(text, 'base64'); }
		catch { key = null; }
	}
	if (!key || key.length !== 32) throw new Error('MEGU_OAUTH_CREDENTIAL_KEY must be 32 bytes encoded as hex or base64');
	return key;
}

function seal(value, source) {
	const key = resolveKey(source);
	if (!key) return null;
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
	return {
		v: 1,
		alg: 'A256GCM',
		iv: iv.toString('base64'),
		tag: cipher.getAuthTag().toString('base64'),
		ciphertext: ciphertext.toString('base64'),
	};
}

function open(envelope, source) {
	const key = resolveKey(source);
	if (!key || !envelope || envelope.v !== 1) return null;
	const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
	decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
	const plaintext = Buffer.concat([
		decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
		decipher.final(),
	]);
	return JSON.parse(plaintext.toString('utf8'));
}

module.exports = { resolveKey, seal, open };
