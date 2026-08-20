const express = require('express');
const os = require('node:os');
const crypto = require('node:crypto');
const QRCode = require('qrcode');
const core = require('../../core/index.js');
const { log } = require('../../core/log.js');
const { readPaymentSlip, stampWhen } = require('../discord/payment-evidence.js');

const { activities, users, access, tokens, money, format, voice, promptpay, notifications } = core;

// A slip photographed on a phone is a few hundred kilobytes once the browser
// has shrunk it. The ceiling is generous enough that nobody meets it by
// accident and low enough that nobody can post a video file to the database.
const SLIP_MAX_BYTES = 2 * 1024 * 1024;
const SLIP_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function decodeDataImage(dataUrl, { maxBytes = SLIP_MAX_BYTES } = {}) {
	const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(String(dataUrl || ''));
	if (!match) return null;
	const mime = match[1].toLowerCase();
	if (!SLIP_TYPES.has(mime)) return null;
	const image = Buffer.from(match[2], 'base64');
	if (image.length === 0 || image.length > maxBytes) return null;
	return { mime, image };
}

/**
 * Answer with a machine-readable code as well as a sentence.
 *
 * The sentence is a fallback: the browser knows which language the reader
 * chose and translates the code itself, so an error stops being the one part
 * of the interface that is always in whichever language the server was
 * written in.
 */
function fail(res, status, code, message) {
	return res.status(status).json({ error: message || code, code });
}

// Amounts are stored as integer minor units for every currently supported
// currency. `amountBaht` remains accepted so old clients do not break, while
// new clients use the currency-neutral `amount` name.
function requestAmountMinor(body = {}) {
	if (body.amountSatang != null) return Number(body.amountSatang);
	if (body.amount != null) return money.toSatang(body.amount);
	if (body.amountBaht != null) return money.toSatang(body.amountBaht);
	return undefined;
}

const DEVICE_COOKIE = 'megu_pt';
const DEVICE_MAX_AGE = 365 * 24 * 60 * 60 * 1000;

function isLoopbackHost(hostname) {
	return hostname === 'localhost' || hostname === '::1' || hostname === '0.0.0.0' || /^127\./.test(hostname);
}

async function discordUidForParticipant(participant) {
	if (participant?.discordUid) return participant.discordUid;
	if (!participant?.userId) return null;
	const identities = await users.getIdentities(participant.userId);
	return identities.find(identity => identity.provider === 'discord')?.providerUid || null;
}

async function discordUidForUser(userId) {
	if (!userId) return null;
	const identities = await users.getIdentities(userId);
	return identities.find(identity => identity.provider === 'discord')?.providerUid || null;
}

function isPrivateIpv4(address) {
	const octets = String(address).split('.').map(Number);
	if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
	return octets[0] === 10
		|| (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
		|| (octets[0] === 192 && octets[1] === 168);
}

/**
 * The address another device on this network can use to reach development.
 * Physical Ethernet/Wi-Fi adapters win over WSL, Docker and VPN adapters;
 * otherwise a copied link can point into a virtual network a phone cannot see.
 */
function preferredLanAddress() {
	const virtual = /(loopback|virtual|vethernet|wsl|docker|vmware|vbox|hyper-v|tailscale|vpn)/i;
	const physical = /(ethernet|wi-?fi|wireless|wlan)/i;
	const candidates = [];

	for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
		for (const address of addresses || []) {
			if (address.internal || address.family !== 'IPv4' || address.address.startsWith('169.254.')) continue;
			candidates.push({
				address: address.address,
				score: (isPrivateIpv4(address.address) ? 40 : 0)
					+ (physical.test(name) ? 20 : 0)
					- (virtual.test(name) ? 100 : 0),
			});
		}
	}

	return candidates.sort((a, b) => b.score - a.score)[0]?.address || null;
}

function shareDetails(
	req,
	configuredFrontendUrl,
	lanAddress = preferredLanAddress(),
	allowLanFallback = process.env.NODE_ENV !== 'production',
) {
	const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
	const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
	const requestOrigin = `${forwardedProto || req.protocol || 'http'}://${forwardedHost || req.get('host')}`;
	let url;

	try {
		url = new URL(configuredFrontendUrl || requestOrigin);
	}
	catch {
		url = new URL(requestOrigin);
	}

	// On a friend's phone, localhost means the friend's phone. In development,
	// replace it with the machine's LAN address before the link reaches chat.
	if (allowLanFallback && isLoopbackHost(url.hostname)) {
		if (lanAddress) url.hostname = lanAddress;
	}

	const reachability = isLoopbackHost(url.hostname)
		? 'device'
		: isPrivateIpv4(url.hostname) ? 'network' : 'public';

	return { origin: url.origin, reachability };
}

/**
 * Who is asking. A caller can be all three at once (signed in, on a known
 * browser, with a Discord identity) or none of them.
 */
function attachActor(req, res, next) {
	let deviceToken = tokens.verifyDeviceToken(req.cookies?.[DEVICE_COOKIE]);

	if (!deviceToken) {
		const issued = tokens.issueDeviceToken();
		deviceToken = tokens.verifyDeviceToken(issued);
		res.cookie(DEVICE_COOKIE, issued, {
			httpOnly: true,
			sameSite: 'lax',
			secure: process.env.NODE_ENV === 'production',
			maxAge: DEVICE_MAX_AGE,
		});
	}

	req.actor = {
		userId: req.session?.meguUserId || null,
		discordUid: req.session?.discordUser?.id || req.session?.user?.id || null,
		deviceToken,
		// Which language to answer in. It travels with the caller rather than
		// as a separate argument because Megu's own sentences are built on the
		// server, and every route that returns an activity returns one of them
		// — an extra parameter is a parameter somebody forgets to pass, and
		// forgetting it means a Thai sentence in the middle of an English page.
		//
		// The browser states its choice explicitly; the header is only a
		// fallback for callers that have not, such as the bot.
		lang: core.format.resolveLang(req.query?.lang || req.headers['accept-language']),
	};
	next();
}

function discordProfileFromSession(sessionUser) {
	if (!sessionUser?.id) return null;
	return {
		provider: 'discord',
		providerUid: String(sessionUser.id),
		username: sessionUser.username || null,
		displayName: sessionUser.global_name || sessionUser.username || 'Megu user',
		avatarUrl: sessionUser.avatar
			? `https://cdn.discordapp.com/avatars/${sessionUser.id}/${sessionUser.avatar}.${String(sessionUser.avatar).startsWith('a_') ? 'gif' : 'png'}?size=128`
			: null,
	};
}

function identityProfileFromSession(session) {
	if (session?.identity?.provider && session.identity.providerUid) return session.identity;
	return discordProfileFromSession(session?.discordUser || session?.user);
}

/**
 * Turn a Discord login session into a live Megu account.
 *
 * Sessions can outlive development database resets. Previously the mere
 * presence of `meguUserId` passed authentication even when that user row had
 * gone, so creating an activity surfaced a raw owner foreign-key error. The
 * Discord identity in the same session is enough to recover deterministically:
 * reuse its account when it exists, or recreate it when the database is new.
 */
async function ensureAccount(req) {
	if (req.actor?.userId) {
		const current = await users.getUser(req.actor.userId);
		if (current) return current;
	}

	const profile = identityProfileFromSession(req.session);
	if (!profile) {
		if (req.session) req.session.meguUserId = null;
		if (req.actor) req.actor.userId = null;
		return null;
	}

	const { user } = await users.loginWithIdentity(profile);
	if (!user) throw new Error('account_recovery_failed');

	req.session.meguUserId = user.id;
	req.actor.userId = user.id;
	await users.claimParticipants(user.id);
	return user;
}

async function requireAccount(req, res, next) {
	try {
		const user = await ensureAccount(req);
		if (!user) return fail(res, 401, 'session_expired', 'Sign in again to continue');
		next();
	}
	catch (error) {
		next(error);
	}
}

/**
 * Participant rows carry device tokens and Discord ids. Neither ever leaves
 * the server — the client only needs to know which row is "me".
 */
function publicParticipant(p, meId, showAmounts, settlementRow) {
	const out = {
		id: p.id,
		displayName: p.displayName,
		rsvp: p.rsvp,
		attended: p.attended,
		claimed: Boolean(p.claimedAt),
		isMe: p.id === meId,
	};
	if (showAmounts && settlementRow) {
		out.owes = settlementRow.owes;
		out.paidOut = settlementRow.paidOut;
		out.settled = settlementRow.settled;
		out.pending = settlementRow.pending;
		out.outstanding = settlementRow.outstanding;
		out.net = settlementRow.net;
	}
	return out;
}

/**
 * Megu reads whichever axis is actually asking for attention: money first when
 * someone is behind, the plan otherwise.
 */
function meguLineFor(activity, sum, period, lang = core.format.DEFAULT_LANG) {
	const seed = { seed: activity.id, lang };
	const when = activity.startsAt ? core.format.formatWhen(activity.startsAt, lang) : null;

	if (activity.planState === 'cancelled') return voice.say('cancelled', { title: activity.title }, seed);

	if (sum.state === 'open') {
		const first = sum.unpaid[0];
		return voice.say('nudgeUnpaid', { name: first.displayName, amount: first.outstanding }, seed);
	}

	if (sum.state === 'settled') {
		return activity.kind === 'recurring' && period
			? voice.say('recurringSettled', { title: activity.title, period: core.format.formatPeriod(period.key, lang) }, seed)
			: voice.say('allSettled', { title: activity.title }, seed);
	}

	if (activity.kind === 'recurring') return voice.say('nothingOwedYet', { title: activity.title }, seed);

	// A poll in progress is the loudest thing on the page: it is the decision
	// the group has been avoiding.
	if (activity.planState === 'open' && activity.slots.length > 0) {
		const silent = activity.participants
			.filter(p => !activity.slots.every(slot => activity.slotVotes.some(v => v.participantId === p.id && v.slotId === slot.id)))
			.map(p => p.displayName);
		if (silent.length > 0) return voice.say('pollWaiting', { names: silent }, seed);

		const winner = activities.bestSlot(activity);
		if (!winner || winner.yes + winner.maybe === 0) {
			return voice.say('pollDeadlocked', { title: activity.title }, seed);
		}
		return voice.say('pollDecided', {
			when: core.format.formatWhen(winner.startsAt, lang),
			count: winner.yes + winner.maybe,
		}, seed);
	}

	const waiting = activity.participants.filter(p => p.rsvp === 'pending').map(p => p.displayName);
	if (activity.planState === 'open') {
		return waiting.length > 0
			? voice.say('waitingOn', { names: waiting }, seed)
			: voice.say('askRsvp', { title: activity.title }, seed);
	}
	if (activity.planState === 'confirmed') {
		const going = activity.participants.filter(p => p.rsvp === 'yes').length;
		return voice.say('confirmed', {
			title: activity.title,
			when: when || voice.say('soon', {}, seed),
			count: going,
		}, seed);
	}
	return voice.say('activityCreated', { title: activity.title }, seed);
}

function serializeActivity(activity, actor, { periodId } = {}) {
	const lang = core.format.resolveLang(actor?.lang);
	const role = access.activityRole(actor, activity);
	const showAmounts = access.can(role, 'viewAmounts');
	const me = access.matchParticipant(actor, activity.participants);

	const period = activity.kind === 'recurring'
		? (activity.periods.find(p => p.id === periodId) || activities.currentPeriod(activity))
		: null;
	const scope = period ? period.id : null;

	const sum = activities.settlement(activity, scope);
	const byParticipant = Object.fromEntries(sum.rows.map(r => [r.participantId, r]));
	const inScope = row => (scope === null ? true : row.periodId === scope);
	const paymentInScope = payment => scope === null
		|| payment.periodId === scope
		|| payment.allocations?.some(allocation => allocation.periodId === scope);
	const allocatedAmount = payment => scope === null
		? payment.amountSatang
		: payment.allocations?.filter(allocation => allocation.periodId === scope)
			.reduce((subtotal, allocation) => subtotal + allocation.amountSatang, 0) || payment.amountSatang;
	const paymentOptions = availablePaymentOptions(activity);

	return {
		code: activity.code,
		shareUrl: actor?.shareOrigin ? `${actor.shareOrigin}/a/${encodeURIComponent(activity.code)}` : null,
		shareReachability: actor?.shareReachability || null,
		title: activity.title,
		kind: activity.kind,
		planState: activity.planState,
		moneyState: showAmounts ? sum.state : null,
		location: activity.location,
		startsAt: activity.startsAt,
		currency: activity.currency,
		recurrence: activity.recurrence,
		dueDay: activity.dueDay,
		createdAt: activity.createdAt,
		role,
		me: me ? { id: me.id, displayName: me.displayName, rsvp: me.rsvp } : null,
		megu: meguLineFor(activity, sum, period, lang),
		// `key` travels and `label` does not: a month's name is rendered by
		// the reader's browser in the reader's language, rather than frozen
		// into the row on whatever day the month happened to be opened.
		period: period ? { id: period.id, key: period.key, dueAt: period.dueAt } : null,
		poll: activity.slots.length > 0
			? {
				ready: activities.pollReady(activity),
				answered: activities.pollAnsweredCount(activity),
				myVotes: me
					? Object.fromEntries(activity.slotVotes.filter(v => v.participantId === me.id).map(v => [v.slotId, v.answer]))
					: {},
				slots: activities.slotStanding(activity).map(s => ({
					id: s.slotId,
					startsAt: s.startsAt,
					yes: s.yes,
					maybe: s.maybe,
					no: s.no,
					answered: s.answered,
				})),
			}
			: null,
		periods: activity.periods.map((p) => {
			const standing = me ? activities.settlement(activity, p.id).rows.find(row => row.participantId === me.id) : null;
			return {
				id: p.id,
				key: p.key,
				dueAt: p.dueAt,
				outstandingSatang: showAmounts && standing ? standing.outstanding : null,
				pendingSatang: showAmounts && standing ? standing.pending : null,
			};
		}),
		participants: activity.participants.map(p => publicParticipant(p, me?.id, showAmounts, byParticipant[p.id])),
		expenses: showAmounts
			? activity.expenses.filter(inScope).map(e => ({
				id: e.id,
				label: e.label,
				amountSatang: e.amountSatang,
				paidBy: e.paidBy,
				// The ledger already stores the exact split. Returning it with the
				// expense lets the page answer "whose dish was this?" without
				// recomputing from today's roster or RSVP state.
				shares: activity.shares
					.filter(s => s.expenseId === e.id)
					.map(s => ({ participantId: s.participantId, amountSatang: s.amountSatang })),
			}))
			: [],
		payments: showAmounts
			? activity.payments.filter(paymentInScope).map(p => ({
				id: p.id,
				participantId: p.participantId,
				amountSatang: allocatedAmount(p),
				transferAmountSatang: p.amountSatang,
				allocations: p.allocations,
				// What we asked for at the time. The owner's list prints it
				// beside the claimed figure when the two disagree, which is how
				// transferring ฿60 and typing ฿6 gets noticed.
				expectedSatang: p.expectedSatang,
				status: p.status,
				method: p.method,
				paymentDestination: p.paymentDestination,
				// Whether a slip exists, never the slip. The image is served by
				// the one route that checks who is asking.
				hasSlip: p.hasSlip,
				slipVerdict: p.slipVerdict,
				slipUploadedAt: p.slipUploadedAt,
				slipBank: p.slipBank,
				slipAmountSatang: p.slipAmountSatang,
				slipWhen: p.slipWhen,
				slipSenderName: p.slipSenderName,
				slipReceiverName: p.slipReceiverName,
				slipSenderAccountTail: p.slipSenderAccountTail,
				slipReceiverAccountTail: p.slipReceiverAccountTail,
				confirmationSource: p.confirmationSource,
				verificationLevel: p.verificationLevel,
				reversalReason: p.reversalReason,
				reversedAt: p.reversedAt,
				events: role === 'owner' ? p.events : undefined,
				createdAt: p.createdAt,
			}))
			: [],
		totals: showAmounts
			? { total: sum.total, unpaidCount: sum.unpaid.length, fullySettled: sum.fullySettled }
			: null,

		// Where the money goes.
		//
		// `masked` is what the page prints; `number` is what the copy button
		// puts on the clipboard. They are separated because a full phone
		// number rendered on screen ends up in screenshots and shared Discord
		// windows, and there is no reason for it to be visible when what the
		// reader needs is to paste it into a banking app.
		//
		// Both are gated on `showAmounts`, so someone holding a forwarded link
		// who is not on the roster gets neither — the same rule that already
		// hides what everyone owes.
		paymentOptions: showAmounts ? paymentOptions : [],
		payTo: showAmounts && activity.payee
			? {
				participantId: activity.payee.participantId,
				displayName: activity.payee.displayName,
				accountName: activity.payee.promptpayName || null,
				masked: activity.payee.promptpayId ? promptpay.maskTarget(activity.payee.promptpayId) : null,
				number: activity.payee.promptpayId || null,
				ready: paymentOptions.length > 0,
				isMe: Boolean(me && me.id === activity.payee.participantId),
			}
			: null,
	};
}

function availablePaymentOptions(activity) {
	const options = [];
	if (activity.currency === 'THB' && activity.payee?.promptpayId) {
		options.push({
			id: `profile-promptpay-${activity.payee.participantId}`,
			type: 'promptpay',
			label: 'PromptPay',
			destination: activity.payee.promptpayId,
			masked: promptpay.maskTarget(activity.payee.promptpayId),
			accountName: activity.payee.promptpayName || null,
			instructions: null,
			url: null,
			source: 'profile',
		});
	}
	for (const option of activity.paymentOptions || []) {
		options.push({ ...option, source: 'activity' });
	}
	return options;
}

/**
 * @param {object} deps
 * @param {(guildIds: string[]) => Promise<string[]>} [deps.botPresence]
 *        Which of these guilds the bot is actually in. Supplied by the host
 *        because it needs IPC to the bot process.
 * @param {(notice: {recipients: string[], message: string}) => Promise<void>} [deps.notifyPayment]
 *        Sends private Discord notices through the separately-running bot.
 */
function router(deps = {}) {
	const api = express.Router();
	api.use(attachActor);
	api.use((req, res, next) => {
		const share = shareDetails(req, deps.frontendUrl ?? process.env.FRONTEND_URL);
		req.actor.shareOrigin = share.origin;
		req.actor.shareReachability = share.reachability;
		next();
	});

	api.get('/me', async (req, res, next) => {
		let account;
		try {
			account = await ensureAccount(req);
		}
		catch (error) {
			return next(error);
		}
		if (!account) return res.json({ loggedIn: false, user: null, servers: [] });

		const user = await users.getUserWithIdentities(account.id);
		const notificationPreferences = await users.getNotificationPreferences(account.id);
		const myGuilds = req.session?.allGuilds || [];

		let botGuildIds = [];
		if (deps.botPresence && myGuilds.length > 0) {
			botGuildIds = await deps.botPresence(myGuilds.map(g => g.id)).catch(() => []);
		}

		res.json({ loggedIn: true, user, notificationPreferences, servers: access.visibleServers(myGuilds, botGuildIds) });
	});

	// Where this person wants to be paid. Their own account, their own bank —
	// Megu prints the address on a QR and never stands between the two ends of
	// the transfer.
	api.patch('/me', requireAccount, async (req, res, next) => {
		try {
			const body = req.body || {};
			let user;
			if (Object.prototype.hasOwnProperty.call(body, 'displayName')) {
				user = await users.setDisplayName(req.actor.userId, body.displayName);
			}
			if (Object.prototype.hasOwnProperty.call(body, 'promptpayId')) {
				user = await users.setPromptPay(req.actor.userId, {
					promptpayId: body.promptpayId,
					promptpayName: body.promptpayName,
				});
			}
			let notificationPreferences;
			if (Object.prototype.hasOwnProperty.call(body, 'notificationMode') || Object.prototype.hasOwnProperty.call(body, 'notificationLocale')) {
				const current = await users.getNotificationPreferences(req.actor.userId);
				notificationPreferences = await users.setNotificationPreferences(req.actor.userId, {
					mode: body.notificationMode || current.mode,
					locale: body.notificationLocale || current.locale,
				});
			}
			if (!user) user = await users.getUser(req.actor.userId);
			res.json({ user, notificationPreferences });
		}
		catch (error) {
			if (['promptpay_unrecognised', 'promptpay_missing', 'display_name_required', 'display_name_too_long',
				'notification_mode_invalid', 'notification_locale_invalid', 'notification_discord_unavailable',
				'notification_email_unavailable'].includes(error.message)) {
				return fail(res, 400, error.message);
			}
			next(error);
		}
	});

	api.get('/activities', requireAccount, async (req, res) => {
		const list = await activities.listActivitiesForOwner(req.actor.userId, {
			includeClosed: req.query.includeClosed !== 'false',
		});
		res.json({ activities: list });
	});

	api.post('/activities', requireAccount, async (req, res, next) => {
		try {
			const {
				title, kind = 'event', location, startsAt, guildId, channelId, participants,
				ownerParticipation = true, ownerDisplayName, saveOwnerDisplayName = false,
				currency = 'THB', initialPayerPosition = 0,
			} = req.body || {};
			if (!title || !String(title).trim()) {
				return fail(res, 400, 'title_required');
			}

			const incoming = Array.isArray(participants) ? participants.slice(0, 50) : [];
			const owner = await users.getUser(req.actor.userId);
			const suppliedOwner = incoming.find(p => p?.userId === req.actor.userId);
			const joins = ownerParticipation !== false;
			const roster = incoming
				.filter(p => p?.userId !== req.actor.userId)
				.map(p => ({ displayName: p?.displayName, discordUid: p?.discordUid || null }));
			if (joins) {
				const chosenName = ownerDisplayName || suppliedOwner?.displayName || owner?.displayName;
				roster.unshift({ displayName: chosenName, userId: req.actor.userId });
				if (saveOwnerDisplayName) await users.setDisplayName(req.actor.userId, chosenName);
			}
			if (roster.length === 0) return fail(res, 400, 'participant_required');

			const recurring = kind === 'recurring';
			const activity = await activities.createActivity({
				ownerUserId: req.actor.userId,
				title,
				kind,
				location: location || null,
				startsAt: startsAt ? new Date(startsAt) : null,
				currency,
				guildId: guildId || null,
				channelId: channelId || null,
				recurrence: recurring ? 'monthly' : null,
				dueDay: recurring ? Number(req.body.dueDay) || 1 : null,
				participants: roster,
			});

			// A monthly agreement starts billing immediately: open this month and,
			// when an amount was given, split it straight away.
			if (recurring) {
				const { period } = await activities.ensurePeriod(activity.id);
				const amountMinor = requestAmountMinor(req.body);
				if (amountMinor > 0) {
					const full = await activities.getActivity(activity.id);
					const position = Number(initialPayerPosition);
					const payer = full.participants[Number.isInteger(position) ? position : 0] || full.participants[0];
					await activities.addExpense(activity.id, {
						label: title,
						amountSatang: amountMinor,
						paidBy: payer.id,
						periodId: period.id,
					});
					await activities.setPayee(activity.id, payer.id);
				}
			}

			const full = await activities.getActivity(activity.id);
			res.status(201).json({ activity: serializeActivity(full, req.actor) });
		}
		catch (error) {
			if (['display_name_required', 'display_name_too_long', 'currency_not_supported'].includes(error.code || error.message)) {
				return fail(res, 400, error.code || error.message);
			}
			next(error);
		}
	});

	api.delete('/me/identities/:provider', requireAccount, async (req, res, next) => {
		try {
			const result = await users.unlinkIdentity(req.actor.userId, req.params.provider);
			if (!result.unlinked) return fail(res, 409, result.reason === 'last-identity' ? 'last_identity' : 'identity_not_linked');
			const identities = await users.getIdentities(req.actor.userId);
			const current = await users.getNotificationPreferences(req.actor.userId);
			const hasDiscord = identities.some(identity => identity.provider === 'discord');
			const hasEmail = identities.some(identity => identity.provider === 'google' && identity.emailVerified && identity.email);
			if ((['discord', 'both'].includes(current.mode) && !hasDiscord) || (['email', 'both'].includes(current.mode) && !hasEmail)) {
				await users.setNotificationPreferences(req.actor.userId, {
					mode: hasDiscord ? 'discord' : hasEmail ? 'email' : 'off',
					locale: current.locale,
				});
			}
			if (req.params.provider === 'discord') {
				await core.oauthCredentials.remove(req.actor.userId, 'discord');
				delete req.session.user;
				delete req.session.discordUser;
				req.session.allGuilds = [];
				req.session.adminGuilds = [];
			}
			req.session.identity = identities[0] || null;
			res.json({ identities });
		}
		catch (error) { next(error); }
	});

	api.get('/a/:code', async (req, res, next) => {
		try {
			const activity = await activities.getActivityByCode(req.params.code);
			if (!activity) return fail(res, 404, 'notFound');
			res.json({ activity: serializeActivity(activity, req.actor, { periodId: req.query.period }) });
		}
		catch (error) {
			next(error);
		}
	});

	// "ผมคือโอม" — binds this browser (and account, if signed in) to a roster row.
	api.post('/a/:code/claim', async (req, res, next) => {
		try {
			const activity = await activities.getActivityByCode(req.params.code);
			if (!activity) return fail(res, 404, 'notFound');

			const target = activity.participants.find(p => p.id === req.body?.participantId);
			if (!target) return fail(res, 400, 'participant_not_in_activity');

			const alreadyMine = access.matchParticipant(req.actor, activity.participants);
			if (alreadyMine && alreadyMine.id !== target.id) {
				return fail(res, 409, 'device_already_claimed');
			}
			if (target.claimedAt && !access.matchParticipant(req.actor, [target])) {
				return fail(res, 409, 'participant_already_claimed');
			}

			await activities.claimParticipant(target.id, req.actor);
			const full = await activities.getActivity(activity.id);
			res.json({ activity: serializeActivity(full, req.actor) });
		}
		catch (error) {
			next(error);
		}
	});

	api.post('/a/:code/rsvp', async (req, res, next) => {
		try {
			const activity = await activities.getActivityByCode(req.params.code);
			if (!activity) return fail(res, 404, 'notFound');

			const me = access.matchParticipant(req.actor, activity.participants);
			if (!me) return fail(res, 403, 'claim_your_name_first');

			await activities.setRsvp(me.id, req.body?.rsvp);
			const full = await activities.getActivity(activity.id);
			res.json({ activity: serializeActivity(full, req.actor) });
		}
		catch (error) {
			next(error);
		}
	});

	/**
	 * What this caller is being asked for, on this activity, right now.
	 *
	 * Both the QR and the payment claim need the same three answers — who is
	 * asking, which month, and how much is outstanding — and getting them out
	 * of step would mean scanning a QR for one amount and claiming another.
	 */
	async function payContext(req, res) {
		const activity = await activities.getActivityByCode(req.params.code);
		if (!activity) {
			fail(res, 404, 'notFound');
			return null;
		}

		const role = access.activityRole(req.actor, activity);
		if (!access.can(role, 'viewAmounts')) {
			fail(res, 403, 'not_on_this_activity');
			return null;
		}

		const me = access.matchParticipant(req.actor, activity.participants);
		const period = activity.kind === 'recurring'
			? (activity.periods.find(p => p.id === (req.body?.periodId || req.query?.period)) || activities.currentPeriod(activity))
			: null;
		const scope = period ? period.id : null;

		const sum = activities.settlement(activity, scope);
		const row = me ? sum.rows.find(r => r.participantId === me.id) : null;

		const outstanding = row?.outstanding || 0;
		const pending = row?.pending || 0;
		return {
			activity, role, me, period, scope, sum, row,
			outstanding,
			available: Math.max(0, outstanding - pending),
		};
	}

	/**
	 * The QR itself, as an image.
	 *
	 * A route rather than a data URL inside the activity JSON, for two reasons
	 * a reader will feel: an <img> can be long-pressed and saved to the photo
	 * library — which is how anyone paying from the same phone they are reading
	 * on gets the code into their banking app — and a page that is not showing
	 * a QR does not pay to build one.
	 *
	 * It is never cached: it encodes a specific amount owed by a specific
	 * person, and both change.
	 */
	api.get('/a/:code/qr', async (req, res, next) => {
		try {
			const ctx = await payContext(req, res);
			if (!ctx) return;

			const methods = availablePaymentOptions(ctx.activity);
			const selected = methods.find(option => option.id === req.query.method)
				|| methods.find(option => option.type === 'promptpay');
			if (!selected || selected.type !== 'promptpay') return fail(res, 404, 'promptpay_missing');

			const requested = Number(req.query.amount);
			const amount = Number.isInteger(requested) && requested > 0 ? requested : ctx.outstanding;
			if (amount <= 0) return fail(res, 400, 'nothing_outstanding');

			const payload = promptpay.buildPayload(selected.destination, amount);
			const png = await QRCode.toBuffer(payload, {
				type: 'png',
				errorCorrectionLevel: 'M',
				margin: 2,
				width: 640,
				color: { dark: '#000000', light: '#FFFFFF' },
			});

			res.setHeader('Content-Type', 'image/png');
			res.setHeader('Cache-Control', 'private, no-store');
			res.setHeader('Content-Disposition', `inline; filename="megu-${ctx.activity.code}-${amount}.png"`);
			res.send(png);
		}
		catch (error) {
			if (error.message === 'promptpay_unrecognised') return fail(res, 400, error.message);
			next(error);
		}
	});

	// A payment claim from a participant lands as pending on purpose.
	api.post('/a/:code/pay', async (req, res, next) => {
		try {
			const ctx = await payContext(req, res);
			if (!ctx) return;
			if (!ctx.me) return fail(res, 403, 'claim_your_name_first');

			let allocations;
			if (Array.isArray(req.body?.allocations) && req.body.allocations.length > 0) {
				if (ctx.activity.kind !== 'recurring') return fail(res, 400, 'allocations_event_not_allowed');
				allocations = [];
				const seen = new Set();
				for (const requested of req.body.allocations) {
					const period = ctx.activity.periods.find(item => item.id === requested?.periodId);
					if (!period || seen.has(period.id)) return fail(res, 400, 'payment_allocation_invalid');
					seen.add(period.id);
					const standing = activities.settlement(ctx.activity, period.id).rows
						.find(item => item.participantId === ctx.me.id);
					const available = Math.max(0, (standing?.outstanding || 0) - (standing?.pending || 0));
					const allocationAmount = Number(requested.amountSatang);
					if (!Number.isSafeInteger(allocationAmount) || allocationAmount <= 0 || allocationAmount > available) {
						return fail(res, 400, 'payment_allocation_exceeds_outstanding');
					}
					allocations.push({ periodId: period.id, amountSatang: allocationAmount });
				}
			}
			else {
				allocations = [{ periodId: ctx.scope, amountSatang: ctx.available }];
			}

			const amount = allocations.reduce((sum, allocation) => sum + allocation.amountSatang, 0);
			if (amount <= 0) return fail(res, 400, 'nothing_outstanding');
			const methods = availablePaymentOptions(ctx.activity);
			const requestedMethod = req.body?.paymentMethodId;
			const selected = requestedMethod
				? methods.find(option => option.id === requestedMethod) || null
				: methods[0] || null;
			if (requestedMethod && !selected) return fail(res, 400, 'payment_option_invalid');

			const payment = await activities.recordPayment(ctx.activity.id, ctx.me.id, {
				amountSatang: amount,
				method: selected?.type || 'manual',
				periodId: allocations.length === 1 ? allocations[0].periodId : null,
				allocations,
				// What was asked for, and where we sent them. Kept on the row so
				// the record still explains itself after the expense is corrected
				// or the owner changes their number.
				expectedSatang: amount,
				promptpayTarget: selected?.type === 'promptpay' ? selected.destination : null,
				paymentDestination: selected ? {
					id: selected.id,
					type: selected.type,
					label: selected.label,
					destination: selected.destination || null,
					accountName: selected.accountName || null,
					url: selected.url || null,
					instructions: selected.instructions || null,
				} : null,
			});

			const full = await activities.getActivity(ctx.activity.id);
			res.json({
				paymentId: payment.id,
				activity: serializeActivity(full, req.actor, { periodId: ctx.scope }),
			});
		}
		catch (error) {
			next(error);
		}
	});

	// Cash and other in-person handoffs have no bank slip. They count only
	// because the owner explicitly records receipt; the verification level says
	// exactly that rather than making them look like matched transfers.
	api.post('/a/:code/payments/manual', requireAccount, async (req, res, next) => {
		try {
			const activity = await ownerOnly(req, res);
			if (!activity) return;
			const participant = activity.participants.find(item => item.id === req.body?.participantId);
			if (!participant) return fail(res, 400, 'participant_not_in_activity');
			const period = activity.kind === 'recurring'
				? activity.periods.find(item => item.id === req.body?.periodId)
					|| activities.currentPeriod(activity)
				: null;
			const standing = activities.settlement(activity, period?.id || null).rows
				.find(item => item.participantId === participant.id);
			const available = Math.max(0, (standing?.outstanding || 0) - (standing?.pending || 0));
			const amountSatang = Number(req.body?.amountSatang);
			if (!Number.isSafeInteger(amountSatang) || amountSatang <= 0 || amountSatang > available) {
				return fail(res, 400, 'manual_payment_exceeds_outstanding');
			}

			await activities.recordPayment(activity.id, participant.id, {
				amountSatang,
				method: 'cash',
				periodId: period?.id || null,
				expectedSatang: amountSatang,
				confirmation: {
					actorUserId: req.actor.userId,
					source: 'owner_cash',
					verificationLevel: 'owner_confirmed',
					reason: String(req.body?.reason || 'รับเงินสดแล้ว').slice(0, 300),
				},
			});

			const full = await activities.getActivity(activity.id);
			if (participant.userId) {
				const recorded = [...full.payments].reverse().find(item => item.participantId === participant.id && item.method === 'cash' && item.amountSatang === amountSatang);
				await notifications.enqueue({
					userId: participant.userId,
					eventType: 'payment_recorded',
					dedupeKey: `payment-recorded:${recorded?.id || `${activity.id}:${participant.id}:${amountSatang}`}`,
					payload: {
						activityTitle: activity.title,
						subjectEn: `Payment recorded · ${activity.title}`,
						subjectTh: `บันทึกรับเงินแล้ว · ${activity.title}`,
						bodyEn: `The organizer recorded an offline payment of ${format.formatMoney(amountSatang, activity.currency)}.`,
						bodyTh: `เจ้าของบันทึกว่าได้รับเงินนอกระบบ ${format.formatMoney(amountSatang, activity.currency)} แล้ว`,
						ctaUrl: `${req.actor.shareOrigin}/a/${activity.code}`,
					},
				}).catch(() => undefined);
			}
			else if (deps.notifyPayment) {
				const payerDiscordUid = await discordUidForParticipant(participant);
				if (payerDiscordUid) {
					await deps.notifyPayment({
						recipients: [payerDiscordUid],
						message: `💵 **${activity.title}** · ${format.formatMoney(amountSatang, activity.currency)}\nเจ้าของบันทึกว่าได้รับเงินนอกระบบแล้ว\n${req.actor.shareOrigin}/a/${activity.code}`,
					}).catch(() => undefined);
				}
			}
			res.json({ activity: serializeActivity(full, req.actor, { periodId: period?.id }) });
		}
		catch (error) {
			next(error);
		}
	});

	/**
	 * Attach the slip to a claim already made.
	 *
	 * The image arrives base64 in JSON rather than as multipart, because the
	 * browser has already decoded, downscaled and re-encoded it to keep a 4MB
	 * phone photo off the wire — at which point it is a string, and adding a
	 * multipart parser to the stack would buy nothing.
	 *
	 * Browser OCR is only a local preview. The server reads the uploaded pixels
	 * again, derives the checksummed reference itself, and renders the long-term
	 * evidence card from that server-side reading. Otherwise a caller could edit
	 * the JSON amount or receiver name and manufacture an automatic match.
	 */
	api.post('/a/:code/payments/:paymentId/slip', async (req, res, next) => {
		try {
			const activity = await activities.getActivityByCode(req.params.code);
			if (!activity) return fail(res, 404, 'notFound');

			const payment = activity.payments.find(p => p.id === req.params.paymentId);
			if (!payment) return fail(res, 404, 'payment_not_found');

			// Only the person the claim belongs to, or the owner correcting it.
			const me = access.matchParticipant(req.actor, activity.participants);
			const isOwner = access.activityRole(req.actor, activity) === 'owner';
			if (!isOwner && payment.participantId !== me?.id) return fail(res, 403, 'not_your_payment');

			const { dataUrl } = req.body || {};
			const original = decodeDataImage(dataUrl);
			if (!original) return fail(res, 400, 'slip_unreadable');

			const serverReader = deps.readPaymentSlip || readPaymentSlip;
			const serverResult = await serverReader(original.image);
			const verifiedQr = serverResult?.slip || null;
			const serverRead = serverResult?.read || {};
			const sender = serverRead.parties?.sender || null;
			const receiver = serverRead.parties?.receiver || null;
			const readAmount = Number(serverRead.amountSatang);
			const normalizedReadAmount = Number.isSafeInteger(readAmount) && readAmount > 0 ? readAmount : null;
			const readWhen = stampWhen(serverRead.when);
			const evidenceImage = serverResult?.evidenceImage || null;

			const result = await activities.attachSlip(payment.id, {
				image: serverResult?.normalizedImage || original.image,
				mime: serverResult?.normalizedMime || original.mime,
				evidenceImage,
				evidenceMime: 'image/png',
				evidenceHash: evidenceImage ? crypto.createHash('sha256').update(evidenceImage).digest('hex') : null,
				ref: verifiedQr?.ref || null,
				bank: verifiedQr?.bank?.code || null,
				amountSatang: normalizedReadAmount,
				when: readWhen,
				senderName: sender?.name ? String(sender.name).slice(0, 160) : null,
				receiverName: receiver?.name ? String(receiver.name).slice(0, 160) : null,
				senderAccountTail: sender?.accountTail || null,
				receiverAccountTail: receiver?.accountTail || null,
				expectedReceiverName: payment.paymentDestination?.accountName || activity.payee?.promptpayName || null,
			});

			const full = await activities.getActivity(activity.id);
			const paymentParticipant = activity.participants.find(participant => participant.id === payment.participantId);
			if (activity.ownerUserId && paymentParticipant?.userId !== activity.ownerUserId) {
				const amount = format.formatMoney(payment.amountSatang, activity.currency);
				await notifications.enqueue({
					userId: activity.ownerUserId,
					eventType: result.autoConfirmed ? 'payment_auto_confirmed' : 'payment_submitted',
					dedupeKey: `payment-slip:${payment.id}:${result.status}`,
					payload: {
						activityTitle: activity.title,
						subjectEn: `Payment update · ${activity.title}`,
						subjectTh: `อัปเดตการจ่ายเงิน · ${activity.title}`,
						bodyEn: `${amount} was submitted.${result.autoConfirmed ? ' Megu matched and confirmed the slip automatically.' : ' It is waiting for your review.'}`,
						bodyTh: `มีคนแจ้งจ่าย ${amount}${result.autoConfirmed ? ' ระบบจับคู่และลงยอดให้อัตโนมัติแล้ว' : ' กำลังรอคุณตรวจสอบ'}`,
						ctaUrl: `${req.actor.shareOrigin}/a/${activity.code}`,
					},
				}).catch(() => undefined);
			}
			else if (deps.notifyPayment) {
				const ownerDiscordUid = await discordUidForUser(activity.ownerUserId);
				const payerDiscordUid = await discordUidForParticipant(
					activity.participants.find(participant => participant.id === payment.participantId),
				);
				if (ownerDiscordUid && ownerDiscordUid !== payerDiscordUid) {
					const amount = format.formatMoney(payment.amountSatang, activity.currency);
					const link = `${req.actor.shareOrigin}/a/${activity.code}`;
					const decision = result.autoConfirmed
						? 'Megu จับคู่สลิปและลงยอดให้อัตโนมัติแล้ว หากเงินไม่เข้าจริงให้ย้อนผลในเว็บพร้อมเหตุผล'
						: `ยังรอตรวจด้วยตนเอง (${result.reasons.join(', ') || 'ข้อมูลไม่ครบ'})`;
					await deps.notifyPayment({
						recipients: [ownerDiscordUid],
						message: `💸 มีคนแจ้งจ่าย ${amount} · **${activity.title}**\n${decision}\n${link}`,
					}).catch(() => undefined);
				}
			}
			res.json({
				verdict: result.verdict,
				status: result.status,
				autoConfirmed: result.autoConfirmed,
				reasons: result.reasons,
				flags: result.flags,
				activity: serializeActivity(full, req.actor, { periodId: payment.periodId || undefined }),
			});
		}
		catch (error) {
			if (error.code === 'slip_duplicate') return fail(res, 409, 'slip_duplicate');
			if (error.message === 'slip_unreadable') return fail(res, 400, 'slip_unreadable');
			next(error);
		}
	});

	/**
	 * Serve a slip back.
	 *
	 * This is somebody's bank document — it carries an account name and part of
	 * an account number — so it is readable by exactly two people: the person
	 * who sent it, and the person who is owed the money. Not the rest of the
	 * roster, and not anyone holding the link.
	 */
	api.get('/a/:code/payments/:paymentId/slip', async (req, res, next) => {
		try {
			const activity = await activities.getActivityByCode(req.params.code);
			if (!activity) return fail(res, 404, 'notFound');

			const payment = activity.payments.find(p => p.id === req.params.paymentId);
			if (!payment) return fail(res, 404, 'payment_not_found');

			const me = access.matchParticipant(req.actor, activity.participants);
			const isOwner = access.activityRole(req.actor, activity) === 'owner';
			const isPayee = me && activity.payee && me.id === activity.payee.participantId;
			if (!isOwner && !isPayee && payment.participantId !== me?.id) {
				return fail(res, 403, 'not_your_slip');
			}

			const storedSlip = await activities.getSlip(payment.id);
			if (!storedSlip) return fail(res, 404, 'no_slip');

			res.setHeader('Content-Type', storedSlip.mime);
			res.setHeader('Cache-Control', 'private, no-store');
			res.send(storedSlip.image);
		}
		catch (error) {
			next(error);
		}
	});

	// Point the money at someone other than the owner — whoever actually
	// fronted it is the one owed it.
	api.post('/a/:code/payee', requireAccount, async (req, res, next) => {
		try {
			const activity = await ownerOnly(req, res);
			if (!activity) return;

			await activities.setPayee(activity.id, req.body?.participantId || null);
			const full = await activities.getActivity(activity.id);
			res.json({ activity: serializeActivity(full, req.actor) });
		}
		catch (error) {
			if (error.message === 'participant_not_in_activity') return fail(res, 400, error.message);
			next(error);
		}
	});

	api.put('/a/:code/payment-options', requireAccount, async (req, res, next) => {
		try {
			const activity = await ownerOnly(req, res);
			if (!activity) return;
			await activities.updateActivity(activity.id, { paymentOptions: req.body?.paymentOptions || [] });
			const full = await activities.getActivity(activity.id);
			res.json({ activity: serializeActivity(full, req.actor) });
		}
		catch (error) {
			if (['payment_option_invalid', 'payment_link_invalid', 'payment_destination_required'].includes(error.code || error.message)) {
				return fail(res, 400, error.code || error.message);
			}
			next(error);
		}
	});

	async function ownerOnly(req, res, nextFn) {
		const activity = await activities.getActivityByCode(req.params.code);
		if (!activity) {
			fail(res, 404, 'notFound');
			return null;
		}
		if (access.activityRole(req.actor, activity) !== 'owner') {
			fail(res, 403, 'owner_only');
			return null;
		}
		if (nextFn) nextFn();
		return activity;
	}

	api.post('/a/:code/participants', requireAccount, async (req, res, next) => {
		try {
			const activity = await ownerOnly(req, res);
			if (!activity) return;
			await activities.addParticipant(activity.id, {
				displayName: req.body?.displayName,
				discordUid: req.body?.discordUid || null,
			});
			const full = await activities.getActivity(activity.id);
			res.json({ activity: serializeActivity(full, req.actor) });
		}
		catch (error) {
			next(error);
		}
	});

	// ── corrections ─────────────────────────────────────────────────────────
	// Everything above creates; everything here fixes. A ledger nobody can
	// correct is a ledger nobody can trust.

	api.patch('/a/:code', requireAccount, async (req, res, next) => {
		try {
			const activity = await ownerOnly(req, res);
			if (!activity) return;
			await activities.updateActivity(activity.id, {
				title: req.body?.title,
				location: req.body?.location,
				startsAt: req.body?.startsAt ? new Date(req.body.startsAt) : undefined,
				dueDay: req.body?.dueDay,
			});
			const full = await activities.getActivity(activity.id);
			res.json({ activity: serializeActivity(full, req.actor) });
		}
		catch (error) {
			next(error);
		}
	});

	api.patch('/a/:code/participants/:participantId', requireAccount, async (req, res, next) => {
		try {
			const activity = await ownerOnly(req, res);
			if (!activity) return;
			const target = activity.participants.find(p => p.id === req.params.participantId);
			if (!target) return fail(res, 404, 'participant_not_in_activity');

			if (req.body?.displayName) await activities.renameParticipant(target.id, req.body.displayName);
			if (req.body?.resetClaim) await activities.resetClaim(target.id);
			if (req.body?.rsvp) await activities.setRsvp(target.id, req.body.rsvp);
			if (req.body?.attended !== undefined) await activities.setAttended(target.id, req.body.attended);

			const full = await activities.getActivity(activity.id);
			res.json({ activity: serializeActivity(full, req.actor) });
		}
		catch (error) {
			next(error);
		}
	});

	api.delete('/a/:code/participants/:participantId', requireAccount, async (req, res, next) => {
		try {
			const activity = await ownerOnly(req, res);
			if (!activity) return;
			if (!activity.participants.some(p => p.id === req.params.participantId)) {
				return fail(res, 404, 'participant_not_in_activity');
			}
			await activities.removeParticipant(req.params.participantId);
			const full = await activities.getActivity(activity.id);
			res.json({ activity: serializeActivity(full, req.actor) });
		}
		catch (error) {
			next(error);
		}
	});

	api.patch('/a/:code/expenses/:expenseId', requireAccount, async (req, res, next) => {
		try {
			const activity = await ownerOnly(req, res);
			if (!activity) return;
			const expense = activity.expenses.find(e => e.id === req.params.expenseId);
			if (!expense) return fail(res, 404, 'expense_not_found');

			const amountSatang = requestAmountMinor(req.body);

			await activities.updateExpense(expense.id, {
				label: req.body?.label,
				amountSatang,
				paidBy: req.body?.paidBy,
				shareParticipantIds: req.body?.shareParticipantIds,
			});
			const full = await activities.getActivity(activity.id);
			res.json({ activity: serializeActivity(full, req.actor, { periodId: expense.periodId }) });
		}
		catch (error) {
			next(error);
		}
	});

	api.delete('/a/:code/expenses/:expenseId', requireAccount, async (req, res, next) => {
		try {
			const activity = await ownerOnly(req, res);
			if (!activity) return;
			const expense = activity.expenses.find(e => e.id === req.params.expenseId);
			if (!expense) return fail(res, 404, 'expense_not_found');
			await activities.removeExpense(expense.id);
			const full = await activities.getActivity(activity.id);
			res.json({ activity: serializeActivity(full, req.actor, { periodId: expense.periodId }) });
		}
		catch (error) {
			next(error);
		}
	});

	api.delete('/a/:code/payments/:paymentId', requireAccount, async (req, res, next) => {
		try {
			const activity = await ownerOnly(req, res);
			if (!activity) return;
			const payment = activity.payments.find(p => p.id === req.params.paymentId);
			if (!payment) return fail(res, 404, 'payment_not_found');
			await activities.removePayment(payment.id, req.actor.userId, req.body?.reason || 'owner_removed_claim');
			const full = await activities.getActivity(activity.id);
			res.json({ activity: serializeActivity(full, req.actor, { periodId: payment.periodId }) });
		}
		catch (error) {
			next(error);
		}
	});

	api.post('/a/:code/expenses', requireAccount, async (req, res, next) => {
		try {
			const activity = await ownerOnly(req, res);
			if (!activity) return;

			const amountSatang = requestAmountMinor(req.body);

			const period = activity.kind === 'recurring'
				? (activity.periods.find(p => p.id === req.body?.periodId) || activities.currentPeriod(activity))
				: null;

			await activities.addExpense(activity.id, {
				label: req.body?.label,
				amountSatang,
				paidBy: req.body?.paidBy,
				shareParticipantIds: req.body?.shareParticipantIds || null,
				periodId: period ? period.id : null,
			});
			const full = await activities.getActivity(activity.id);
			res.json({ activity: serializeActivity(full, req.actor, { periodId: period?.id }) });
		}
		catch (error) {
			next(error);
		}
	});

	// Anyone on the roster votes; only the owner proposes or locks.
	api.post('/a/:code/slots/vote', async (req, res, next) => {
		try {
			const activity = await activities.getActivityByCode(req.params.code);
			if (!activity) return fail(res, 404, 'notFound');

			const me = access.matchParticipant(req.actor, activity.participants);
			if (!me) return fail(res, 403, 'claim_your_name_first');

			for (const [slotId, answer] of Object.entries(req.body?.votes || {})) {
				if (!activity.slots.some(s => s.id === slotId)) continue;
				await activities.voteSlot(slotId, me.id, answer);
			}

			const full = await activities.getActivity(activity.id);
			res.json({ activity: serializeActivity(full, req.actor) });
		}
		catch (error) {
			next(error);
		}
	});

	api.post('/a/:code/slots', requireAccount, async (req, res, next) => {
		try {
			const activity = await ownerOnly(req, res);
			if (!activity) return;
			await activities.proposeSlots(activity.id, req.body?.startTimes);
			const full = await activities.getActivity(activity.id);
			res.json({ activity: serializeActivity(full, req.actor) });
		}
		catch (error) {
			next(error);
		}
	});

	api.post('/a/:code/slots/lock', requireAccount, async (req, res, next) => {
		try {
			const activity = await ownerOnly(req, res);
			if (!activity) return;
			const winner = await activities.lockBestSlot(activity.id);
			const full = await activities.getActivity(activity.id);
			res.json({ activity: serializeActivity(full, req.actor), winner });
		}
		catch (error) {
			next(error);
		}
	});

	api.post('/a/:code/plan', requireAccount, async (req, res, next) => {
		try {
			const activity = await ownerOnly(req, res);
			if (!activity) return;
			await activities.setPlanState(activity.id, req.body?.planState);
			const full = await activities.getActivity(activity.id);
			res.json({ activity: serializeActivity(full, req.actor) });
		}
		catch (error) {
			next(error);
		}
	});

	// Roll a monthly agreement into the next month and bill it.
	api.post('/a/:code/periods', requireAccount, async (req, res, next) => {
		try {
			const activity = await ownerOnly(req, res);
			if (!activity) return;
			if (activity.kind !== 'recurring') {
				return fail(res, 400, 'recurring_only');
			}

			const { period, created } = await activities.ensurePeriod(activity.id, req.body?.date ? new Date(req.body.date) : new Date());

			const amountMinor = requestAmountMinor(req.body);
			if (created && amountMinor > 0) {
				const payer = activity.participants.find(p => p.userId === req.actor.userId) || activity.participants[0];
				await activities.addExpense(activity.id, {
					label: activity.title,
					amountSatang: amountMinor,
					paidBy: payer.id,
					periodId: period.id,
				});
			}

			const full = await activities.getActivity(activity.id);
			res.json({ activity: serializeActivity(full, req.actor, { periodId: period.id }) });
		}
		catch (error) {
			next(error);
		}
	});

	api.post('/a/:code/attendance', requireAccount, async (req, res, next) => {
		try {
			const activity = await ownerOnly(req, res);
			if (!activity) return;
			if (activity.planState !== 'done') {
				return fail(res, 409, 'attendance_not_ready', 'Finish the activity before recording attendance');
			}
			const rosterIds = new Set(activity.participants.map(p => p.id));
			const entries = Object.entries(req.body?.attendance || {});
			for (const [participantId, attended] of entries) {
				if (!rosterIds.has(participantId)) {
					return fail(res, 400, 'participant_not_in_activity', 'That person is not on this activity');
				}
				if (attended !== null && typeof attended !== 'boolean') {
					return fail(res, 400, 'attendance_invalid', 'Attendance must be true, false, or null');
				}
			}
			for (const [participantId, attended] of entries) {
				await activities.setAttended(participantId, attended);
			}
			const full = await activities.getActivity(activity.id);
			res.json({ activity: serializeActivity(full, req.actor) });
		}
		catch (error) {
			next(error);
		}
	});

	api.post('/a/:code/payments/:paymentId/:decision', requireAccount, async (req, res, next) => {
		try {
			const activity = await ownerOnly(req, res);
			if (!activity) return;

			const { paymentId, decision } = req.params;
			if (!activity.payments.some(p => p.id === paymentId)) {
				return fail(res, 404, 'payment_not_found');
			}

			const payment = activity.payments.find(item => item.id === paymentId);
			const reason = String(req.body?.reason || '').trim();
			if (decision === 'confirm') {
				const cash = ['cash', 'manual'].includes(payment.method);
				await activities.confirmPayment(paymentId, req.actor.userId, {
					source: cash ? 'owner_cash' : 'owner_review',
					verificationLevel: 'owner_confirmed',
					reason: reason || (cash ? 'owner_received_cash' : 'owner_checked_transfer'),
				});
			}
			else if (decision === 'reject') {
				await activities.rejectPayment(paymentId, req.actor.userId, reason);
			}
			else if (decision === 'undo') {
				await activities.reversePayment(paymentId, req.actor.userId, reason);
			}
			else {
				return fail(res, 400, 'decision_invalid');
			}

			// Nothing to close: the money axis settles itself the moment the
			// last outstanding row reaches zero.
			const full = await activities.getActivity(activity.id);
			const periodId = full.payments.find(p => p.id === paymentId)?.periodId || undefined;
			const payer = activity.participants.find(participant => participant.id === payment.participantId);
			if (payer?.userId) {
				const amount = format.formatMoney(payment.amountSatang, activity.currency);
				const bodyEn = decision === 'confirm'
					? `The organizer confirmed your ${amount} payment.`
					: decision === 'reject' ? `Your ${amount} payment was rejected: ${reason}` : `Your ${amount} payment confirmation was reversed: ${reason}`;
				const bodyTh = decision === 'confirm'
					? `เจ้าของยืนยันการจ่าย ${amount} ของคุณแล้ว`
					: decision === 'reject' ? `การจ่าย ${amount} ของคุณถูกปฏิเสธ: ${reason}` : `ผลยืนยันการจ่าย ${amount} ถูกยกเลิก: ${reason}`;
				await notifications.enqueue({
					userId: payer.userId,
					eventType: `payment_${decision}`,
					dedupeKey: `payment-decision:${paymentId}:${decision}:${full.payments.find(p => p.id === paymentId)?.status}`,
					payload: {
						activityTitle: activity.title,
						subjectEn: `Payment update · ${activity.title}`,
						subjectTh: `อัปเดตการจ่ายเงิน · ${activity.title}`,
						bodyEn, bodyTh, ctaUrl: `${req.actor.shareOrigin}/a/${activity.code}`,
					},
				}).catch(() => undefined);
			}
			else if (deps.notifyPayment) {
				const payerDiscordUid = await discordUidForParticipant(
					activity.participants.find(participant => participant.id === payment.participantId),
				);
				if (payerDiscordUid) {
					const amount = format.formatMoney(payment.amountSatang, activity.currency);
					const action = decision === 'confirm'
						? 'เจ้าของยืนยันว่าได้รับเงินแล้ว'
						: decision === 'reject' ? `การชำระถูกปฏิเสธ: ${reason}` : `ผลการชำระถูกยกเลิก: ${reason}`;
					await deps.notifyPayment({
						recipients: [payerDiscordUid],
						message: `🔔 **${activity.title}** · ${amount}\n${action}\n${req.actor.shareOrigin}/a/${activity.code}`,
					}).catch(() => undefined);
				}
			}
			res.json({ activity: serializeActivity(full, req.actor, { periodId }) });
		}
		catch (error) {
			next(error);
		}
	});

	api.use((err, req, res, next) => {
		log('Megu', `${req.method} ${req.originalUrl} → ${err.message}`);
		if (res.headersSent) return next(err);
		// PostgreSQL messages name tables, columns and constraints. They are
		// useful in the server log above and never useful in the form someone is
		// filling in. Keep that implementation detail behind the API boundary.
		if (/^[0-9A-Z]{5}$/.test(String(err.code || ''))) {
			return fail(res, 409, 'data_conflict', 'The data changed while saving; reload and try again');
		}
		// `code` is what the browser translates; `error` is the sentence it
		// falls back to when the code is one it has no words for yet.
		const code = err.code || (/^[a-z0-9_]+$/.test(String(err.message || '')) ? err.message : null);
		res.status(400).json({ error: err.message || 'failed', code });
	});

	return api;
}

module.exports = { router, attachActor, serializeActivity, ensureAccount, shareDetails, DEVICE_COOKIE };
