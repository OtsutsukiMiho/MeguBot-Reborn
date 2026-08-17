const express = require('express');
const QRCode = require('qrcode');
const core = require('../../core/index.js');
const { log } = require('../../core/log.js');

const { activities, users, access, tokens, money, voice, promptpay } = core;

// A slip photographed on a phone is a few hundred kilobytes once the browser
// has shrunk it. The ceiling is generous enough that nobody meets it by
// accident and low enough that nobody can post a video file to the database.
const SLIP_MAX_BYTES = 2 * 1024 * 1024;
const SLIP_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

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

const DEVICE_COOKIE = 'megu_pt';
const DEVICE_MAX_AGE = 365 * 24 * 60 * 60 * 1000;

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
		discordUid: req.session?.user?.id || null,
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

function requireAccount(req, res, next) {
	if (!req.actor?.userId) {
		return res.status(401).json({ error: 'ต้องเข้าสู่ระบบก่อนถึงจะสร้างกิจกรรมได้' });
	}
	next();
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
		const voted = new Set(activity.slotVotes.map(v => v.participantId));
		const silent = activity.participants.filter(p => !voted.has(p.id)).map(p => p.displayName);
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

	return {
		code: activity.code,
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
		periods: activity.periods.map(p => ({ id: p.id, key: p.key, dueAt: p.dueAt })),
		participants: activity.participants.map(p => publicParticipant(p, me?.id, showAmounts, byParticipant[p.id])),
		expenses: showAmounts
			? activity.expenses.filter(inScope).map(e => ({
				id: e.id,
				label: e.label,
				amountSatang: e.amountSatang,
				paidBy: e.paidBy,
			}))
			: [],
		payments: showAmounts
			? activity.payments.filter(inScope).map(p => ({
				id: p.id,
				participantId: p.participantId,
				amountSatang: p.amountSatang,
				// What we asked for at the time. The owner's list prints it
				// beside the claimed figure when the two disagree, which is how
				// transferring ฿60 and typing ฿6 gets noticed.
				expectedSatang: p.expectedSatang,
				status: p.status,
				method: p.method,
				// Whether a slip exists, never the slip. The image is served by
				// the one route that checks who is asking.
				hasSlip: p.hasSlip,
				slipVerdict: p.slipVerdict,
				slipUploadedAt: p.slipUploadedAt,
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
		payTo: showAmounts && activity.payee
			? {
				participantId: activity.payee.participantId,
				displayName: activity.payee.displayName,
				accountName: activity.payee.promptpayName || null,
				masked: activity.payee.promptpayId ? promptpay.maskTarget(activity.payee.promptpayId) : null,
				number: activity.payee.promptpayId || null,
				ready: Boolean(activity.payee.promptpayId),
				isMe: Boolean(me && me.id === activity.payee.participantId),
			}
			: null,
	};
}

/**
 * @param {object} deps
 * @param {(guildIds: string[]) => Promise<string[]>} [deps.botPresence]
 *        Which of these guilds the bot is actually in. Supplied by the host
 *        because it needs IPC to the bot process.
 */
function router(deps = {}) {
	const api = express.Router();
	api.use(attachActor);

	api.get('/me', async (req, res) => {
		if (!req.actor.userId) return res.json({ loggedIn: false, user: null, servers: [] });

		const user = await users.getUserWithIdentities(req.actor.userId);
		const myGuilds = req.session?.allGuilds || [];

		let botGuildIds = [];
		if (deps.botPresence && myGuilds.length > 0) {
			botGuildIds = await deps.botPresence(myGuilds.map(g => g.id)).catch(() => []);
		}

		res.json({ loggedIn: true, user, servers: access.visibleServers(myGuilds, botGuildIds) });
	});

	// Where this person wants to be paid. Their own account, their own bank —
	// Megu prints the address on a QR and never stands between the two ends of
	// the transfer.
	api.patch('/me', requireAccount, async (req, res, next) => {
		try {
			const user = await users.setPromptPay(req.actor.userId, {
				promptpayId: req.body?.promptpayId,
				promptpayName: req.body?.promptpayName,
			});
			res.json({ user });
		}
		catch (error) {
			if (error.message === 'promptpay_unrecognised' || error.message === 'promptpay_missing') {
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
			const { title, kind = 'event', location, startsAt, guildId, channelId, participants } = req.body || {};
			if (!title || !String(title).trim()) {
				return res.status(400).json({ error: 'ต้องมีชื่อกิจกรรม' });
			}

			const roster = Array.isArray(participants) ? participants.slice(0, 50) : [];
			const owner = await users.getUser(req.actor.userId);
			if (!roster.some(p => p.userId === req.actor.userId)) {
				roster.unshift({ displayName: owner?.displayName || 'ฉัน', userId: req.actor.userId });
			}

			const recurring = kind === 'recurring';
			const activity = await activities.createActivity({
				ownerUserId: req.actor.userId,
				title,
				kind,
				location: location || null,
				startsAt: startsAt ? new Date(startsAt) : null,
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
				const amountBaht = Number(req.body.amountBaht);
				if (amountBaht > 0) {
					const full = await activities.getActivity(activity.id);
					const payer = full.participants.find(p => p.userId === req.actor.userId) || full.participants[0];
					await activities.addExpense(activity.id, {
						label: title,
						amountSatang: money.toSatang(amountBaht),
						paidBy: payer.id,
						periodId: period.id,
					});
				}
			}

			const full = await activities.getActivity(activity.id);
			res.status(201).json({ activity: serializeActivity(full, req.actor) });
		}
		catch (error) {
			next(error);
		}
	});

	api.get('/a/:code', async (req, res, next) => {
		try {
			const activity = await activities.getActivityByCode(req.params.code);
			if (!activity) return res.status(404).json({ error: 'ไม่พบกิจกรรมนี้' });
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
			if (!activity) return res.status(404).json({ error: 'ไม่พบกิจกรรมนี้' });

			const target = activity.participants.find(p => p.id === req.body?.participantId);
			if (!target) return res.status(400).json({ error: 'ไม่พบชื่อนี้ในกิจกรรม' });

			const alreadyMine = access.matchParticipant(req.actor, activity.participants);
			if (alreadyMine && alreadyMine.id !== target.id) {
				return res.status(409).json({ error: `เครื่องนี้ถูกใช้เป็น "${alreadyMine.displayName}" ไปแล้ว` });
			}
			if (target.claimedAt && !access.matchParticipant(req.actor, [target])) {
				return res.status(409).json({ error: `"${target.displayName}" ถูกเลือกไปแล้ว ถ้าเป็นคุณจริง ให้เจ้าของกิจกรรมรีเซ็ตให้` });
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
			if (!activity) return res.status(404).json({ error: 'ไม่พบกิจกรรมนี้' });

			const me = access.matchParticipant(req.actor, activity.participants);
			if (!me) return res.status(403).json({ error: 'เลือกชื่อตัวเองก่อนถึงจะตอบได้' });

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

		return { activity, role, me, period, scope, sum, outstanding: row?.outstanding || 0 };
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

			const payee = ctx.activity.payee;
			if (!payee?.promptpayId) return fail(res, 404, 'promptpay_missing');

			const requested = Number(req.query.amount);
			const amount = Number.isInteger(requested) && requested > 0 ? requested : ctx.outstanding;
			if (amount <= 0) return fail(res, 400, 'nothing_outstanding');

			const payload = promptpay.buildPayload(payee.promptpayId, amount);
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

			const amount = Number(req.body?.amountSatang) || ctx.outstanding;
			if (amount <= 0) return fail(res, 400, 'nothing_outstanding');

			const payment = await activities.recordPayment(ctx.activity.id, ctx.me.id, {
				amountSatang: amount,
				method: ctx.activity.payee?.promptpayId ? 'promptpay' : 'manual',
				periodId: ctx.scope,
				// What was asked for, and where we sent them. Kept on the row so
				// the record still explains itself after the expense is corrected
				// or the owner changes their number.
				expectedSatang: ctx.outstanding || amount,
				promptpayTarget: ctx.activity.payee?.promptpayId || null,
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

	/**
	 * Attach the slip to a claim already made.
	 *
	 * The image arrives base64 in JSON rather than as multipart, because the
	 * browser has already decoded, downscaled and re-encoded it to keep a 4MB
	 * phone photo off the wire — at which point it is a string, and adding a
	 * multipart parser to the stack would buy nothing.
	 *
	 * `ref` is whatever the browser read out of the slip's own QR. It is not
	 * trusted to prove anything; it only has to be unique, and the database is
	 * what enforces that.
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

			const { dataUrl, ref } = req.body || {};
			const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(String(dataUrl || ''));
			if (!match) return fail(res, 400, 'slip_unreadable');

			const [, mime, base64] = match;
			if (!SLIP_TYPES.has(mime.toLowerCase())) return fail(res, 400, 'slip_unreadable');

			const image = Buffer.from(base64, 'base64');
			if (image.length === 0) return fail(res, 400, 'slip_unreadable');
			if (image.length > SLIP_MAX_BYTES) return fail(res, 413, 'slip_too_large');

			const result = await activities.attachSlip(payment.id, {
				image,
				mime: mime.toLowerCase(),
				ref: ref ? String(ref).slice(0, 200) : null,
			});

			const full = await activities.getActivity(activity.id);
			res.json({
				verdict: result.verdict,
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

			const slip = await activities.getSlip(payment.id);
			if (!slip) return fail(res, 404, 'no_slip');

			res.setHeader('Content-Type', slip.mime);
			res.setHeader('Cache-Control', 'private, no-store');
			res.send(slip.image);
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

	async function ownerOnly(req, res, nextFn) {
		const activity = await activities.getActivityByCode(req.params.code);
		if (!activity) {
			res.status(404).json({ error: 'ไม่พบกิจกรรมนี้' });
			return null;
		}
		if (access.activityRole(req.actor, activity) !== 'owner') {
			res.status(403).json({ error: 'เฉพาะเจ้าของกิจกรรมเท่านั้น' });
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
			if (!target) return res.status(404).json({ error: 'ไม่พบคนนี้ในกิจกรรม' });

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
				return res.status(404).json({ error: 'ไม่พบคนนี้ในกิจกรรม' });
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
			if (!expense) return res.status(404).json({ error: 'ไม่พบรายการนี้' });

			const amountSatang = req.body?.amountSatang != null
				? Number(req.body.amountSatang)
				: req.body?.amountBaht != null ? money.toSatang(req.body.amountBaht) : undefined;

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
			if (!expense) return res.status(404).json({ error: 'ไม่พบรายการนี้' });
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
			if (!payment) return res.status(404).json({ error: 'ไม่พบรายการจ่ายนี้' });
			await activities.removePayment(payment.id);
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

			const amountSatang = req.body?.amountSatang != null
				? Number(req.body.amountSatang)
				: money.toSatang(req.body?.amountBaht);

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
			if (!activity) return res.status(404).json({ error: 'ไม่พบกิจกรรมนี้' });

			const me = access.matchParticipant(req.actor, activity.participants);
			if (!me) return res.status(403).json({ error: 'เลือกชื่อตัวเองก่อนถึงจะโหวตได้' });

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
				return res.status(400).json({ error: 'กิจกรรมนี้ไม่ใช่แบบรายเดือน' });
			}

			const { period, created } = await activities.ensurePeriod(activity.id, req.body?.date ? new Date(req.body.date) : new Date());

			const amountBaht = Number(req.body?.amountBaht);
			if (created && amountBaht > 0) {
				const payer = activity.participants.find(p => p.userId === req.actor.userId) || activity.participants[0];
				await activities.addExpense(activity.id, {
					label: activity.title,
					amountSatang: money.toSatang(amountBaht),
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
			for (const [participantId, attended] of Object.entries(req.body?.attendance || {})) {
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
				return res.status(404).json({ error: 'ไม่พบรายการจ่ายนี้' });
			}

			if (decision === 'confirm') await activities.confirmPayment(paymentId, req.actor.userId);
			else if (decision === 'reject') await activities.rejectPayment(paymentId, req.actor.userId);
			else if (decision === 'undo') await activities.unconfirmPayment(paymentId);
			else return res.status(400).json({ error: 'decision ต้องเป็น confirm, reject หรือ undo' });

			// Nothing to close: the money axis settles itself the moment the
			// last outstanding row reaches zero.
			const full = await activities.getActivity(activity.id);
			const periodId = full.payments.find(p => p.id === paymentId)?.periodId || undefined;
			res.json({ activity: serializeActivity(full, req.actor, { periodId }) });
		}
		catch (error) {
			next(error);
		}
	});

	api.use((err, req, res, next) => {
		log('Megu', `${req.method} ${req.originalUrl} → ${err.message}`);
		if (res.headersSent) return next(err);
		// `code` is what the browser translates; `error` is the sentence it
		// falls back to when the code is one it has no words for yet.
		res.status(400).json({ error: err.message || 'failed', code: err.code || null });
	});

	return api;
}

module.exports = { router, attachActor, serializeActivity, DEVICE_COOKIE };
