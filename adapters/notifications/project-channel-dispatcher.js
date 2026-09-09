const core = require('../../core/index.js');

function createProjectChannelDispatcher({ sendChannel, log = () => undefined }) {
	let running = false;
	async function drain() {
		if (running) return;
		running = true;
		try {
			const deliveries = await core.projectChannelNotifications.claimPending();
			for (const delivery of deliveries) {
				try {
					await sendChannel({
						guildId: delivery.guild_id,
						channelId: delivery.channel_id,
						message: String(delivery.payload?.message || ''),
						cta: delivery.payload?.ctaUrl ? { label: delivery.payload.ctaLabel || 'Open project', url: delivery.payload.ctaUrl } : null,
					});
					await core.projectChannelNotifications.markSent(delivery.id);
				}
				catch (error) {
					log(`Project channel notification ${delivery.id} failed: ${error.message}`);
					await core.projectChannelNotifications.markFailed(delivery.id, error, delivery.attempts);
				}
			}
		}
		finally { running = false; }
	}
	return { drain };
}

module.exports = { createProjectChannelDispatcher };
