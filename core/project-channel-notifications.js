const { query, transaction } = require('./db.js');
const { newId } = require('./ids.js');

async function enqueueWithClient(client, { projectId, eventType, guildId, channelId, payload, dedupeKey }) {
	if (!projectId || !eventType || !/^\d{17,20}$/.test(String(guildId)) || !/^\d{17,20}$/.test(String(channelId)) || !dedupeKey) {
		throw new Error('project_channel_notification_invalid');
	}
	const result = await client.query(
		`INSERT INTO project_channel_deliveries (id, project_id, event_type, guild_id, channel_id, payload, dedupe_key)
		 VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (dedupe_key) DO UPDATE SET dedupe_key=EXCLUDED.dedupe_key
		 RETURNING id, (xmax = 0) AS inserted`,
		[newId('pcd'), projectId, eventType, String(guildId), String(channelId), payload || {}, dedupeKey],
	);
	return { deliveryId: result.rows[0].id, created: result.rows[0].inserted === true };
}

async function claimPending(limit = 20, { projectId = null } = {}) {
	return transaction(async client => {
		const result = await client.query(
			`SELECT d.*, s.channel_enabled, s.guild_id AS current_guild_id, s.channel_id AS current_channel_id,
			 p.status AS project_status
			 FROM project_channel_deliveries d
			 JOIN projects p ON p.id=d.project_id
			 LEFT JOIN project_notification_settings s ON s.project_id=d.project_id
			 WHERE ((d.status IN ('pending','failed') AND d.next_attempt_at <= now())
			    OR (d.status='sending' AND d.locked_at < now() - interval '5 minutes'))
			 AND ($2::text IS NULL OR d.project_id=$2)
			 ORDER BY d.created_at FOR UPDATE OF d SKIP LOCKED LIMIT $1`,
			[Math.max(1, Math.min(100, Number(limit) || 20)), projectId],
		);
		const valid = [];
		for (const row of result.rows) {
			if (!row.channel_enabled || row.project_status !== 'active'
				|| row.guild_id !== row.current_guild_id || row.channel_id !== row.current_channel_id) {
				await client.query("UPDATE project_channel_deliveries SET status='skipped', locked_at=NULL, last_error='Destination or project is no longer active' WHERE id=$1", [row.id]);
				continue;
			}
			await client.query("UPDATE project_channel_deliveries SET status='sending', attempts=attempts+1, locked_at=now() WHERE id=$1", [row.id]);
			valid.push(row);
		}
		return valid;
	});
}

async function markSent(id) {
	await query("UPDATE project_channel_deliveries SET status='sent', sent_at=now(), locked_at=NULL, last_error=NULL WHERE id=$1", [id]);
}

async function markFailed(id, error, attempts) {
	const terminal = Number(attempts) + 1 >= 8;
	await query(
		`UPDATE project_channel_deliveries SET status=$2, locked_at=NULL, last_error=$3,
		 next_attempt_at=now() + make_interval(secs => LEAST(3600, 30 * power(2, LEAST(attempts, 7)))::int)
		 WHERE id=$1`,
		[id, terminal ? 'skipped' : 'failed', String(error?.message || error).slice(0, 500)],
	);
}

module.exports = { enqueueWithClient, claimPending, markSent, markFailed };
