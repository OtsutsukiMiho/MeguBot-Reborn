'use strict';

function assertDelivered(reply) {
	if (reply && !reply.blocked && Number.isSafeInteger(reply.delivered) && reply.delivered > 0) return reply;
	const error = new Error(reply?.blocked ? 'Discord delivery temporarily blocked' : 'Discord delivery was not acknowledged');
	error.permanent = !reply?.blocked && reply?.outcome === 'permanent_refusal';
	error.ineligible = !reply?.blocked && reply?.outcome === 'ineligible';
	throw error;
}

// Reuse the bot's Discord call/block guards. Only the remote send's positive
// result acknowledges delivery; swallowed/unknown failures are never success.
async function deliverNotice(msg, { users, discordCall, isBlocked, prepareWorkflow, noticeComponents, wait }) {
	let delivered = 0, outcome = 'transient_failure';
	const recipients = Array.isArray(msg.recipients) ? [...new Set(msg.recipients)] : [];
	if (msg.workflowDelivery && recipients.length !== 1) return { delivered, blocked: isBlocked(), outcome: 'ineligible' };
	for (let i = 0; i < recipients.length; i++) {
		if (isBlocked()) break;
		const uid = String(recipients[i]);
		if (!/^\d{17,20}$/.test(uid) || !msg.message) continue;
		const user = users.cache.get(uid) || await discordCall('opening a DM', () => users.fetch(uid), null);
		let message = String(msg.message).slice(0, 1900), cta = msg.cta, defer = msg.defer;
		if (msg.workflowDelivery) {
			// Lookup may wait on Discord. Recheck only after it finishes, directly
			// before send, using the persisted delivery/lease and current identity.
			let content;
			try { content = await prepareWorkflow(msg.workflowDelivery, uid); }
			catch { return { delivered, blocked: isBlocked(), outcome: 'transient_failure' }; }
			if (!content) { outcome = 'ineligible'; continue; }
			message = `${content.body}\n${content.ctaUrl}`;
			cta = { label: content.ctaLabel, url: content.ctaUrl }; defer = null;
		}
		if (!user) continue;
		const sent = await discordCall('sending a DM', async () => {
			try {
				await user.send({ content: message, components: noticeComponents(cta, defer),
					...(msg.workflowDelivery ? { allowedMentions: { parse: [] } } : {}) });
				return true;
			} catch (error) {
				if (Number(error.code) === 50007) outcome = 'permanent_refusal';
				throw error;
			}
		}, false);
		if (sent === true) delivered++;
		if (i < recipients.length - 1) await wait(1000);
	}
	return { delivered, blocked: isBlocked(), outcome: delivered > 0 ? 'delivered' : outcome };
}
module.exports = { assertDelivered, deliverNotice };
