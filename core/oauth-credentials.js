const { query } = require('./db.js');
const vault = require('./auth/credential-vault.js');

async function save(userId, provider, credential, expiresAt = null) {
	const sealed = vault.seal(credential);
	if (!sealed) return { stored: false, reason: 'encryption-key-missing' };
	await query(
		`INSERT INTO oauth_credentials (user_id, provider, credential_json, expires_at)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id, provider) DO UPDATE
		 SET credential_json = EXCLUDED.credential_json, expires_at = EXCLUDED.expires_at, updated_at = now()`,
		[userId, provider, sealed, expiresAt],
	);
	return { stored: true };
}

async function get(userId, provider) {
	const res = await query(
		'SELECT credential_json, expires_at FROM oauth_credentials WHERE user_id = $1 AND provider = $2',
		[userId, provider],
	);
	if (!res.rows[0]) return null;
	try {
		return { credential: vault.open(res.rows[0].credential_json), expiresAt: res.rows[0].expires_at };
	}
	catch {
		return null;
	}
}

async function remove(userId, provider) {
	await query('DELETE FROM oauth_credentials WHERE user_id = $1 AND provider = $2', [userId, provider]);
}

module.exports = { save, get, remove };
