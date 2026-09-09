const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const core = require('../../core/index.js');

const EPHEMERAL = MessageFlags.Ephemeral;
const ROLES = [
	{ name: 'Lead', value: 'lead' },
	{ name: 'Member', value: 'member' },
	{ name: 'Viewer', value: 'viewer' },
];

function projectOption(command) {
	return command.addStringOption(option => option.setName('project').setDescription('Project title or 7-character code').setAutocomplete(true).setRequired(true));
}

function topicOption(command) {
	return command.addIntegerOption(option => option.setName('topic').setDescription('Stable topic number').setMinValue(1).setRequired(true));
}

function safe(value) {
	return String(value ?? '').replace(/([\\`*_{}\[\]()#+\-.!|>~])/g, '\\$1').slice(0, 1000);
}

function projectUrl(code) {
	return `${String(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')}/p/${code}`;
}

const REPLIES = {
	en: {
		unavailable: 'Projects is currently unavailable.', noDeadline: 'No deadline', topics: 'topics', people: 'people',
		blocked: 'Blocked', status: { planning: 'Planning', active: 'Active', paused: 'Paused', completed: 'Completed', cancelled: 'Cancelled' }, workflow: { not_started: 'Not started', in_progress: 'In progress', in_review: 'In review', completed: 'Completed' }, role: { owner: 'Owner', lead: 'Lead', member: 'Member', viewer: 'Viewer' },
		linkAccount: url => `Link this Discord account to Megu first: ${url}/account`,
		created: (title, code, url) => `Created private planning project **${title}** · \`${code}\`\n${url}`,
		noProjects: url => `No projects yet. Create one with \`/projects create\` or on ${url}/projects`,
		added: (number, title, url) => `Added topic #${number} **${title}**\n${url}?view=topics`,
		assigned: (name, number, title) => `Assigned **${name}** to #${number} **${title}**.`,
		scheduleRequired: 'Add a start date, a deadline, or both. Use the web project to clear an existing date.',
		scheduleUpdated: (number, title) => `Updated the schedule for #${number} **${title}**.`,
		reportSaved: (number, title, progress, workflow) => `Saved #${number} **${title}** at ${progress}% · ${workflow}.`,
		reviewSaved: (number, workflow, progress) => `Topic #${number} is now **${workflow}** at ${progress}%.`,
		invite: (name, role, url) => `Private invite for **${name}** · ${role} · expires in 7 days\n${url}`,
		removed: name => `Removed **${name}** from the project.`, roleChanged: (name, role) => `Changed **${name}** to ${role}.`, stateChanged: (title, status) => `**${title}** is now ${status}.`,
		errors: {
			project_not_found: 'I cannot find an accessible project with that code.', project_forbidden: 'Your project role does not allow that action.', project_not_active: 'Activate the project before reporting progress.', project_closed: 'That project is closed.', revision_conflict: 'Someone changed this work first. Run the command again to use the latest version.', invitation_pending: 'A current invitation already exists for that person.', member_exists: 'That person already belongs to the project.', assignee_invalid: 'That person must join the project as a contributor before they can be assigned.', topic_not_found: 'That topic is unavailable.', summary_required: 'Add a short summary of what changed.', blocker_reason_required: 'Describe what is blocking the work.', reason_required: 'Add a reason for this change.', fallback: 'That change could not be saved. Open the web project for more detail.',
		},
	},
	th: {
		unavailable: 'โปรเจกต์ยังไม่พร้อมใช้งานในขณะนี้', noDeadline: 'ยังไม่กำหนดส่ง', topics: 'หัวข้องาน', people: 'คน',
		blocked: 'ติดปัญหา', status: { planning: 'กำลังวางแผน', active: 'กำลังทำ', paused: 'พักไว้', completed: 'เสร็จแล้ว', cancelled: 'ยกเลิกแล้ว' }, workflow: { not_started: 'ยังไม่เริ่ม', in_progress: 'กำลังทำ', in_review: 'รอตรวจรับ', completed: 'เสร็จแล้ว' }, role: { owner: 'เจ้าของ', lead: 'หัวหน้าทีม', member: 'สมาชิก', viewer: 'ผู้ชม' },
		linkAccount: url => `เชื่อมบัญชี Discord นี้กับ Megu ก่อน: ${url}/account`,
		created: (title, code, url) => `สร้างโปรเจกต์ส่วนตัวแบบกำลังวางแผน **${title}** แล้ว · \`${code}\`\n${url}`,
		noProjects: url => `ยังไม่มีโปรเจกต์ สร้างด้วย \`/projects create\` หรือที่ ${url}/projects`,
		added: (number, title, url) => `เพิ่มหัวข้องาน #${number} **${title}** แล้ว\n${url}?view=topics`,
		assigned: (name, number, title) => `มอบหมาย **${name}** ให้หัวข้องาน #${number} **${title}** แล้ว`,
		scheduleRequired: 'ใส่วันเริ่ม วันส่ง หรือทั้งสองอย่าง หากต้องการล้างวันที่เดิมให้เปิดโปรเจกต์บนเว็บ',
		scheduleUpdated: (number, title) => `อัปเดตกำหนดเวลาของหัวข้องาน #${number} **${title}** แล้ว`,
		reportSaved: (number, title, progress, workflow) => `บันทึก #${number} **${title}** ที่ ${progress}% · ${workflow} แล้ว`,
		reviewSaved: (number, workflow, progress) => `หัวข้องาน #${number} เป็น **${workflow}** ที่ ${progress}% แล้ว`,
		invite: (name, role, url) => `คำเชิญส่วนตัวสำหรับ **${name}** · ${role} · หมดอายุใน 7 วัน\n${url}`,
		removed: name => `นำ **${name}** ออกจากโปรเจกต์แล้ว`, roleChanged: (name, role) => `เปลี่ยน **${name}** เป็น ${role} แล้ว`, stateChanged: (title, status) => `**${title}** เปลี่ยนเป็น ${status} แล้ว`,
		errors: {
			project_not_found: 'ไม่พบโปรเจกต์ที่คุณมีสิทธิ์เข้าถึงด้วยรหัสนี้', project_forbidden: 'บทบาทในโปรเจกต์ของคุณทำรายการนี้ไม่ได้', project_not_active: 'เริ่มโปรเจกต์ก่อนจึงจะรายงานความคืบหน้าได้', project_closed: 'โปรเจกต์นี้ปิดแล้ว', revision_conflict: 'มีคนแก้งานนี้ก่อนแล้ว รันคำสั่งอีกครั้งเพื่อใช้ข้อมูลล่าสุด', invitation_pending: 'มีคำเชิญที่ยังใช้ได้สำหรับคนนี้อยู่แล้ว', member_exists: 'คนนี้อยู่ในโปรเจกต์แล้ว', assignee_invalid: 'คนนี้ต้องเข้าร่วมโปรเจกต์ในฐานะผู้ร่วมงานก่อนจึงจะรับมอบหมายได้', topic_not_found: 'หัวข้องานนี้เปิดไม่ได้', summary_required: 'ใส่สรุปสั้น ๆ ว่ามีอะไรเปลี่ยนไป', blocker_reason_required: 'อธิบายสิ่งที่ทำให้งานติดขัด', reason_required: 'ใส่เหตุผลของการเปลี่ยนแปลงนี้', fallback: 'บันทึกการเปลี่ยนแปลงไม่ได้ เปิดโปรเจกต์บนเว็บเพื่อดูรายละเอียดเพิ่มเติม',
		},
	},
};

function replies(interaction) { return String(interaction.locale || '').toLowerCase().startsWith('th') ? REPLIES.th : REPLIES.en; }
function errorMessage(error, copy) { return copy.errors[error?.code] || copy.errors.fallback; }

async function actor(interaction) {
	return core.users.findByIdentity('discord', interaction.user.id);
}

async function requireActor(interaction) {
	const user = await actor(interaction);
	if (user) return user;
	await interaction.editReply(replyOptions(replies(interaction).linkAccount(String(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, ''))));
	return null;
}

async function projectAndTopic(code, topicNumber, userId) {
	const data = await core.projects.getProjectByCode(code, userId);
	const topic = data.topics.find(item => item.number === topicNumber);
	if (!topic) { const error = new Error('topic_not_found'); error.code = 'topic_not_found'; throw error; }
	return { data, topic };
}

function replyOptions(content) {
	return { content, allowedMentions: { parse: [] } };
}

const data = new SlashCommandBuilder()
	.setName('projects')
	.setDescription('Plan shared work and report progress')
	.addSubcommand(command => command.setName('create').setDescription('Create a private planning project')
		.addStringOption(option => option.setName('title').setDescription('Outcome or project name').setMaxLength(120).setRequired(true))
		.addStringOption(option => option.setName('description').setDescription('What the team will deliver').setMaxLength(1000))
		.addStringOption(option => option.setName('deadline').setDescription('Target date as YYYY-MM-DD').setMaxLength(10))
		.addStringOption(option => option.setName('timezone').setDescription('IANA timezone, for example Asia/Bangkok').setMaxLength(80)))
	.addSubcommand(command => command.setName('list').setDescription('List projects you can access'))
	.addSubcommand(command => projectOption(command.setName('view').setDescription('View a private project summary')))
	.addSubcommandGroup(group => group.setName('topic').setDescription('Create, assign, schedule, or view topics')
		.addSubcommand(command => projectOption(command.setName('add').setDescription('Add a topic'))
			.addStringOption(option => option.setName('title').setDescription('Topic title').setMaxLength(120).setRequired(true))
			.addStringOption(option => option.setName('description').setDescription('Topic detail').setMaxLength(1000)))
		.addSubcommand(command => topicOption(projectOption(command.setName('view').setDescription('View a topic'))))
		.addSubcommand(command => topicOption(projectOption(command.setName('assign').setDescription('Assign a project member')))
			.addUserOption(option => option.setName('user').setDescription('Member to assign').setRequired(true))
			.addBooleanOption(option => option.setName('primary').setDescription('Make this person the primary assignee')))
		.addSubcommand(command => topicOption(projectOption(command.setName('schedule').setDescription('Set topic dates')))
			.addStringOption(option => option.setName('start').setDescription('Start date as YYYY-MM-DD').setMaxLength(10))
			.addStringOption(option => option.setName('deadline').setDescription('Due date as YYYY-MM-DD').setMaxLength(10))
			.addBooleanOption(option => option.setName('after_project_target').setDescription('Confirm a deadline after the project target'))))
	.addSubcommand(command => topicOption(projectOption(command.setName('report').setDescription('Report progress on a topic')))
		.addIntegerOption(option => option.setName('progress').setDescription('Whole percent from 0 to 99').setMinValue(0).setMaxValue(99).setRequired(true))
		.addStringOption(option => option.setName('summary').setDescription('Result, decision, or next step').setMaxLength(1000).setRequired(true))
		.addBooleanOption(option => option.setName('request_review').setDescription('Request completion review'))
		.addBooleanOption(option => option.setName('blocked').setDescription('Mark this work blocked'))
		.addStringOption(option => option.setName('blocker_reason').setDescription('What is blocking the work').setMaxLength(1000))
		.addStringOption(option => option.setName('change_reason').setDescription('Reason for a decrease or cleared blocker').setMaxLength(1000)))
	.addSubcommand(command => topicOption(projectOption(command.setName('review').setDescription('Approve, return, or reopen a topic')))
		.addStringOption(option => option.setName('action').setDescription('Review decision').addChoices({ name: 'Approve completion', value: 'approve' }, { name: 'Return to work', value: 'return' }, { name: 'Reopen', value: 'reopen' }).setRequired(true))
		.addStringOption(option => option.setName('reason').setDescription('Required when returning or reopening').setMaxLength(1000))
		.addIntegerOption(option => option.setName('progress').setDescription('Reopened progress from 0 to 99').setMinValue(0).setMaxValue(99)))
	.addSubcommandGroup(group => group.setName('member').setDescription('Invite and manage project people')
		.addSubcommand(command => projectOption(command.setName('invite').setDescription('Create a private invite for a Discord user'))
			.addUserOption(option => option.setName('user').setDescription('Person to invite').setRequired(true))
			.addStringOption(option => option.setName('role').setDescription('Role to grant').addChoices(...ROLES).setRequired(true)))
		.addSubcommand(command => projectOption(command.setName('remove').setDescription('Remove a project member'))
			.addUserOption(option => option.setName('user').setDescription('Member to remove').setRequired(true)))
		.addSubcommand(command => projectOption(command.setName('role').setDescription('Change a project member role'))
			.addUserOption(option => option.setName('user').setDescription('Member to update').setRequired(true))
			.addStringOption(option => option.setName('role').setDescription('New role').addChoices(...ROLES).setRequired(true))))
	.addSubcommand(command => projectOption(command.setName('state').setDescription('Change project lifecycle state'))
		.addStringOption(option => option.setName('status').setDescription('New state').addChoices({ name: 'Active', value: 'active' }, { name: 'Paused', value: 'paused' }, { name: 'Completed', value: 'completed' }, { name: 'Cancelled', value: 'cancelled' }).setRequired(true))
		.addStringOption(option => option.setName('reason').setDescription('Reason or context').setMaxLength(1000)));

module.exports = {
	data,
	async autocomplete(interaction) {
		const user = await actor(interaction);
		if (!user) return interaction.respond([]).catch(() => undefined);
		const needle = String(interaction.options.getFocused() || '').toLowerCase();
		const available = await core.projects.listProjectDirectory(user.id, { bucket: 'all', search: needle, limit: 25 });
		return interaction.respond(available.projects.map(project => ({ name: `${project.title} · ${project.code}`.slice(0, 100), value: project.code }))).catch(() => undefined);
	},
	async execute(interaction) {
		await interaction.deferReply({ flags: EPHEMERAL });
		const copy = replies(interaction);
		if (process.env.MEGU_PROJECTS_ENABLED === '0') return interaction.editReply(replyOptions(copy.unavailable));
		const user = await requireActor(interaction);
		if (!user) return;
		const group = interaction.options.getSubcommandGroup(false);
		const command = interaction.options.getSubcommand();
		try {
			if (!group && command === 'create') {
				const deadlineAt = interaction.options.getString('deadline');
				const project = await core.projects.createProject({ ownerUserId: user.id, title: interaction.options.getString('title', true), description: interaction.options.getString('description') || '', timezone: interaction.options.getString('timezone') || 'Asia/Bangkok', deadlineAt, deadlinePrecision: deadlineAt ? 'date' : null });
				return interaction.editReply(replyOptions(copy.created(safe(project.title), project.code, projectUrl(project.code))));
			}
			if (!group && command === 'list') {
				const available = await core.projects.listProjectDirectory(user.id, { bucket: 'all', limit: 15 });
				if (!available.projects.length) return interaction.editReply(replyOptions(copy.noProjects(String(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, ''))));
				return interaction.editReply(replyOptions(available.projects.map(project => `• **${safe(project.title)}** · ${project.progress}% · ${safe(copy.status[project.status] || project.status)} · \`${project.code}\``).join('\n')));
			}

			const code = interaction.options.getString('project', true).toUpperCase();
			if (!group && command === 'view') {
				const result = await core.projects.getProjectByCode(code, user.id);
				const due = result.project.deadlineAt ? new Intl.DateTimeFormat(copy === REPLIES.th ? 'th-TH' : 'en-GB', { dateStyle: 'medium', timeZone: result.project.timezone }).format(new Date(result.project.deadlineAt)) : copy.noDeadline;
				return interaction.editReply(replyOptions(`**${safe(result.project.title)}** · ${safe(copy.status[result.project.status] || result.project.status)} · ${result.project.progress}%\n${result.topics.length} ${copy.topics} · ${result.members.length} ${copy.people} · ${due}\n${projectUrl(code)}`));
			}
			if (group === 'topic' && command === 'add') {
				const current = await core.projects.getProjectByCode(code, user.id);
				const result = await core.projects.createTopic(code, user.id, { title: interaction.options.getString('title', true), description: interaction.options.getString('description') || '', assigneeUserIds: [user.id], expectedRevision: current.project.revision });
				return interaction.editReply(replyOptions(copy.added(result.topic.number, safe(result.topic.title), projectUrl(code))));
			}
			if (group === 'topic' && command === 'view') {
				const { topic } = await projectAndTopic(code, interaction.options.getInteger('topic', true), user.id);
				return interaction.editReply(replyOptions(`**#${topic.number} ${safe(topic.title)}** · ${safe(copy.workflow[topic.workflow] || topic.workflow)} · ${topic.progress}%${topic.blocked ? `\n${copy.blocked}: ` + safe(topic.blockerReason) : ''}\n${projectUrl(code)}?view=topics`));
			}
			if (group === 'topic' && command === 'assign') {
				const { topic } = await projectAndTopic(code, interaction.options.getInteger('topic', true), user.id);
				const target = await core.users.findByIdentity('discord', interaction.options.getUser('user', true).id);
				if (!target) throw Object.assign(new Error('assignee_invalid'), { code: 'assignee_invalid' });
				const ids = [...new Set([...topic.assignees.map(item => item.userId), target.id])];
				const currentPrimary = topic.assignees.find(item => item.primary)?.userId || null;
				await core.projects.setTopicAssignees(code, topic.id, user.id, { userIds: ids, primaryUserId: interaction.options.getBoolean('primary') ? target.id : currentPrimary, expectedRevision: topic.revision });
				return interaction.editReply(replyOptions(copy.assigned(safe(target.displayName), topic.number, safe(topic.title))));
			}
			if (group === 'topic' && command === 'schedule') {
				const { topic } = await projectAndTopic(code, interaction.options.getInteger('topic', true), user.id);
				const startsAt = interaction.options.getString('start'); const deadlineAt = interaction.options.getString('deadline');
				if (!startsAt && !deadlineAt) return interaction.editReply(replyOptions(copy.scheduleRequired));
				const changes = { expectedRevision: topic.revision };
				if (startsAt) Object.assign(changes, { startsAt, startsPrecision: 'date' });
				if (deadlineAt) Object.assign(changes, { deadlineAt, deadlinePrecision: 'date' });
				if (interaction.options.getBoolean('after_project_target')) changes.acknowledgeProjectDeadline = true;
				await core.projects.updateTopic(code, topic.id, user.id, changes);
				return interaction.editReply(replyOptions(copy.scheduleUpdated(topic.number, safe(topic.title))));
			}
			if (!group && command === 'report') {
				const { topic } = await projectAndTopic(code, interaction.options.getInteger('topic', true), user.id);
				const result = await core.projects.reportProgress(code, topic.id, user.id, { progress: interaction.options.getInteger('progress', true), summary: interaction.options.getString('summary', true), requestReview: interaction.options.getBoolean('request_review') || false, blocked: interaction.options.getBoolean('blocked') || false, blockerReason: interaction.options.getString('blocker_reason'), reason: interaction.options.getString('change_reason'), expectedRevision: topic.revision, idempotencyKey: interaction.id });
				return interaction.editReply(replyOptions(copy.reportSaved(topic.number, safe(topic.title), result.topic.progress, safe(copy.workflow[result.topic.workflow] || result.topic.workflow))));
			}
			if (!group && command === 'review') {
				const { topic } = await projectAndTopic(code, interaction.options.getInteger('topic', true), user.id);
				const action = interaction.options.getString('action', true);
				const result = await core.projects.reviewTopic(code, topic.id, user.id, { action, reason: interaction.options.getString('reason'), progress: interaction.options.getInteger('progress') ?? 0, expectedRevision: topic.revision });
				return interaction.editReply(replyOptions(copy.reviewSaved(topic.number, safe(copy.workflow[result.topic.workflow] || result.topic.workflow), result.topic.progress)));
			}
			if (group === 'member' && command === 'invite') {
				const target = interaction.options.getUser('user', true);
				const result = await core.projects.createInvitation(code, user.id, { provider: 'discord', recipient: target.id, role: interaction.options.getString('role', true) });
				const inviteUrl = `${String(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')}/projects/invitations/${result.token}`;
				return interaction.editReply(replyOptions(copy.invite(safe(target.username), safe(copy.role[result.invitation.role] || result.invitation.role), inviteUrl)));
			}
			if (group === 'member' && ['remove', 'role'].includes(command)) {
				const targetDiscord = interaction.options.getUser('user', true);
				const target = await core.users.findByIdentity('discord', targetDiscord.id);
				if (!target) throw Object.assign(new Error('member_not_found'), { code: 'member_not_found' });
				const current = await core.projects.getProjectByCode(code, user.id);
				if (command === 'remove') await core.projects.removeProjectMember(code, target.id, user.id, { expectedRevision: current.project.revision });
				else await core.projects.updateMemberRole(code, target.id, user.id, { role: interaction.options.getString('role', true), expectedRevision: current.project.revision });
				return interaction.editReply(replyOptions(command === 'remove' ? copy.removed(safe(target.displayName)) : copy.roleChanged(safe(target.displayName), safe(copy.role[interaction.options.getString('role', true)] || interaction.options.getString('role', true)))));
			}
			if (!group && command === 'state') {
				const current = await core.projects.getProjectByCode(code, user.id);
				const changed = await core.projects.setProjectState(code, user.id, { status: interaction.options.getString('status', true), reason: interaction.options.getString('reason'), expectedRevision: current.project.revision });
				return interaction.editReply(replyOptions(copy.stateChanged(safe(changed.title), safe(copy.status[changed.status] || changed.status))));
			}
		}
		catch (error) {
			return interaction.editReply(replyOptions(errorMessage(error, copy)));
		}
	},
};
