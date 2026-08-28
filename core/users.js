const { query, transaction } = require('./db.js');
const { newId } = require('./ids.js');
const { normaliseTarget } = require('./promptpay.js');

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
		promptpayId: row.promptpay_id || null,
		promptpayName: row.promptpay_name || null,
		profileSource: row.profile_source || 'manual',
		createdAt: row.created_at,
	};
}

/**
 * Where the name and picture on the account come from.
 *
 * `manual` means the person typed it, and no login may overwrite it. A provider
 * means the account follows that provider — so someone who merges a Discord
 * account into a Google one and picks Google sees their Google name update when
 * they change it there.
 *
 * This is the whole meaning of "primary" in the merge flow. It decides nothing
 * about sign-in: both providers keep working either way, and switching this
 * back and forth costs nothing because no row moves.
 */
const PROFILE_SOURCES = new Set(['google', 'discord', 'manual']);

async function applyProfileSource(client, userId) {
	const res = await client.query('SELECT profile_source FROM users WHERE id = $1', [userId]);
	const source = res.rows[0]?.profile_source || 'manual';
	if (!PROFILE_SOURCES.has(source) || source === 'manual') return;

	await client.query(
		`UPDATE users u
		    SET display_name = COALESCE(NULLIF(i.display_name, ''), u.display_name),
		        avatar_url = COALESCE(i.avatar_url, u.avatar_url)
		   FROM identities i
		  WHERE u.id = $1 AND i.user_id = $1 AND i.provider = $2`,
		[userId, source],
	);
}

function rowToIdentity(row) {
	return {
		id: row.id,
		provider: row.provider,
		providerUid: row.provider_uid,
		email: row.email,
		emailVerified: Boolean(row.email_verified),
		username: row.username,
		displayName: row.display_name || row.username || null,
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
	const { provider, providerUid, email, emailVerified, username, avatarUrl, displayName } = profile;
	assertProvider(provider);
	if (!providerUid) throw new Error('providerUid is required');

	return transaction(async (client) => {
		// OAuth callback and stale-session recovery can arrive together from two
		// browser requests. Serialize work for this provider identity so both
		// cannot observe "missing" and race to insert the same unique key.
		await client.query(
			'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
			[provider, String(providerUid)],
		);
		const existing = await client.query(
			'SELECT * FROM identities WHERE provider = $1 AND provider_uid = $2',
			[provider, String(providerUid)],
		);

		if (existing.rows.length > 0) {
			const identity = existing.rows[0];
			await client.query(
				`UPDATE identities SET email = $2, email_verified = $3, username = $4, avatar_url = $5, display_name = $6
				 WHERE id = $1`,
				[identity.id, email || null, Boolean(emailVerified), username || null, avatarUrl || null,
					displayName || username || null],
			);
			// Only moves the account's own name and picture when this provider is
			// the one it was told to follow. A `manual` account keeps what the
			// person typed, which is the point of having the column at all.
			await applyProfileSource(client, identity.user_id);
			const user = await client.query('SELECT * FROM users WHERE id = $1', [identity.user_id]);
			await client.query(
				`INSERT INTO notification_preferences (user_id, mode)
				 VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
				[identity.user_id, provider === 'google' && emailVerified ? 'email' : provider === 'discord' ? 'discord' : 'off'],
			);
			return { user: rowToUser(user.rows[0]), created: false };
		}

		const userId = newId('usr');
		const name = displayName || username || 'Megu user';
		const created = await client.query(
			'INSERT INTO users (id, display_name, avatar_url) VALUES ($1, $2, $3) RETURNING *',
			[userId, name, avatarUrl || null],
		);
		await client.query(
			`INSERT INTO identities (id, user_id, provider, provider_uid, email, email_verified, username, avatar_url, display_name)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			[newId('idn'), userId, provider, String(providerUid), email || null, Boolean(emailVerified), username || null, avatarUrl || null, name],
		);
		await client.query(
			`INSERT INTO notification_preferences (user_id, mode)
			 VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
			[userId, provider === 'google' && emailVerified ? 'email' : provider === 'discord' ? 'discord' : 'off'],
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
	const { provider, providerUid, email, emailVerified, username, avatarUrl, displayName } = profile;
	assertProvider(provider);

	const owner = await query(
		'SELECT user_id FROM identities WHERE provider = $1 AND provider_uid = $2',
		[provider, String(providerUid)],
	);

	if (owner.rows.length > 0) {
		if (owner.rows[0].user_id === userId) return { linked: false, reason: 'already-linked' };
		return { linked: false, reason: 'claimed-by-another-user' };
	}

	return transaction(async (client) => {
		await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [userId, provider]);
		const sameProvider = await client.query(
			'SELECT provider_uid FROM identities WHERE user_id = $1 AND provider = $2',
			[userId, provider],
		);
		if (sameProvider.rows.length > 0) {
			return { linked: false, reason: sameProvider.rows[0].provider_uid === String(providerUid) ? 'already-linked' : 'provider-already-linked' };
		}
		await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [provider, String(providerUid)]);
		const claimed = await client.query(
			'SELECT user_id FROM identities WHERE provider = $1 AND provider_uid = $2',
			[provider, String(providerUid)],
		);
		if (claimed.rows.length > 0) {
			if (claimed.rows[0].user_id === userId) return { linked: false, reason: 'already-linked' };
			return { linked: false, reason: 'claimed-by-another-user' };
		}
		await client.query(
			`INSERT INTO identities (id, user_id, provider, provider_uid, email, email_verified, username, avatar_url, display_name)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			[newId('idn'), userId, provider, String(providerUid), email || null, Boolean(emailVerified), username || null, avatarUrl || null,
				displayName || username || null],
		);
		await applyProfileSource(client, userId);
		return { linked: true };
	});
}

/**
 * Choose which connected provider supplies the name and picture — or `manual`
 * to keep whatever is there now and stop following either of them.
 *
 * Sign-in is untouched by this. Every linked provider still logs in, which is
 * why picking one as "primary" is safe to offer during a merge: the word
 * describes a display preference and nothing else.
 */
async function setProfileSource(userId, source) {
	if (!PROFILE_SOURCES.has(source)) throw new Error('profile_source_invalid');

	return transaction(async (client) => {
		if (source !== 'manual') {
			const identity = await client.query(
				'SELECT id FROM identities WHERE user_id = $1 AND provider = $2',
				[userId, source],
			);
			if (identity.rows.length === 0) throw new Error('profile_source_unavailable');
		}
		const res = await client.query(
			'UPDATE users SET profile_source = $2 WHERE id = $1 RETURNING *',
			[userId, source],
		);
		if (res.rows.length === 0) throw new Error('user_not_found');
		await applyProfileSource(client, userId);
		const refreshed = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
		return rowToUser(refreshed.rows[0]);
	});
}

async function getNotificationPreferences(userId) {
	const identities = await getIdentities(userId);
	const fallbackMode = identities.some(identity => identity.provider === 'discord') ? 'discord'
		: identities.some(identity => identity.provider === 'google' && identity.emailVerified) ? 'email' : 'off';
	const res = await query(
		`INSERT INTO notification_preferences (user_id, mode)
		 VALUES ($1, $2)
		 ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
		 RETURNING mode, locale, updated_at`,
		[userId, fallbackMode],
	);
	return { mode: res.rows[0].mode, locale: res.rows[0].locale, updatedAt: res.rows[0].updated_at };
}

async function setNotificationPreferences(userId, { mode, locale }) {
	const allowedModes = new Set(['discord', 'email', 'both', 'off']);
	if (!allowedModes.has(mode)) throw new Error('notification_mode_invalid');
	if (!['en', 'th'].includes(locale)) throw new Error('notification_locale_invalid');
	const identities = await getIdentities(userId);
	const hasDiscord = identities.some(identity => identity.provider === 'discord');
	const hasEmail = identities.some(identity => identity.provider === 'google' && identity.emailVerified && identity.email);
	if (['discord', 'both'].includes(mode) && !hasDiscord) throw new Error('notification_discord_unavailable');
	if (['email', 'both'].includes(mode) && !hasEmail) throw new Error('notification_email_unavailable');
	const res = await query(
		`INSERT INTO notification_preferences (user_id, mode, locale)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (user_id) DO UPDATE SET mode = EXCLUDED.mode, locale = EXCLUDED.locale, updated_at = now()
		 RETURNING mode, locale, updated_at`,
		[userId, mode, locale],
	);
	return { mode: res.rows[0].mode, locale: res.rows[0].locale, updatedAt: res.rows[0].updated_at };
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
 * Set, or clear, where this person wants to be paid.
 *
 * The number is normalised before it is stored, so `081-234-5678` and
 * `+66 81 234 5678` cannot end up as two different-looking rows for the same
 * account. It is validated here rather than at the edge because an unusable
 * number does not fail loudly — it produces a QR that a banking app simply
 * refuses, at the moment somebody is standing there trying to pay.
 *
 * Passing null removes it, which has to stay possible: this is a phone number,
 * and someone who no longer wants it in the database is entitled to that.
 */
async function setPromptPay(userId, { promptpayId, promptpayName }) {
	const clearing = promptpayId == null || String(promptpayId).trim() === '';

	let stored = null;
	if (!clearing) {
		// Throws `promptpay_unrecognised` for anything that is not a mobile,
		// national id or e-wallet — the caller turns that into a message.
		normaliseTarget(promptpayId);
		stored = String(promptpayId).replace(/\s+/g, ' ').trim();
	}

	const name = promptpayName == null ? null : String(promptpayName).trim() || null;

	const res = await query(
		'UPDATE users SET promptpay_id = $2, promptpay_name = $3 WHERE id = $1 RETURNING *',
		[userId, stored, clearing ? null : name],
	);
	if (res.rows.length === 0) throw new Error('user_not_found');

	// The number lives in `payment_methods` now, which is where everything
	// reads it from. These columns stay written so a database rolled back to
	// an older build still finds it, and because the schema's backfill reads
	// them — but they are no longer what anybody asks.
	//
	// Kept in one statement each so the profile screen and the payment-methods
	// screen cannot end up disagreeing about the same number.
	if (clearing) {
		await query('DELETE FROM payment_methods WHERE user_id = $1 AND type = $2', [userId, 'promptpay']);
	}
	else {
		const updated = await query(
			`UPDATE payment_methods SET destination = $2, account_name = $3, updated_at = now()
			 WHERE user_id = $1 AND type = 'promptpay' RETURNING id`,
			[userId, stored, name],
		);
		if (updated.rows.length === 0) {
			// First number this person has saved. It goes to the front, because
			// somebody who has just entered one is telling you where to send it.
			await query(
				`INSERT INTO payment_methods (id, user_id, type, label, destination, account_name, position)
				 VALUES ($1, $2, 'promptpay', 'PromptPay', $3, $4,
				         (SELECT COALESCE(MIN(position) - 1, 0) FROM payment_methods WHERE user_id = $2))`,
				[newId('pmt'), userId, stored, name],
			);
		}
	}

	return rowToUser(res.rows[0]);
}

async function setDisplayName(userId, displayName) {
	const value = String(displayName || '').trim();
	if (!value) throw new Error('display_name_required');
	if ([...value].length > 80) throw new Error('display_name_too_long');

	// Typing a name is the act that means "stop following a provider". Without
	// this, an account set to follow Google would accept the new name and then
	// discard it at the next sign-in, which reads as the save having failed.
	const res = await query(
		'UPDATE users SET display_name = $2, profile_source = \'manual\' WHERE id = $1 RETURNING *',
		[userId, value],
	);
	if (res.rows.length === 0) throw new Error('user_not_found');
	return rowToUser(res.rows[0]);
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
	setPromptPay,
	setDisplayName,
	setProfileSource,
	// Exported for the merge, which sets `profile_source` inside its own
	// transaction and must apply it there — reading it back afterwards would
	// mean a second connection and a snapshot taken before any of this landed.
	applyProfileSource,
	PROFILE_SOURCES,
	claimParticipants,
	getNotificationPreferences,
	setNotificationPreferences,
};
