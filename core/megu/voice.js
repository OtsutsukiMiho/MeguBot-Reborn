// Megu's words live here and nowhere else.
//
// The moment a phrase gets written inline in the Discord adapter, she becomes
// a different person on LINE — and the character is the product, so that is
// the one refactor we cannot afford later. Adapters ask for a line; they never
// write one.

const { formatTHB } = require('../money.js');
const { resolveLang } = require('../format.js');

function pick(options, seed) {
	if (options.length === 1) return options[0];
	const n = typeof seed === 'string'
		? [...seed].reduce((a, c) => a + c.charCodeAt(0), 0)
		: Math.floor(Math.random() * options.length);
	return options[n % options.length];
}

// Tones are data, not code paths. A paid personality later is a new key here,
// and a new language is a new key inside one.
//
// The English lines are written rather than translated. Megu nags without
// scolding, in the first person, and a sentence run through a translator comes
// back polite and cold — which is a different character, and the character is
// the product. Where Thai leans on particles to soften ("นะ", "ใช่มั้ย"),
// English leans on brevity and the em dash; neither is a transliteration of
// the other, and both are her.
const TONES = {
	megu: {
		th: {
			activityCreated: ({ title }) => [
				`เอาละ "${title}" เราจัดให้เอง เดี๋ยวไปถามทุกคนให้`,
				`รับทราบ "${title}" — เดี๋ยวจัดการต่อให้เอง`,
			],
			askRsvp: ({ title }) => [
				`ใครจะไป "${title}" บ้าง กดตอบในลิงก์เลยนะ`,
				`"${title}" — ตอบหน่อยว่าไปหรือไม่ไป จะได้สรุปได้`,
			],
			waitingOn: ({ names }) => {
				const list = Array.isArray(names) ? names : [names];
				const joined = list.join(', ');
				if (list.length === 1) {
					return [
						`เหลือ ${joined} คนเดียวที่ยังไม่ตอบนะ`,
						`ขาด ${joined} คนเดียวแล้ว รีบตอบหน่อย`,
					];
				}
				return [
					`เหลือ ${joined} ที่ยังไม่ตอบนะ`,
					`ยังขาดอีก ${list.length} คน — ${joined}`,
				];
			},
			confirmed: ({ title, when, count }) => [
				`สรุป "${title}" ${when} · ${count} คน — ใครถอนบอกตอนนี้ยังทัน`,
			],
			reminder: ({ title, when }) => [
				`พรุ่งนี้ "${title}" ${when} นะ อย่าลืม`,
				`เตือนความจำ — "${title}" ${when}`,
			],
			expenseAdded: ({ label, amount, perHead }) => [
				`${label} ${formatTHB(amount)} — ตกคนละ ${formatTHB(perHead)}`,
			],
			nudgeUnpaid: ({ name, amount, days }) => [
				`${name} ยังเหลือ ${formatTHB(amount)} นะ ไม่ได้ลืมใช่มั้ย`,
				`${name} ค้างอยู่ ${formatTHB(amount)} ${days ? `${days} วันแล้ว ` : ''}เดี๋ยวเตือนให้อีกที`,
			],
			paymentConfirmed: ({ name, amount }) => [
				`${name} จ่ายแล้ว ${formatTHB(amount)} ✓`,
				`รับเงิน ${name} ${formatTHB(amount)} เรียบร้อย ✓`,
			],
			allSettled: ({ title }) => [
				`"${title}" ปิดจบแล้ว ทุกคนจ่ายครบ 🎉`,
				`จบสวย — "${title}" เคลียร์ครบทุกคน`,
			],
			cancelled: ({ title }) => [
				`"${title}" ยกเลิกแล้วนะ`,
			],
			recurringOpen: ({ title, period, perHead }) => [
				`${period} ของ "${title}" — คนละ ${formatTHB(perHead)} นะ`,
				`ถึงรอบ ${period} แล้ว "${title}" คนละ ${formatTHB(perHead)}`,
			],
			recurringSettled: ({ title, period }) => [
				`${period} ของ "${title}" เก็บครบแล้ว ✓`,
			],
			nothingOwedYet: ({ title }) => [
				`"${title}" ยังไม่มีค่าใช้จ่ายนะ`,
			],
			askWhen: ({ title, count }) => [
				`"${title}" — เลือกมาว่าว่างช่วงไหนบ้าง มี ${count} ตัวเลือก`,
				`ว่างช่วงไหนบ้าง กดเลือกได้หลายอันเลย (${count} ตัวเลือก)`,
			],
			pollWaiting: ({ names }) => {
				const list = Array.isArray(names) ? names : [names];
				const joined = list.join(', ');
				return list.length === 1
					? [`รอ ${joined} คนเดียวแล้ว เลือกเวลาหน่อย`]
					: [`ยังไม่เลือกเวลา ${list.length} คน — ${joined}`];
			},
			pollDecided: ({ when, count }) => [
				`สรุปแล้ว ${when} · ${count} คน — ใครถอนบอกตอนนี้ยังทัน`,
				`ฟันธง ${when} ไปเลย ${count} คน`,
			],
			pollDeadlocked: ({ title }) => [
				`"${title}" ยังหาเวลาที่ทุกคนว่างตรงกันไม่ได้เลย ลองเสนอช่วงอื่นมั้ย`,
			],
			// Stands in for a date that has not been set. It is one word, but it is
			// one of hers, so it lives here rather than inline in an adapter.
			soon: () => ['เร็ว ๆ นี้'],
		},

		en: {
			activityCreated: ({ title }) => [
				`Right — "${title}". I'll go and ask everyone.`,
				`Got it, "${title}". Leave the rest to me.`,
			],
			askRsvp: ({ title }) => [
				`Who's in for "${title}"? Tap the link and say.`,
				`"${title}" — in or out? I need to know to call it.`,
			],
			waitingOn: ({ names }) => {
				const list = Array.isArray(names) ? names : [names];
				const joined = list.join(', ');
				if (list.length === 1) {
					return [
						`Only ${joined} left to answer.`,
						`Just waiting on ${joined} now.`,
					];
				}
				return [
					`Still waiting on ${joined}.`,
					`${list.length} still to answer — ${joined}.`,
				];
			},
			confirmed: ({ title, when, count }) => [
				`"${title}", ${when}, ${count} of you. Speak now if you're out.`,
			],
			reminder: ({ title, when }) => [
				`"${title}" is tomorrow, ${when}. Don't forget.`,
				`Reminder — "${title}", ${when}.`,
			],
			expenseAdded: ({ label, amount, perHead }) => [
				`${label} ${formatTHB(amount)} — that's ${formatTHB(perHead)} each.`,
			],
			nudgeUnpaid: ({ name, amount, days }) => [
				`${name} still owes ${formatTHB(amount)}. Not forgotten, I hope.`,
				`${name} is ${formatTHB(amount)} short${days ? `, ${days} days now` : ''} — I'll ask again.`,
			],
			paymentConfirmed: ({ name, amount }) => [
				`${name} paid ${formatTHB(amount)} ✓`,
				`${formatTHB(amount)} in from ${name} ✓`,
			],
			allSettled: ({ title }) => [
				`"${title}" is done — everyone has paid 🎉`,
				`That's "${title}" closed out. All square.`,
			],
			cancelled: ({ title }) => [
				`"${title}" is off.`,
			],
			recurringOpen: ({ title, period, perHead }) => [
				`${period} for "${title}" — ${formatTHB(perHead)} each.`,
				`${period} is up. "${title}", ${formatTHB(perHead)} each.`,
			],
			recurringSettled: ({ title, period }) => [
				`${period} for "${title}" is all in ✓`,
			],
			nothingOwedYet: ({ title }) => [
				`Nothing to pay on "${title}" yet.`,
			],
			askWhen: ({ title, count }) => [
				`"${title}" — pick the times you're free. ${count} to choose from.`,
				`When are you free? Pick as many as you like (${count} options).`,
			],
			pollWaiting: ({ names }) => {
				const list = Array.isArray(names) ? names : [names];
				const joined = list.join(', ');
				return list.length === 1
					? [`Only ${joined} left — pick a time.`]
					: [`${list.length} haven't picked a time — ${joined}.`];
			},
			pollDecided: ({ when, count }) => [
				`It's ${when}, ${count} of you. Speak now if you're out.`,
				`Calling it: ${when}. ${count} in.`,
			],
			pollDeadlocked: ({ title }) => [
				`There's no time everyone can make for "${title}". Want to offer some others?`,
			],
			soon: () => ['soon'],
		},
	},
};

/**
 * @param {string} key       situation, e.g. 'nudgeUnpaid'
 * @param {object} vars      values the phrase needs
 * @param {object} [options] { tone, lang, seed } — seed keeps repeated renders
 *                           of the same event stable instead of reshuffling
 *
 * An unwritten line in one language falls back to Thai rather than throwing.
 * She was Thai first, and a sentence in the wrong language is a smaller
 * failure than a page that will not render.
 */
function say(key, vars = {}, options = {}) {
	const tone = TONES[options.tone] || TONES.megu;
	// Thai when nobody says otherwise — not the site's default, which is
	// English. A caller with a reader in front of it knows which language that
	// reader chose and passes it; a caller that does not is the bot, talking to
	// the Thai friend group she was built for. Falling back to the site default
	// here would have switched every Discord DM to English without anyone
	// asking for it.
	const lang = options.lang ? resolveLang(options.lang) : 'th';
	const builder = tone[lang]?.[key] || tone.th[key];
	if (!builder) throw new Error(`Megu has no line for "${key}"`);
	return pick(builder(vars), options.seed);
}

function hasLine(key, tone = 'megu', lang = 'th') {
	const set = TONES[tone] || TONES.megu;
	return Boolean(set[resolveLang(lang)]?.[key]);
}

module.exports = { say, hasLine, TONES };
