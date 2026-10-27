// `/event` — a bill started from the chat it belongs to.
//
// The whole point is that nobody has to open the web to start one. The
// organiser names the thing, picks people from the server, types the names of
// anyone who is not on Discord, and says what it cost. What comes back is one
// message the people on the bill read: who is in, who owes what, who has paid.
//
// Who owes what is not the server's business. The full card goes only where
// just those people can see it: a private thread of the bill's members, or
// the organiser's DM when nobody else on the bill uses Discord. Anywhere the
// whole server reads gets publicCardMessage, which has no names and no money.
//
// Nothing here talks to Discord or Postgres. The command adapter feeds in what
// the modal returned and what the ledger says, and gets back plain values —
// so the rules can be tested against literals.

const { formatMoney, formatPeriod, formatDueDay } = require('./format.js');

const MAX_PEOPLE = 25;
const MAX_NAME = 60;
const SPLIT_MODES = ['with_me', 'without_me'];

const COPY = {
	th: {
		heading: (title, total, count) => (total
			? `**${title}** ${total} หารเท่า ${count} คน`
			: `**${title}** ${count} คน ยังไม่ใส่ยอด`),
		payee: name => `โอนให้ ${name}`,
		receives: 'รับเงิน',
		paid: 'จ่ายแล้ว',
		checking: 'รอตรวจสลิป',
		notLinked: 'ไม่ได้ใช้ Discord',
		howTo: 'โอนแล้วกด **แนบสลิป** ได้เลย ถ้าไปด้วยแต่ไม่มีชื่อ กด **ฉันไปด้วย**',
		noAmount: 'คนจัดใส่ยอดได้ที่ลิงก์ เมื่อรู้ยอดแล้ว',
		settled: 'ทุกคนจ่ายครบแล้ว',
		more: count => `…และอีก ${count} คน`,
		monthly: (title, total, count, period, due) => `**${title}** ${total}/เดือน หารเท่า ${count} คน\nรอบ${period} ครบกำหนด${due}`,
		monthlyHowTo: 'โอนแล้วกด **แนบสลิป** ได้เลย แล้ว Megu จะเตือนทุกเดือนเมื่อถึงกำหนด',
		dueHeading: (title, period) => `**${title}** รอบ${period} ครบกำหนดวันนี้`,
		dueLine: (name, amount) => `• ${name} ยังค้าง ${amount}`,
		dueHowTo: 'โอนแล้วกด **แนบสลิป** ด้านล่าง',
		monthlyNote: (due, period) => `Megu จะเปิดรอบใหม่ให้ทุกเดือน และเตือนคนที่ยังไม่จ่าย ${due} (รอบแรก: ${period})`,
		startsFrom: period => `(เริ่ม${period})`,
		lastMonth: '(เดือนสุดท้าย)',
		upcoming: (period, total, count) => `ตั้งแต่${period}: ${total}/เดือน หาร ${count} คน`,
		publicHeading: (title, count) => `**${title}** บิลของ ${count} คน`,
		publicMonthly: (title, count, due) => `**${title}** บิลรายเดือนของ ${count} คน ครบกำหนด${due}`,
		publicHowTo: 'ยอดของแต่ละคนไม่แสดงในช่องนี้ คนในบิลกด **แนบสลิป** เพื่อดูยอดของตัวเองและจ่าย ถ้าไปด้วยแต่ไม่มีชื่อ กด **ฉันไปด้วย**',
		publicMonthlyHowTo: 'ยอดของแต่ละคนไม่แสดงในช่องนี้ คนในบิลกด **แนบสลิป** เพื่อดูยอดของตัวเองและจ่าย',
		shareTotal: (total, count) => `ยอดรวม ${total} หาร ${count} คน`,
		shareMonthly: (total, count, due) => `${total}/เดือน หาร ${count} คน ครบกำหนด${due}`,
		shareLine: (name, amount) => `${name} ${amount}`,
		shareLink: url => `ดูยอดและจ่ายได้ที่ ${url}`,
	},
	en: {
		heading: (title, total, count) => (total
			? `**${title}** ${total} split evenly by ${count}`
			: `**${title}** ${count} people, no amount yet`),
		payee: name => `Pay ${name}`,
		receives: 'collecting',
		paid: 'paid',
		checking: 'slip being checked',
		notLinked: 'not on Discord',
		howTo: 'Paid? Press **Send slip**. Coming but not listed? Press **I\'m in**',
		noAmount: 'The organiser can add the amount at the link once it is known',
		settled: 'Everyone has paid',
		more: count => `…and ${count} more`,
		monthly: (title, total, count, period, due) => `**${title}** ${total}/month split evenly by ${count}\n${period}, due ${due}`,
		monthlyHowTo: 'Paid? Press **Send slip**. Megu reminds everyone each month when it is due',
		dueHeading: (title, period) => `**${title}** for ${period} is due today`,
		dueLine: (name, amount) => `• ${name} still owes ${amount}`,
		dueHowTo: 'Paid? Press **Send slip** below',
		monthlyNote: (due, period) => `Megu opens a new month automatically and reminds whoever has not paid on ${due} (first month: ${period})`,
		startsFrom: period => `(from ${period})`,
		lastMonth: '(last month)',
		upcoming: (period, total, count) => `From ${period}: ${total}/month split by ${count}`,
		publicHeading: (title, count) => `**${title}**, a bill for ${count} people`,
		publicMonthly: (title, count, due) => `**${title}**, a monthly bill for ${count} people, due ${due}`,
		publicHowTo: 'Amounts are not shown in this channel. If you are on the bill, press **Send slip** to see your share and pay. Coming but not listed? Press **I\'m in**',
		publicMonthlyHowTo: 'Amounts are not shown in this channel. If you are on the bill, press **Send slip** to see your share and pay',
		shareTotal: (total, count) => `${total} split by ${count}`,
		shareMonthly: (total, count, due) => `${total}/month split by ${count}, due ${due}`,
		shareLine: (name, amount) => `${name} ${amount}`,
		shareLink: url => `See your share and pay at ${url}`,
	},
};

function langOf(locale) {
	return String(locale || '').toLowerCase().startsWith('th') ? 'th' : 'en';
}

/** Discord markdown and mentions, made inert. A typed name is a name. */
function inert(value) {
	return String(value ?? '')
		.replace(/[\\`*_~|>[\]()#-]/g, '\\$&')
		.replace(/@/g, '@​')
		.slice(0, MAX_NAME);
}

/**
 * The free-text names box: one per line, or separated by commas. Blank lines,
 * repeats and anything past the cap are dropped rather than refused — the
 * organiser is typing on a phone, not filling in a form they can fix easily.
 */
function parseGuestNames(text) {
	const seen = new Set();
	const names = [];
	for (const raw of String(text || '').split(/[\n,，、]+/)) {
		const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
		if (!name) continue;
		const key = name.toLocaleLowerCase('th-TH');
		if (seen.has(key)) continue;
		seen.add(key);
		names.push(name);
	}
	return names;
}

/**
 * Who goes on the roster, in order, and who shares the cost.
 *
 * The organiser is always on the roster — they are the one being paid, and the
 * ledger needs a row for the money to go to — whether or not they picked
 * themselves. `without_me` keeps that row but leaves it out of the split, for
 * the organiser who is paying for everybody else's court.
 *
 * @returns {{ participants: Array<{displayName, discordUid, userId}>, sharerIndexes: number[], dropped: number }}
 */
function planRoster({ organizer, picked = [], guests = [], splitMode = 'with_me' }) {
	if (!organizer?.discordUid) throw new Error('organizer is required');
	const mode = SPLIT_MODES.includes(splitMode) ? splitMode : 'with_me';

	const participants = [{
		displayName: String(organizer.displayName || 'Organiser').slice(0, MAX_NAME),
		discordUid: String(organizer.discordUid),
		userId: organizer.userId || null,
	}];
	const seenUids = new Set([String(organizer.discordUid)]);

	let dropped = 0;
	for (const person of picked) {
		if (!person?.discordUid || person.bot) continue;
		const uid = String(person.discordUid);
		if (seenUids.has(uid)) continue;
		if (participants.length >= MAX_PEOPLE) {
			dropped++;
			continue;
		}
		seenUids.add(uid);
		participants.push({
			displayName: String(person.displayName || 'Discord user').slice(0, MAX_NAME),
			discordUid: uid,
			userId: person.userId || null,
		});
	}
	for (const name of guests) {
		if (participants.length >= MAX_PEOPLE) {
			dropped++;
			continue;
		}
		participants.push({ displayName: name, discordUid: null, userId: null });
	}

	const sharerIndexes = participants
		.map((_, index) => index)
		.filter(index => !(mode === 'without_me' && index === 0));
	return { participants, sharerIndexes, dropped };
}

/**
 * The message in the channel, rebuilt from the ledger every time it changes.
 *
 * @param {object} input
 * @param {object} input.activity     from activities.getActivity
 * @param {object} input.settlement   from activities.settlement
 * @param {object|null} input.payee   from activities.resolvePayee
 * @param {{ key: string }|null} [input.period]  the month shown, for a monthly bill
 * @param {string} [input.locale]
 * @param {number} [input.maxLines]
 * @returns {{ content: string, mentionUids: string[] }}
 */
function eventCardMessage({ activity, settlement, payee = null, period = null, upcoming = null, locale = 'th', maxLines = 20 }) {
	const lang = langOf(locale);
	const copy = COPY[lang];
	const money = satang => formatMoney(satang, activity.currency || 'THB', lang);
	const rowsById = new Map((settlement?.rows || []).map(row => [row.participantId, row]));
	const total = settlement?.total || 0;
	const sharers = activity.participants.filter(p => (rowsById.get(p.id)?.owes || 0) > 0);
	const payeeId = payee?.participantId || null;
	const monthly = activity.kind === 'recurring' && total > 0;

	const label = p => (p.discordUid ? `<@${p.discordUid}>` : inert(p.displayName));
	const lines = [monthly
		? copy.monthly(inert(activity.title), money(total), sharers.length, formatPeriod(period?.key, lang), formatDueDay(activity.dueDay, lang))
		: copy.heading(inert(activity.title), total ? money(total) : null, total ? sharers.length : activity.participants.length)];

	// A monthly card is about this month and the next. Somebody who left an
	// earlier month has no share in either and is not listed.
	const joining = new Set(upcoming?.join || []);
	const leaving = new Set(upcoming?.leave || []);
	const roster = monthly
		? activity.participants.filter(p => (rowsById.get(p.id)?.owes || 0) > 0 || p.id === payeeId || joining.has(p.id))
		: activity.participants;
	const shown = roster.slice(0, maxLines);
	for (const p of shown) {
		const row = rowsById.get(p.id) || { owes: 0, outstanding: 0, pending: 0 };
		const parts = [`• ${label(p)}`];
		if (row.owes > 0) parts.push(money(row.owes));
		if (p.id === payeeId) {
			parts.push(`(${copy.receives})`);
		}
		else if (total > 0 && row.owes > 0) {
			if (row.outstanding <= 0) parts.push(`(${copy.paid})`);
			else if (row.pending > 0) parts.push(`(${copy.checking})`);
		}
		if (!p.discordUid && !p.userId) parts.push(`_(${copy.notLinked})_`);
		if (joining.has(p.id) && !(row.owes > 0)) parts.push(copy.startsFrom(formatPeriod(upcoming.periodKey, lang)));
		else if (leaving.has(p.id)) parts.push(copy.lastMonth);
		lines.push(parts.join(' '));
	}
	if (roster.length > shown.length) lines.push(copy.more(roster.length - shown.length));
	if (monthly && upcoming) {
		lines.push(copy.upcoming(formatPeriod(upcoming.periodKey, lang), money(upcoming.amountSatang), upcoming.sharerIds.length));
	}

	lines.push('');
	if (total === 0) {
		lines.push(copy.noAmount);
	}
	else if (settlement?.state === 'settled') {
		lines.push(copy.settled);
	}
	else {
		const payeeRow = activity.participants.find(p => p.id === payeeId);
		if (payeeRow) lines.push(copy.payee(label(payeeRow)));
		lines.push(monthly ? copy.monthlyHowTo : copy.howTo);
	}

	// Pinged once, on the post that tells them they owe something. The
	// organiser is left out: they pressed the button.
	const mentionUids = shown
		.filter(p => p.discordUid && p.id !== payeeId && (rowsById.get(p.id)?.owes || 0) > 0)
		.map(p => p.discordUid);
	return { content: lines.join('\n').slice(0, 1900), mentionUids };
}

function headcount(activity, settlement) {
	const sharing = (settlement?.rows || []).filter(row => row.owes > 0).length;
	return (settlement?.total || 0) > 0 && sharing > 0 ? sharing : activity.participants.length;
}

/**
 * The card for a channel the whole server reads, used only when the bill's
 * private thread could not be made. It says a bill exists and how to act on
 * it, and nothing else: no names, no amounts, no mentions. Pressing
 * **Send slip** shows each person their own share, privately.
 *
 * @returns {{ content: string, mentionUids: string[] }}
 */
function publicCardMessage({ activity, settlement = null, locale = 'th' }) {
	const lang = langOf(locale);
	const copy = COPY[lang];
	const count = headcount(activity, settlement);
	const monthly = activity.kind === 'recurring';
	const lines = [monthly
		? copy.publicMonthly(inert(activity.title), count, formatDueDay(activity.dueDay, lang))
		: copy.publicHeading(inert(activity.title), count)];
	lines.push('', monthly ? copy.publicMonthlyHowTo : copy.publicHowTo);
	return { content: lines.join('\n').slice(0, 1900), mentionUids: [] };
}

/**
 * Plain text the organiser can paste into LINE or anywhere else, for a bill
 * whose other people are not on Discord. No Discord markdown or mentions,
 * since it is read outside Discord.
 */
function shareText({ activity, settlement, shareUrl, locale = 'th' }) {
	const lang = langOf(locale);
	const copy = COPY[lang];
	const money = satang => formatMoney(satang, activity.currency || 'THB', lang);
	const total = settlement?.total || 0;
	const rows = new Map((settlement?.rows || []).map(row => [row.participantId, row]));
	const lines = [String(activity.title)];
	if (total > 0) {
		const count = headcount(activity, settlement);
		lines.push(activity.kind === 'recurring'
			? copy.shareMonthly(money(total), count, formatDueDay(activity.dueDay, lang))
			: copy.shareTotal(money(total), count));
		for (const p of activity.participants) {
			const owes = rows.get(p.id)?.owes || 0;
			if (owes > 0) lines.push(copy.shareLine(p.displayName, money(owes)));
		}
	}
	lines.push(copy.shareLink(shareUrl));
	return lines.join('\n');
}

/**
 * What the organiser is told privately after posting: who Megu can chase for
 * them, and who they will have to send the link to themselves.
 */
function organizerNote({ activity, payeeHasPromptPay, shareUrl, period = null, locale = 'th' }) {
	const lang = langOf(locale);
	const monthlyLine = activity.kind === 'recurring'
		? COPY[lang].monthlyNote(formatDueDay(activity.dueDay, lang), formatPeriod(period?.key, lang))
		: null;
	const others = activity.participants.filter(p => p.userId !== activity.ownerUserId);
	const reachable = others.filter(p => p.discordUid);
	const unlinked = others.filter(p => !p.discordUid && !p.userId);
	// Somebody other than the organiser receives the money: a subscription on
	// a friend's card. The PromptPay line is then about them, not "you".
	const payee = activity.payee || null;
	const payeeRow = payee?.participantId ? activity.participants.find(p => p.id === payee.participantId) : null;
	const payeeIsOther = payeeRow
		? payeeRow.userId !== activity.ownerUserId
		: Boolean(payee?.userId && payee.userId !== activity.ownerUserId);
	const payeeName = payee ? inert(payee.displayName) : '';
	const lines = [];
	if (lang === 'th') {
		lines.push(`สร้าง **${inert(activity.title)}** แล้ว Megu เตือนผ่าน DM ได้ ${reachable.length} จาก ${others.length} คน`);
		if (unlinked.length > 0) {
			lines.push(`**${unlinked.map(p => inert(p.displayName)).join(', ')}** ไม่ได้ใช้ Discord ส่งลิงก์นี้ให้เขาเข้าไปกดเลือกชื่อตัวเอง จะผูก Discord เพื่อให้ Megu ทักเตือนก็ได้ ไม่ผูกก็จ่ายได้เหมือนกัน`);
		}
		lines.push(shareUrl);
		if (payeeIsOther) lines.push(`ทุกคนโอนคืนเข้าพร้อมเพย์ของ **${payeeName}**${payeeHasPromptPay ? '' : ' ซึ่งยังไม่ได้ตั้ง ระหว่างนี้ยังไม่มีใครแนบสลิปได้'}`);
		else if (!payeeHasPromptPay) lines.push('ยังไม่มีพร้อมเพย์ของคุณ คนอื่นจะยังแนบสลิปไม่ได้ กด **ตั้งพร้อมเพย์** ด้านล่าง');
	}
	else {
		lines.push(`Created **${inert(activity.title)}**. Megu can remind ${reachable.length} of ${others.length} people by DM`);
		if (unlinked.length > 0) {
			lines.push(`**${unlinked.map(p => inert(p.displayName)).join(', ')}** ${unlinked.length === 1 ? 'is' : 'are'} not on Discord. Send them this link to pick their name. Linking Discord lets Megu remind them, but they can pay either way.`);
		}
		lines.push(shareUrl);
		if (payeeIsOther) lines.push(`Everyone pays **${payeeName}** back by PromptPay${payeeHasPromptPay ? '.' : ', who has not set it yet, so nobody can send a slip until then.'}`);
		else if (!payeeHasPromptPay) lines.push('You have no PromptPay yet, so nobody can send a slip. Press **Set PromptPay** below.');
	}
	if (monthlyLine) lines.splice(1, 0, monthlyLine);
	return lines.join('\n');
}

/**
 * The due day as people type it: "5", "๕", "วันที่ 5", "5th", or "สิ้นเดือน"
 * for the last day. Any day 1 to 31 is kept as typed; a month too short for
 * it falls due on its last day instead (periodDueAt in core/activities.js),
 * the way subscription billing does it, and the next month goes back to the
 * day that was asked for.
 */
function parseDueDay(value) {
	const text = String(value ?? '').trim().replace(/[๐-๙]/g, digit => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit)));
	if (/สิ้นเดือน|วันสุดท้าย|last day|end of (the )?month/i.test(text)) return 31;
	const match = text.match(/\d{1,2}/);
	const day = match ? Number(match[0]) : NaN;
	return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

/**
 * The monthly bill's due-day post in its channel: who still owes this month.
 *
 * Posted once per deadline by the payment-due sweep. Names are shown as
 * mentions so people recognise themselves, but the message is sent with
 * mentions disabled — the DM already did the tapping on the shoulder, and a
 * channel ping on top of it is the kind of noise that gets a bot muted.
 */
function dueChannelMessage({ title, periodKey, lines, currency = 'THB', locale = 'th', maxLines = 20 }) {
	const lang = langOf(locale);
	const copy = COPY[lang];
	const money = satang => formatMoney(satang, currency, lang);
	const out = [copy.dueHeading(inert(title), formatPeriod(periodKey, lang) || '')];
	for (const line of lines.slice(0, maxLines)) {
		const who = line.discordUid ? `<@${line.discordUid}>` : inert(line.displayName);
		out.push(copy.dueLine(who, money(line.amountSatang)));
	}
	if (lines.length > maxLines) out.push(copy.more(lines.length - maxLines));
	out.push('', copy.dueHowTo);
	return out.join('\n').slice(0, 1900);
}

module.exports = { parseGuestNames, planRoster, eventCardMessage, publicCardMessage, shareText, organizerNote, parseDueDay, dueChannelMessage, langOf, inert, MAX_PEOPLE, SPLIT_MODES };
