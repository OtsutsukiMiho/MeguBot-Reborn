const core = require('../../core/index.js');
const resend = require('../email/resend.js');
const { assertDelivered } = require('./discord-delivery');
const { isWorkflow } = require('../../core/project-workflow-notifications');

function createDispatcher({ sendDiscord, sendEmail = resend.send, log = () => {} }) {
	let running = false;
	async function drain() {
		if (running) return;
		running = true;
		try {
			const deliveries = await core.notifications.claimPending();
			for (const delivery of deliveries) {
				const workflowDelivery = isWorkflow(delivery.event_type)
					? { deliveryId: delivery.id, attempt: Number(delivery.attempts) + 1, channel: delivery.channel } : null;
				try {
					if (!await core.notifications.recheckClaimed(delivery.id)) continue;
					let content = core.notifications.render(delivery);
					if (delivery.channel === 'discord') {
						if (!delivery.discord_uid) throw new Error('Discord identity is unavailable');
						assertDelivered(await sendDiscord({
							recipients: [delivery.discord_uid],
							// The URL stays in the text as well as on the button.
							// A link button is unreachable to anyone reading the
							// DM through a screen reader's message text, and it
							// is the one thing in the message that must not be.
							message: `${content.body}${content.ctaUrl ? `\n${content.ctaUrl}` : ''}`,
							cta: content.ctaUrl ? { label: content.ctaLabel, url: content.ctaUrl } : null,
							// Present only on the events that have a second
							// answer to offer; the bot draws no button without it.
							defer: content.defer
								? { ...content.defer, label: content.secondaryLabel }
								: null,
							...(workflowDelivery ? { workflowDelivery } : {}),
						}));
					}
					else if (delivery.channel === 'email') {
						if (!delivery.email) throw new Error('Verified email is unavailable');
						if (workflowDelivery) {
							content = await core.notifications.prepareWorkflowDelivery(workflowDelivery, delivery.email);
							if (!content) continue;
						}
						await sendEmail({ to: delivery.email, ...content });
					}
					await core.notifications.markSent(delivery.id, workflowDelivery?.attempt ?? null);
				}
				catch (error) {
					log(`Notification ${delivery.id} failed: ${error.message}`);
					if (error.permanent || error.ineligible) await core.notifications.markSkipped(delivery.id, error.message, workflowDelivery?.attempt ?? null);
					else await core.notifications.markFailed(delivery.id, error, delivery.attempts, workflowDelivery?.attempt ?? null);
				}
			}
		}
		finally { running = false; }
	}
	return { drain };
}

module.exports = { createDispatcher };
