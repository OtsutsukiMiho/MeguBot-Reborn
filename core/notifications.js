const { query, transaction } = require('./db.js');
const { newId } = require('./ids.js');

function channelsFor(mode, { hasDiscord, hasEmail }) {
	const channels = [];
	if (['discord', 'both'].includes(mode) && hasDiscord) channels.push('discord');
	if (['email', 'both'].includes(mode) && hasEmail) channels.push('email');
	return channels;
}

async function enqueue({ userId, eventType, payload, dedupeKey }) {
	if (!userId || !eventType || !dedupeKey) throw new Error('notification_event_invalid');
	return transaction(async (client) => {
		const identities = await client.query(
			'SELECT provider, provider_uid, email, email_verified FROM identities WHERE user_id = $1',
			[userId],
		);
		const discord = identities.rows.find(row => row.provider === 'discord');
		const email = identities.rows.find(row => row.provider === 'google' && row.email_verified && row.email);
		const preference = await client.query('SELECT mode, locale FROM notification_preferences WHERE user_id = $1', [userId]);
		const mode = preference.rows[0]?.mode || (discord ? 'discord' : email ? 'email' : 'off');
		const locale = preference.rows[0]?.locale || 'en';
		const event = await client.query(
			`INSERT INTO notification_events (id, user_id, event_type, payload, dedupe_key)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (dedupe_key) DO UPDATE SET dedupe_key = EXCLUDED.dedupe_key
			 RETURNING id`,
			[newId('nev'), userId, eventType, { ...payload, locale }, dedupeKey],
		);
		for (const channel of channelsFor(mode, { hasDiscord: Boolean(discord), hasEmail: Boolean(email) })) {
			await client.query(
				`INSERT INTO notification_deliveries (id, event_id, channel)
				 VALUES ($1, $2, $3) ON CONFLICT (event_id, channel) DO NOTHING`,
				[newId('ndl'), event.rows[0].id, channel],
			);
		}
		return { eventId: event.rows[0].id, mode };
	});
}

async function claimPending(limit = 20) {
	return transaction(async (client) => {
		const res = await client.query(
			`SELECT d.id, d.channel, d.attempts, e.event_type, e.payload, e.user_id,
				i.provider_uid AS discord_uid,
				ge.email
			 FROM notification_deliveries d
			 JOIN notification_events e ON e.id = d.event_id
			 LEFT JOIN identities i ON i.user_id = e.user_id AND i.provider = 'discord'
			 LEFT JOIN identities ge ON ge.user_id = e.user_id AND ge.provider = 'google' AND ge.email_verified = true
			 WHERE (d.status IN ('pending', 'failed') AND d.next_attempt_at <= now())
			    OR (d.status = 'sending' AND d.locked_at < now() - interval '5 minutes')
			 ORDER BY d.created_at
			 FOR UPDATE OF d SKIP LOCKED
			 LIMIT $1`,
			[limit],
		);
		if (res.rows.length) {
			await client.query(
				`UPDATE notification_deliveries SET status = 'sending', attempts = attempts + 1, locked_at = now()
				 WHERE id = ANY($1::text[])`,
				[res.rows.map(row => row.id)],
			);
		}
		return res.rows;
	});
}

async function markSent(deliveryId) {
	await query("UPDATE notification_deliveries SET status = 'sent', sent_at = now(), last_error = NULL, locked_at = NULL WHERE id = $1", [deliveryId]);
}

async function markFailed(deliveryId, error, attempts) {
	const terminal = Number(attempts) + 1 >= 8;
	await query(
		`UPDATE notification_deliveries
		 SET status = $2, last_error = $3, locked_at = NULL,
		     next_attempt_at = now() + make_interval(secs => LEAST(3600, 30 * power(2, LEAST(attempts, 7)))::int)
		 WHERE id = $1`,
		[deliveryId, terminal ? 'skipped' : 'failed', String(error?.message || error).slice(0, 500)],
	);
}

function render(delivery) {
	const p = delivery.payload || {};
	const th = p.locale === 'th';
	const subject = (th ? p.subjectTh : p.subjectEn) || p.subject || (th ? `อัปเดตจาก Megu · ${p.activityTitle || ''}` : `Megu update · ${p.activityTitle || ''}`);
	const body = (th ? p.bodyTh : p.bodyEn) || p.body || (th ? 'มีรายการใหม่ในกิจกรรมของคุณ' : 'There is a new update in your activity.');
	const ctaLabel = p.ctaLabel || (th ? 'เปิดใน Megu' : 'Open in Megu');
	return { subject, body, ctaLabel, ctaUrl: p.ctaUrl || null };
}

module.exports = { channelsFor, enqueue, claimPending, markSent, markFailed, render };
