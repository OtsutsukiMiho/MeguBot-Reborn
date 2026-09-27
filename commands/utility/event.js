const {
	SlashCommandBuilder, MessageFlags, ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle,
	UserSelectMenuBuilder, StringSelectMenuBuilder, FileUploadBuilder, TextDisplayBuilder,
	ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const defaultCore = require('../../core/index.js');
const card = require('../../core/event-card.js');
const { submitDiscordSlip, parseBaht, money, siteUrl } = require('../../adapters/discord/slip-submit.js');

// `/event ตีแบด` — start a shared bill without leaving the chat.
//
// The slash command carries one optional word, the title, because that is what
// people type without thinking. Everything else is a modal: picking people
// from a list and choosing a split from a menu is faster, on a phone, than
// typing mentions and remembering option names.
//
// Every button here is an answer to something Discord pushed to us — nothing
// runs on a timer and nothing loops over members (DISCORD-RATE-LIMITS.md
// rules 1 and 7). The card is rebuilt from the ledger each time somebody acts
// on it, so it cannot drift from what the web shows.

const PREFIX = 'evt';
const EPHEMERAL = MessageFlags.Ephemeral;
const NO_PINGS = { parse: [] };

const T = {
	th: {
		guildOnly: 'ใช้ /event ในเซิร์ฟเวอร์ที่กลุ่มคุยกันนะ',
		modalTitle: 'บิลใหม่',
		title: 'ชื่อกิจกรรม', titleHint: 'เช่น ตีแบดเสาร์นี้',
		people: 'ใครไปบ้าง (คนในดิส)', peopleHint: 'ไม่ต้องเลือกตัวเอง Megu ใส่ให้',
		guests: 'คนที่ไม่ได้ใช้ Discord', guestsHint: 'ชื่อละบรรทัด หรือคั่นด้วยจุลภาค',
		amount: 'ยอดรวม (บาท)', amountHint: 'เว้นไว้ได้ถ้ายังไม่รู้ยอด',
		split: 'หารยังไง', withMe: 'หารเท่ากัน รวมฉันด้วย', withoutMe: 'หารเท่ากัน ไม่รวมฉัน (ฉันออกให้)',
		badAmount: raw => `อ่านยอด "${raw}" ไม่ออก เลยสร้างบิลไว้ก่อนโดยยังไม่ใส่ยอด ใส่ยอดได้ที่ลิงก์`,
		nobody: 'ยังไม่มีใครในบิลนอกจากคุณ เลือกคนหรือพิมพ์ชื่ออย่างน้อยหนึ่งคนนะ',
		dropped: count => `เกิน 25 คน ตัด ${count} ชื่อสุดท้ายออก`,
		pay: 'แนบสลิป', join: 'ฉันไปด้วย', open: 'เปิดบิล', setPromptPay: 'ตั้งพร้อมเพย์',
		gone: 'ไม่พบบิลนี้แล้ว',
		wrongServer: 'บิลนี้อยู่คนละเซิร์ฟเวอร์',
		alreadyIn: 'คุณอยู่ในบิลนี้แล้ว',
		whoAreYou: 'คุณคือใครในรายชื่อนี้? ถ้าไม่มี เลือก "เพิ่มฉันเข้าไป"',
		addMe: 'ไม่มีชื่อฉัน — เพิ่มฉันเข้าไป',
		pickName: 'เลือกชื่อของคุณ',
		joined: 'เพิ่มคุณเข้าบิลแล้ว',
		claimed: name => `ผูกชื่อ **${name}** กับ Discord ของคุณแล้ว Megu จะทักเตือนให้เมื่อถึงกำหนด`,
		claimTaken: 'ชื่อนี้มีคนเลือกไปแล้ว',
		paidAlready: 'มีคนจ่ายเข้ามาแล้ว เลยไม่หารใหม่อัตโนมัติ ให้คนจัดปรับยอดที่เว็บ',
		notInBill: 'คุณยังไม่อยู่ในบิลนี้ กด **ฉันไปด้วย** ก่อนนะ',
		nothingOwed: 'คุณไม่มียอดค้างในบิลนี้',
		slipTitle: 'แนบสลิป',
		slipTo: (name, masked, amount) => `โอน **${amount}** ให้ **${name}**${masked ? ` · พร้อมเพย์ ${masked}` : ''}`,
		slipAmount: 'ยอดที่โอน (บาท)', slipFile: 'ภาพสลิป',
		slipBadAmount: 'ใส่ยอดเป็นตัวเลข เช่น 120',
		slipMissing: 'ยังไม่ได้แนบภาพสลิป',
		ppTitle: 'พร้อมเพย์สำหรับรับเงิน', ppId: 'เบอร์มือถือ หรือเลขบัตรประชาชน', ppName: 'ชื่อบัญชี (ไว้ตรวจสลิป)',
		ppSaved: 'บันทึกพร้อมเพย์แล้ว ทุกคนแนบสลิปได้เลย',
		ppInvalid: 'เลขนี้ไม่ใช่พร้อมเพย์ที่รู้จัก ใช้เบอร์มือถือ 10 หลัก หรือเลขบัตร 13 หลัก',
		failed: 'ทำรายการไม่สำเร็จ ลองใหม่อีกทีนะ',
		subModalTitle: 'บิลรายเดือนใหม่',
		service: 'ชื่อบริการ', serviceHint: 'เช่น Netflix, Spotify Family',
		monthlyAmount: 'ยอดต่อเดือน (บาท)', monthlyAmountHint: 'เช่น 419',
		dueDay: 'ครบกำหนดทุกวันที่', dueDayHint: '1–28',
		peopleSub: 'ใครหารด้วย (คนในดิส)',
		needAmount: raw => `อ่านยอด "${raw}" ไม่ออก ใส่เป็นตัวเลข เช่น 419 แล้วลองใหม่นะ`,
		badDueDay: raw => `วันที่ "${raw}" ใช้ไม่ได้ ใส่ 1–28 (ทุกเดือนมีวันนั้นแน่นอน)`,
		joinSub: 'ขอหารด้วย',
	},
	en: {
		guildOnly: 'Use /event in the server your group talks in.',
		modalTitle: 'New bill',
		title: 'What is it', titleHint: 'e.g. Badminton on Saturday',
		people: 'Who is in (on Discord)', peopleHint: 'No need to pick yourself',
		guests: 'People not on Discord', guestsHint: 'One name per line, or comma separated',
		amount: 'Total (THB)', amountHint: 'Leave empty if you do not know yet',
		split: 'How to split', withMe: 'Evenly, including me', withoutMe: 'Evenly, not me (my treat)',
		badAmount: raw => `Could not read "${raw}" as an amount, so the bill has no amount yet. Add it at the link.`,
		nobody: 'Nobody else is on this bill. Pick someone or type at least one name.',
		dropped: count => `Over 25 people — the last ${count} were left out.`,
		pay: 'Send slip', join: 'I\'m in', open: 'Open bill', setPromptPay: 'Set PromptPay',
		gone: 'This bill no longer exists.',
		wrongServer: 'This bill belongs to another server.',
		alreadyIn: 'You are already on this bill.',
		whoAreYou: 'Which of these is you? If none, choose "Add me".',
		addMe: 'Not listed — add me',
		pickName: 'Pick your name',
		joined: 'You are on the bill.',
		claimed: name => `**${name}** is now linked to your Discord. Megu will remind you when it is due.`,
		claimTaken: 'Somebody already picked that name.',
		paidAlready: 'Someone has already paid, so the split was not redone automatically. The organiser can adjust it on the web.',
		notInBill: 'You are not on this bill yet. Press **I\'m in** first.',
		nothingOwed: 'You have nothing outstanding on this bill.',
		slipTitle: 'Send slip',
		slipTo: (name, masked, amount) => `Send **${amount}** to **${name}**${masked ? ` · PromptPay ${masked}` : ''}`,
		slipAmount: 'Amount sent (THB)', slipFile: 'Slip image',
		slipBadAmount: 'Enter the amount as a number, e.g. 120',
		slipMissing: 'No slip image was attached.',
		ppTitle: 'PromptPay for receiving', ppId: 'Mobile number or national ID', ppName: 'Account name (to check slips)',
		ppSaved: 'PromptPay saved. Everyone can send slips now.',
		ppInvalid: 'That is not a PromptPay number Megu recognises. Use a 10-digit mobile or 13-digit ID.',
		failed: 'That did not work. Please try again.',
		subModalTitle: 'New monthly bill',
		service: 'Service', serviceHint: 'e.g. Netflix, Spotify Family',
		monthlyAmount: 'Amount per month (THB)', monthlyAmountHint: 'e.g. 419',
		dueDay: 'Due every month on day', dueDayHint: '1–28',
		peopleSub: 'Who shares it (on Discord)',
		needAmount: raw => `Could not read "${raw}" as an amount. Enter a number such as 419 and try again.`,
		badDueDay: raw => `"${raw}" is not a usable day. Use 1–28, which every month has.`,
		joinSub: 'Count me in',
	},
};

function copyFor(interaction) {
	return T[card.langOf(interaction.locale)];
}

function shareUrl(code) {
	return `${siteUrl()}/a/${code}`;
}

async function ensureOrganizer(core, user) {
	const existing = await core.users.findByIdentity('discord', user.id);
	if (existing) return existing;
	// A Discord interaction is signed by Discord, so it proves who pressed it as
	// well as an OAuth round trip would. Creating the account here means an
	// organiser's first bill does not start with "go and sign in on the web".
	const { user: created } = await core.users.loginWithIdentity({
		provider: 'discord',
		providerUid: user.id,
		username: user.username,
		displayName: user.globalName || user.username,
		avatarUrl: user.displayAvatarURL?.({ size: 128 }) || null,
	});
	await core.users.claimParticipants(created.id);
	return created;
}

function cardButtons(code, t, monthly = false) {
	return [new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`${PREFIX}:pay:${code}`).setStyle(ButtonStyle.Primary).setLabel(t.pay),
		new ButtonBuilder().setCustomId(`${PREFIX}:join:${code}`).setStyle(ButtonStyle.Secondary).setLabel(monthly ? t.joinSub : t.join),
		new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(shareUrl(code)).setLabel(t.open),
	)];
}

async function renderCard(core, code, locale) {
	let activity = await core.activities.getActivityByCode(code);
	if (!activity) return null;
	// A monthly bill is shown for this month. Opening it here is the same
	// rollover every other read does: the new month copies the last one.
	let period = null;
	if (activity.kind === 'recurring') {
		await core.activities.ensurePeriod(activity.id, new Date(), { rollover: true });
		activity = await core.activities.getActivityByCode(code);
		period = core.activities.currentPeriod(activity);
	}
	const settlement = core.activities.settlement(activity, period?.id ?? null);
	const built = card.eventCardMessage({ activity, settlement, payee: activity.payee, period, locale });
	return { activity, settlement, period, monthly: activity.kind === 'recurring', ...built };
}

function isMine(activity, discordUid, userId) {
	return activity.participants.find(p => (p.discordUid && p.discordUid === String(discordUid))
		|| (userId && p.userId === userId)) || null;
}

/**
 * Re-divide the single even expense a `/event` bill starts with, now that the
 * roster changed. Anything more elaborate — several expenses, a custom split,
 * money already sent — is left alone: re-dividing it here would quietly change
 * what somebody already paid against, which is a decision for the organiser.
 */
async function resplitForNewcomer(core, activity, newcomerId) {
	// A monthly bill is re-divided for the current month only; later months
	// copy it, so the newcomer is in those too. Earlier months are history.
	const period = activity.kind === 'recurring' ? core.activities.currentPeriod(activity) : null;
	const expenses = activity.expenses.filter(e => !period || e.periodId === period.id);
	if (expenses.length === 0) return 'none';
	const standing = core.activities.settlement(activity, period?.id ?? null);
	const hasMoney = standing.rows.some(row => row.settled > 0 || row.pending > 0);
	if (expenses.length !== 1 || hasMoney) return 'skipped';
	const expense = expenses[0];
	if ((expense.splitMode || 'even') !== 'even') return 'skipped';
	const sharers = activity.shares.filter(s => s.expenseId === expense.id).map(s => s.participantId);
	await core.activities.updateExpense(expense.id, { shareParticipantIds: [...new Set([...sharers, newcomerId])] });
	return 'resplit';
}

/** Edit the card a component was pressed on, or the one named in a custom id. */
async function refreshCard(core, interaction, code, messageId = null) {
	const rendered = await renderCard(core, code, interaction.guildLocale || interaction.locale);
	if (!rendered) return;
	const payload = { content: rendered.content, components: cardButtons(code, T[card.langOf(interaction.guildLocale || interaction.locale)], rendered.monthly), allowedMentions: NO_PINGS };
	try {
		if (messageId && interaction.channel) await interaction.channel.messages.edit(messageId, payload);
		else if (interaction.message?.editable) await interaction.message.edit(payload);
	}
	catch (error) {
		// A stale card is cosmetic; the ledger is already right. The refusal
		// itself still reaches the block guard through the REST client wrapper.
		console.warn(`[Megu] Could not refresh the card for ${code}: ${error.message}`);
	}
}

// ── the command ────────────────────────────────────────────────────────────

function createModal(t, title) {
	return new ModalBuilder()
		.setCustomId(`${PREFIX}:create`)
		.setTitle(t.modalTitle)
		.addLabelComponents(
			new LabelBuilder().setLabel(t.title).setTextInputComponent(new TextInputBuilder()
				.setCustomId('title').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)
				.setPlaceholder(t.titleHint).setValue(String(title || '').slice(0, 100))),
			new LabelBuilder().setLabel(t.people).setDescription(t.peopleHint).setUserSelectMenuComponent(new UserSelectMenuBuilder()
				.setCustomId('people').setMinValues(0).setMaxValues(24).setRequired(false)),
			new LabelBuilder().setLabel(t.guests).setTextInputComponent(new TextInputBuilder()
				.setCustomId('guests').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false)
				.setPlaceholder(t.guestsHint)),
			new LabelBuilder().setLabel(t.amount).setTextInputComponent(new TextInputBuilder()
				.setCustomId('amount').setStyle(TextInputStyle.Short).setMaxLength(12).setRequired(false)
				.setPlaceholder(t.amountHint)),
			new LabelBuilder().setLabel(t.split).setStringSelectMenuComponent(new StringSelectMenuBuilder()
				.setCustomId('split').setRequired(true).setMinValues(1).setMaxValues(1)
				.addOptions(
					{ label: t.withMe, value: 'with_me', default: true },
					{ label: t.withoutMe, value: 'without_me' },
				)),
		);
}

function subModal(t, title) {
	return new ModalBuilder()
		.setCustomId(`${PREFIX}:subcreate`)
		.setTitle(t.subModalTitle)
		.addLabelComponents(
			new LabelBuilder().setLabel(t.service).setTextInputComponent(new TextInputBuilder()
				.setCustomId('title').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)
				.setPlaceholder(t.serviceHint).setValue(String(title || '').slice(0, 100))),
			new LabelBuilder().setLabel(t.peopleSub).setDescription(t.peopleHint).setUserSelectMenuComponent(new UserSelectMenuBuilder()
				.setCustomId('people').setMinValues(0).setMaxValues(24).setRequired(false)),
			new LabelBuilder().setLabel(t.guests).setTextInputComponent(new TextInputBuilder()
				.setCustomId('guests').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false)
				.setPlaceholder(t.guestsHint)),
			new LabelBuilder().setLabel(t.monthlyAmount).setTextInputComponent(new TextInputBuilder()
				.setCustomId('amount').setStyle(TextInputStyle.Short).setMaxLength(12).setRequired(true)
				.setPlaceholder(t.monthlyAmountHint)),
			new LabelBuilder().setLabel(t.dueDay).setTextInputComponent(new TextInputBuilder()
				.setCustomId('dueDay').setStyle(TextInputStyle.Short).setMaxLength(8).setRequired(true)
				.setPlaceholder(t.dueDayHint)),
		);
}

async function onCreate(interaction, core, { monthly = false } = {}) {
	const t = copyFor(interaction);
	const title = interaction.fields.getTextInputValue('title').trim();
	const users = interaction.fields.getSelectedUsers('people') || new Map();
	const members = interaction.fields.getSelectedMembers('people') || new Map();
	const guests = card.parseGuestNames(interaction.fields.getTextInputValue('guests'));
	const rawAmount = interaction.fields.getTextInputValue('amount').trim();
	// A subscription is shared by everyone on it; an uneven one is set on the web.
	const splitMode = monthly ? 'with_me' : (interaction.fields.getStringSelectValues('split')[0] || 'with_me');
	const rawDueDay = monthly ? interaction.fields.getTextInputValue('dueDay').trim() : '';

	const picked = [...users.values()].filter(u => !u.bot && u.id !== interaction.user.id);
	if (picked.length === 0 && guests.length === 0) {
		return interaction.reply({ content: t.nobody, flags: EPHEMERAL });
	}
	// A monthly bill without an amount or a day bills nobody, ever — refuse it
	// here rather than create something that silently does nothing.
	const dueDay = monthly ? card.parseDueDay(rawDueDay) : null;
	if (monthly && !parseBaht(rawAmount)) return interaction.reply({ content: t.needAmount(rawAmount), flags: EPHEMERAL });
	if (monthly && !dueDay) return interaction.reply({ content: t.badDueDay(rawDueDay), flags: EPHEMERAL });

	// Public: the card is the reply. Everything after this is an edit.
	await interaction.deferReply();

	const organizer = await ensureOrganizer(core, interaction.user);
	const pickedPeople = [];
	for (const user of picked) {
		const account = await core.users.findByIdentity('discord', user.id);
		pickedPeople.push({
			discordUid: user.id,
			displayName: members.get(user.id)?.displayName || user.globalName || user.username,
			userId: account?.id || null,
		});
	}
	const plan = card.planRoster({
		organizer: {
			discordUid: interaction.user.id,
			displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
			userId: organizer.id,
		},
		picked: pickedPeople,
		guests,
		splitMode,
	});

	const created = await core.activities.createActivity({
		ownerUserId: organizer.id,
		title,
		kind: monthly ? 'recurring' : 'event',
		recurrence: monthly ? 'monthly' : null,
		dueDay,
		guildId: interaction.guildId,
		channelId: interaction.channelId,
		participants: plan.participants,
	});
	let activity = await core.activities.getActivity(created.id);
	if (!monthly) for (const p of activity.participants) await core.activities.setRsvp(p.id, 'yes');

	const notes = [];
	const amountSatang = rawAmount ? parseBaht(rawAmount) : null;
	if (rawAmount && !amountSatang) notes.push(t.badAmount(rawAmount));
	if (plan.dropped > 0) notes.push(t.dropped(plan.dropped));
	if (amountSatang && monthly) {
		// This month opens with its bill in one transaction; every later month
		// copies the one before it (the rollover in core/activities.js).
		await core.activities.ensurePeriod(activity.id, new Date(), {
			expense: { label: title, amountSatang, paidBy: activity.participants[0].id },
		});
	}
	else if (amountSatang) {
		await core.activities.addExpense(activity.id, {
			label: title,
			amountSatang,
			paidBy: activity.participants[0].id,
			shareParticipantIds: plan.sharerIndexes.map(index => activity.participants[index].id),
		});
	}

	const rendered = await renderCard(core, activity.code, interaction.guildLocale || interaction.locale);
	activity = rendered.activity;
	await interaction.editReply({
		content: rendered.content,
		components: cardButtons(activity.code, T[card.langOf(interaction.guildLocale || interaction.locale)], monthly),
		allowedMentions: { parse: [], users: rendered.mentionUids },
	});

	const payeeHasPromptPay = Boolean(activity.payee?.promptpayId);
	const note = card.organizerNote({ activity, payeeHasPromptPay, shareUrl: shareUrl(activity.code), period: rendered.period, locale: interaction.locale });
	await interaction.followUp({
		content: [note, ...notes].join('\n'),
		flags: EPHEMERAL,
		allowedMentions: NO_PINGS,
		components: payeeHasPromptPay ? [] : [new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`${PREFIX}:pp`).setStyle(ButtonStyle.Primary).setLabel(t.setPromptPay),
		)],
	});
}

// ── "I'm in" ───────────────────────────────────────────────────────────────

async function onJoin(interaction, core, code) {
	const t = copyFor(interaction);
	const activity = await core.activities.getActivityByCode(code);
	if (!activity) return interaction.reply({ content: t.gone, flags: EPHEMERAL });
	if (activity.guildId && activity.guildId !== interaction.guildId) return interaction.reply({ content: t.wrongServer, flags: EPHEMERAL });

	const account = await core.users.findByIdentity('discord', interaction.user.id);
	if (isMine(activity, interaction.user.id, account?.id)) return interaction.reply({ content: t.alreadyIn, flags: EPHEMERAL });

	// Somebody typed "Ton" before Ton pressed the button. Ask which row is
	// them rather than adding a second Ton who owes the same money twice.
	const unclaimed = activity.participants.filter(p => !p.discordUid && !p.userId);
	if (unclaimed.length > 0) {
		const menu = new StringSelectMenuBuilder()
			.setCustomId(`${PREFIX}:claim:${code}:${interaction.message.id}`)
			.setPlaceholder(t.pickName)
			.addOptions(
				...unclaimed.slice(0, 24).map(p => ({ label: p.displayName.slice(0, 100), value: p.id })),
				{ label: t.addMe, value: 'new' },
			);
		return interaction.reply({ content: t.whoAreYou, components: [new ActionRowBuilder().addComponents(menu)], flags: EPHEMERAL });
	}

	await interaction.deferReply({ flags: EPHEMERAL });
	const outcome = await addMe(core, interaction, activity, account);
	await refreshCard(core, interaction, code);
	return interaction.editReply(outcome === 'skipped' ? `${t.joined}\n${t.paidAlready}` : t.joined);
}

async function addMe(core, interaction, activity, account) {
	const participant = await core.activities.addParticipant(activity.id, {
		displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
		discordUid: interaction.user.id,
		userId: account?.id || null,
		rsvp: 'yes',
	});
	const fresh = await core.activities.getActivity(activity.id);
	return resplitForNewcomer(core, fresh, participant.id);
}

async function onClaim(interaction, core, code, cardMessageId) {
	const t = copyFor(interaction);
	await interaction.deferUpdate();
	const activity = await core.activities.getActivityByCode(code);
	if (!activity) return interaction.editReply({ content: t.gone, components: [] });
	const account = await core.users.findByIdentity('discord', interaction.user.id);
	if (isMine(activity, interaction.user.id, account?.id)) return interaction.editReply({ content: t.alreadyIn, components: [] });

	const choice = interaction.values[0];
	let reply;
	if (choice === 'new') {
		const outcome = await addMe(core, interaction, activity, account);
		reply = outcome === 'skipped' ? `${t.joined}\n${t.paidAlready}` : t.joined;
	}
	else {
		const row = activity.participants.find(p => p.id === choice);
		if (!row || row.discordUid || row.userId) return interaction.editReply({ content: t.claimTaken, components: [] });
		await core.activities.claimParticipant(row.id, { userId: account?.id || null, discordUid: interaction.user.id });
		reply = t.claimed(card.inert(row.displayName));
	}
	await refreshCard(core, interaction, code, cardMessageId);
	return interaction.editReply({ content: reply, components: [] });
}

// ── paying from a button: on the card, or in a due-date DM ─────────────────

async function candidateFor(core, discordUid, code) {
	const found = await core.activities.listPaymentCandidatesForDiscord(discordUid, null, code);
	return found.find(item => item.code === code) || null;
}

async function onPay(interaction, core, code) {
	const t = copyFor(interaction);
	const candidate = await candidateFor(core, interaction.user.id, code);
	if (!candidate) {
		const activity = await core.activities.getActivityByCode(code);
		if (!activity) return interaction.reply({ content: t.gone, flags: EPHEMERAL });
		const account = await core.users.findByIdentity('discord', interaction.user.id);
		const mine = isMine(activity, interaction.user.id, account?.id);
		return interaction.reply({ content: mine ? t.nothingOwed : t.notInBill, flags: EPHEMERAL });
	}
	const amount = money(candidate.outstandingSatang);
	const masked = candidate.payee?.promptpayId ? core.promptpay.maskTarget(candidate.payee.promptpayId) : null;
	const modal = new ModalBuilder()
		.setCustomId(`${PREFIX}:slip:${code}`)
		.setTitle(t.slipTitle)
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(t.slipTo(card.inert(candidate.payee?.displayName || '—'), masked, amount)))
		.addLabelComponents(
			new LabelBuilder().setLabel(t.slipAmount).setTextInputComponent(new TextInputBuilder()
				.setCustomId('amount').setStyle(TextInputStyle.Short).setMaxLength(12).setRequired(true)
				.setValue((candidate.outstandingSatang / 100).toFixed(2))),
			new LabelBuilder().setLabel(t.slipFile).setFileUploadComponent(new FileUploadBuilder()
				.setCustomId('slip').setMinValues(1).setMaxValues(1).setRequired(true)),
		);
	return interaction.showModal(modal);
}

async function onSlip(interaction, core, code) {
	const t = copyFor(interaction);
	await interaction.deferReply({ flags: EPHEMERAL });
	const candidate = await candidateFor(core, interaction.user.id, code);
	if (!candidate) return interaction.editReply(t.nothingOwed);
	const amountSatang = parseBaht(interaction.fields.getTextInputValue('amount'));
	if (!amountSatang) return interaction.editReply(t.slipBadAmount);
	const attachment = interaction.fields.getUploadedFiles('slip')?.first?.();
	if (!attachment) return interaction.editReply(t.slipMissing);

	const reply = await submitDiscordSlip({
		candidate,
		amountSatang,
		attachment,
		senderDiscordUid: interaction.user.id,
		core,
		notifyOwner: async (uid, content) => {
			const owner = await interaction.client.users.fetch(uid);
			await owner.send(content);
		},
	});
	await interaction.editReply(reply);
	// Pressed on the channel card: show the new status there too. Pressed in a
	// DM, the message is the reminder and is left as it was.
	if (interaction.guildId) await refreshCard(core, interaction, code);
}

// ── PromptPay, so that slips can be checked ────────────────────────────────

function onPromptPayButton(interaction) {
	const t = copyFor(interaction);
	return interaction.showModal(new ModalBuilder()
		.setCustomId(`${PREFIX}:ppsave`)
		.setTitle(t.ppTitle)
		.addLabelComponents(
			new LabelBuilder().setLabel(t.ppId).setTextInputComponent(new TextInputBuilder()
				.setCustomId('id').setStyle(TextInputStyle.Short).setMaxLength(20).setRequired(true)),
			new LabelBuilder().setLabel(t.ppName).setTextInputComponent(new TextInputBuilder()
				.setCustomId('name').setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(false)),
		));
}

async function onPromptPaySave(interaction, core) {
	const t = copyFor(interaction);
	await interaction.deferReply({ flags: EPHEMERAL });
	const user = await ensureOrganizer(core, interaction.user);
	try {
		await core.users.setPromptPay(user.id, {
			promptpayId: interaction.fields.getTextInputValue('id'),
			promptpayName: interaction.fields.getTextInputValue('name') || null,
		});
	}
	catch (error) {
		if (error.code === 'promptpay_unrecognised' || error.message === 'promptpay_unrecognised') return interaction.editReply(t.ppInvalid);
		throw error;
	}
	return interaction.editReply(t.ppSaved);
}

// ── routing ────────────────────────────────────────────────────────────────

async function handleComponent(interaction, { core = defaultCore } = {}) {
	const [, action, code, extra] = interaction.customId.split(':');
	try {
		if (interaction.isModalSubmit()) {
			if (action === 'create') return await onCreate(interaction, core);
			if (action === 'subcreate') return await onCreate(interaction, core, { monthly: true });
			if (action === 'slip') return await onSlip(interaction, core, code);
			if (action === 'ppsave') return await onPromptPaySave(interaction, core);
		}
		else if (interaction.isButton()) {
			if (action === 'join') return await onJoin(interaction, core, code);
			if (action === 'pay') return await onPay(interaction, core, code);
			if (action === 'pp') return await onPromptPayButton(interaction);
		}
		else if (interaction.isStringSelectMenu() && action === 'claim') {
			return await onClaim(interaction, core, code, extra);
		}
	}
	catch (error) {
		console.error(`[Megu] /event ${action} failed: ${error.stack || error.message}`);
		const content = copyFor(interaction).failed;
		if (interaction.deferred || interaction.replied) await interaction.followUp({ content, flags: EPHEMERAL }).catch(() => undefined);
		else await interaction.reply({ content, flags: EPHEMERAL }).catch(() => undefined);
	}
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('event')
		.setDescription('Start a shared bill: who is in, what it cost, how to split')
		.setDescriptionLocalizations({ th: 'เปิดบิลกิจกรรม: ใครไปบ้าง ค่าใช้จ่ายเท่าไหร่ หารยังไง' })
		.addStringOption(option => option
			.setName('title')
			.setNameLocalizations({ th: 'ชื่อ' })
			.setDescription('What it is, e.g. Badminton')
			.setDescriptionLocalizations({ th: 'ชื่อกิจกรรม เช่น ตีแบด' })
			.setMaxLength(100)),
	PREFIX,
	copyFor,
	subModal,
	handleComponent,
	resplitForNewcomer,

	async execute(interaction) {
		const t = copyFor(interaction);
		if (!interaction.guildId) return interaction.reply({ content: t.guildOnly, flags: EPHEMERAL });
		// The modal must be the first response, so nothing is looked up first.
		return interaction.showModal(createModal(t, interaction.options.getString('title')));
	},
};
