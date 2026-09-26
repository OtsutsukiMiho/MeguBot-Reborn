// The bill, said once in the Discord channel the group already talks in.
//
// Splitting happens on the web because it needs a table of names and numbers.
// Paying happens because somebody read "you owe ฿107.25 to Fig" — and the place
// people read things is the channel. So the organiser can post one summary
// back: the total, who sends how much to whom, and a link to pay.
//
// Plain text built from settlement rows, so it can be tested against literals
// and never depends on Discord. Names are escaped and the message never pings:
// a bill is not worth an @everyone.

const { formatMoney } = require('./format.js');

const COPY = {
	th: {
		heading: (title, total) => `💸 **${title}** · สรุปบิล ${total}`,
		owes: (name, amount, to) => `• ${name} โอน ${amount} ให้ ${to}`,
		settled: '✅ ทุกคนเคลียร์กันครบแล้ว',
		more: count => `…และอีก ${count} รายการ ดูทั้งหมดในลิงก์`,
		cta: 'ดูบิล / จ่ายเงิน',
	},
	en: {
		heading: (title, total) => `💸 **${title}** · bill summary ${total}`,
		owes: (name, amount, to) => `• ${name} sends ${amount} to ${to}`,
		settled: '✅ Everyone is settled up',
		more: count => `…and ${count} more, all in the link`,
		cta: 'View bill / pay',
	},
};

/** Discord markdown and mentions, made inert. A name is a name, not a format. */
function inert(value) {
	return String(value ?? '')
		.replace(/[\\`*_~|>[\]()#-]/g, '\\$&')
		.replace(/@/g, '@​')
		.slice(0, 80);
}

/**
 * @param {object} input
 * @param {string} input.title
 * @param {{ rows: Array, total: number }} input.settlement  from activities.settlement()
 * @param {'th'|'en'} [input.lang]
 * @param {number} [input.maxLines]  a channel message is a glance, not a ledger
 * @returns {{ message: string, ctaLabel: string, lines: number }}
 */
function billSummaryMessage({ title, settlement, lang = 'th', currency = 'THB', maxLines = 15 }) {
	const copy = COPY[lang] || COPY.th;
	const money = satang => formatMoney(satang, currency, lang);
	const names = new Map((settlement?.rows || []).map(row => [row.participantId, row.displayName]));
	const transfers = [];
	for (const row of settlement?.rows || []) {
		for (const debt of row.owesTo || []) {
			if (!(debt.outstandingSatang > 0)) continue;
			transfers.push({ from: row.displayName, to: names.get(debt.creditorId) || '?', amount: debt.outstandingSatang });
		}
	}
	transfers.sort((a, b) => b.amount - a.amount);

	const total = (settlement?.total ?? 0);
	const lines = [copy.heading(inert(title), money(total))];
	if (transfers.length === 0) lines.push(copy.settled);
	for (const transfer of transfers.slice(0, maxLines)) lines.push(copy.owes(inert(transfer.from), money(transfer.amount), inert(transfer.to)));
	if (transfers.length > maxLines) lines.push(copy.more(transfers.length - maxLines));
	return { message: lines.join('\n').slice(0, 1900), ctaLabel: copy.cta, lines: transfers.length };
}

module.exports = { billSummaryMessage };
