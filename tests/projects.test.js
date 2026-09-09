require('dotenv').config();
const assert = require('node:assert');
const core = require('../core/index.js');

const createdUsers = [];
const createdProjects = [];

async function expectCode(promise, code) {
	await assert.rejects(promise, error => error?.code === code);
}

async function main() {
	await core.initCoreSchema();
	const ownerLogin = await core.users.loginWithIdentity({
		provider: 'discord', providerUid: `__project_owner_${Date.now()}__`,
		username: 'project-owner', displayName: 'Project Owner',
	});
	const memberLogin = await core.users.loginWithIdentity({
		provider: 'discord', providerUid: `__project_member_${Date.now()}__`,
		username: 'project-member', displayName: 'Project Member',
	});
	const invitedDiscordUid = `${Date.now()}12345`.slice(0, 18);
	const invitedLogin = await core.users.loginWithIdentity({
		provider: 'discord', providerUid: invitedDiscordUid,
		username: 'project-invitee', displayName: 'Project Invitee',
	});
	const ownerId = ownerLogin.user.id;
	const memberId = memberLogin.user.id;
	const invitedId = invitedLogin.user.id;
	createdUsers.push(ownerId, memberId, invitedId);

	const project = await core.projects.createProject({
		ownerUserId: ownerId,
		title: 'Community website',
		description: 'A shared home for the group.',
		timezone: 'Asia/Bangkok',
		deadlineAt: '2026-09-30',
		deadlinePrecision: 'date',
	});
	createdProjects.push(project.id);
	assert.match(project.code, /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{7}$/);
	assert.strictEqual(project.status, 'planning');
	assert.strictEqual(new Date(project.deadlineAt).toISOString(), '2026-09-30T16:59:59.999Z');
	assert.throws(() => core.projects.validate.dates({ deadlineAt: '2026-02-31', deadlinePrecision: 'date' }, 'Asia/Bangkok'));

	const firstTopic = await core.projects.createTopic(project.code, ownerId, {
		title: 'Website frontend', description: 'Build the responsive workspace.',
		startsAt: '2026-09-09', startsPrecision: 'date',
		deadlineAt: '2026-09-24', deadlinePrecision: 'date',
		assigneeUserIds: [ownerId], expectedRevision: 0,
	});
	assert.strictEqual(firstTopic.topic.number, 1);
	assert.strictEqual(firstTopic.topic.assignees[0].primary, true);
	assert.strictEqual((await core.projects.listProjectTopics(project.code, ownerId)).topics[0].id, firstTopic.topic.id);
	assert.strictEqual((await core.projects.getProjectTopic(project.code, firstTopic.topic.id, ownerId)).topic.title, 'Website frontend');

	const invitation = await core.projects.createInvitation(project.code, ownerId, {
		provider: 'discord', recipient: invitedDiscordUid, role: 'member',
	});
	assert.ok(invitation.token.length > 30);
	const pending = await core.projects.listProjectInvitations(project.code, ownerId);
	assert.strictEqual(pending.invitations.length, 1);
	assert.strictEqual('token' in pending.invitations[0], false, 'pending lists never disclose the invite token');
	await expectCode(core.projects.acceptInvitation(invitation.token, memberId), 'invitation_recipient_mismatch');
	const accepted = await core.projects.acceptInvitation(invitation.token, invitedId);
	assert.strictEqual(accepted.project.code, project.code);
	assert.strictEqual(accepted.member.role, 'member');
	await expectCode(core.projects.acceptInvitation(invitation.token, invitedId), 'invitation_used');
	const people = await core.projects.listProjectMembers(project.code, invitedId);
	assert.ok(people.members.some(person => person.userId === invitedId));
	const transfer = await core.projects.proposeOwnershipTransfer(project.code, ownerId, {
		proposedOwnerId: invitedId, expectedRevision: 2,
	});
	const recipientView = await core.projects.getProjectByCode(project.code, invitedId);
	assert.strictEqual(recipientView.ownershipTransfer.id, transfer.transfer.id);
	const transferred = await core.projects.acceptOwnershipTransfer(project.code, transfer.transfer.id, invitedId);
	assert.strictEqual(transferred.project.ownerUserId, invitedId);
	const oldOwnerView = await core.projects.getProjectByCode(project.code, ownerId);
	assert.strictEqual(oldOwnerView.me.role, 'lead');
	const assigned = await core.projects.setTopicAssignees(project.code, firstTopic.topic.id, ownerId, {
		userIds: [invitedId, ownerId], primaryUserId: invitedId, expectedRevision: 0,
	});
	assert.deepStrictEqual(assigned.assignees.map(person => person.userId), [invitedId, ownerId]);

	await core.db.query(
		"INSERT INTO project_memberships (project_id, user_id, role) VALUES ($1, $2, 'member')",
		[project.id, memberId],
	);
	await expectCode(core.projects.createTopic(project.code, memberId, { title: 'Not allowed', expectedRevision: 1 }), 'project_forbidden');
	await expectCode(core.projects.getProjectByCode(project.code, 'usr_not_a_member'), 'project_not_found');
	await expectCode(core.projects.reportProgress(project.code, firstTopic.topic.id, ownerId, {
		progress: 10, summary: 'Started.', expectedRevision: 1, idempotencyKey: 'planning-report',
	}), 'project_not_active');

	const active = await core.projects.setProjectState(project.code, ownerId, { status: 'active', expectedRevision: 5 });
	assert.strictEqual(active.status, 'active');
	const report = await core.projects.reportProgress(project.code, firstTopic.topic.id, ownerId, {
		progress: 60, summary: 'Navigation and responsive layout are ready.',
		expectedRevision: 1, idempotencyKey: 'report-1',
	});
	assert.strictEqual(report.topic.progress, 60);
	assert.strictEqual(report.topic.workflow, 'in_progress');
	const replay = await core.projects.reportProgress(project.code, firstTopic.topic.id, ownerId, {
		progress: 60, summary: 'Navigation and responsive layout are ready.',
		expectedRevision: 1, idempotencyKey: 'report-1',
	});
	assert.strictEqual(replay.report.id, report.report.id, 'a retried mutation returns the original report');
	await expectCode(core.projects.reportProgress(project.code, firstTopic.topic.id, ownerId, {
		progress: 61, summary: 'Different payload.', expectedRevision: 2, idempotencyKey: 'report-1',
	}), 'idempotency_conflict');

	const review = await core.projects.reportProgress(project.code, firstTopic.topic.id, ownerId, {
		progress: 90, summary: 'Ready for review.', requestReview: true,
		expectedRevision: 2, idempotencyKey: 'report-2',
	});
	assert.strictEqual(review.topic.workflow, 'in_review');
	const approved = await core.projects.reviewTopic(project.code, firstTopic.topic.id, ownerId, {
		action: 'approve', expectedRevision: 3,
	});
	assert.strictEqual(approved.topic.workflow, 'completed');
	assert.strictEqual(approved.topic.progress, 100);

	const detail = await core.projects.getProjectByCode(project.code, ownerId);
	assert.strictEqual(detail.project.progress, 100);
	assert.strictEqual(detail.project.topicCount, 1);
	assert.strictEqual(detail.me.userId, ownerId);
	assert.strictEqual(detail.topics[0].latestReport.summary, 'Ready for review.');
	assert.ok(detail.events.some(event => event.type === 'topic_completed'));
	await core.projects.updateTopic(project.code, firstTopic.topic.id, ownerId, { archived: true, expectedRevision: approved.topic.revision });
	const withoutTopics = await core.projects.getProjectByCode(project.code, ownerId);
	assert.strictEqual(withoutTopics.project.topicCount, 0);
	assert.strictEqual(withoutTopics.project.progress, 0, 'archiving removes a topic from the rollup denominator');
	assert.ok(withoutTopics.events.some(event => event.type === 'topic_archived'));
	const replacement = await core.projects.createTopic(project.code, ownerId, {
		title: 'Launch follow-up', assigneeUserIds: [ownerId, memberId], expectedRevision: withoutTopics.project.revision,
	});
	assert.strictEqual(replacement.topic.number, 2, 'archiving the highest topic never reuses its stable command number');
	const reordered = await core.projects.updateTopic(project.code, replacement.topic.id, ownerId, { position: 7, expectedRevision: replacement.topic.revision });
	assert.strictEqual(reordered.topic.position, 7);
	await expectCode(core.projects.updateTopic(project.code, replacement.topic.id, memberId, { position: 1, expectedRevision: reordered.topic.revision }), 'project_forbidden');
	const leadView = await core.projects.getProjectByCode(project.code, ownerId);
	await expectCode(core.projects.updateMemberRole(project.code, memberId, ownerId, { role: 'lead', expectedRevision: leadView.project.revision }), 'project_forbidden');
	await core.projects.updateTopic(project.code, firstTopic.topic.id, ownerId, { archived: false, expectedRevision: withoutTopics.archivedTopics[0].revision });
	const restoredView = await core.projects.getProjectByCode(project.code, ownerId);
	assert.strictEqual(restoredView.project.progress, 50, 'restoring the completed topic adds it back to the equal-weight rollup');
	assert.ok(restoredView.events.some(event => event.type === 'topic_restored'));
	const directory = await core.projects.listProjectsForUser(ownerId);
	assert.strictEqual(directory.find(item => item.id === project.id).assignedCount, 2);

	const revokedInvite = await core.projects.createInvitation(project.code, ownerId, { provider: 'discord', recipient: `${Date.now()}99123`.slice(0, 18), role: 'member' });
	await core.projects.revokeInvitation(project.code, revokedInvite.invitation.id, ownerId);
	await expectCode(core.projects.acceptInvitation(revokedInvite.token, memberId), 'invitation_revoked');
	const expiredInvite = await core.projects.createInvitation(project.code, ownerId, { provider: 'discord', recipient: `${Date.now()}88123`.slice(0, 18), role: 'member' });
	await core.db.query("UPDATE project_invitations SET expires_at=now() - interval '1 minute' WHERE id=$1", [expiredInvite.invitation.id]);
	await expectCode(core.projects.acceptInvitation(expiredInvite.token, memberId), 'invitation_expired');

	const viewerRole = await core.projects.updateMemberRole(project.code, memberId, invitedId, { role: 'viewer', expectedRevision: restoredView.project.revision });
	assert.strictEqual(viewerRole.member.role, 'viewer');
	assert.strictEqual((await core.projects.getProjectByCode(project.code, memberId)).me.role, 'viewer');
	await expectCode(core.projects.reportProgress(project.code, replacement.topic.id, memberId, {
		progress: 10, summary: 'Viewer write must fail.', expectedRevision: reordered.topic.revision, idempotencyKey: 'viewer-report',
	}), 'project_forbidden');
	await expectCode(core.projects.updateTopic(project.code, replacement.topic.id, memberId, { title: 'Viewer edit', expectedRevision: reordered.topic.revision }), 'project_forbidden');

	const beforeClose = await core.projects.getProjectByCode(project.code, invitedId);
	await expectCode(core.projects.setProjectState(project.code, invitedId, { status: 'completed', expectedRevision: beforeClose.project.revision }), 'reason_required');
	await core.projects.setProjectState(project.code, invitedId, { status: 'completed', reason: 'Pilot close with follow-up still open.', expectedRevision: beforeClose.project.revision });
	const closedView = await core.projects.getProjectByCode(project.code, invitedId);
	assert.strictEqual(closedView.project.progress, 50, 'closing with unfinished work preserves the reported rollup');
	assert.strictEqual(closedView.project.closeReason, 'Pilot close with follow-up still open.');
	await expectCode(core.projects.updateTopic(project.code, replacement.topic.id, ownerId, { title: 'Closed edit', expectedRevision: reordered.topic.revision }), 'project_closed');
	const reopened = await core.projects.setProjectState(project.code, invitedId, { status: 'active', expectedRevision: closedView.project.revision });
	const paused = await core.projects.setProjectState(project.code, ownerId, { status: 'paused', expectedRevision: reopened.revision });
	await expectCode(core.projects.reportProgress(project.code, replacement.topic.id, ownerId, {
		progress: 10, summary: 'Paused report must fail.', expectedRevision: reordered.topic.revision, idempotencyKey: 'paused-report',
	}), 'project_not_active');
	await core.projects.setProjectState(project.code, ownerId, { status: 'active', expectedRevision: paused.revision });

	const scheduledProject = await core.projects.createProject({ ownerUserId: ownerId, title: 'Release train', timezone: 'Asia/Bangkok' });
	createdProjects.push(scheduledProject.id);
	const reminderSettings = await core.projects.updateProjectNotificationSettings(scheduledProject.code, ownerId, {
		enabled: true, blockerNotifications: true, reminder48h: true, reminder24h: true, expectedRevision: 0,
	});
	assert.strictEqual(reminderSettings.settings.reminder48h, true);
	const topicA = await core.projects.createTopic(scheduledProject.code, ownerId, {
		title: 'Package release', deadlineAt: '2030-10-10', deadlinePrecision: 'date', assigneeUserIds: [ownerId], expectedRevision: 1,
	});
	let reminderJobs = await core.db.query("SELECT * FROM project_reminder_jobs WHERE project_id=$1 AND status='pending'", [scheduledProject.id]);
	assert.strictEqual(reminderJobs.rows.length, 2, 'each scheduled topic gets the opted-in 48h and 24h durable jobs');
	const scheduledDirectory = await core.projects.listProjectsForUser(ownerId);
	assert.strictEqual(new Date(scheduledDirectory.find(item => item.id === scheduledProject.id).nextDueAt).toISOString(), new Date(topicA.topic.deadlineAt).toISOString());
	const directoryPageOne = await core.projects.listProjectDirectory(ownerId, { bucket: 'active', limit: 1 });
	assert.strictEqual(directoryPageOne.projects.length, 1);
	assert.ok(directoryPageOne.nextCursor, 'a bounded directory page exposes a cursor when more work exists');
	const directoryPageTwo = await core.projects.listProjectDirectory(ownerId, { bucket: 'active', limit: 1, cursor: directoryPageOne.nextCursor });
	assert.notStrictEqual(directoryPageTwo.projects[0].id, directoryPageOne.projects[0].id);
	const filteredDirectory = await core.projects.listProjectDirectory(ownerId, { bucket: 'active', search: 'no-such-project', assignedOnly: true });
	assert.strictEqual(filteredDirectory.projects.length, 0);
	assert.strictEqual(filteredDirectory.hasAnyProjects, true, 'filtered emptiness stays distinct from first-run emptiness');
	await core.projects.setProjectState(scheduledProject.code, ownerId, { status: 'active', expectedRevision: 2 });
	await core.db.query("UPDATE project_reminder_jobs SET run_at=now() - interval '1 minute' WHERE id=$1", [reminderJobs.rows[0].id]);
	const reminderRun = await core.projectReminders.queueDue({ now: new Date(), baseUrl: 'https://megu.example', projectId: scheduledProject.id });
	assert.strictEqual(reminderRun.queued, 1, `one due reminder should queue: ${JSON.stringify(reminderRun)}`);
	const reminderEvent = await core.db.query("SELECT payload FROM notification_events WHERE dedupe_key=$1", [`project-deadline:${reminderJobs.rows[0].id}:${ownerId}`]);
	assert.ok(reminderEvent.rows[0], 'the queued reminder should persist its notification event');
	assert.strictEqual(reminderEvent.rows[0].payload.ctaUrl, `https://megu.example/p/${scheduledProject.code}?view=topics`);
	const topicB = await core.projects.createTopic(scheduledProject.code, ownerId, { title: 'Publish notes', expectedRevision: 3 });
	const topicC = await core.projects.createTopic(scheduledProject.code, ownerId, { title: 'Announce release', expectedRevision: 4 });
	await expectCode(core.projects.createDependency(scheduledProject.code, ownerId, {
		predecessorTopicId: topicA.topic.id, successorTopicId: replacement.topic.id, expectedRevision: 5,
	}), 'dependency_topic_invalid');
	await core.projects.createDependency(scheduledProject.code, ownerId, {
		predecessorTopicId: topicA.topic.id, successorTopicId: topicB.topic.id, expectedRevision: 5,
	});
	await core.projects.createDependency(scheduledProject.code, ownerId, {
		predecessorTopicId: topicB.topic.id, successorTopicId: topicC.topic.id, expectedRevision: 6,
	});
	await expectCode(core.projects.createDependency(scheduledProject.code, ownerId, {
		predecessorTopicId: topicC.topic.id, successorTopicId: topicA.topic.id, expectedRevision: 7,
	}), 'dependency_cycle');
	const milestone = await core.projects.createMilestone(scheduledProject.code, ownerId, {
		title: 'Public launch', dueAt: '2030-10-11', duePrecision: 'date', expectedRevision: 7,
	});
	const reached = await core.projects.updateMilestone(scheduledProject.code, milestone.milestone.id, ownerId, {
		state: 'reached', expectedRevision: 0,
	});
	assert.strictEqual(reached.milestone.state, 'reached');
	const scheduleDetail = await core.projects.getProjectByCode(scheduledProject.code, ownerId);
	assert.strictEqual(scheduleDetail.dependencies.length, 2);
	assert.strictEqual(scheduleDetail.milestones[0].state, 'reached');
	await core.projects.updateProject(scheduledProject.code, ownerId, {
		timezone: 'America/New_York', timezoneChangeMode: 'keep_local', expectedRevision: 9,
	});
	const rezoned = await core.projects.getProjectByCode(scheduledProject.code, ownerId);
	const rezonedTopicParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(rezoned.topics.find(topic => topic.id === topicA.topic.id).deadlineAt)).map(part => [part.type, part.value]));
	assert.strictEqual(`${rezonedTopicParts.year}-${rezonedTopicParts.month}-${rezonedTopicParts.day}`, '2030-10-10');
	assert.strictEqual(rezoned.project.timezone, 'America/New_York');
	await core.db.query("INSERT INTO project_memberships (project_id, user_id, role) VALUES ($1,$2,'member')", [scheduledProject.id, memberId]);
	const reassigned = await core.projects.setTopicAssignees(scheduledProject.code, topicA.topic.id, ownerId, {
		userIds: [memberId], primaryUserId: memberId, expectedRevision: rezoned.topics.find(topic => topic.id === topicA.topic.id).revision,
	});
	assert.strictEqual(reassigned.assignees[0].userId, memberId);
	const reassignedJobs = await core.db.query("SELECT * FROM project_reminder_jobs WHERE project_id=$1 AND topic_id=$2 AND status='pending' ORDER BY threshold_hours DESC", [scheduledProject.id, topicA.topic.id]);
	await core.db.query("UPDATE project_reminder_jobs SET run_at=now() - interval '1 minute' WHERE id=$1", [reassignedJobs.rows[0].id]);
	await core.projectReminders.queueDue({ now: new Date(), baseUrl: 'https://megu.example', projectId: scheduledProject.id });
	const reassignedReminder = await core.db.query("SELECT user_id FROM notification_events WHERE dedupe_key=$1", [`project-deadline:${reassignedJobs.rows[0].id}:${memberId}`]);
	assert.strictEqual(reassignedReminder.rows[0].user_id, memberId, 'deadline delivery resolves the current assignee when it becomes due');
	const pausedSchedule = await core.projects.setProjectState(scheduledProject.code, ownerId, { status: 'paused', expectedRevision: rezoned.project.revision + 1 });
	await core.db.query("UPDATE project_reminder_jobs SET run_at=now() - interval '1 minute' WHERE id=$1", [reassignedJobs.rows[1].id]);
	const pausedReminder = await core.projectReminders.queueDue({ now: new Date(), baseUrl: 'https://megu.example', projectId: scheduledProject.id });
	assert.strictEqual(pausedReminder.skipped, 1, 'paused projects suppress reminders that become due');
	await core.projects.setProjectState(scheduledProject.code, ownerId, { status: 'active', expectedRevision: pausedSchedule.revision });
	const beforeConcurrentEdges = await core.projects.getProjectByCode(scheduledProject.code, ownerId);
	const topicD = await core.projects.createTopic(scheduledProject.code, ownerId, { title: 'Verify release', expectedRevision: beforeConcurrentEdges.project.revision });
	const edgeCandidates = [
		{ predecessorTopicId: topicC.topic.id, successorTopicId: topicD.topic.id },
		{ predecessorTopicId: topicD.topic.id, successorTopicId: topicA.topic.id },
	];
	const concurrentEdges = await Promise.allSettled(edgeCandidates.map(edge => core.projects.createDependency(scheduledProject.code, ownerId, {
		...edge, expectedRevision: topicD.projectRevision,
	})));
	assert.strictEqual(concurrentEdges.filter(result => result.status === 'fulfilled').length, 1);
	const rejectedEdgeIndex = concurrentEdges.findIndex(result => result.status === 'rejected');
	assert.strictEqual(concurrentEdges[rejectedEdgeIndex].reason?.code, 'revision_conflict', 'project locking serializes concurrent cycle candidates');
	const afterConcurrentEdges = await core.projects.getProjectByCode(scheduledProject.code, ownerId);
	await expectCode(core.projects.createDependency(scheduledProject.code, ownerId, {
		...edgeCandidates[rejectedEdgeIndex], expectedRevision: afterConcurrentEdges.project.revision,
	}), 'dependency_cycle');

	const correctionProject = await core.projects.createProject({ ownerUserId: ownerId, title: 'Correction trail', timezone: 'Asia/Bangkok' });
	createdProjects.push(correctionProject.id);
	const correctionTopic = await core.projects.createTopic(correctionProject.code, ownerId, { title: 'Publish brief', expectedRevision: 0 });
	await core.projects.setProjectState(correctionProject.code, ownerId, { status: 'active', expectedRevision: 1 });
	const originalReport = await core.projects.reportProgress(correctionProject.code, correctionTopic.topic.id, ownerId, {
		progress: 40, summary: 'Draft published.', expectedRevision: 0, idempotencyKey: 'correction-original',
	});
	const correctedReport = await core.projects.reportProgress(correctionProject.code, correctionTopic.topic.id, ownerId, {
		progress: 35, summary: 'Corrected the reported estimate.', reason: 'The first estimate included unfinished review.',
		correctionOfReportId: originalReport.report.id, expectedRevision: 1, idempotencyKey: 'correction-followup',
	});
	assert.strictEqual(correctedReport.report.correctionOfReportId, originalReport.report.id);
	await expectCode(core.projects.reportProgress(correctionProject.code, correctionTopic.topic.id, ownerId, {
		progress: 36, summary: 'Invalid reference.', correctionOfReportId: 'rep_other_topic', expectedRevision: 2, idempotencyKey: 'correction-invalid',
	}), 'correction_report_invalid');
	await core.projects.updateProjectNotificationSettings(correctionProject.code, ownerId, {
		enabled: true, blockerNotifications: false, reminder48h: false, reminder24h: false,
		channelEnabled: true, guildId: '123456789012345678', channelId: '223456789012345678', channelName: 'project-updates', expectedRevision: 4,
	});
	await core.projects.reportProgress(correctionProject.code, correctionTopic.topic.id, ownerId, {
		progress: 36, summary: 'Private report summary.', blocked: true, blockerReason: 'Private blocker reason.',
		expectedRevision: 2, idempotencyKey: 'channel-blocker',
	});
	const channelDelivery = await core.db.query('SELECT * FROM project_channel_deliveries WHERE project_id=$1', [correctionProject.id]);
	assert.strictEqual(channelDelivery.rows.length, 1);
	assert.ok(!JSON.stringify(channelDelivery.rows[0].payload).includes('Private report summary'));
	assert.ok(!JSON.stringify(channelDelivery.rows[0].payload).includes('Private blocker reason'));
	const claimedChannel = await core.projectChannelNotifications.claimPending(10, { projectId: correctionProject.id });
	assert.strictEqual(claimedChannel.length, 1, 'an active validated destination can be leased');
	await core.db.query("UPDATE project_channel_deliveries SET locked_at=now() - interval '6 minutes' WHERE id=$1", [claimedChannel[0].id]);
	const reclaimedChannel = await core.projectChannelNotifications.claimPending(10, { projectId: correctionProject.id });
	assert.strictEqual(reclaimedChannel[0].id, claimedChannel[0].id, 'an expired sending lease is recovered after a worker restart or lost acknowledgement');
	await core.projectChannelNotifications.markFailed(reclaimedChannel[0].id, new Error('Mock Discord rate limit'), reclaimedChannel[0].attempts);
	const failedChannel = await core.db.query('SELECT status, last_error FROM project_channel_deliveries WHERE id=$1', [claimedChannel[0].id]);
	assert.strictEqual(failedChannel.rows[0].status, 'failed');
	assert.strictEqual(failedChannel.rows[0].last_error, 'Mock Discord rate limit');
	await core.projects.updateProjectNotificationSettings(correctionProject.code, ownerId, { enabled: false, expectedRevision: 6 });
	await core.db.query("UPDATE project_channel_deliveries SET next_attempt_at=now() - interval '1 minute' WHERE id=$1", [claimedChannel[0].id]);
	assert.strictEqual((await core.projectChannelNotifications.claimPending(10, { projectId: correctionProject.id })).length, 0, 'a disabled destination is revalidated before retry');
	const skippedChannel = await core.db.query('SELECT status FROM project_channel_deliveries WHERE id=$1', [claimedChannel[0].id]);
	assert.strictEqual(skippedChannel.rows[0].status, 'skipped');
	const latestCorrectionProject = await core.projects.getProjectByCode(correctionProject.code, ownerId);
	const concurrentTopic = await core.projects.createTopic(correctionProject.code, ownerId, {
		title: 'Concurrent report target', assigneeUserIds: [ownerId], expectedRevision: latestCorrectionProject.project.revision,
	});
	const concurrentReports = await Promise.allSettled([
		core.projects.reportProgress(correctionProject.code, concurrentTopic.topic.id, ownerId, {
			progress: 20, summary: 'First concurrent estimate.', expectedRevision: 0, idempotencyKey: 'concurrent-a',
		}),
		core.projects.reportProgress(correctionProject.code, concurrentTopic.topic.id, ownerId, {
			progress: 30, summary: 'Second concurrent estimate.', expectedRevision: 0, idempotencyKey: 'concurrent-b',
		}),
	]);
	assert.strictEqual(concurrentReports.filter(result => result.status === 'fulfilled').length, 1);
	assert.strictEqual(concurrentReports.filter(result => result.status === 'rejected' && result.reason?.code === 'revision_conflict').length, 1, 'simultaneous reports cannot silently overwrite one another');

	console.log('projects passed — private access, ownership, reporting, reminders, dependencies and milestones hold together');
}

async function cleanup() {
	for (const id of createdProjects) {
		await core.db.query('DELETE FROM project_topic_assignees WHERE project_id = $1', [id]).catch(() => undefined);
		await core.db.query('DELETE FROM project_progress_reports WHERE project_id = $1', [id]).catch(() => undefined);
		await core.db.query('DELETE FROM project_events WHERE project_id = $1', [id]).catch(() => undefined);
		await core.db.query('DELETE FROM projects WHERE id = $1', [id]).catch(() => undefined);
	}
	for (const id of createdUsers) await core.db.query('DELETE FROM users WHERE id = $1', [id]).catch(() => undefined);
}

main().then(cleanup).then(() => core.db.close()).catch(async error => {
	console.error(error);
	await cleanup().catch(() => undefined);
	await core.db.close().catch(() => undefined);
	process.exitCode = 1;
});
