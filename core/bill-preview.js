// The card Discord and LINE draw under a bill link.
//
// Most people meet Megu this way: a friend pastes /a/{code} into a chat and
// the preview is the first thing they read. It used to inherit the site-wide
// description, so an invitation to split YouTube Premium introduced itself as a
// Discord server manager.
//
// Anyone holding the link can see the preview, so it says only what a reader
// who is not on the roster may see: the title, what kind of bill it is, how
// many people share it and when it falls due. No names and no amounts. It is
// built from the guest view of the API for the same reason, and kept pure so it
// can be tested from literals.

const COPY = {
	th: {
		fallbackTitle: 'บิลที่หารกัน',
		fallback: 'หารค่าใช้จ่ายกับเพื่อนใน Discord เปิดลิงก์เพื่อดูยอดของคุณและจ่ายผ่าน PromptPay',
		cancelled: 'บิลนี้ถูกยกเลิกแล้ว',
		monthly: 'บิลรายเดือน',
		event: 'หารค่าใช้จ่าย',
		people: count => `หารกัน ${count} คน`,
		due: day => `ครบกำหนดวันที่ ${day} ของทุกเดือน`,
		open: 'เปิดลิงก์เพื่อดูยอดของคุณและจ่ายผ่าน PromptPay',
		sentence(parts) { return `${parts.join(' ')} ${this.open}`; },
	},
	en: {
		fallbackTitle: 'A shared bill',
		fallback: 'Split costs with friends on Discord. Open the link to see your share and pay by PromptPay.',
		cancelled: 'This bill has been cancelled',
		monthly: 'Monthly bill',
		event: 'Shared costs',
		people: count => `split ${count} ways`,
		due: day => `due on day ${day} of each month`,
		open: 'Open the link to see your share and pay by PromptPay.',
		sentence(parts) { return `${parts.join(', ')}. ${this.open}`; },
	},
};

const MAX_TITLE = 70;

function clip(text, max) {
	const chars = Array.from(String(text || '').trim());
	return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

/**
 * @param {object|null} activity  the `activity` of GET /api/megu/a/:code, read
 *                                without a session, or null when there is none
 * @param {'th'|'en'} [lang]
 * @returns {{ title: string, description: string }}
 */
function billPreview(activity, lang = 'th') {
	const t = COPY[lang] || COPY.th;
	const title = clip(activity?.title, MAX_TITLE);
	if (!activity || !title) return { title: t.fallbackTitle, description: t.fallback };
	if (activity.planState === 'cancelled') return { title, description: t.cancelled };

	const monthly = activity.kind === 'recurring';
	const sharing = (activity.participants || []).filter(p => p.rsvp !== 'no').length;
	const parts = [monthly ? t.monthly : t.event];
	if (sharing > 1) parts.push(t.people(sharing));
	const day = Number(activity.dueDay);
	if (monthly && Number.isInteger(day) && day >= 1 && day <= 31) parts.push(t.due(day));

	return { title, description: t.sentence(parts) };
}

module.exports = { billPreview };
