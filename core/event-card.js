// `/event` — a bill started from the chat it belongs to.
//
// The whole point is that nobody has to open the web to start one. The
// organiser names the thing, picks people from the server, types the names of
// anyone who is not on Discord, and says what it cost. What comes back is one
// message in the channel that everybody reads: who is in, who owes what, who
// has paid.
//
// Nothing here talks to Discord or Postgres. The command adapter feeds in what
// the modal returned and what the ledger says, and gets back plain values —
// so the rules can be tested against literals.

const { formatMoney } = require('./format.js');

const MAX_PEOPLE = 25;
const MAX_NAME = 60;
const SPLIT_MODES = ['with_me', 'without_me'];

const COPY = {
	th: {
		heading: (title, total, count) => (total
			? `🧾 **${title}** · ${total} หารเท่า ${count} คน`
			: `🧾 **${title}** · ${count} คน · ยังไม่ใส่ยอด`),
		payee: name => `💰 โอนให้ ${name}`,
		receives: 'รับเงิน',
		paid: 'จ่ายแล้ว',
		checking: 'รอตรวจสลิป',
		notLinked: 'ไม่ได้ใช้ Discord',
		howTo: 'โอนแล้วกด **แนบสลิป** ได้เลย · ไม่อยู่ในรายชื่อแต่ไปด้วย กด **ฉันไปด้วย**',
		noAmount: 'คนจัดใส่ยอดได้ที่ลิงก์ เมื่อรู้ยอดแล้ว',
		settled: '✅ ทุกคนจ่ายครบแล้ว',
		more: count => `…และอีก ${count} คน`,
	},
	en: {
		heading: (title, total, count) => (total
			? `🧾 **${title}** · ${total} split evenly by ${count}`
			: `🧾 **${title}** · ${count} people · no amount yet`),
		payee: name => `💰 Pay ${name}`,
		receives: 'collecting',
		paid: 'paid',
		checking: 'slip being checked',
		notLinked: 'not on Discord',
		howTo: 'Paid? Press **Send slip**. Coming but not listed? Press **I\'m in**',
		noAmount: 'The organiser can add the amount at the link once it is known',
		settled: '✅ Everyone has paid',
		more: count => `…and ${count} more`,
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
 * @param {string} [input.locale]
 * @param {number} [input.maxLines]
 * @returns {{ content: string, mentionUids: string[] }}
 */
function eventCardMessage({ activity, settlement, payee = null, locale = 'th', maxLines = 20 }) {
	const lang = langOf(locale);
	const copy = COPY[lang];
	const money = satang => formatMoney(satang, activity.currency || 'THB', lang);
	const rowsById = new Map((settlement?.rows || []).map(row => [row.participantId, row]));
	const total = settlement?.total || 0;
	const sharers = activity.participants.filter(p => (rowsById.get(p.id)?.owes || 0) > 0);
	const payeeId = payee?.participantId || null;

	const label = p => (p.discordUid ? `<@${p.discordUid}>` : inert(p.displayName));
	const lines = [copy.heading(inert(activity.title), total ? money(total) : null, total ? sharers.length : activity.participants.length)];

	const shown = activity.participants.slice(0, maxLines);
	for (const p of shown) {
		const row = rowsById.get(p.id) || { owes: 0, outstanding: 0, pending: 0 };
		const parts = [`• ${label(p)}`];
		if (row.owes > 0) parts.push(money(row.owes));
		if (p.id === payeeId) {
			parts.push(`· ${copy.receives}`);
		}
		else if (total > 0 && row.owes > 0) {
			if (row.outstanding <= 0) parts.push(`· ✅ ${copy.paid}`);
			else if (row.pending > 0) parts.push(`· 🧾 ${copy.checking}`);
		}
		if (!p.discordUid && !p.userId) parts.push(`· _${copy.notLinked}_`);
		lines.push(parts.join(' '));
	}
	if (activity.participants.length > shown.length) lines.push(copy.more(activity.participants.length - shown.length));

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
		lines.push(copy.howTo);
	}

	// Pinged once, on the post that tells them they owe something. The
	// organiser is left out: they pressed the button.
	const mentionUids = shown
		.filter(p => p.discordUid && p.id !== payeeId && (rowsById.get(p.id)?.owes || 0) > 0)
		.map(p => p.discordUid);
	return { content: lines.join('\n').slice(0, 1900), mentionUids };
}

/**
 * What the organiser is told privately after posting: who Megu can chase for
 * them, and who they will have to send the link to themselves.
 */
function organizerNote({ activity, payeeHasPromptPay, shareUrl, locale = 'th' }) {
	const lang = langOf(locale);
	const others = activity.participants.filter(p => p.userId !== activity.ownerUserId);
	const reachable = others.filter(p => p.discordUid);
	const unlinked = others.filter(p => !p.discordUid && !p.userId);
	const lines = [];
	if (lang === 'th') {
		lines.push(`สร้าง **${inert(activity.title)}** แล้ว · Megu เตือนผ่าน DM ได้ ${reachable.length} จาก ${others.length} คน`);
		if (unlinked.length > 0) {
			lines.push(`**${unlinked.map(p => inert(p.displayName)).join(', ')}** ไม่ได้ใช้ Discord ส่งลิงก์นี้ให้เขาเข้าไปกดเลือกชื่อตัวเอง จะผูก Discord เพื่อให้ Megu ทักเตือนก็ได้ ไม่ผูกก็จ่ายได้เหมือนกัน`);
		}
		lines.push(shareUrl);
		if (!payeeHasPromptPay) lines.push('⚠️ ยังไม่มีพร้อมเพย์ของคุณ คนอื่นจะยังแนบสลิปไม่ได้ กด **ตั้งพร้อมเพย์** ด้านล่าง');
	}
	else {
		lines.push(`Created **${inert(activity.title)}** · Megu can remind ${reachable.length} of ${others.length} people by DM`);
		if (unlinked.length > 0) {
			lines.push(`**${unlinked.map(p => inert(p.displayName)).join(', ')}** ${unlinked.length === 1 ? 'is' : 'are'} not on Discord. Send them this link to pick their name — linking Discord lets Megu remind them, but they can pay either way.`);
		}
		lines.push(shareUrl);
		if (!payeeHasPromptPay) lines.push('⚠️ You have no PromptPay yet, so nobody can send a slip. Press **Set PromptPay** below.');
	}
	return lines.join('\n');
}

module.exports = { parseGuestNames, planRoster, eventCardMessage, organizerNote, langOf, inert, MAX_PEOPLE, SPLIT_MODES };
