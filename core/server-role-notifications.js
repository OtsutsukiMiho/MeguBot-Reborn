'use strict';
const notifications = require('./notifications');
const syncEnabled = () => require('./server-role-sync').enabled();
const link = path => process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL.replace(/\/$/, '')}${path}` : null;

async function enqueueMembership(client, { teamId, mappingId, userId, sourceId, cycle, change }) {
	if (!syncEnabled()) return;
	return notifications.enqueueWithClient(client, { userId, eventType: 'team_role_membership_changed', dedupeKey: `role_membership:${sourceId}:${change}:${userId}`,
		payload: { teamId, mappingId, sourceId, cycle, change, subjectEn: 'Team access update', subjectTh: 'ความเคลื่อนไหวของสิทธิ์เข้าทีม',
			bodyEn: 'Your team eligibility changed after role verification. Open Teams to check your current access. Project access is managed separately.',
			bodyTh: 'สิทธิ์เข้าทีมของคุณเปลี่ยนหลังตรวจสอบบทบาท เปิดหน้าทีมเพื่อตรวจสอบสิทธิ์ปัจจุบัน สิทธิ์เข้าโปรเจกต์จัดการแยกต่างหาก',
			ctaLabelEn: 'Open Teams', ctaLabelTh: 'เปิดหน้าทีม', ctaUrl: link('/teams') } });
}

async function enqueueAttention(client, { mappingId, sourceId = null, cycle = null, jobId = null, attentionCycle = null }) {
	if (!syncEnabled()) return;
	const mapping = (await client.query(`SELECT m.id,m.team_id,m.guild_id,m.revision,m.server_consent_by,owner.user_id AS owner_id
	 FROM server_role_mappings m LEFT JOIN team_memberships owner ON owner.team_id=m.team_id AND owner.role='owner' AND owner.revoked_at IS NULL WHERE m.id=$1`, [mappingId])).rows[0];
	if (!mapping) return;
	for (const userId of new Set([mapping.owner_id, mapping.server_consent_by].filter(Boolean))) {
		await notifications.enqueueWithClient(client, { userId, eventType: 'team_role_sync_attention', dedupeKey: `role_attention:${sourceId || jobId}:${cycle ?? attentionCycle}:${userId}`,
			payload: { teamId: mapping.team_id, mappingId, mappingRevision: mapping.revision, sourceId, cycle, jobId, attentionCycle,
				subjectEn: 'Role integration needs attention', subjectTh: 'การเชื่อมบทบาทต้องได้รับการตรวจสอบ',
				bodyEn: 'Role reconciliation needs attention. Existing access may remain while verification recovers or ownership is resolved. Review the integration; use manual removal if access must stop urgently.',
				bodyTh: 'การตรวจสอบบทบาทต้องได้รับการแก้ไข สิทธิ์เดิมอาจยังคงอยู่ระหว่างรอการตรวจสอบหรือแก้ไขความเป็นเจ้าของ ตรวจสอบการเชื่อมต่อ และนำสมาชิกออกด้วยตนเองหากต้องหยุดสิทธิ์ทันที',
				ctaLabelEn: 'Review integration', ctaLabelTh: 'ตรวจสอบการเชื่อมต่อ', ctaUrl: link(userId === mapping.owner_id ? `/teams/${encodeURIComponent(mapping.team_id)}` : `/teams/server/${encodeURIComponent(mapping.guild_id)}/role-mappings`) } });
	}
}

async function eligible(client, row) {
	if (!syncEnabled()) return false;
	const p = row.payload;
	if (!p || typeof p.teamId !== 'string' || typeof p.mappingId !== 'string') return false;
	const state = (await client.query(`SELECT m.revision,m.server_consent_by,m.mode,m.enabled,m.retired_at,m.delegation_version,t.archived_at,
	 EXISTS(SELECT 1 FROM team_memberships owner WHERE owner.team_id=m.team_id AND owner.user_id=m.owner_consent_by AND owner.role='owner' AND owner.revoked_at IS NULL) AS owner_valid
	 FROM server_role_mappings m JOIN teams t ON t.id=m.team_id WHERE m.id=$1 AND m.team_id=$2`, [p.mappingId, p.teamId])).rows[0];
	if (!state) return false;
	const account = (await client.query(`SELECT prefs.mode,
	 EXISTS(SELECT 1 FROM identities WHERE user_id=$1 AND provider='discord') AS has_discord,
	 EXISTS(SELECT 1 FROM identities WHERE user_id=$1 AND provider='google' AND email_verified AND email IS NOT NULL) AS has_email
	 FROM users u LEFT JOIN notification_preferences prefs ON prefs.user_id=u.id WHERE u.id=$1`, [row.user_id])).rows[0];
	if (!account || !notifications.channelsFor(account.mode || (account.has_discord ? 'discord' : account.has_email ? 'email' : 'off'), { hasDiscord: account.has_discord, hasEmail: account.has_email }).includes(row.channel)) return false;
	if (row.event_type === 'team_role_membership_changed') {
		if (p.change === 'granted') {
			if (!state.enabled || state.mode !== 'automatic' || state.retired_at || state.delegation_version !== 1 || !state.owner_valid) return false;
			try { await require('./company-access').requireTeamCompanyAccess(client, p.teamId, row.user_id); }
			catch (error) { if (['team_not_found','company_archived'].includes(error.code)) return false; throw error; }
		}
		const source = (await client.query(`SELECT s.revoked_at,m.revoked_at AS member_revoked,t.archived_at FROM team_membership_sources s
		 JOIN team_memberships m ON m.team_id=s.team_id AND m.user_id=s.user_id JOIN teams t ON t.id=s.team_id
		 WHERE s.id=$1 AND s.mapping_id=$2 AND s.team_id=$3 AND s.user_id=$4 AND s.cycle=$5`, [p.sourceId,p.mappingId,p.teamId,row.user_id,p.cycle])).rows[0];
		return Boolean(source && (p.change === 'granted' ? !source.revoked_at && !source.member_revoked && !source.archived_at : p.change === 'revoked' && source.revoked_at && source.member_revoked));
	}
	if (row.event_type !== 'team_role_sync_attention' || state.archived_at || state.revision !== p.mappingRevision) return false;
	const owner = (await client.query("SELECT 1 FROM team_memberships WHERE team_id=$1 AND user_id=$2 AND role='owner' AND revoked_at IS NULL", [p.teamId,row.user_id])).rows.length > 0;
	if (owner) {
		try { await require('./company-access').requireTeamCompanyAccess(client, p.teamId, row.user_id); }
		catch (error) { if (['team_not_found','company_archived'].includes(error.code)) return false; throw error; }
	}
	if (!owner && !(state.server_consent_by === row.user_id && account.has_discord)) return false;
	if (p.sourceId) return (await client.query("SELECT 1 FROM team_membership_sources WHERE id=$1 AND mapping_id=$2 AND cycle=$3 AND revoked_at IS NULL AND metadata ? 'blockedRevocation'", [p.sourceId,p.mappingId,p.cycle])).rows.length > 0;
	return (await client.query("SELECT 1 FROM server_role_sync_jobs WHERE id=$1 AND mapping_id=$2 AND attention_cycle=$3 AND attention_open AND state IN ('degraded','blocked')", [p.jobId,p.mappingId,p.attentionCycle])).rows.length > 0;
}

module.exports = { enqueueMembership, enqueueAttention, eligible };
