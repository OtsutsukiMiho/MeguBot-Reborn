// Megu's words live here and nowhere else.
//
// The moment a phrase gets written inline in the Discord adapter, she becomes
// a different person on LINE — and the character is the product, so that is
// the one refactor we cannot afford later. Adapters ask for a line; they never
// write one.

const { formatTHB } = require('../money.js');

function pick(options, seed) {
	if (options.length === 1) return options[0];
	const n = typeof seed === 'string'
		? [...seed].reduce((a, c) => a + c.charCodeAt(0), 0)
		: Math.floor(Math.random() * options.length);
	return options[n % options.length];
}

// Tones are data, not code paths. A paid personality later is a new key here.
const TONES = {
	megu: {
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
	},
};

/**
 * @param {string} key       situation, e.g. 'nudgeUnpaid'
 * @param {object} vars      values the phrase needs
 * @param {object} [options] { tone, seed } — seed keeps repeated renders of
 *                           the same event stable instead of reshuffling
 */
function say(key, vars = {}, options = {}) {
	const tone = TONES[options.tone] || TONES.megu;
	const builder = tone[key];
	if (!builder) throw new Error(`Megu has no line for "${key}"`);
	return pick(builder(vars), options.seed);
}

function hasLine(key, tone = 'megu') {
	return Boolean((TONES[tone] || TONES.megu)[key]);
}

module.exports = { say, hasLine, TONES };
