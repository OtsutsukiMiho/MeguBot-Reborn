const core = require('../../core/index.js');
const { assertDelivered } = require('./discord-delivery');
const { dueChannelMessage } = require('../../core/event-card.js');

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

// The buttons under a due-date message, in the language of whoever reads it.
const LABELS = {
	th: { pay: 'จ่ายเงิน', notNow: 'ยังไม่จ่ายตอนนี้', slip: 'แนบสลิป', open: 'เปิดบิล' },
	en: { pay: 'Pay now', notNow: 'Not now', slip: 'Send slip', open: 'Open bill' },
};

/**
 * `serverLang(guildId)` answers the language a server chose for Megu (see
 * core/server-lang.js). It is asked once per server per sweep, and only reads
 * the settings store and the bot's cache; it never calls Discord.
 */
function createPaymentDueSweep({ baseUrl = '', sendDiscord = null, postChannel = null, serverLang = null, log = () => undefined } = {}) {
	let running = false;

	async function langsFor(guildIds) {
		const langs = new Map();
		for (const guildId of new Set(guildIds.filter(Boolean))) {
			let lang = null;
			try {
				lang = serverLang ? await serverLang(guildId) : null;
			}
			catch (error) {
				log(`Server language for ${guildId} could not be read: ${error.message}`);
			}
			langs.set(guildId, LABELS[lang] ? lang : 'th');
		}
		return langs;
	}

	async function runOnce({ now = new Date() } = {}) {
		if (running) return { queued: 0, dmed: 0, digests: 0, skipped: true };
		running = true;
		try {
			const { notices, hostDigests, channelNotices = [] } = await core.reminders.paymentDueNow({ now, baseUrl });
			let queued = 0;
			let dmed = 0;
			let digests = 0;
			let posted = 0;
			// A bill with no server (made on the web) stays Thai, as before.
			const langs = await langsFor([...notices, ...channelNotices, ...hostDigests.map(digest => digest.lines[0] || {})]
				.map(notice => notice.guildId));
			const langOf = notice => langs.get(notice.guildId) || 'th';

			for (const notice of notices) {
				try {
					if (notice.userId) {
						const enqueued = await core.notifications.enqueue({
							userId: notice.userId,
							eventType: 'payment_due',
							dedupeKey: notice.dedupeKey,
							payload: { ...payloadFor(notice), contextLocale: langOf(notice) },
						});
						// Counted only when the outbox actually took a new event.
						// A dedupe key that has been seen before is this sweep
						// discovering it already did the work, not doing it again.
						if (enqueued.created) queued++;
					}
					else if (notice.discordUid && sendDiscord) {
						// No account, so no preference: the bill's server decides.
						const lang = langOf(notice);
						const labels = LABELS[lang];
						assertDelivered(await sendDiscord({
							recipients: [notice.discordUid],
							message: core.reminders.composeDueNotice(notice, { locale: lang }),
							cta: { label: labels.pay, url: notice.payUrl },
							defer: { participantId: notice.participantId, periodId: notice.periodId, code: notice.code, label: labels.notNow, payLabel: labels.slip },
						}));
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
							contextLocale: langOf(digest.lines[0] || {}),
						},
					});
					if (enqueued.created) digests++;
				}
				catch (error) {
					log(`Payment-due digest for ${digest.title} failed: ${error.message}`);
				}
			}

			for (const notice of channelNotices) {
				if (!postChannel) break;
				try {
					const lang = langOf(notice);
					const result = await postChannel({
						guildId: notice.guildId,
						channelId: notice.channelId,
						message: dueChannelMessage({ title: notice.title, periodKey: notice.periodKey, lines: notice.lines, currency: notice.currency, locale: lang }),
						cta: notice.shareUrl ? { label: LABELS[lang].open, url: notice.shareUrl } : null,
						// Drawn as the "send slip" button; no participant, so no "not now".
						defer: { code: notice.code, payLabel: LABELS[lang].slip },
					});
					// A block leaves it due for the next sweep after the ban.
					// Anything else — a deleted channel, a lost permission — is
					// recorded as done: retrying a refusal every five minutes for
					// three days is the invalid-request storm rule 3c is about.
					if (result?.blocked) continue;
					await core.reminders.markChannelPosted(notice, { sentAt: now });
					if (result?.delivered) posted++;
					else log(`Due-day channel post for ${notice.title} was not delivered: ${result?.error || 'unknown'}`);
				}
				catch (error) {
					log(`Due-day channel post for ${notice.title} failed: ${error.message}`);
				}
			}

			if (queued + dmed + digests + posted > 0) {
				log(`Payment due: ${queued} queued, ${dmed} DMed directly, ${digests} organizer digests, ${posted} channel posts`);
			}
			return { queued, dmed, digests, posted };
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

module.exports = { createPaymentDueSweep, DEFAULT_INTERVAL_MS, LABELS };
