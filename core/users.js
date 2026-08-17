const { query, transaction } = require('./db.js');
const { newId } = require('./ids.js');

const PROVIDERS = new Set(['discord', 'google', 'line']);

function assertProvider(provider) {
	if (!PROVIDERS.has(provider)) {
		throw new Error(`unknown identity provider: ${provider}`);
	}
}

function rowToUser(row) {
	if (!row) return null;
	return {
		id: row.id,
		displayName: row.display_name,
		avatarUrl: row.avatar_url,
		createdAt: row.created_at,
	};
}

function rowToIdentity(row) {
	return {
		id: row.id,
		provider: row.provider,
		providerUid: row.provider_uid,
		email: row.email,
		username: row.username,
		avatarUrl: row.avatar_url,
	};
}

async function getUser(userId) {
	const res = await query('SELECT * FROM users WHERE id = $1', [userId]);
	return rowToUser(res.rows[0]);
}

async function getIdentities(userId) {
	const res = await query(
		'SELECT * FROM identities WHERE user_id = $1 ORDER BY created_at',
		[userId],
	);
	return res.rows.map(rowToIdentity);
}

/**
 * A user plus every provider they have connected. This is what the session
 * layer hands to permission checks.
 */
async function getUserWithIdentities(userId) {
	const user = await getUser(userId);
	if (!user) return null;
	user.identities = await getIdentities(userId);
	return user;
}

async function findByIdentity(provider, providerUid) {
	assertProvider(provider);
	const res = await query(
		`SELECT u.* FROM users u
		 JOIN identities i ON i.user_id = u.id
		 WHERE i.provider = $1 AND i.provider_uid = $2`,
		[provider, String(providerUid)],
	);
	return rowToUser(res.rows[0]);
}

/**
 * The single entry point for OAuth callbacks. Returns an existing user when
 * the provider identity is known, otherwise creates one. Profile fields are
 * refreshed on every login so a renamed Discord account stays current.
 */
async function loginWithIdentity(profile) {
	const { provider, providerUid, email, username, avatarUrl, displayName } = profile;
	assertProvider(provider);
	if (!providerUid) throw new Error('providerUid is required');

	return transaction(async (client) => {
		const existing = await client.query(
			'SELECT * FROM identities WHERE provider = $1 AND provider_uid = $2',
			[provider, String(providerUid)],
		);

		if (existing.rows.length > 0) {
			const identity = existing.rows[0];
			await client.query(
				'UPDATE identities SET email = $2, username = $3, avatar_url = $4 WHERE id = $1',
				[identity.id, email || null, username || null, avatarUrl || null],
			);
			const user = await client.query('SELECT * FROM users WHERE id = $1', [identity.user_id]);
			return { user: rowToUser(user.rows[0]), created: false };
		}

		const userId = newId('usr');
		const name = displayName || username || 'Megu user';
		const created = await client.query(
			'INSERT INTO users (id, display_name, avatar_url) VALUES ($1, $2, $3) RETURNING *',
			[userId, name, avatarUrl || null],
		);
		await client.query(
			`INSERT INTO identities (id, user_id, provider, provider_uid, email, username, avatar_url)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			[newId('idn'), userId, provider, String(providerUid), email || null, username || null, avatarUrl || null],
		);

		return { user: rowToUser(created.rows[0]), created: true };
	});
}

/**
 * Connect a second provider to an account that is already signed in.
 * Refuses when the identity belongs to someone else rather than guessing
 * which of the two accounts should win.
 */
async function linkIdentity(userId, profile) {
	const { provider, providerUid, email, username, avatarUrl } = profile;
	assertProvider(provider);

	const owner = await query(
		'SELECT user_id FROM identities WHERE provider = $1 AND provider_uid = $2',
		[provider, String(providerUid)],
	);

	if (owner.rows.length > 0) {
		if (owner.rows[0].user_id === userId) return { linked: false, reason: 'already-linked' };
		return { linked: false, reason: 'claimed-by-another-user' };
	}

	await query(
		`INSERT INTO identities (id, user_id, provider, provider_uid, email, username, avatar_url)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[newId('idn'), userId, provider, String(providerUid), email || null, username || null, avatarUrl || null],
	);
	return { linked: true };
}

async function unlinkIdentity(userId, provider) {
	assertProvider(provider);
	const remaining = await query(
		'SELECT count(*)::int AS n FROM identities WHERE user_id = $1',
		[userId],
	);
	if (remaining.rows[0].n <= 1) {
		return { unlinked: false, reason: 'last-identity' };
	}
	await query('DELETE FROM identities WHERE user_id = $1 AND provider = $2', [userId, provider]);
	return { unlinked: true };
}

/**
 * When someone who has only ever tapped a link finally signs in, adopt every
 * participant row the organizer already created for them. This is why the
 * history survives the moment an account appears.
 */
async function claimParticipants(userId) {
	const discord = await query(
		'SELECT provider_uid FROM identities WHERE user_id = $1 AND provider = $2',
		[userId, 'discord'],
	);
	if (discord.rows.length === 0) return { claimed: 0 };

	const res = await query(
		`UPDATE participants
		 SET user_id = $1, claimed_at = COALESCE(claimed_at, now())
		 WHERE discord_uid = $2 AND user_id IS NULL`,
		[userId, discord.rows[0].provider_uid],
	);
	return { claimed: res.rowCount || 0 };
}

module.exports = {
	getUser,
	getIdentities,
	getUserWithIdentities,
	findByIdentity,
	loginWithIdentity,
	linkIdentity,
	unlinkIdentity,
	claimParticipants,
};
