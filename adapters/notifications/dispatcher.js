const core = require('../../core/index.js');
const resend = require('../email/resend.js');

function createDispatcher({ sendDiscord, sendEmail = resend.send, log = () => {} }) {
	let running = false;
	async function drain() {
		if (running) return;
		running = true;
		try {
			const deliveries = await core.notifications.claimPending();
			for (const delivery of deliveries) {
				try {
					const content = core.notifications.render(delivery);
					if (delivery.channel === 'discord') {
						if (!delivery.discord_uid) throw new Error('Discord identity is unavailable');
						await sendDiscord({ recipients: [delivery.discord_uid], message: `${content.body}${content.ctaUrl ? `\n${content.ctaUrl}` : ''}` });
					}
					else if (delivery.channel === 'email') {
						if (!delivery.email) throw new Error('Verified email is unavailable');
						await sendEmail({ to: delivery.email, ...content });
					}
					await core.notifications.markSent(delivery.id);
				}
				catch (error) {
					log(`Notification ${delivery.id} failed: ${error.message}`);
					await core.notifications.markFailed(delivery.id, error, delivery.attempts);
				}
			}
		}
		finally { running = false; }
	}
	return { drain };
}

module.exports = { createDispatcher };
