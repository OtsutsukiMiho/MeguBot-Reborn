const { query, transaction } = require('./db.js');
const { newId } = require('./ids.js');
const users = require('./users.js');

/**
 * Two Megu accounts, one person.
 *
 * This happens the ordinary way: somebody signs in with Google on their laptop,
 * having already been a Discord account for a year, and only finds out when
 * they try to connect the second provider. Before this file, `linkIdentity`
 * answered `claimed-by-another-user` and stopped — correct, and useless.
 *
 * What makes the merge safe is not the transaction alone. It is that every
 * reference to the dying account is *moved*, never dropped, and that the code
 * refuses to finish if it cannot account for one. See `assertNoReferences`.
 */

// Delivery modes as sets of channels, so merging two accounts' preferences is
// a union rather than a precedence rule.
//
// Precedence was the tempting answer and it is wrong in both directions: keep
// the survivor's mode and the other account's channel goes quiet; keep
// "discord, because Discord came first" and a Google account that was
// receiving email stops receiving anything. Neither person asked for that. A
// union only ever restores a channel they were already getting, and `off` —
// which is never a default, only ever an explicit choice — survives.
const MODE_CHANNELS = {
	off: [],
	discord: ['discord'],
	email: ['email'],
	both: ['discord', 'email'],
};

function modeFromChannels(channels) {
	const set = channels instanceof Set ? channels : new Set(channels || []);
	if (set.has('discord') && set.has('email')) return 'both';
	if (set.has('discord')) return 'discord';
	if (set.has('email')) return 'email';
	return 'off';
}

function unionMode(a, b) {
	return modeFromChannels([...(MODE_CHANNELS[a] || []), ...(MODE_CHANNELS[b] || [])]);
}

/**
 * Every column in the database that points at `users.id`, and what a merge
 * does with it.
 *
 * This list is checked against the live catalogue at merge time rather than
 * trusted, because the failure mode of forgetting an entry is silent. Most of
 * these foreign keys are `ON DELETE SET NULL` or `ON DELETE CASCADE`, so a
 * column nobody moved does not raise a constraint error when the old row goes
 * — it quietly becomes NULL, or quietly disappears, and the evidence that a
 * payment was confirmed by a real person is gone.
 */
const REPOINT = [
	['activities', 'owner_user_id'],
	['participants', 'user_id'],
	['payments', 'confirmed_by'],
	['payments', 'reversed_by'],
	['payment_events', 'actor_user_id'],
	['notification_events', 'user_id'],
	['identities', 'user_id'],
	// An account that already absorbed another one carries its aliases and its
	// audit rows forward, so a chain of merges still resolves in one hop.
	['user_aliases', 'user_id'],
	['account_merges', 'survivor_user_id'],
	// A person's ways of being paid belong to the person, not to whichever of
	// their two logins happened to save them, so both accounts' methods move to
	// the survivor. The foreign key is ON DELETE CASCADE, which is why this one
	// cannot simply be left out: an unmoved row would not fail the merge, it
	// would take somebody's PromptPay number down with the deleted account.
	// There is no uniqueness constraint on (user_id, position) — the index is
	// plain — so two methods can land on the same position and merely sort
	// arbitrarily against each other, which is a cosmetic outcome rather than a
	// failed merge.
	['payment_methods', 'user_id'],
];

// Handled by hand further down, because moving the row would collide with a
// uniqueness constraint the survivor already occupies.
const HANDLED_ELSEWHERE = [
	['notification_preferences', 'user_id'],
	['oauth_credentials', 'user_id'],
];

function referenceKey(table, column) {
	return `${table}.${column}`;
}

/**
 * Ask Postgres, not the developer, which columns reference `users.id`.
 *
 * A table added next year gets a foreign key to `users` and no thought about
 * merging; this turns that into a loud failure the first time anyone merges,
 * instead of data that vanishes without a log line.
 */
async function usersReferences(client) {
	const res = await client.query(`
		SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name
		FROM pg_constraint c
		JOIN pg_class target ON target.oid = c.confrelid
		JOIN pg_namespace tn ON tn.oid = target.relnamespace
		JOIN unnest(c.conkey) AS k(attnum) ON true
		JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
		WHERE c.contype = 'f' AND target.relname = 'users' AND tn.nspname = 'public'
	`);
	return res.rows.map(row => ({
		table: row.table_name.replace(/^public\./, ''),
		column: row.column_name,
	}));
}

async function assertEveryReferenceIsKnown(client) {
	const known = new Set([...REPOINT, ...HANDLED_ELSEWHERE].map(([t, c]) => referenceKey(t, c)));
	const live = await usersReferences(client);
	const unknown = live
		.map(ref => referenceKey(ref.table, ref.column))
		.filter(key => !known.has(key));
	if (unknown.length > 0) {
		throw new Error(`merge_unknown_reference:${[...new Set(unknown)].sort().join(',')}`);
	}
}

/**
 * Nothing may still point at the account about to be deleted.
 *
 * Run after every move and before the DELETE. The DELETE itself is not a
 * sufficient test — see the comment on REPOINT — so this counts explicitly.
 */
async function assertNoReferences(client, userId) {
	const live = await usersReferences(client);
	for (const { table, column } of live) {
		const res = await client.query(
			`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`,
			[userId],
		);
		if (res.rows[0].n > 0) {
			throw new Error(`merge_incomplete:${referenceKey(table, column)}=${res.rows[0].n}`);
		}
	}
}

async function countsFor(client, userId) {
	const res = await client.query(`
		SELECT
			(SELECT count(*)::int FROM activities WHERE owner_user_id = $1) AS owned_activities,
			(SELECT count(*)::int FROM participants WHERE user_id = $1) AS participant_rows,
			(SELECT count(*)::int FROM payments p
			   JOIN participants pt ON pt.id = p.participant_id
			  WHERE pt.user_id = $1) AS payments,
			(SELECT count(*)::int FROM identities WHERE user_id = $1) AS identities
	`, [userId]);
	return res.rows[0];
}

/**
 * Activities where both accounts already hold a roster row.
 *
 * The rows are deliberately left alone — see `mergeAccounts` — so this exists
 * to tell the person what they are about to see: their name, twice, in the
 * same event.
 */
async function duplicateParticipants(client, userIdA, userIdB) {
	const res = await client.query(`
		SELECT a.id, a.code, a.title,
			array_agg(p.display_name ORDER BY p.position, p.created_at) AS names
		FROM participants p
		JOIN activities a ON a.id = p.activity_id
		WHERE p.user_id IN ($1, $2)
		GROUP BY a.id, a.code, a.title, a.created_at
		HAVING count(*) FILTER (WHERE p.user_id = $1) > 0
		   AND count(*) FILTER (WHERE p.user_id = $2) > 0
		   AND count(*) > 1
		ORDER BY a.created_at
	`, [userIdA, userIdB]);
	return res.rows.map(row => ({
		activityId: row.id,
		code: row.code,
		title: row.title,
		names: row.names,
	}));
}

async function sharedProviders(client, userIdA, userIdB) {
	const res = await client.query(`
		SELECT provider FROM identities WHERE user_id = $1
		INTERSECT
		SELECT provider FROM identities WHERE user_id = $2
	`, [userIdA, userIdB]);
	return res.rows.map(row => row.provider);
}

/**
 * Which account keeps its id.
 *
 * This is an internal decision and the person merging never sees it, which is
 * the point: the survivor is chosen to move the fewest rows, while the profile
 * they see — name, avatar, email — is `users.profile_source` and stays theirs
 * to change afterwards. Tying the two together would have made "use my Google
 * name" silently mean "throw away the account that owns the money".
 *
 * Owning activities wins because `activities.owner_user_id` is the one
 * reference here that is `ON DELETE RESTRICT`, and because an owner is the
 * account other people's payments are addressed to. Age breaks the tie.
 */
async function chooseSurvivor(client, userIdA, userIdB) {
	const res = await client.query(`
		SELECT u.id, u.created_at,
			(SELECT count(*)::int FROM activities WHERE owner_user_id = u.id) AS owned
		FROM users u WHERE u.id IN ($1, $2)
	`, [userIdA, userIdB]);

	const a = res.rows.find(row => row.id === userIdA);
	const b = res.rows.find(row => row.id === userIdB);
	if (!a || !b) throw new Error('merge_user_missing');

	if (a.owned !== b.owned) {
		return a.owned > b.owned
			? { survivorId: a.id, mergedId: b.id }
			: { survivorId: b.id, mergedId: a.id };
	}
	return a.created_at <= b.created_at
		? { survivorId: a.id, mergedId: b.id }
		: { survivorId: b.id, mergedId: a.id };
}

/**
 * Everything the confirmation screen needs, and nothing written.
 *
 * `blockedBy` is the important field: a plan that cannot proceed says so here,
 * before the person is shown a button that would fail.
 */
async function planMerge(userIdA, userIdB) {
	if (!userIdA || !userIdB || userIdA === userIdB) throw new Error('merge_same_account');

	return transaction(async (client) => {
		const { survivorId, mergedId } = await chooseSurvivor(client, userIdA, userIdB);
		const shared = await sharedProviders(client, userIdA, userIdB);
		const duplicates = await duplicateParticipants(client, userIdA, userIdB);

		const identities = await client.query(
			`SELECT user_id, provider, provider_uid, email, username, display_name
			 FROM identities WHERE user_id IN ($1, $2) ORDER BY user_id, provider`,
			[userIdA, userIdB],
		);
		const preferences = await client.query(
			'SELECT user_id, mode, locale FROM notification_preferences WHERE user_id IN ($1, $2)',
			[userIdA, userIdB],
		);

		const survivorMode = preferences.rows.find(row => row.user_id === survivorId)?.mode || 'off';
		const mergedMode = preferences.rows.find(row => row.user_id === mergedId)?.mode || 'off';

		return {
			survivorId,
			mergedId,
			blockedBy: shared.length > 0 ? { reason: 'provider-collision', providers: shared } : null,
			counts: {
				survivor: await countsFor(client, survivorId),
				merged: await countsFor(client, mergedId),
			},
			duplicateParticipants: duplicates,
			identities: identities.rows.map(row => ({
				userId: row.user_id,
				provider: row.provider,
				email: row.email,
				username: row.username,
				displayName: row.display_name,
			})),
			notificationMode: {
				survivor: survivorMode,
				merged: mergedMode,
				result: unionMode(survivorMode, mergedMode),
			},
		};
	});
}

/**
 * Tell both channels, each about the other one.
 *
 * The email names the Discord account; the Discord message names the email
 * address. That crossing is the whole design. If a merge happens that the
 * account holder did not perform, the notice arrives on the channel whoever did
 * it does not control, and it names exactly what they attached — which is the
 * only way anyone would find out, because a merge cannot be undone.
 *
 * Written with the merge's own client so it commits or rolls back with the
 * merge, and queued rather than sent: a closed DM must not roll back a
 * completed merge. Delivery is the dispatcher's problem, with its own retries.
 *
 * The rows are inserted here rather than through `notifications.enqueue`
 * because that opens its own transaction, which would read the identities from
 * a snapshot taken before any of this moved.
 */
async function enqueueMergeNotice(client, { mergeId, survivorId, locale }) {
	const identities = await client.query(
		`SELECT provider, provider_uid, email, email_verified, username, display_name
		   FROM identities WHERE user_id = $1`,
		[survivorId],
	);
	const discord = identities.rows.find(row => row.provider === 'discord');
	const google = identities.rows.find(row => row.provider === 'google' && row.email_verified && row.email);

	// How each connected sign-in would be recognised by the person reading it —
	// the Discord name they use, the address the email arrives at.
	function label(identity) {
		if (!identity) return null;
		if (identity.provider === 'google') return identity.email || identity.username;
		return identity.display_name || identity.username || identity.provider_uid;
	}
	const names = {
		discord: label(discord),
		google: label(google),
		line: label(identities.rows.find(row => row.provider === 'line')),
	};
	const th = locale === 'th';
	const providerNames = { discord: 'Discord', google: 'Google', line: 'LINE' };

	// Every channel is told about the sign-ins that are *not* it.
	//
	// Sending each channel a list of the others is what makes an unauthorized
	// merge findable: the notice lands somewhere the person who did it does not
	// control, and it names what they attached. Writing it as "everything except
	// me" rather than hardcoding the Google/Discord pair also means a merge
	// involving LINE still tells somebody, instead of silently telling nobody.
	const CHANNELS = [
		{ channel: 'email', provider: 'google', available: Boolean(google) },
		{ channel: 'discord', provider: 'discord', available: Boolean(discord) },
	];

	const notices = [];
	for (const target of CHANNELS) {
		if (!target.available) continue;
		const others = Object.entries(names)
			.filter(([provider, name]) => name && provider !== target.provider)
			.map(([provider, name]) => `${providerNames[provider]} (${name})`);
		if (others.length === 0) continue;

		const listEn = others.join(', ');
		const listTh = others.join(' และ ');
		const reportEn = target.channel === 'email'
			? 'If you did not do this, reply to this email straight away.'
			: 'If you did not do this, say so in this chat straight away.';
		const reportTh = target.channel === 'email'
			? 'ถ้าคุณไม่ได้ทำ กรุณาตอบกลับอีเมลนี้ทันที'
			: 'ถ้าคุณไม่ได้ทำ กรุณาแจ้งในแชทนี้ทันที';

		notices.push({
			channel: target.channel,
			eventType: `account_merged_${target.channel}`,
			payload: {
				subjectEn: 'Your Megu accounts were merged',
				subjectTh: 'บัญชี Megu ของคุณถูกรวมแล้ว',
				bodyEn: `Your Megu account now also signs in with ${listEn}. Activities, payments and history from both accounts are in one place. This cannot be undone. ${reportEn}`,
				bodyTh: `บัญชี Megu ของคุณเข้าสู่ระบบด้วย ${listTh} ได้แล้ว กิจกรรม การจ่ายเงิน และประวัติของทั้งสองบัญชีถูกรวมไว้ที่เดียว การรวมนี้ย้อนกลับไม่ได้ ${reportTh}`,
			},
		});
	}

	for (const notice of notices) {
		const eventId = newId('nev');
		const inserted = await client.query(
			`INSERT INTO notification_events (id, user_id, event_type, payload, dedupe_key)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (dedupe_key) DO NOTHING
			 RETURNING id`,
			[eventId, survivorId, notice.eventType,
				{ ...notice.payload, locale: th ? 'th' : 'en', mergeId },
				`${notice.eventType}:${mergeId}`],
		);
		if (inserted.rows.length === 0) continue;
		await client.query(
			`INSERT INTO notification_deliveries (id, event_id, channel)
			 VALUES ($1, $2, $3) ON CONFLICT (event_id, channel) DO NOTHING`,
			[newId('ndl'), inserted.rows[0].id, notice.channel],
		);
	}

	return notices.map(notice => notice.channel);
}

/**
 * Do it.
 *
 * `proof` records how both sides were established — which provider the caller
 * was signed in as, and which one they just authenticated. Never tokens, never
 * an authorization code: this row outlives the session that produced it.
 */
async function mergeAccounts({ userIdA, userIdB, proof = {}, profileSource = null }) {
	if (!userIdA || !userIdB || userIdA === userIdB) throw new Error('merge_same_account');

	// Sorted, because two people merging overlapping accounts at the same moment
	// would otherwise take the same two locks in opposite orders and deadlock.
	const [lockLow, lockHigh] = [userIdA, userIdB].sort();

	return transaction(async (client) => {
		await client.query(
			'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
			[lockLow, lockHigh],
		);
		await assertEveryReferenceIsKnown(client);

		const { survivorId, mergedId } = await chooseSurvivor(client, userIdA, userIdB);

		// Re-checked inside the lock: the confirmation screen was rendered from a
		// plan built earlier, and either account could have gained a provider in
		// between.
		const shared = await sharedProviders(client, survivorId, mergedId);
		if (shared.length > 0) throw new Error(`merge_provider_collision:${shared.join(',')}`);

		const before = {
			survivor: await countsFor(client, survivorId),
			merged: await countsFor(client, mergedId),
		};

		// Preferences first, while both rows still exist to be read.
		const preferences = await client.query(
			'SELECT user_id, mode, locale FROM notification_preferences WHERE user_id IN ($1, $2)',
			[survivorId, mergedId],
		);
		const survivorPreference = preferences.rows.find(row => row.user_id === survivorId);
		const mergedPreference = preferences.rows.find(row => row.user_id === mergedId);
		const mode = unionMode(survivorPreference?.mode || 'off', mergedPreference?.mode || 'off');
		const locale = survivorPreference?.locale || mergedPreference?.locale || 'en';

		await client.query(
			`INSERT INTO notification_preferences (user_id, mode, locale)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (user_id) DO UPDATE SET mode = EXCLUDED.mode, locale = EXCLUDED.locale, updated_at = now()`,
			[survivorId, mode, locale],
		);
		await client.query('DELETE FROM notification_preferences WHERE user_id = $1', [mergedId]);

		// Credentials are keyed (user_id, provider). Providers are disjoint by the
		// check above, so this moves everything; the guard is here so a future
		// relaxation of that rule loses one row instead of the whole transaction.
		await client.query(
			`UPDATE oauth_credentials o SET user_id = $1
			 WHERE o.user_id = $2
			   AND NOT EXISTS (
			     SELECT 1 FROM oauth_credentials existing
			      WHERE existing.user_id = $1 AND existing.provider = o.provider)`,
			[survivorId, mergedId],
		);
		await client.query('DELETE FROM oauth_credentials WHERE user_id = $1', [mergedId]);

		for (const [table, column] of REPOINT) {
			await client.query(
				`UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2`,
				[survivorId, mergedId],
			);
		}

		// Deliberately *not* merging duplicate participant rows.
		//
		// Two roster rows for one person in one activity is the visible cost of
		// this choice, and it is the cheap one. Combining them means combining
		// their `shares` — the unique constraint on (expense_id, participant_id)
		// leaves no other option — and adding two shares together is rewriting a
		// settled ledger. A merge must never change what anybody owes.
		const duplicates = await duplicateParticipants(client, survivorId, survivorId);

		const mergedUser = await client.query('SELECT id FROM users WHERE id = $1', [mergedId]);
		if (mergedUser.rows.length === 0) throw new Error('merge_user_missing');

		await assertNoReferences(client, mergedId);
		await client.query('DELETE FROM users WHERE id = $1', [mergedId]);

		await client.query(
			`INSERT INTO user_aliases (old_user_id, user_id) VALUES ($1, $2)
			 ON CONFLICT (old_user_id) DO UPDATE SET user_id = EXCLUDED.user_id`,
			[mergedId, survivorId],
		);

		// "Primary" is decided here and means exactly one thing: which connected
		// provider the name and picture follow. Both providers still sign in, and
		// this is reversible from the account screen at any time — which is why
		// it can be offered as a checkbox during a merge that is not reversible
		// at all.
		if (profileSource) {
			if (!users.PROFILE_SOURCES.has(profileSource)) throw new Error('profile_source_invalid');
			await client.query(
				'UPDATE users SET profile_source = $2 WHERE id = $1',
				[survivorId, profileSource],
			);
			await users.applyProfileSource(client, survivorId);
		}

		const mergeId = newId('mrg');
		const movedCounts = {
			before,
			after: await countsFor(client, survivorId),
			duplicateParticipantActivities: duplicates.length,
		};
		await client.query(
			`INSERT INTO account_merges
			   (id, survivor_user_id, original_survivor_user_id, merged_user_id, provider_proof, moved_counts)
			 VALUES ($1, $2, $2, $3, $4, $5)`,
			[mergeId, survivorId, mergedId, JSON.stringify(proof || {}), JSON.stringify(movedCounts)],
		);

		const notified = await enqueueMergeNotice(client, { mergeId, survivorId, locale });

		return {
			mergeId,
			survivorId,
			mergedId,
			notificationMode: mode,
			notified,
			duplicateParticipants: duplicates,
			counts: movedCounts,
		};
	});
}

/**
 * A merged id, resolved to the account that absorbed it.
 *
 * Sessions live in Postgres and outlive a merge, so a second browser can come
 * back holding an id whose row is gone. Without this it would be treated as a
 * dead session and rebuilt from the session's identity — a third account.
 */
async function resolveUserId(userId) {
	if (!userId) return null;
	const res = await query(
		`WITH RECURSIVE chain AS (
			SELECT old_user_id, user_id, 1 AS depth FROM user_aliases WHERE old_user_id = $1
			UNION ALL
			SELECT a.old_user_id, a.user_id, chain.depth + 1
			  FROM user_aliases a JOIN chain ON a.old_user_id = chain.user_id
			 WHERE chain.depth < 16
		)
		SELECT user_id FROM chain ORDER BY depth DESC LIMIT 1`,
		[userId],
	);
	return res.rows[0]?.user_id || userId;
}

module.exports = {
	planMerge,
	mergeAccounts,
	resolveUserId,
	unionMode,
	modeFromChannels,
	MODE_CHANNELS,
	REPOINT,
};
