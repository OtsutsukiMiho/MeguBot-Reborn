const {
	SlashCommandBuilder, MessageFlags, ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle,
	UserSelectMenuBuilder, StringSelectMenuBuilder, FileUploadBuilder, TextDisplayBuilder,
	ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const defaultCore = require('../../core/index.js');
const card = require('../../core/event-card.js');
const { formatPeriod } = require('../../core/format.js');
const { submitDiscordSlip, ownerDecisionButtons, parseBaht, money, siteUrl } = require('../../adapters/discord/slip-submit.js');

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
		lang: 'th',
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
		notOwner: 'เฉพาะเจ้าของบิลหรือคนรับเงินเท่านั้นที่ยืนยันหรือปฏิเสธรายการนี้ได้',
		ownerOnly: 'เฉพาะเจ้าของบิลเท่านั้นที่เปลี่ยนคนจ่ายได้',
		payerPick: 'ใครเป็นคนจ่ายค่าบริการ (เงินจะโอนเข้าพร้อมเพย์ของคนนี้)',
		payerMe: name => `${name} (คุณ)`,
		payerLocked: 'เดือนนี้มีคนโอนเข้ามาแล้ว เลยเปลี่ยนคนจ่ายไม่ได้ เดี๋ยวเงินที่โอนไปแล้วจะเข้าผิดคน',
		payerAsked: name => `${name} ยังไม่ได้ตั้งพร้อมเพย์ Megu ส่ง DM ไปขอให้แล้ว ระหว่างนี้ยังไม่มีใครแนบสลิปได้`,
		payerUnreachable: name => `${name} ยังไม่ได้ตั้งพร้อมเพย์ และ Megu ส่ง DM หาไม่ได้ บอกให้เขาตั้งพร้อมเพย์ ไม่อย่างนั้นยังไม่มีใครแนบสลิปได้`,
		payerDm: title => `คุณถูกตั้งเป็นคนจ่ายค่าบริการ **${title}** เพื่อนๆ จะโอนส่วนของตัวเองเข้าพร้อมเพย์ของคุณทุกเดือน\nกด **ตั้งพร้อมเพย์** ด้านล่างเพื่อให้ทุกคนเริ่มแนบสลิปได้`,
		leave: 'ออกจากบิล', manage: 'จัดการ',
		leaveConfirm: title => `ออกจาก **${title}** ใช่ไหม ถ้าเดือนนี้มีคนจ่ายแล้ว คุณยังต้องจ่ายส่วนของเดือนนี้ และจะไม่ถูกเรียกเก็บตั้งแต่เดือนหน้า`,
		leftNow: 'ออกจากบิลแล้ว ส่วนของคุณถูกหารให้คนที่เหลือ',
		leftNext: period => `ออกจากบิลแล้ว เดือนนี้ยังต้องจ่ายส่วนของคุณ ตั้งแต่${period}จะไม่ถูกเรียกเก็บ`,
		alreadyLeaving: period => `คุณจะออกจากบิลตั้งแต่${period}อยู่แล้ว ถ้าเปลี่ยนใจ กด **ขอหารด้วย**`,
		payerCannotLeave: 'คนจ่ายค่าบริการออกจากบิลไม่ได้ ให้เจ้าของบิลเปลี่ยนคนจ่ายก่อน',
		lastPerson: 'ถ้าออก บิลนี้จะไม่เหลือใครหารเลย',
		changeNeedsWeb: 'บิลนี้มีหลายรายการต่อเดือน แก้ได้ที่เว็บ',
		manageTitle: title => `จัดการ **${title}**`,
		manageNow: (total, count) => `เดือนนี้ ${total} หาร ${count} คน`,
		priceButton: 'เปลี่ยนราคา', priceTitle: 'ราคาใหม่ต่อเดือน', priceLabel: 'ยอดต่อเดือน (บาท)',
		addPeople: 'เพิ่มคนหารด้วย', removePeople: 'เอาคนออกจากบิล',
		changedNow: (total, count) => `เปลี่ยนแล้ว เดือนนี้ ${total} หาร ${count} คน`,
		changedNext: (period, total, count) => `เดือนนี้มีคนโอนเข้ามาแล้ว เลยเริ่มใช้ตั้งแต่${period}: ${total} หาร ${count} คน`,
		joinedNext: period => `เพิ่มคุณเข้าบิลแล้ว เดือนนี้มีคนจ่ายแล้ว เลยเริ่มหารตั้งแต่${period}`,
		paymentGone: 'ไม่พบรายการจ่ายนี้แล้ว',
		decided: 'รายการนี้ถูกจัดการไปแล้ว',
		rejectTitle: 'ยังไม่ได้รับเงิน', undoTitle: 'ย้อนผลการยืนยัน',
		reasonLabel: 'เหตุผล (คนจ่ายจะเห็นข้อความนี้)',
		confirmedLine: 'คุณยืนยันแล้วว่าได้รับเงิน',
		rejectedLine: reason => `คุณปฏิเสธรายการนี้แล้ว เหตุผล: ${reason}`,
		undoneLine: reason => `คุณย้อนผลการยืนยันแล้ว เหตุผล: ${reason}`,
	},
	en: {
		lang: 'en',
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
		notOwner: 'Only the owner of this bill or the person receiving the money can confirm or reject it.',
		ownerOnly: 'Only the owner of this bill can change who pays.',
		payerPick: 'Whose card pays for it (everyone pays this person back)',
		payerMe: name => `${name} (you)`,
		payerLocked: 'Someone has already sent money this month, so the payer cannot change now. It would send their transfer to the wrong person.',
		payerAsked: name => `${name} has no PromptPay yet. Megu sent them a DM asking for it. Nobody can send a slip until then.`,
		payerUnreachable: name => `${name} has no PromptPay yet and Megu could not DM them. Ask them to set it, or nobody can send a slip.`,
		payerDm: title => `You are now the one paying for **${title}**. Everyone sends their share to your PromptPay each month.\nPress **Set PromptPay** below so they can start sending slips.`,
		leave: 'Leave', manage: 'Manage',
		leaveConfirm: title => `Leave **${title}**? If anyone has paid this month you still owe this month's share, and you will not be billed from next month.`,
		leftNow: 'You left the bill. Your share was split among the others.',
		leftNext: period => `You left the bill. You still owe this month's share; from ${period} you will not be billed.`,
		alreadyLeaving: period => `You already leave from ${period}. Changed your mind? Press **Count me in**.`,
		payerCannotLeave: 'The person paying for the service cannot leave. The owner has to change who pays first.',
		lastPerson: 'If you leave, nobody is left to share this bill.',
		changeNeedsWeb: 'This bill has several costs a month. Change it on the web.',
		manageTitle: title => `Manage **${title}**`,
		manageNow: (total, count) => `This month ${total} split by ${count}`,
		priceButton: 'Change price', priceTitle: 'New monthly price', priceLabel: 'Amount per month (THB)',
		addPeople: 'Add people to share it', removePeople: 'Remove people from the bill',
		changedNow: (total, count) => `Changed. This month is ${total} split by ${count}.`,
		changedNext: (period, total, count) => `Someone has already paid this month, so this starts from ${period}: ${total} split by ${count}.`,
		joinedNext: period => `You are on the bill. Someone has already paid this month, so your share starts from ${period}.`,
		paymentGone: 'This payment no longer exists.',
		decided: 'This payment has already been handled.',
		rejectTitle: 'Not received', undoTitle: 'Undo confirmation',
		reasonLabel: 'Reason (the payer will see this)',
		confirmedLine: 'You confirmed this payment arrived.',
		rejectedLine: reason => `You rejected this payment. Reason: ${reason}`,
		undoneLine: reason => `You undid the confirmation. Reason: ${reason}`,
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
	const row = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`${PREFIX}:pay:${code}`).setStyle(ButtonStyle.Primary).setLabel(t.pay),
		new ButtonBuilder().setCustomId(`${PREFIX}:join:${code}`).setStyle(ButtonStyle.Secondary).setLabel(monthly ? t.joinSub : t.join),
	);
	// A subscription runs for months, so people come and go and the price moves.
	if (monthly) {
		row.addComponents(
			new ButtonBuilder().setCustomId(`${PREFIX}:leave:${code}`).setStyle(ButtonStyle.Secondary).setLabel(t.leave),
			new ButtonBuilder().setCustomId(`${PREFIX}:manage:${code}`).setStyle(ButtonStyle.Secondary).setLabel(t.manage),
		);
	}
	row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(shareUrl(code)).setLabel(t.open));
	return [row];
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
	const upcoming = period ? core.activities.upcomingSubscription(activity, period) : null;
	const built = card.eventCardMessage({ activity, settlement, payee: activity.payee, period, upcoming, locale });
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
	// A monthly bill takes the newcomer this month while nobody has paid, and
	// from next month otherwise. Before this, a join after the first transfer
	// added a name that no later month ever billed.
	if (activity.kind === 'recurring') {
		try {
			const result = await core.activities.changeSubscription(activity.id, { join: [newcomerId] });
			return result.when === 'now' ? 'resplit' : 'next';
		}
		catch (error) {
			if (error.code === 'change_needs_web') return 'skipped';
			throw error;
		}
	}
	const period = null;
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
	// The card belongs to its server and channel, wherever the press came
	// from. A panel or DM has no server language, and its own channel is not
	// where the card lives: editing there answers Unknown Message.
	const bill = await core.activities.getActivityByCode(code);
	if (!bill) return;
	const guild = bill.guildId ? interaction.client?.guilds?.cache?.get(bill.guildId) : null;
	const locale = interaction.guildLocale || guild?.preferredLocale || interaction.locale;
	const rendered = await renderCard(core, code, locale);
	if (!rendered) return;
	const payload = { content: rendered.content, components: cardButtons(code, T[card.langOf(locale)], rendered.monthly), allowedMentions: NO_PINGS };
	const channel = (bill.channelId && interaction.client?.channels?.cache?.get(bill.channelId)) || interaction.channel;
	try {
		if (messageId && channel) await channel.messages.edit(messageId, payload);
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
	const posted = await interaction.editReply({
		content: rendered.content,
		components: cardButtons(activity.code, T[card.langOf(interaction.guildLocale || interaction.locale)], monthly),
		allowedMentions: { parse: [], users: rendered.mentionUids },
	});

	await interaction.followUp({
		...organizerFollowUp(t, activity, rendered.period, interaction, { cardMessageId: posted?.id || null, monthly }),
		content: [organizerNoteFor(activity, rendered.period, interaction.locale), ...notes].join('\n'),
		flags: EPHEMERAL,
		allowedMentions: NO_PINGS,
	});
}

function organizerNoteFor(activity, period, locale) {
	return card.organizerNote({
		activity,
		payeeHasPromptPay: Boolean(activity.payee?.promptpayId),
		shareUrl: shareUrl(activity.code),
		period,
		locale,
	});
}

/**
 * What the organiser can do next, under the note: set PromptPay when the money
 * comes to them and they have none, and on a subscription, say whose card it
 * is on. The card's message id rides in the menu so the card can be redrawn
 * after a pick; without it the menu would edit this private message instead.
 */
function organizerFollowUp(t, activity, period, interaction, { cardMessageId, monthly }) {
	const rows = [];
	const payeeIsMe = !activity.payee?.userId || activity.payee.userId === activity.ownerUserId;
	if (payeeIsMe && !activity.payee?.promptpayId) {
		rows.push(new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`${PREFIX}:pp`).setStyle(ButtonStyle.Primary).setLabel(t.setPromptPay),
		));
	}
	const payer = monthly && cardMessageId ? payerSelect(t, activity, interaction, `${PREFIX}:payer:${activity.code}:${cardMessageId}`) : null;
	if (payer) rows.push(payer);
	return { components: rows };
}

/** The "whose card pays" menu, or null when there is nobody else to pick. */
function payerSelect(t, activity, interaction, customId) {
	const choices = activity.participants.filter(p => p.discordUid).slice(0, 25);
	if (choices.length < 2) return null;
	const current = activity.payee?.participantId;
	return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
		.setCustomId(customId)
		.setPlaceholder(t.payerPick)
		.addOptions(choices.map(p => ({
			label: (p.discordUid === interaction.user.id ? t.payerMe(p.displayName) : p.displayName).slice(0, 100),
			value: p.id,
			default: p.id === current,
		}))));
}

// ── whose card the subscription is on ──────────────────────────────────────

async function onPayerPick(interaction, core, code, cardMessageId, { fromPanel = false } = {}) {
	const t = copyFor(interaction);
	await interaction.deferUpdate();
	let activity = await core.activities.getActivityByCode(code);
	if (!activity) return interaction.editReply({ content: t.gone, components: [] });
	const account = await core.users.findByIdentity('discord', interaction.user.id);
	if (!account || account.id !== activity.ownerUserId) return interaction.followUp({ content: t.ownerOnly, flags: EPHEMERAL });
	const payer = activity.participants.find(p => p.id === interaction.values[0] && p.discordUid);
	if (!payer) return interaction.followUp({ content: t.failed, flags: EPHEMERAL });

	const period = core.activities.currentPeriod(activity);
	try {
		await core.activities.setRecurringPayer(activity.id, payer.id, { periodId: period?.id || null });
	}
	catch (error) {
		if (error.code === 'payer_locked') return interaction.followUp({ content: t.payerLocked, flags: EPHEMERAL });
		throw error;
	}

	const rendered = await renderCard(core, code, interaction.guildLocale || interaction.locale);
	activity = rendered.activity;
	await refreshCard(core, interaction, code, cardMessageId);

	const lines = [organizerNoteFor(activity, rendered.period, interaction.locale)];
	const isMe = payer.discordUid === interaction.user.id;
	let asked = null;
	if (!isMe && !activity.payee?.promptpayId) {
		asked = await askPayerForPromptPay(interaction.client, payer, activity)
			? t.payerAsked(card.inert(payer.displayName))
			: t.payerUnreachable(card.inert(payer.displayName));
		lines.push(asked);
	}
	if (fromPanel) return interaction.editReply(managePanel(t, core, activity, rendered.period, interaction, cardMessageId, asked));
	return interaction.editReply({
		content: lines.join('\n'),
		allowedMentions: NO_PINGS,
		...organizerFollowUp(t, activity, rendered.period, interaction, { cardMessageId, monthly: true }),
	});
}

/**
 * One DM to the person now receiving the money, because nobody can send a
 * slip until they have a PromptPay number. It is sent once, on the pick, in
 * answer to the organiser pressing something (DISCORD-RATE-LIMITS.md rule 1).
 */
async function askPayerForPromptPay(client, payer, activity) {
	const t = T.th;
	try {
		const user = await client.users.fetch(payer.discordUid);
		await user.send({
			content: t.payerDm(card.inert(activity.title)),
			components: [new ActionRowBuilder().addComponents(
				new ButtonBuilder().setCustomId(`${PREFIX}:pp`).setStyle(ButtonStyle.Primary).setLabel(t.setPromptPay),
			)],
			allowedMentions: NO_PINGS,
		});
		return true;
	}
	catch (error) {
		// A closed DM is the ordinary case. A Discord refusal has already been
		// recorded by the block guard in the REST client.
		console.warn(`[Megu] Could not ask the payer of ${activity.code} for PromptPay: ${error.message}`);
		return false;
	}
}

// ── "I'm in" ───────────────────────────────────────────────────────────────

async function onJoin(interaction, core, code) {
	const t = copyFor(interaction);
	const activity = await core.activities.getActivityByCode(code);
	if (!activity) return interaction.reply({ content: t.gone, flags: EPHEMERAL });
	if (activity.guildId && activity.guildId !== interaction.guildId) return interaction.reply({ content: t.wrongServer, flags: EPHEMERAL });

	const account = await core.users.findByIdentity('discord', interaction.user.id);
	const mine = isMine(activity, interaction.user.id, account?.id);
	if (mine) {
		// On a monthly bill "already in" depends on the month: someone who left,
		// or is about to, presses this to come back.
		if (activity.kind !== 'recurring' || sharesThisMonth(core, activity, mine.id) && !leavingSoon(activity, mine.id)) {
			return interaction.reply({ content: t.alreadyIn, flags: EPHEMERAL });
		}
		await interaction.deferReply({ flags: EPHEMERAL });
		const outcome = await resplitForNewcomer(core, activity, mine.id);
		await refreshCard(core, interaction, code);
		return interaction.editReply(joinReply(t, core, activity, outcome));
	}

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
	return interaction.editReply(joinReply(t, core, activity, outcome));
}

function sharesThisMonth(core, activity, participantId) {
	const period = core.activities.currentPeriod(activity);
	return activity.shares.some(s => s.participantId === participantId && s.amountSatang > 0 && (!period || s.periodId === period.id));
}

function leavingSoon(activity, participantId) {
	return (activity.recurringChange?.leave || []).includes(participantId);
}

function joinReply(t, core, activity, outcome) {
	if (outcome === 'skipped') return `${t.joined}\n${t.paidAlready}`;
	if (outcome === 'next') {
		const period = core.activities.currentPeriod(activity);
		return t.joinedNext(formatPeriod(period ? core.activities.nextPeriodKey(period.key) : null, t.lang));
	}
	return t.joined;
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
		reply = joinReply(t, core, activity, outcome);
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
		notifyOwner: async (uid, message) => {
			const owner = await interaction.client.users.fetch(uid);
			await owner.send({ ...message, allowedMentions: { parse: [] } });
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

// ── a subscription that changes: leaving, the price, who is on it ──────────

/** One sentence for what changeSubscription() did: this month, or from next. */
function changeResult(t, result) {
	const total = money(result.amountSatang);
	return result.when === 'now'
		? t.changedNow(total, result.sharerIds.length)
		: t.changedNext(formatPeriod(result.periodKey, t.lang), total, result.sharerIds.length);
}

/** The refusals changeSubscription() can give, as sentences. Anything else is a fault. */
function changeRefusal(t, error) {
	return {
		payer_cannot_leave: t.payerCannotLeave,
		nobody_left: t.lastPerson,
		change_needs_web: t.changeNeedsWeb,
		amount_invalid: t.needAmount(''),
	}[error.code] || null;
}

async function onLeave(interaction, core, code) {
	const t = copyFor(interaction);
	const activity = await core.activities.getActivityByCode(code);
	if (!activity) return interaction.reply({ content: t.gone, flags: EPHEMERAL });
	const account = await core.users.findByIdentity('discord', interaction.user.id);
	const mine = isMine(activity, interaction.user.id, account?.id);
	if (!mine || !sharesThisMonth(core, activity, mine.id)) return interaction.reply({ content: t.notInBill, flags: EPHEMERAL });
	if (mine.id === activity.payee?.participantId) return interaction.reply({ content: t.payerCannotLeave, flags: EPHEMERAL });
	if (leavingSoon(activity, mine.id)) {
		return interaction.reply({ content: t.alreadyLeaving(formatPeriod(activity.recurringChange.from, t.lang)), flags: EPHEMERAL });
	}
	// Asked once more, because it moves money for everybody else.
	return interaction.reply({
		content: t.leaveConfirm(card.inert(activity.title)),
		components: [new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`${PREFIX}:leaveok:${code}:${interaction.message.id}`).setStyle(ButtonStyle.Danger).setLabel(t.leave),
		)],
		flags: EPHEMERAL,
	});
}

async function onLeaveConfirm(interaction, core, code, cardMessageId) {
	const t = copyFor(interaction);
	await interaction.deferUpdate();
	const activity = await core.activities.getActivityByCode(code);
	if (!activity) return interaction.editReply({ content: t.gone, components: [] });
	const account = await core.users.findByIdentity('discord', interaction.user.id);
	const mine = isMine(activity, interaction.user.id, account?.id);
	if (!mine) return interaction.editReply({ content: t.notInBill, components: [] });
	let result;
	try {
		result = await core.activities.changeSubscription(activity.id, { leave: [mine.id] });
	}
	catch (error) {
		const refusal = changeRefusal(t, error);
		if (!refusal) throw error;
		return interaction.editReply({ content: refusal, components: [] });
	}
	await refreshCard(core, interaction, code, cardMessageId);
	const content = result.when === 'now' ? t.leftNow : t.leftNext(formatPeriod(result.periodKey, t.lang));
	return interaction.editReply({ content, components: [] });
}

/**
 * The owner's panel for a running subscription: the price, who is on it and
 * whose card pays. It hangs off the card rather than the note under it, which
 * Discord forgets as soon as the organiser reloads.
 */
function managePanel(t, core, activity, period, interaction, cardMessageId, extra = null) {
	const settlement = core.activities.settlement(activity, period?.id ?? null);
	const sharers = settlement.rows.filter(row => row.owes > 0);
	const upcoming = core.activities.upcomingSubscription(activity, period);
	const lines = [t.manageTitle(card.inert(activity.title)), t.manageNow(money(settlement.total), sharers.length)];
	if (upcoming) lines.push(changeResult(t, { when: 'next', ...upcoming }));
	if (extra) lines.push(extra);

	const ids = `${activity.code}:${cardMessageId}`;
	const rows = [
		new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`${PREFIX}:price:${ids}`).setStyle(ButtonStyle.Secondary).setLabel(t.priceButton),
		),
		new ActionRowBuilder().addComponents(new UserSelectMenuBuilder()
			.setCustomId(`${PREFIX}:addp:${ids}`).setPlaceholder(t.addPeople).setMinValues(1).setMaxValues(10)),
	];
	const leaving = new Set(upcoming?.leave || []);
	const removable = activity.participants
		.filter(p => sharers.some(row => row.participantId === p.id) && p.id !== activity.payee?.participantId && !leaving.has(p.id))
		.slice(0, 25);
	if (removable.length > 0) {
		rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
			.setCustomId(`${PREFIX}:rmp:${ids}`).setPlaceholder(t.removePeople)
			.setMinValues(1).setMaxValues(removable.length)
			.addOptions(removable.map(p => ({ label: p.displayName.slice(0, 100), value: p.id })))));
	}
	const payer = payerSelect(t, activity, interaction, `${PREFIX}:payerm:${ids}`);
	if (payer) rows.push(payer);
	return { content: lines.join('\n'), components: rows, allowedMentions: NO_PINGS };
}

/** The bill, its current month, and whether the person pressing owns it. */
async function ownerView(core, interaction, code) {
	const t = copyFor(interaction);
	const rendered = await renderCard(core, code, interaction.guildLocale || interaction.locale);
	if (!rendered) return { error: t.gone };
	const account = await core.users.findByIdentity('discord', interaction.user.id);
	if (!account || account.id !== rendered.activity.ownerUserId) return { error: t.ownerOnly };
	return { activity: rendered.activity, period: rendered.period };
}

async function onManage(interaction, core, code) {
	const t = copyFor(interaction);
	const view = await ownerView(core, interaction, code);
	if (view.error) return interaction.reply({ content: view.error, flags: EPHEMERAL });
	return interaction.reply({ ...managePanel(t, core, view.activity, view.period, interaction, interaction.message.id), flags: EPHEMERAL });
}

async function onPriceButton(interaction, core, code, cardMessageId) {
	const t = copyFor(interaction);
	const view = await ownerView(core, interaction, code);
	if (view.error) return interaction.reply({ content: view.error, flags: EPHEMERAL });
	const expense = view.activity.expenses.find(e => e.periodId === view.period?.id);
	const upcoming = core.activities.upcomingSubscription(view.activity, view.period);
	const current = upcoming?.amountSatang ?? expense?.amountSatang ?? null;
	return interaction.showModal(new ModalBuilder()
		.setCustomId(`${PREFIX}:pricesave:${code}:${cardMessageId}`)
		.setTitle(t.priceTitle)
		.addLabelComponents(new LabelBuilder().setLabel(t.priceLabel).setTextInputComponent(new TextInputBuilder()
			.setCustomId('amount').setStyle(TextInputStyle.Short).setMaxLength(12).setRequired(true)
			.setValue(current ? (current / 100).toFixed(2) : ''))));
}

/** Run one change from the panel, redraw the card and the panel, and say what happened. */
async function applyFromPanel(interaction, core, code, cardMessageId, change) {
	const t = copyFor(interaction);
	await interaction.deferUpdate();
	const view = await ownerView(core, interaction, code);
	if (view.error) return interaction.followUp({ content: view.error, flags: EPHEMERAL });
	let result;
	try {
		result = await core.activities.changeSubscription(view.activity.id, change);
	}
	catch (error) {
		const refusal = changeRefusal(t, error);
		if (!refusal) throw error;
		return interaction.followUp({ content: refusal, flags: EPHEMERAL });
	}
	await refreshCard(core, interaction, code, cardMessageId);
	const fresh = await ownerView(core, interaction, code);
	return interaction.editReply(managePanel(t, core, fresh.activity, fresh.period, interaction, cardMessageId, changeResult(t, result)));
}

async function onPriceSave(interaction, core, code, cardMessageId) {
	const t = copyFor(interaction);
	const raw = interaction.fields.getTextInputValue('amount').trim();
	const amountSatang = parseBaht(raw);
	if (!amountSatang) return interaction.reply({ content: t.needAmount(raw), flags: EPHEMERAL });
	return applyFromPanel(interaction, core, code, cardMessageId, { amountSatang });
}

async function onAddPeople(interaction, core, code, cardMessageId) {
	const view = await ownerView(core, interaction, code);
	if (view.error) return interaction.reply({ content: view.error, flags: EPHEMERAL });
	// A Discord account already on the roster (someone who left, say) comes
	// back as the same row, so their history stays in one place.
	const ids = [];
	for (const user of interaction.users.values()) {
		if (user.bot) continue;
		const existing = view.activity.participants.find(p => p.discordUid === user.id);
		if (existing) {
			ids.push(existing.id);
			continue;
		}
		const account = await core.users.findByIdentity('discord', user.id);
		const added = await core.activities.addParticipant(view.activity.id, {
			displayName: interaction.members?.get(user.id)?.displayName || user.globalName || user.username,
			discordUid: user.id,
			userId: account?.id || null,
			rsvp: 'yes',
		});
		ids.push(added.id);
	}
	if (ids.length === 0) return interaction.deferUpdate();
	return applyFromPanel(interaction, core, code, cardMessageId, { join: ids });
}

function onRemovePeople(interaction, core, code, cardMessageId) {
	return applyFromPanel(interaction, core, code, cardMessageId, { leave: [...interaction.values] });
}

// ── the organiser's answer to a slip, from the DM that asked ───────────────

// Button action, the payment status it acts on, and what it becomes.
const DECISIONS = {
	pok: { decision: 'confirm', from: 'pending' },
	pno: { decision: 'reject', from: 'pending' },
	pundo: { decision: 'undo', from: 'confirmed' },
};

/** The bill and the payment, if the person pressing owns the bill. */
async function decisionTarget(core, interaction, code, paymentId, from) {
	const t = copyFor(interaction);
	const activity = await core.activities.getActivityByCode(code);
	if (!activity) return { error: t.gone };
	const account = await core.users.findByIdentity('discord', interaction.user.id);
	// The owner, or whoever the money went to: they are the one who can see it.
	const allowed = account && (account.id === activity.ownerUserId || account.id === activity.payee?.userId);
	if (!allowed) return { error: t.notOwner };
	const payment = activity.payments.find(p => p.id === paymentId);
	if (!payment) return { error: t.paymentGone };
	if (payment.status !== from) return { error: t.decided };
	return { activity, payment, account };
}

function reasonModal(t, action, code, paymentId) {
	return new ModalBuilder()
		.setCustomId(`${PREFIX}:${action}save:${code}:${paymentId}`)
		.setTitle(action === 'pundo' ? t.undoTitle : t.rejectTitle)
		.addLabelComponents(new LabelBuilder().setLabel(t.reasonLabel).setTextInputComponent(new TextInputBuilder()
			.setCustomId('reason').setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(true)));
}

async function onDecisionButton(interaction, core, action, code, paymentId) {
	const { decision, from } = DECISIONS[action];
	// Checked before the modal opens, so a stranger or a second press is told
	// at once instead of after typing a reason.
	const target = await decisionTarget(core, interaction, code, paymentId, from);
	if (target.error) return interaction.reply({ content: target.error, flags: EPHEMERAL });
	if (decision !== 'confirm') return interaction.showModal(reasonModal(copyFor(interaction), action, code, paymentId));
	await interaction.deferUpdate();
	return decide(interaction, core, target, decision, '');
}

async function onDecisionReason(interaction, core, action, code, paymentId) {
	const { decision, from } = DECISIONS[action];
	const reason = interaction.fields.getTextInputValue('reason').trim();
	// Read again: time passed while the modal was open.
	const target = await decisionTarget(core, interaction, code, paymentId, from);
	if (target.error) return interaction.reply({ content: target.error, flags: EPHEMERAL });
	await interaction.deferUpdate();
	return decide(interaction, core, target, decision, reason);
}

async function decide(interaction, core, { activity, payment, account }, decision, reason) {
	const t = copyFor(interaction);
	let done;
	if (decision === 'confirm') {
		done = await core.activities.confirmPayment(payment.id, account.id, {
			source: 'owner_review', verificationLevel: 'owner_confirmed', reason: 'owner_checked_transfer',
		});
	}
	else if (decision === 'reject') done = await core.activities.rejectPayment(payment.id, account.id, reason);
	else done = await core.activities.reversePayment(payment.id, account.id, reason);
	// Somebody answered on the web between the check and this write.
	if (!done) return interaction.followUp({ content: t.decided, flags: EPHEMERAL });

	const line = decision === 'confirm' ? t.confirmedLine : decision === 'reject' ? t.rejectedLine(reason) : t.undoneLine(reason);
	await interaction.editReply({
		content: `${interaction.message?.content || ''}\n\n${line}`.trim(),
		// A confirm is one tap next to the reject button, so it keeps a way back:
		// the same undo an automatic match offers. Reject and undo are final here.
		components: decision === 'confirm' ? ownerDecisionButtons(activity.code, payment.id, { autoConfirmed: true }) : [],
		allowedMentions: NO_PINGS,
	});
	await tellPayer(core, interaction.client, activity, payment, decision, reason);
}

/**
 * The payer hears the answer the way they would from the web: through the
 * outbox when they have an account, so their channel choice is respected, and
 * as a DM when they are only a Discord row on the roster.
 */
async function tellPayer(core, client, activity, payment, decision, reason) {
	const payer = activity.participants.find(p => p.id === payment.participantId);
	if (!payer) return;
	const amount = money(payment.amountSatang);
	const bodyTh = decision === 'confirm'
		? `เจ้าของบิลยืนยันแล้วว่าได้รับเงิน ${amount} ของคุณ`
		: decision === 'reject'
			? `เจ้าของบิลยังไม่ได้รับเงิน ${amount} ของคุณ เหตุผล: ${reason}\nแนบสลิปใหม่ได้ที่การ์ดบิล`
			: `เจ้าของบิลย้อนผลการยืนยันเงิน ${amount} ของคุณ เหตุผล: ${reason}`;
	const bodyEn = decision === 'confirm'
		? `The organiser confirmed your ${amount} payment.`
		: decision === 'reject'
			? `The organiser has not received your ${amount} payment. Reason: ${reason}\nYou can send a new slip from the bill card.`
			: `The organiser undid the confirmation of your ${amount} payment. Reason: ${reason}`;
	try {
		if (payer.userId) {
			await core.notifications.enqueue({
				userId: payer.userId,
				eventType: `payment_${decision}`,
				dedupeKey: `payment-decision:${payment.id}:${decision}:discord`,
				payload: {
					activityTitle: activity.title,
					subjectTh: `อัปเดตการจ่ายเงิน ${activity.title}`,
					subjectEn: `Payment update for ${activity.title}`,
					bodyTh, bodyEn, ctaUrl: shareUrl(activity.code),
				},
			});
		}
		else if (payer.discordUid) {
			const user = await client.users.fetch(payer.discordUid);
			await user.send({ content: `**${card.inert(activity.title)}**\n${bodyTh}\n${shareUrl(activity.code)}`, allowedMentions: NO_PINGS });
		}
	}
	catch (error) {
		// The decision is already written. A closed DM is not an incident, and a
		// Discord refusal has already reached the block guard in the REST client.
		console.warn(`[Megu] Could not tell the payer of ${activity.code} about the ${decision}: ${error.message}`);
	}
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
			if (action === 'pnosave') return await onDecisionReason(interaction, core, 'pno', code, extra);
			if (action === 'pundosave') return await onDecisionReason(interaction, core, 'pundo', code, extra);
			if (action === 'pricesave') return await onPriceSave(interaction, core, code, extra);
		}
		else if (interaction.isButton()) {
			if (action === 'join') return await onJoin(interaction, core, code);
			if (action === 'pay') return await onPay(interaction, core, code);
			if (action === 'pp') return await onPromptPayButton(interaction);
			if (action === 'leave') return await onLeave(interaction, core, code);
			if (action === 'leaveok') return await onLeaveConfirm(interaction, core, code, extra);
			if (action === 'manage') return await onManage(interaction, core, code);
			if (action === 'price') return await onPriceButton(interaction, core, code, extra);
			if (DECISIONS[action]) return await onDecisionButton(interaction, core, action, code, extra);
		}
		else if (interaction.isStringSelectMenu()) {
			if (action === 'claim') return await onClaim(interaction, core, code, extra);
			if (action === 'payer') return await onPayerPick(interaction, core, code, extra);
			if (action === 'payerm') return await onPayerPick(interaction, core, code, extra, { fromPanel: true });
			if (action === 'rmp') return await onRemovePeople(interaction, core, code, extra);
		}
		else if (interaction.isUserSelectMenu?.() && action === 'addp') {
			return await onAddPeople(interaction, core, code, extra);
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
