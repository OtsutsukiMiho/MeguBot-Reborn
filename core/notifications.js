const { query, transaction } = require('./db.js');
const { newId } = require('./ids.js');

function channelsFor(mode, { hasDiscord, hasEmail }) {
	const channels = [];
	if (['discord', 'both'].includes(mode) && hasDiscord) channels.push('discord');
	if (['email', 'both'].includes(mode) && hasEmail) channels.push('email');
	return channels;
}

/**
 * Queue one semantic event for delivery.
 *
 * `channels` overrides the account's delivery preference, and exists for the
 * short list of messages that are not product notifications at all: "your
 * account was merged" is a security notice, and a security notice that obeys a
 * mute setting is a security notice the one person who needed it never sees.
 * It is still filtered by which channels the account actually has.
 */
async function enqueueWithClient(client, { userId, eventType, payload, dedupeKey, channels = null }) {
	if (!userId || !eventType || !dedupeKey) throw new Error('notification_event_invalid');
		const identities = await client.query(
			'SELECT provider, provider_uid, email, email_verified FROM identities WHERE user_id = $1',
			[userId],
		);
		const discord = identities.rows.find(row => row.provider === 'discord');
		const email = identities.rows.find(row => row.provider === 'google' && row.email_verified && row.email);
		const preference = await client.query('SELECT mode, locale FROM notification_preferences WHERE user_id = $1', [userId]);
		const mode = preference.rows[0]?.mode || (discord ? 'discord' : email ? 'email' : 'off');
		const locale = preference.rows[0]?.locale || 'en';
		// `xmax = 0` is true only on a genuine insert: on the conflict path the
		// row carries the updating transaction's id. Callers need to tell the
		// two apart — a sweep that runs every five minutes would otherwise
		// report "1 reminder sent" on every pass for the same reminder, which
		// reads in the log exactly like the bug it is not.
		const event = await client.query(
			`INSERT INTO notification_events (id, user_id, event_type, payload, dedupe_key)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (dedupe_key) DO UPDATE SET dedupe_key = EXCLUDED.dedupe_key
			 RETURNING id, (xmax = 0) AS inserted`,
			[newId('nev'), userId, eventType, { ...payload, locale }, dedupeKey],
		);
		const available = { hasDiscord: Boolean(discord), hasEmail: Boolean(email) };
		const selected = channels
			? channels.filter(channel => (channel === 'discord' && available.hasDiscord)
				|| (channel === 'email' && available.hasEmail))
			: channelsFor(mode, available);
		for (const channel of selected) {
			await client.query(
				`INSERT INTO notification_deliveries (id, event_id, channel)
				 VALUES ($1, $2, $3) ON CONFLICT (event_id, channel) DO NOTHING`,
				[newId('ndl'), event.rows[0].id, channel],
			);
		}
		return { eventId: event.rows[0].id, created: event.rows[0].inserted === true, mode };
}

async function enqueue(options) {
	return transaction(client => enqueueWithClient(client, options));
}

async function claimPending(limit = 20) {
	return transaction(async (client) => {
		const res = await client.query(
			`SELECT d.id, d.channel, d.attempts, e.event_type, e.payload, e.user_id,
				i.provider_uid AS discord_uid,
				ge.email,p.id AS project_id,p.status AS project_status,p.team_id,p.owner_user_id AS project_owner_id,
				pm.user_id AS project_member_id,tm.user_id AS team_member_id,t.archived_at AS team_archived_at,
				pjr.id AS project_request_id,pjr.status AS project_request_status,pjr.request_cycle AS project_request_cycle,
				pjl.id AS project_link_id,pjl.revoked_at AS project_link_revoked_at,pjl.expires_at AS project_link_expires_at,
				jt.id AS join_team_id,jt.archived_at AS join_team_archived_at,jtm.role AS join_team_recipient_role,
				tjr.id AS team_request_id,tjr.status AS team_request_status,tjr.request_cycle AS team_request_cycle,
				tjl.id AS team_link_id,tjl.revoked_at AS team_link_revoked_at,tjl.expires_at AS team_link_expires_at
			 FROM notification_deliveries d
			 JOIN notification_events e ON e.id = d.event_id
			 LEFT JOIN identities i ON i.user_id = e.user_id AND i.provider = 'discord'
			 LEFT JOIN identities ge ON ge.user_id = e.user_id AND ge.provider = 'google' AND ge.email_verified = true
			 LEFT JOIN projects p ON p.id=(e.payload->>'projectId')
			 LEFT JOIN project_memberships pm ON pm.project_id=p.id AND pm.user_id=e.user_id AND pm.revoked_at IS NULL
			 LEFT JOIN teams t ON t.id=p.team_id
			 LEFT JOIN team_memberships tm ON tm.team_id=p.team_id AND tm.user_id=e.user_id AND tm.revoked_at IS NULL
			 LEFT JOIN project_join_requests pjr ON pjr.id=(e.payload->>'projectRequestId') AND pjr.project_id=p.id
			 LEFT JOIN project_join_links pjl ON pjl.id=pjr.originating_link_id AND pjl.project_id=p.id
			 LEFT JOIN teams jt ON jt.id=(e.payload->>'teamId')
			 LEFT JOIN team_memberships jtm ON jtm.team_id=jt.id AND jtm.user_id=e.user_id AND jtm.revoked_at IS NULL
			 LEFT JOIN team_join_requests tjr ON tjr.id=(e.payload->>'teamRequestId') AND tjr.team_id=jt.id
			 LEFT JOIN team_join_links tjl ON tjl.id=tjr.originating_link_id AND tjl.team_id=jt.id
			 WHERE (d.status IN ('pending', 'failed') AND d.next_attempt_at <= now())
			    OR (d.status = 'sending' AND d.locked_at < now() - interval '5 minutes')
			 ORDER BY d.created_at
			 FOR UPDATE OF d SKIP LOCKED
			 LIMIT $1`,
			[limit],
		);
		const valid = [];
		for (const row of res.rows) {
			let accessible;
			if (['team_goal_changed', 'team_goal_due'].includes(row.event_type)) accessible = await require('./team-goal-notifications').eligible(client, row);
			else if (row.event_type === 'project_join_requested') {
				accessible = Boolean(row.project_id
					&& row.project_owner_id === row.user_id
					&& ['planning', 'active', 'paused'].includes(row.project_status)
					&& row.project_request_id === row.payload?.projectRequestId
					&& row.project_request_status === 'pending'
					&& Number(row.project_request_cycle) === Number(row.payload?.requestCycle)
					&& row.project_link_id
					&& !row.project_link_revoked_at
					&& new Date(row.project_link_expires_at) > new Date());
			}
			else if (row.event_type === 'team_join_requested') {
				accessible = Boolean(row.join_team_id
					&& !row.join_team_archived_at
					&& row.join_team_recipient_role === 'owner'
					&& row.team_request_id === row.payload?.teamRequestId
					&& row.team_request_status === 'pending'
					&& Number(row.team_request_cycle) === Number(row.payload?.requestCycle)
					&& row.team_link_id
					&& !row.team_link_revoked_at
					&& new Date(row.team_link_expires_at) > new Date());
			}
			else {
				const referencesProject = Boolean(row.payload?.projectId);
				accessible = !referencesProject || (row.project_id && row.project_member_id
					&& row.project_status === 'active' && (!row.team_id || (row.team_member_id && !row.team_archived_at)));
			}
			if (accessible) accessible = await require('./company-access').notificationScopeEligible(client,row);
			if (!accessible) {
				await client.query("UPDATE notification_deliveries SET status='skipped',locked_at=NULL,last_error='Notification is no longer eligible' WHERE id=$1", [row.id]);
				continue;
			}
			valid.push(row);
		}
		if (valid.length) {
			await client.query(
				`UPDATE notification_deliveries SET status = 'sending', attempts = attempts + 1, locked_at = now()
				 WHERE id = ANY($1::text[])`,
				[valid.map(row => row.id)],
			);
		}
		return valid;
	});
}

async function recheckClaimed(deliveryId) {
	return transaction(async client => {
		const delivery = await client.query(
			`SELECT d.id,d.status,d.channel,e.event_type,e.payload,e.user_id FROM notification_deliveries d
			 JOIN notification_events e ON e.id=d.event_id WHERE d.id=$1 FOR UPDATE OF d`,
			[deliveryId],
		);
		const row = delivery.rows[0];
		if (!row || row.status !== 'sending') return false;
		let eligible = true;
		if (['team_goal_changed', 'team_goal_due'].includes(row.event_type)) eligible = await require('./team-goal-notifications').eligible(client, row);
		else if (row.event_type === 'project_join_requested') {
			const check = await client.query(
				`SELECT 1 FROM projects p JOIN project_join_requests r ON r.project_id=p.id
				 JOIN project_join_links l ON l.id=r.originating_link_id AND l.project_id=p.id
				 WHERE p.id=$1 AND p.owner_user_id=$2 AND p.status IN ('planning','active','paused')
				 AND r.id=$3 AND r.status='pending' AND r.request_cycle=$4
				 AND l.revoked_at IS NULL AND l.expires_at>now()`,
				[row.payload?.projectId, row.user_id, row.payload?.projectRequestId, Number(row.payload?.requestCycle)],
			);
			eligible = Boolean(check.rows[0]);
		}
		else if (row.event_type === 'team_join_requested') {
			const check = await client.query(
				`SELECT 1 FROM teams t JOIN team_memberships m ON m.team_id=t.id
				 JOIN team_join_requests r ON r.team_id=t.id
				 JOIN team_join_links l ON l.id=r.originating_link_id AND l.team_id=t.id
				 WHERE t.id=$1 AND t.archived_at IS NULL AND m.user_id=$2 AND m.role='owner' AND m.revoked_at IS NULL
				 AND r.id=$3 AND r.status='pending' AND r.request_cycle=$4
				 AND l.revoked_at IS NULL AND l.expires_at>now()`,
				[row.payload?.teamId, row.user_id, row.payload?.teamRequestId, Number(row.payload?.requestCycle)],
			);
			eligible = Boolean(check.rows[0]);
		}
		if (eligible) eligible = await require('./company-access').notificationScopeEligible(client,row);
		if (!eligible) {
			await client.query("UPDATE notification_deliveries SET status='skipped',locked_at=NULL,last_error='Notification became obsolete before dispatch' WHERE id=$1", [deliveryId]);
		}
		return eligible;
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
	const ctaLabel = (th ? p.ctaLabelTh : p.ctaLabelEn) || p.ctaLabel || (th ? 'เปิดใน Megu' : 'Open in Megu');

	// A second, quieter button. It exists because a message with one button
	// only collects one answer: everybody who cannot press "Pay" today presses
	// nothing, and silence is the one reply that tells the organizer nothing.
	// Email can only offer it as a link; Discord replaces it with a real button
	// and a modal, and both end up writing the same row.
	const secondaryUrl = p.secondaryUrl || null;
	const secondaryLabel = secondaryUrl
		? ((th ? p.secondaryLabelTh : p.secondaryLabelEn) || p.secondaryLabel || (th ? 'ยังไม่พร้อม' : 'Not now'))
		: null;

	return {
		subject,
		body,
		ctaLabel,
		ctaUrl: p.ctaUrl || null,
		secondaryLabel,
		secondaryUrl,
		defer: p.defer || null,
	};
}

module.exports = { channelsFor, enqueue, enqueueWithClient, claimPending, recheckClaimed, markSent, markFailed, render };
