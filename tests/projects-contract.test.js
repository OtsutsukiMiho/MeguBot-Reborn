'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const projects = require('../core/projects.js');
const { newProjectCode } = require('../core/ids.js');

const root = path.join(__dirname, '..');
const workspace = fs.readFileSync(path.join(root, 'app', 'components', 'projects', 'ProjectWorkspace.js'), 'utf8');
const workspaceStyles = fs.readFileSync(path.join(root, 'app', 'components', 'projects', 'projectWorkspace.module.css'), 'utf8');
const manage = fs.readFileSync(path.join(root, 'app', 'components', 'projects', 'ProjectManage.js'), 'utf8');
const manageStyles = fs.readFileSync(path.join(root, 'app', 'components', 'projects', 'projectManage.module.css'), 'utf8');
const invitation = fs.readFileSync(path.join(root, 'app', 'components', 'projects', 'ProjectInvitation.js'), 'utf8');
const invitationStyles = fs.readFileSync(path.join(root, 'app', 'components', 'projects', 'projectInvitation.module.css'), 'utf8');
const directoryStyles = fs.readFileSync(path.join(root, 'app', 'projects', 'projects.module.css'), 'utf8');
const customSelect = fs.readFileSync(path.join(root, 'app', 'components', 'CustomSelect.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'adapters', 'http', 'megu-api.js'), 'utf8');
const web = fs.readFileSync(path.join(root, 'backend', 'web', 'web.js'), 'utf8');
const projectsCore = fs.readFileSync(path.join(root, 'core', 'projects.js'), 'utf8');
const projectReminders = fs.readFileSync(path.join(root, 'core', 'project-reminders.js'), 'utf8');
const projectSchema = fs.readFileSync(path.join(root, 'core', 'schema.js'), 'utf8');
const channelNotifications = fs.readFileSync(path.join(root, 'core', 'project-channel-notifications.js'), 'utf8');
const bot = fs.readFileSync(path.join(root, 'backend', 'bot', 'bot.js'), 'utf8');
const discordCommandSource = fs.readFileSync(path.join(root, 'commands', 'utility', 'projects.js'), 'utf8');
const discordCommand = require('../commands/utility/projects.js').data.toJSON();

assert.match(newProjectCode(), /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{7}$/);
assert.strictEqual(projects.validate.dates({ deadlineAt: '2026-09-30' }, 'Asia/Bangkok').deadlineAt, '2026-09-30T16:59:59.999Z');
assert.strictEqual(projects.validate.dates({ deadlineAt: '2569-09-07' }, 'Asia/Bangkok').deadlineAt, '2026-09-07T16:59:59.999Z');
assert.throws(() => projects.validate.dates({ deadlineAt: '2026-02-31' }, 'Asia/Bangkok'), error => error.code === 'deadline_at_invalid');
assert.deepStrictEqual(projects.validate.normaliseInviteRecipient({ provider: 'email', recipient: ' Person@Example.COM ' }), { provider: 'email', recipient: 'person@example.com' });
assert.throws(() => projects.validate.normaliseInviteRecipient({ provider: 'discord', recipient: 'display-name' }), error => error.code === 'invitation_recipient_invalid');
const bangkokDeadline = projects.validate.dates({ deadlineAt: '2030-10-10' }, 'Asia/Bangkok').deadlineAt;
const newYorkDeadline = projects.validate.rezoneInstant(bangkokDeadline, 'date', 'Asia/Bangkok', 'America/New_York', true);
const newYorkParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(newYorkDeadline)).map(part => [part.type, part.value]));
assert.strictEqual(`${newYorkParts.year}-${newYorkParts.month}-${newYorkParts.day}`, '2030-10-10');
const springDst = projects.validate.dates({ startsAt: '2030-03-10', deadlineAt: '2030-03-10' }, 'America/New_York');
const fallDst = projects.validate.dates({ startsAt: '2030-11-03', deadlineAt: '2030-11-03' }, 'America/New_York');
assert.strictEqual(new Date(springDst.deadlineAt) - new Date(springDst.startsAt), 23 * 60 * 60 * 1000 - 1, 'a date-only spring DST day is not forced to 24 hours');
assert.strictEqual(new Date(fallDst.deadlineAt) - new Date(fallDst.startsAt), 25 * 60 * 60 * 1000 - 1, 'a date-only fall DST day is not forced to 24 hours');
assert.throws(() => projects.validate.rezoneInstant('2030-03-10T02:30:00.000Z', 'instant', 'UTC', 'America/New_York'), error => error.code === 'timezone_schedule_invalid');
assert.equal(projects.validate.dependencyCreatesCycle([], 'topic-a', 'topic-b'), false);
assert.equal(projects.validate.normaliseReport({ progress: 0, summary: 'Not started yet' }).workflow, 'not_started');
assert.equal(projects.validate.normaliseReport({ progress: 1, summary: 'Started' }).workflow, 'in_progress');
assert.throws(() => projects.validate.assertKnownFields({ title: 'Known', ownerUserId: 'usr_1', role: 'owner' }, ['title', 'ownerUserId']), error => error.code === 'unknown_field' && error.field === 'role');
assert.equal(projects.validate.dependencyCreatesCycle([
	{ predecessor_topic_id: 'topic-b', successor_topic_id: 'topic-c' },
	{ predecessor_topic_id: 'topic-c', successor_topic_id: 'topic-a' },
], 'topic-a', 'topic-b'), true);

assert.match(workspace, /role="tablist"/);
assert.match(workspace, /onKeyDown=\{event => onTabKey/);
assert.match(workspace, /topics\/\$\{topic\.id\}\/assignees/);
assert.match(workspace, /projects\/\$\{project\.code\}\/dependencies/);
assert.match(workspace, /projects\/\$\{project\.code\}\/milestones/);
assert.match(workspace, /role="tabpanel"/);
assert.match(workspace, /onPointerDown=\{event => onDrag/);
assert.match(workspace, /event\.key === 'Escape'/);
assert.match(workspace, /const todayVisible = today >= 0 && today <= 100/);
assert.match(workspace, /<span aria-hidden="true" \/><span>\{p\.topic\}/);
assert.match(workspace, /scheduleChangeTitle/);
assert.match(workspace, /acknowledgeProjectDeadline/);
assert.match(workspace, /reportPreview/);
assert.match(workspace, /SafeProjectMarkdown/);
assert.match(workspace, /canonicalProjectDate/);
assert.match(workspace, /https\?:\\\/\\\//);
assert.match(workspace, /noreferrer noopener/);
assert.doesNotMatch(workspace, /dangerouslySetInnerHTML/);
assert.match(workspace, /sortTopics/);
assert.match(workspace, /role="dialog"/);
assert.match(workspace, /detailTriggerRef\.current\?\.focus/);
assert.doesNotMatch(workspace, /(?:window\.)?confirm\s*\(/);
assert.match(workspaceStyles, /prefers-reduced-motion:\s*reduce/);
for (const styles of [workspaceStyles, manageStyles, invitationStyles, directoryStyles]) {
	assert.match(styles, /max-width:\s*1568px/);
}
assert.match(manage, /manageTabs/);
assert.match(manage, /beforeunload/);
assert.match(manage, /unsavedWarning/);
assert.match(manage, /reminder48h/);
assert.match(manage, /reminder24h/);
assert.match(manage, /channelDisclosure/);
assert.doesNotMatch(`${workspace}\n${manage}\n${invitation}`, /<select\b/, 'Projects surfaces must use the shared custom selection control');
assert.match(workspace, /import CustomSelect from '..\/CustomSelect'/);
assert.match(manage, /import CustomSelect from '..\/CustomSelect'/);
assert.match(customSelect, /size === 'compact'/);
assert.match(customSelect, /aria-required=\{required \|\| undefined\}/);
assert.match(manage, /channelName: option\?\.label \|\| ''/);
assert.match(manage, /recipient-bound|only work for the Discord account|inviteHint/);
assert.match(invitation, /returnTo=/);
assert.match(api, /projects\/invitations\/:token\/accept/);
assert.match(api, /listProjectDirectory/);
assert.match(api, /assertKnownFields\(req\.body \|\| \{\}, \[\]\)/);
assert.match(api, /projects\/:code\/members\/:memberId/);
assert.match(api, /projects\/:code\/notification-settings/);
assert.match(api, /api\.get\('\/projects\/:code\/topics'/);
assert.match(api, /api\.get\('\/projects\/:code\/topics\/:topicId'/);
assert.match(api, /projects\/:code\/dependencies\/:dependencyId/);
assert.match(api, /projects\/:code\/milestones\/:milestoneId/);
assert.match(workspace, /notifyLeads/);
const blockerPayloadStart = projectsCore.indexOf("eventType: 'project_topic_blocked'");
const blockerPayloadEnd = projectsCore.indexOf("await client.query('UPDATE projects", blockerPayloadStart);
assert.ok(blockerPayloadStart > 0 && blockerPayloadEnd > blockerPayloadStart);
assert.doesNotMatch(projectsCore.slice(blockerPayloadStart, blockerPayloadEnd), /report\.(?:summary|blockerReason)/);
assert.match(projectSchema, /project_reminder_jobs/);
assert.match(projectSchema, /correction_of_report_id/);
assert.match(projectsCore, /correction_report_invalid/);
assert.match(projectSchema, /deadline_revision/);
assert.match(projectReminders, /FOR UPDATE OF j SKIP LOCKED/);
assert.match(projectReminders, /project_status !== 'active'/);
assert.match(projectReminders, /m\.revoked_at IS NULL/);
assert.match(projectReminders, /schedule_revision/);
assert.match(projectSchema, /project_channel_deliveries/);
assert.match(channelNotifications, /FOR UPDATE OF d SKIP LOCKED/);
assert.match(api, /validateProjectChannel/);
assert.match(bot, /project_channel_notice/);
assert.match(bot, /allowedMentions: \{ parse: \[\] \}/);
assert.match(api, /MEGU_PROJECTS_ENABLED === '0'/);
assert.match(web, /safeInternalReturn\(req\.query\.returnTo\)/);
assert.match(web, /!path\.startsWith\('\/'\) \|\| path\.startsWith\('\/\/'\)/);
assert.strictEqual(discordCommand.name, 'projects');
assert.ok(discordCommand.options.length <= 25);
for (const top of discordCommand.options) {
	for (const command of top.type === 2 ? top.options : [top]) {
		let sawOptional = false;
		for (const option of command.options || []) {
			if (!option.required) sawOptional = true;
			assert.ok(!(option.required && sawOptional), `${top.name}/${command.name} puts a required option after an optional one`);
		}
	}
}
assert.match(discordCommandSource, /deferReply\(\{ flags: EPHEMERAL \}\)/);
assert.match(discordCommandSource, /allowedMentions: \{ parse: \[\] \}/);
assert.match(discordCommandSource, /listProjectDirectory/);
assert.match(discordCommandSource, /startsWith\('th'\)/);
assert.match(discordCommandSource, /โปรเจกต์ยังไม่พร้อมใช้งาน/);

console.log('projects contract passed — private navigation, dates, invitations, assignments and accessible views are wired');
