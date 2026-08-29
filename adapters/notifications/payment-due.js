const core = require('../../core/index.js');

// The deadline sweep.
//
// Core works out who owes what and writes the sentences; this file decides
// where they go. Everything that has a Megu account goes into the outbox, which
// already knows that account's channel choice, its language, and how to retry —
// so a due-date notice obeys "email only" or "off" without this file ever
// asking. Only a roster row that came from Discord and never became an account
// is handed straight to the bot, because there is no account to hold a
// preference for it.
//
// The timer here is five minutes and touches nothing but Postgres. That is the
// distinction DISCORD-RATE-LIMITS.md draws: polling a database on a timer is
// fine, calling Discord on one is not. Nothing in this sweep reaches Discord —
// the dispatcher does that, when it has something real to deliver.

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

function createPaymentDueSweep({ baseUrl = '', sendDiscord = null, log = () => undefined } = {}) {
	let running = false;

	async function runOnce({ now = new Date() } = {}) {
		if (running) return { queued: 0, dmed: 0, digests: 0, skipped: true };
		running = true;
		try {
			const { notices, hostDigests } = await core.reminders.paymentDueNow({ now, baseUrl });
			let queued = 0;
			let dmed = 0;
			let digests = 0;

			for (const notice of notices) {
				try {
					if (notice.userId) {
						const enqueued = await core.notifications.enqueue({
							userId: notice.userId,
							eventType: 'payment_due',
							dedupeKey: notice.dedupeKey,
							payload: payloadFor(notice),
						});
						// Counted only when the outbox actually took a new event.
						// A dedupe key that has been seen before is this sweep
						// discovering it already did the work, not doing it again.
						if (enqueued.created) queued++;
					}
					else if (notice.discordUid && sendDiscord) {
						await sendDiscord({
							recipients: [notice.discordUid],
							message: core.reminders.composeDueNotice(notice, { locale: 'th' }),
							cta: { label: 'จ่ายเงิน', url: notice.payUrl },
							defer: { participantId: notice.participantId, periodId: notice.periodId, label: 'ยังไม่จ่ายตอนนี้' },
						});
						dmed++;
					}
					else {
						// Reachable in principle, unreachable in practice: a
						// Discord roster row on a deploy where the bot is not
						// running. Saying nothing is right — but it must not be
						// written down as said, or the deadline is announced to
						// nobody and never announced again.
						continue;
					}
					// Only after the message is somewhere it will be delivered
					// from. This row is what stops the next sweep repeating it,
					// so writing it before the send would lose the notice
					// entirely on a failure.
					await core.reminders.markSent(notice, { channel: 'payment-due', sentAt: now });
				}
				catch (error) {
					log(`Payment-due notice for ${notice.displayName} failed: ${error.message}`);
				}
			}

			for (const digest of hostDigests) {
				try {
					// The digest has no `payment_reminders` row to check against —
					// it is about people who have no roster reminder to record —
					// so the outbox dedupe key is the only thing making it
					// once-per-deadline. Trust it, and report what it says.
					const enqueued = await core.notifications.enqueue({
						userId: digest.ownerUserId,
						eventType: 'payment_due_host',
						dedupeKey: digest.dedupeKey,
						payload: {
							activityTitle: digest.title,
							subjectTh: `${digest.lines.length} คนยังไม่จ่าย และเราติดต่อเองไม่ได้ · ${digest.title}`,
							subjectEn: `${digest.lines.length} unpaid people Megu cannot reach · ${digest.title}`,
							bodyTh: core.reminders.composeHostDigest(digest, { locale: 'th' }),
							bodyEn: core.reminders.composeHostDigest(digest, { locale: 'en' }),
							ctaUrl: digest.shareUrl || null,
							ctaLabelTh: 'เปิดกิจกรรม',
							ctaLabelEn: 'Open activity',
						},
					});
					if (enqueued.created) digests++;
				}
				catch (error) {
					log(`Payment-due digest for ${digest.title} failed: ${error.message}`);
				}
			}

			if (queued + dmed + digests > 0) {
				log(`Payment due: ${queued} queued, ${dmed} DMed directly, ${digests} organizer digests`);
			}
			return { queued, dmed, digests };
		}
		finally {
			running = false;
		}
	}

	/**
	 * Start the sweep. Returns a stop function.
	 */
	function start({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
		const tick = () => runOnce().catch(error => log(`Payment-due sweep failed: ${error.message}`));
		const timer = setInterval(tick, intervalMs);
		// Deadlines are dates, not seconds. Waiting a minute after boot costs
		// nothing and keeps a restart loop from re-running the sweep on every
		// crash, which is the boot-time work DISCORD-RATE-LIMITS.md warns about.
		const kickoff = setTimeout(tick, 60 * 1000);
		timer.unref?.();
		kickoff.unref?.();
		return () => {
			clearInterval(timer);
			clearTimeout(kickoff);
		};
	}

	return { runOnce, start };
}

/**
 * Both languages, both buttons.
 *
 * `render()` in core picks the language from the reader's own preference, so
 * every string is supplied twice and neither channel has to guess. The second
 * button is a URL rather than an action because email cannot do actions — the
 * Discord side replaces it with a real button and a modal, and both end up
 * writing the same row.
 */
function payloadFor(notice) {
	return {
		activityTitle: notice.title,
		activityCode: notice.code,
		participantId: notice.participantId,
		periodId: notice.periodId,
		amountSatang: notice.amountSatang,
		currency: notice.currency,
		dueAt: notice.dueAt,
		subjectTh: `ครบกำหนดจ่ายวันนี้ · ${notice.title}`,
		subjectEn: `Payment due today · ${notice.title}`,
		bodyTh: core.reminders.composeDueNotice(notice, { locale: 'th' }),
		bodyEn: core.reminders.composeDueNotice(notice, { locale: 'en' }),
		ctaUrl: notice.payUrl || null,
		ctaLabelTh: 'จ่ายเงิน',
		ctaLabelEn: 'Pay now',
		secondaryUrl: notice.deferUrl || null,
		secondaryLabelTh: 'ยังไม่จ่ายตอนนี้',
		secondaryLabelEn: 'Not now',
		// What the Discord side needs to turn "Not now" into a modal instead of
		// a link. Absent for every other event type, which is how the bot knows
		// not to draw the button.
		defer: { participantId: notice.participantId, periodId: notice.periodId, code: notice.code },
	};
}

module.exports = { createPaymentDueSweep, DEFAULT_INTERVAL_MS };
