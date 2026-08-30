const { query, transaction } = require('./db.js');
const { newId, newActivityCode } = require('./ids.js');
const { resolveSplit } = require('./split.js');
const paymentMethods = require('./payment-methods.js');
const { assessSlip, validateAllocations } = require('./payment-evidence.js');
const { pairwiseObligations, obligationsFor, paymentAmountInScope } = require('./obligations.js');

// ── Two axes ────────────────────────────────────────────────────────────────
//
// PLAN   what the group agreed to do
//        open → confirmed → done, or cancelled
//
// MONEY  what they owe each other. Derived, never stored, and completely
//        independent of the plan: a court is paid for before anyone plays,
//        a dinner bill only after everyone has eaten.
//
// The old design made money the last stage of one pipeline, which forced an
// order that is wrong half the time.

const PLAN_STATES = ['open', 'confirmed', 'done', 'cancelled'];

const PLAN_TRANSITIONS = {
	open: ['confirmed', 'done', 'cancelled'],
	confirmed: ['done', 'open', 'cancelled'],
	done: ['confirmed'],
	cancelled: ['open'],
};

const MONEY_STATES = ['none', 'open', 'settled'];
const KINDS = ['event', 'recurring'];
const RSVP = ['pending', 'yes', 'no'];
const SLOT_ANSWERS = ['yes', 'maybe', 'no'];
const SUPPORTED_CURRENCIES = ['THB', 'USD', 'EUR', 'GBP', 'SGD', 'AUD', 'CAD'];
const PAYMENT_OPTION_TYPES = ['bank_transfer', 'payment_link', 'cash', 'custom'];

// A single "no" sinks a slot faster than a "yes" lifts it: the point of the
// poll is to find a time nobody is blocked on, not the most popular one.
const SLOT_WEIGHT = { yes: 2, maybe: 1, no: -3 };

function codedError(code, message = code) {
	const error = new Error(message);
	error.code = code;
	return error;
}

function canTransition(from, to) {
	return (PLAN_TRANSITIONS[from] || []).includes(to);
}

function rowToActivity(row) {
	if (!row) return null;
	return {
		id: row.id,
		code: row.code,
		ownerUserId: row.owner_user_id,
		title: row.title,
		kind: row.kind,
		planState: row.plan_state,
		location: row.location,
		startsAt: row.starts_at,
		currency: row.currency,
		paymentOptions: Array.isArray(row.payment_options) ? row.payment_options : [],
		recurrence: row.recurrence,
		dueDay: row.due_day,
		paymentDueAt: row.payment_due_at || null,
		payeeParticipantId: row.payee_participant_id || null,
		guildId: row.guild_id,
		channelId: row.channel_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		closedAt: row.closed_at,
	};
}

function rowToParticipant(row) {
	return {
		id: row.id,
		activityId: row.activity_id,
		displayName: row.display_name,
		userId: row.user_id,
		discordUid: row.discord_uid,
		deviceToken: row.device_token,
		rsvp: row.rsvp,
		attended: row.attended,
		claimedAt: row.claimed_at,
	};
}

function rowToDeferral(row) {
	return {
		id: row.id,
		activityId: row.activity_id,
		periodId: row.period_id,
		participantId: row.participant_id,
		reason: row.reason,
		source: row.source,
		snoozeUntil: row.snooze_until,
		createdAt: row.created_at,
	};
}

function rowToPeriod(row) {
	return {
		id: row.id,
		activityId: row.activity_id,
		key: row.period_key,
		label: row.label,
		dueAt: row.due_at,
	};
}

// ── period helpers ──────────────────────────────────────────────────────────

const THAI_MONTHS = [
	'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
	'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

function periodKeyFor(date) {
	const d = new Date(date);
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function periodLabelFor(key) {
	const [year, month] = key.split('-').map(Number);
	return `${THAI_MONTHS[month - 1]} ${year + 543}`;
}

function periodDueAt(key, dueDay) {
	const [year, month] = key.split('-').map(Number);
	const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
	const day = Math.min(dueDay || 1, lastDay);
	return new Date(Date.UTC(year, month - 1, day, 17, 0, 0));
}

// ── create and read ─────────────────────────────────────────────────────────

async function createActivity(input) {
	const {
		ownerUserId,
		title,
		kind = 'event',
		location = null,
		startsAt = null,
		guildId = null,
		channelId = null,
		recurrence = null,
		dueDay = null,
		paymentDueAt = null,
		currency = 'THB',
		paymentOptions = [],
		participants = [],
	} = input;

	if (!ownerUserId) throw new Error('ownerUserId is required');
	if (!title || !title.trim()) throw new Error('title is required');
	if (!KINDS.includes(kind)) throw new Error(`unknown activity kind: ${kind}`);
	if (kind === 'recurring' && recurrence !== 'monthly') {
		throw new Error('recurring activities currently support monthly only');
	}
	const storedCurrency = cleanCurrency(currency);
	const storedPaymentOptions = normalisePaymentOptions(paymentOptions);

	return transaction(async (client) => {
		const activityId = newId('act');
		const res = await client.query(
			`INSERT INTO activities
			   (id, code, owner_user_id, title, kind, location, starts_at, currency, guild_id, channel_id, recurrence, due_day, payment_due_at, plan_state, payment_options)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb) RETURNING *`,
			[
				activityId, newActivityCode(), ownerUserId, title.trim(), kind,
				location, cleanStartsAt(startsAt), storedCurrency, guildId, channelId, recurrence, dueDay,
				// A monthly agreement already answers "when is it due" once per
				// month through `dueDay` → `periods.due_at`. Giving it a second,
				// activity-wide deadline would be two answers to one question.
				kind === 'recurring' ? null : cleanPaymentDueAt(paymentDueAt),
				// A monthly agreement has nothing to agree on — it just runs.
				kind === 'recurring' ? 'confirmed' : 'open',
				JSON.stringify(storedPaymentOptions),
			],
		);

		for (const [index, p] of participants.entries()) {
			await client.query(
				`INSERT INTO participants (id, activity_id, display_name, user_id, discord_uid, rsvp, position)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				[
					newId('par'),
					activityId,
					cleanDisplayName(p.displayName),
					p.userId || null,
					p.discordUid ? String(p.discordUid) : null,
					kind === 'recurring' ? 'yes' : 'pending',
					index,
				],
			);
		}

		return rowToActivity(res.rows[0]);
	});
}

async function loadActivity(where, value) {
	const res = await query(`SELECT * FROM activities WHERE ${where} = $1`, [value]);
	const activity = rowToActivity(res.rows[0]);
	if (!activity) return null;

	const [participants, periods, slots, slotVotes, expenses, shares, payments, paymentAllocations, paymentEvents, deferrals] = await Promise.all([
		query('SELECT * FROM participants WHERE activity_id = $1 ORDER BY position, created_at', [activity.id]),
		query('SELECT * FROM periods WHERE activity_id = $1 ORDER BY period_key DESC', [activity.id]),
		query('SELECT * FROM slots WHERE activity_id = $1 ORDER BY position, starts_at', [activity.id]),
		query(
			`SELECT v.* FROM slot_votes v
			 JOIN slots s ON s.id = v.slot_id
			 WHERE s.activity_id = $1`,
			[activity.id],
		),
		query('SELECT * FROM expenses WHERE activity_id = $1 ORDER BY created_at', [activity.id]),
		query(
			`SELECT s.*, e.period_id FROM shares s
			 JOIN expenses e ON e.id = s.expense_id
			 WHERE e.activity_id = $1`,
			[activity.id],
		),
		query('SELECT * FROM payments WHERE activity_id = $1 ORDER BY created_at', [activity.id]),
		query(
			`SELECT a.* FROM payment_allocations a
			 JOIN payments p ON p.id = a.payment_id
			 WHERE p.activity_id = $1 ORDER BY a.created_at`,
			[activity.id],
		),
		query('SELECT * FROM payment_events WHERE activity_id = $1 ORDER BY created_at', [activity.id]),
		query('SELECT * FROM payment_deferrals WHERE activity_id = $1 ORDER BY created_at DESC', [activity.id]),
	]);

	const allocationsByPayment = new Map();
	for (const row of paymentAllocations.rows) {
		const list = allocationsByPayment.get(row.payment_id) || [];
		list.push({ id: row.id, periodId: row.period_id, amountSatang: Number(row.amount_satang) });
		allocationsByPayment.set(row.payment_id, list);
	}
	const eventsByPayment = new Map();
	for (const row of paymentEvents.rows) {
		const list = eventsByPayment.get(row.payment_id) || [];
		list.push({
			id: row.id,
			type: row.event_type,
			actorUserId: row.actor_user_id,
			actorParticipantId: row.actor_participant_id,
			reason: row.reason,
			metadata: row.metadata || {},
			createdAt: row.created_at,
		});
		eventsByPayment.set(row.payment_id, list);
	}

	activity.participants = participants.rows.map(rowToParticipant);
	activity.periods = periods.rows.map(rowToPeriod);
	// Newest first, because only the latest one is an answer to "why has this
	// person not paid yet" — the older ones are history.
	activity.deferrals = deferrals.rows.map(rowToDeferral);
	activity.slots = slots.rows.map(r => ({ id: r.id, startsAt: r.starts_at, position: r.position }));
	activity.slotVotes = slotVotes.rows.map(r => ({
		slotId: r.slot_id,
		participantId: r.participant_id,
		answer: r.answer,
	}));
	activity.expenses = expenses.rows.map(r => ({
		id: r.id,
		periodId: r.period_id,
		label: r.label,
		amountSatang: Number(r.amount_satang),
		paidBy: r.paid_by,
		// The instruction that produced the shares, so an edit screen can offer
		// the division back rather than making somebody retype it.
		splitMode: r.split_mode || 'even',
		splitValues: r.split_values || null,
		createdAt: r.created_at,
	}));
	activity.shares = shares.rows.map(r => ({
		id: r.id,
		expenseId: r.expense_id,
		periodId: r.period_id,
		participantId: r.participant_id,
		amountSatang: Number(r.amount_satang),
	}));
	activity.payments = payments.rows.map(r => ({
		id: r.id,
		periodId: r.period_id,
		participantId: r.participant_id,
		// Null on every row written before the column existed. `settlement()`
		// reconstructs those rather than ignoring them, and says that it did.
		creditorParticipantId: r.creditor_participant_id || null,
		amountSatang: Number(r.amount_satang),
		expectedSatang: r.expected_satang == null ? null : Number(r.expected_satang),
		promptpayTarget: r.promptpay_target || null,
		paymentDestination: r.payment_destination || null,
		method: r.method,
		status: r.status,
		allocations: allocationsByPayment.get(r.id) || [],
		events: eventsByPayment.get(r.id) || [],
		reference: r.reference,
		// The image itself is never loaded here — it is fetched by the one route
		// that serves it, so a page render does not drag a megabyte of other
		// people's bank slips through memory to display a list of names.
		hasSlip: Boolean(r.slip_uploaded_at || r.evidence_image),
		hasEvidence: Boolean(r.evidence_image),
		slipVerdict: r.slip_verdict || null,
		slipUploadedAt: r.slip_uploaded_at,
		slipBank: r.slip_bank || null,
		// What was read off the picture, kept apart from `amountSatang` — which
		// is what the payer said — and from `expectedSatang`, which is what was
		// asked. Three numbers that should agree, from three sources, and the
		// screen is better for showing where each one came from.
		slipAmountSatang: r.slip_amount_satang == null ? null : Number(r.slip_amount_satang),
		slipWhen: r.slip_when || null,
		slipTransferredAt: r.slip_transferred_at || null,
		slipSenderName: r.slip_sender_name || null,
		slipReceiverName: r.slip_receiver_name || null,
		slipSenderAccountTail: r.slip_sender_account_tail || null,
		slipReceiverAccountTail: r.slip_receiver_account_tail || null,
		confirmationSource: r.confirmation_source || null,
		verificationLevel: r.verification_level || 'none',
		reversedBy: r.reversed_by || null,
		reversedAt: r.reversed_at || null,
		reversalReason: r.reversal_reason || null,
		confirmedBy: r.confirmed_by,
		createdAt: r.created_at,
		confirmedAt: r.confirmed_at,
	}));

	// Where each person on the roster can be paid, not just the one the activity
	// named. Anybody who fronted money is owed some, so anybody can be the far
	// end of a transfer, and the page has to be able to print their number.
	activity.paymentProfiles = await loadPaymentProfiles(activity.participants);
	activity.payee = await resolvePayee(activity);

	return activity;
}

/**
 * PromptPay details for every participant who has an account, in one query.
 *
 * A number belongs to the person, not to the activity — it follows them into
 * every group they are in, and is retyped nowhere. A participant who has never
 * signed in has no account and therefore no number; they get an entry with
 * nulls rather than being left out, so callers can tell "cannot be paid here"
 * apart from "not on this roster".
 */
async function loadPaymentProfiles(participants) {
	const profiles = new Map(participants.map(p => [p.id, { promptpayId: null, promptpayName: null, methods: [] }]));
	const userIds = [...new Set(participants.filter(p => p.userId).map(p => p.userId))];
	if (userIds.length === 0) return profiles;

	const byUser = await paymentMethods.listForUsers(userIds);
	for (const participant of participants) {
		const methods = participant.userId ? (byUser.get(participant.userId) || []) : [];
		if (methods.length === 0) continue;
		// PromptPay is still surfaced on its own because the QR route and the
		// payee summary both ask for "the number", and the first PromptPay
		// method is what that means now.
		const promptpay = methods.find(method => method.type === 'promptpay') || null;
		profiles.set(participant.id, {
			promptpayId: promptpay?.destination || null,
			promptpayName: promptpay?.accountName || null,
			methods,
		});
	}
	return profiles;
}

/**
 * Who the group actually pays, and where.
 *
 * Whoever fronted the money is the one owed it, which is usually but not
 * always the owner — on a shared subscription it is whoever's card the bill
 * lands on. An explicit `payee_participant_id` wins; otherwise it falls back
 * to the owner's own row on the roster. If the organizer deliberately did
 * not join, their account is still a valid payment recipient — ownership and
 * attendance are separate axes, so receiving money must not add them back to
 * the participant list by accident.
 *
 * The PromptPay number comes from that person's account, so it follows them
 * across every activity rather than being retyped into each one. A participant
 * who has never signed in has no account and therefore no number — the page
 * says so rather than showing a QR that goes nowhere.
 */
async function resolvePayee(activity) {
	const explicit = activity.payeeParticipantId
		? activity.participants.find(p => p.id === activity.payeeParticipantId)
		: null;
	const participant = explicit
		|| activity.participants.find(p => p.userId === activity.ownerUserId)
		|| null;

	if (!participant) {
		const owner = await query(
			'SELECT id, display_name, promptpay_id, promptpay_name FROM users WHERE id = $1',
			[activity.ownerUserId],
		);
		if (!owner.rows[0]) return null;
		return {
			participantId: null,
			displayName: owner.rows[0].display_name,
			userId: owner.rows[0].id,
			promptpayId: owner.rows[0].promptpay_id || null,
			promptpayName: owner.rows[0].promptpay_name || null,
		};
	}

	// Read from the roster-wide lookup rather than asking again for one row.
	// Two paths to the same number is how the payee's screen and everybody
	// else's start disagreeing about which account is current.
	const profile = activity.paymentProfiles?.get(participant.id) || { promptpayId: null, promptpayName: null };
	return {
		participantId: participant.id,
		displayName: participant.displayName,
		userId: participant.userId || null,
		promptpayId: profile.promptpayId,
		promptpayName: profile.promptpayName,
	};
}

/**
 * Point the money at a different person on the roster. Passing null hands it
 * back to the owner.
 */
async function setPayee(activityId, participantId) {
	if (participantId) {
		const found = await query(
			'SELECT id FROM participants WHERE id = $1 AND activity_id = $2',
			[participantId, activityId],
		);
		if (found.rows.length === 0) throw new Error('participant_not_in_activity');
	}
	const res = await query(
		'UPDATE activities SET payee_participant_id = $2, updated_at = now() WHERE id = $1 RETURNING *',
		[activityId, participantId || null],
	);
	return rowToActivity(res.rows[0]);
}

function getActivity(id) {
	return loadActivity('id', id);
}

function getActivityByCode(code) {
	return loadActivity('code', String(code || '').toUpperCase());
}

async function listActivitiesForOwner(ownerUserId, { includeClosed = true, at = new Date() } = {}) {
	const activityScope = includeClosed
		? 'owner_user_id = $1'
		: `owner_user_id = $1
		   AND (kind = 'recurring' OR plan_state NOT IN ('done', 'cancelled'))`;
	const activityRows = query(
		`SELECT * FROM activities WHERE ${activityScope} ORDER BY created_at DESC`,
		[ownerUserId],
	);

	// Start the list and all of its standing queries together. Passing the list
	// promise down also keeps the summary from fetching the same activities a
	// second time.
	const summaries = summariseActivitiesForOwner(ownerUserId, {
		at,
		activityRowsPromise: activityRows,
		activityScope,
	});
	const [res, byActivity] = await Promise.all([activityRows, summaries]);

	return res.rows.map(row => ({
		...rowToActivity(row),
		summary: byActivity[row.id],
	}));
}

function cleanDisplayName(value) {
	const name = String(value || '').trim();
	if (!name) throw codedError('display_name_required');
	if ([...name].length > 80) throw codedError('display_name_too_long');
	return name;
}

function cleanCurrency(value) {
	const currency = String(value || 'THB').toUpperCase();
	if (!SUPPORTED_CURRENCIES.includes(currency)) throw codedError('currency_not_supported');
	return currency;
}

/**
 * The payment deadline, or nothing.
 *
 * A browser sends `<input type="date">` back as "2026-08-21", which `new Date`
 * reads as midnight UTC — seven in the morning in Bangkok, on a date the
 * organizer thinks of as a whole day. Anything that arrives as a bare date is
 * therefore moved to the end of that day in Bangkok, so "จ่ายวันที่ 21" means
 * the 21st is not over until it is over. A full timestamp is trusted as sent.
 */
function cleanPaymentDueAt(value) {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
		const [year, month, day] = value.trim().split('-').map(Number);
		return new Date(Date.UTC(year, month - 1, day, 16, 59, 59));
	}
	const at = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(at.getTime())) throw codedError('payment_due_at_invalid');
	return at;
}

/**
 * When the activity starts, or nothing.
 *
 * `<input type="datetime-local">` sends back "2026-09-05T19:00" with no zone,
 * and `new Date` reads that as the *server's* local time. On a box running UTC
 * — which is every deploy of this — an organizer in Bangkok typing seven in the
 * evening gets two in the morning the next day, told to the whole group.
 *
 * A bare wall clock is therefore read as Bangkok, exactly as `cleanPaymentDueAt`
 * already reads a bare date. Anything carrying its own offset is trusted as
 * sent, so a caller that knows what it means keeps saying it.
 */
function cleanStartsAt(value) {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value === 'string') {
		const bare = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
		if (bare) {
			const [, year, month, day, hour, minute, second = '00'] = bare;
			return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+07:00`);
		}
	}
	const at = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(at.getTime())) throw codedError('starts_at_invalid');
	return at;
}

function normalisePaymentOptions(options) {
	if (!Array.isArray(options)) return [];
	const usedIds = new Set();
	return options.slice(0, 8).map((option) => {
		const type = String(option?.type || 'custom');
		if (!PAYMENT_OPTION_TYPES.includes(type)) throw codedError('payment_option_invalid');
		const label = String(option?.label || '').trim();
		if (!label || [...label].length > 60) throw codedError('payment_option_invalid');
		const instructions = String(option?.instructions || '').trim().slice(0, 500);
		const destination = String(option?.destination || '').trim().slice(0, 180);
		const accountName = String(option?.accountName || '').trim().slice(0, 120);
		const url = String(option?.url || '').trim();
		if (type === 'payment_link') {
			let parsed;
			try { parsed = new URL(url); }
			catch { throw codedError('payment_link_invalid'); }
			if (!['https:', 'http:'].includes(parsed.protocol)) throw codedError('payment_link_invalid');
		}
		if (type === 'bank_transfer' && !destination) throw codedError('payment_destination_required');
		const requestedId = String(option?.id || '');
		const id = /^pmo_[0-9a-f]{16}$/.test(requestedId) && !usedIds.has(requestedId)
			? requestedId
			: newId('pmo');
		usedIds.add(id);
		return {
			id,
			type,
			label,
			instructions: instructions || null,
			destination: destination || null,
			accountName: accountName || null,
			url: type === 'payment_link' ? url : null,
		};
	});
}

/**
 * One line of standing for every activity an owner has, so their list can say
 * which ones are waiting on them instead of making them open each one to find
 * out.
 *
 * Two things had to be true for this to be worth adding.
 *
 * The first is that it costs a fixed number of queries, not one per activity.
 * Everything below is scoped by a single `owner_user_id = $1` subquery and
 * grouped in memory afterwards, so an owner with forty activities costs the
 * same round trips as one with two.
 *
 * The second is that the numbers cannot disagree with the activity page. They
 * are not recomputed here: each activity is assembled into the shape
 * `settlement()` already reads and handed to that same function. If the money
 * rules change, they change in one place and both surfaces follow. A summary
 * that quietly drifts from the page it summarises is worse than no summary,
 * because the reader stops trusting both.
 */
async function summariseActivitiesForOwner(ownerUserId, {
	at = new Date(),
	activityRowsPromise = null,
	activityScope = 'owner_user_id = $1',
} = {}) {
	const owned = `(SELECT id FROM activities WHERE ${activityScope})`;
	const args = [ownerUserId];

	const [activityRows, participants, periods, expenses, shares, payments, slots, votes] = await Promise.all([
		activityRowsPromise || query(`SELECT id, kind FROM activities WHERE ${activityScope}`, args),
		query(`SELECT id, activity_id, display_name, rsvp FROM participants WHERE activity_id IN ${owned}`, args),
		query(`SELECT id, activity_id, period_key FROM periods WHERE activity_id IN ${owned}`, args),
		query(`SELECT id, activity_id, period_id, amount_satang, paid_by FROM expenses WHERE activity_id IN ${owned}`, args),
		query(
			`SELECT s.expense_id, s.participant_id, s.amount_satang, e.activity_id, e.period_id
			 FROM shares s JOIN expenses e ON e.id = s.expense_id
			 WHERE e.activity_id IN ${owned}`,
			args,
		),
		query(`SELECT activity_id, period_id, participant_id, creditor_participant_id, amount_satang, status FROM payments WHERE activity_id IN ${owned}`, args),
		query(`SELECT id, activity_id FROM slots WHERE activity_id IN ${owned}`, args),
		query(
			`SELECT v.slot_id, v.participant_id, sl.activity_id
			 FROM slot_votes v JOIN slots sl ON sl.id = v.slot_id
			 WHERE sl.activity_id IN ${owned}`,
			args,
		),
	]);

	const bucket = new Map(activityRows.rows.map(r => [r.id, {
		kind: r.kind,
		participants: [], periods: [], slots: [], slotVotes: [],
		expenses: [], shares: [], payments: [],
	}]));

	const push = (id, key, value) => bucket.get(id)?.[key].push(value);

	for (const r of participants.rows) push(r.activity_id, 'participants', { id: r.id, displayName: r.display_name, rsvp: r.rsvp });
	for (const r of periods.rows) push(r.activity_id, 'periods', { id: r.id, key: r.period_key });
	for (const r of slots.rows) push(r.activity_id, 'slots', { id: r.id });
	for (const r of votes.rows) push(r.activity_id, 'slotVotes', { slotId: r.slot_id, participantId: r.participant_id });
	for (const r of expenses.rows) {
		push(r.activity_id, 'expenses', { id: r.id, periodId: r.period_id, amountSatang: Number(r.amount_satang), paidBy: r.paid_by });
	}
	for (const r of shares.rows) {
		// `expenseId` and the participant's name are carried here so that the
		// summary feeds `settlement()` the same shape the activity page does.
		// Without them the pair calculation quietly returns nothing, which is a
		// worse failure than a slow one: the list would agree with the page
		// until the day somebody read the pairs off it.
		push(r.activity_id, 'shares', { expenseId: r.expense_id, participantId: r.participant_id, periodId: r.period_id, amountSatang: Number(r.amount_satang) });
	}
	for (const r of payments.rows) {
		push(r.activity_id, 'payments', {
			participantId: r.participant_id,
			creditorParticipantId: r.creditor_participant_id || null,
			periodId: r.period_id,
			amountSatang: Number(r.amount_satang),
			status: r.status,
		});
	}

	const nowKey = periodKeyFor(at);
	const summaries = {};

	for (const [id, a] of bucket) {
		// A monthly agreement is only ever asked about the month it is in. Last
		// month is closed business and showing its total on the list would read
		// as an unpaid bill that nobody actually owes.
		const period = a.kind === 'recurring'
			? (a.periods.find(p => p.key === nowKey) || a.periods.sort((x, y) => y.key.localeCompare(x.key))[0] || null)
			: null;
		const sum = settlement(a, period ? period.id : null);

		const total = a.participants.length;
		const answered = a.slots.length > 0
			? a.participants.filter(p => a.slots.every(slot => a.slotVotes.some(v => v.participantId === p.id && v.slotId === slot.id))).length
			: a.participants.filter(p => p.rsvp !== 'pending').length;

		summaries[id] = {
			moneyState: sum.state,
			// What the group still owes whoever fronted the money — the one
			// number that decides whether this activity is finished.
			outstandingSatang: sum.rows.reduce((n, r) => n + Math.max(0, r.outstanding), 0),
			unpaidCount: sum.unpaid.length,
			// Claims the owner has not confirmed yet. This is the only figure
			// here that is a task rather than a status, so the list leads with
			// it when it is non-zero.
			awaitingConfirmation: a.payments.filter(p => p.status === 'pending' && (period ? p.periodId === period.id : true)).length,
			people: total,
			answered,
			awaitingAnswer: Math.max(0, total - answered),
			polling: a.slots.length > 0,
			periodKey: period ? period.key : null,
		};
	}

	return summaries;
}

// ── participants ────────────────────────────────────────────────────────────

async function addParticipant(activityId, { displayName, userId = null, discordUid = null, rsvp = 'pending' }) {
	const res = await query(
		`INSERT INTO participants (id, activity_id, display_name, user_id, discord_uid, rsvp, position)
		 VALUES ($1, $2, $3, $4, $5, $6,
		         (SELECT COALESCE(MAX(position) + 1, 0) FROM participants WHERE activity_id = $2))
		 RETURNING *`,
		[newId('par'), activityId, String(displayName || 'ใครไม่รู้').trim(), userId, discordUid ? String(discordUid) : null, rsvp],
	);
	return rowToParticipant(res.rows[0]);
}

async function claimParticipant(participantId, actor) {
	const res = await query(
		`UPDATE participants
		 SET user_id      = COALESCE($2, user_id),
		     discord_uid  = COALESCE($3, discord_uid),
		     device_token = COALESCE($4, device_token),
		     claimed_at   = COALESCE(claimed_at, now())
		 WHERE id = $1
		 RETURNING *`,
		[participantId, actor.userId || null, actor.discordUid ? String(actor.discordUid) : null, actor.deviceToken || null],
	);
	return rowToParticipant(res.rows[0]);
}

async function setRsvp(participantId, rsvp) {
	if (!RSVP.includes(rsvp)) throw new Error(`invalid rsvp: ${rsvp}`);
	const res = await query('UPDATE participants SET rsvp = $2 WHERE id = $1 RETURNING *', [participantId, rsvp]);
	return rowToParticipant(res.rows[0]);
}

async function renameParticipant(participantId, displayName) {
	const name = String(displayName || '').trim();
	if (!name) throw codedError('display_name_required');
	const res = await query(
		'UPDATE participants SET display_name = $2 WHERE id = $1 RETURNING *',
		[participantId, name],
	);
	if (res.rows.length === 0) throw codedError('participant_not_in_activity');
	return rowToParticipant(res.rows[0]);
}

/**
 * Take a name off the roster. Refuses while money is attached to it — silently
 * deleting a share would change what everyone else owes without anyone asking,
 * which is exactly the kind of quiet wrongness this product exists to prevent.
 */
async function removeParticipant(participantId) {
	return transaction(async (client) => {
		const money = await client.query(
			`SELECT
			   (SELECT count(*) FROM shares WHERE participant_id = $1)      AS shares,
			   (SELECT count(*) FROM payments WHERE participant_id = $1)    AS payments,
			   (SELECT count(*) FROM expenses WHERE paid_by = $1)           AS paid,
			   (SELECT count(*) FROM payments
			     WHERE creditor_participant_id = $1)                        AS received`,
			[participantId],
		);
		const { shares, payments, paid, received } = money.rows[0];
		if (Number(paid) > 0) throw codedError('participant_paid_out');
		// Somebody money was sent to. The foreign key would refuse this anyway;
		// catching it here is what turns a constraint violation into a sentence
		// the organizer can act on.
		if (Number(received) > 0) throw codedError('participant_is_creditor');
		if (Number(shares) > 0 || Number(payments) > 0) {
			throw codedError('participant_has_money');
		}

		const res = await client.query('DELETE FROM participants WHERE id = $1 RETURNING id', [participantId]);
		return res.rows.length > 0;
	});
}

/**
 * Hand a name back. Used when the wrong person tapped it, or someone wants to
 * move to a new phone.
 */
async function resetClaim(participantId) {
	const res = await query(
		`UPDATE participants
		 SET device_token = NULL, claimed_at = NULL, user_id = NULL, discord_uid = discord_uid
		 WHERE id = $1 RETURNING *`,
		[participantId],
	);
	if (res.rows.length === 0) throw codedError('participant_not_in_activity');
	return rowToParticipant(res.rows[0]);
}

async function setAttended(participantId, attended) {
	const res = await query(
		'UPDATE participants SET attended = $2 WHERE id = $1 RETURNING *',
		[participantId, attended === null ? null : Boolean(attended)],
	);
	return rowToParticipant(res.rows[0]);
}

// ── plan axis ───────────────────────────────────────────────────────────────

async function setPlanState(activityId, nextState) {
	if (!PLAN_STATES.includes(nextState)) throw new Error(`unknown plan state: ${nextState}`);

	return transaction(async (client) => {
		const current = await client.query(
			'SELECT plan_state, kind, starts_at FROM activities WHERE id = $1 FOR UPDATE',
			[activityId],
		);
		if (current.rows.length === 0) throw new Error('activity not found');

		const from = current.rows[0].plan_state;
		if (from === nextState) return { changed: false, planState: from };
		if (['confirmed', 'done'].includes(nextState) && current.rows[0].kind === 'event' && !current.rows[0].starts_at) {
			throw codedError('time_not_set', 'Choose a date and time before confirming this activity');
		}
		if (!canTransition(from, nextState)) {
			throw new Error(`cannot move plan from ${from} to ${nextState}`);
		}

		const res = await client.query(
			`UPDATE activities
			 SET plan_state = $2,
			     updated_at = now(),
			     closed_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE closed_at END
			 WHERE id = $1 RETURNING *`,
			[activityId, nextState],
		);
		return { changed: true, from, planState: nextState, activity: rowToActivity(res.rows[0]) };
	});
}

// ── the time poll ───────────────────────────────────────────────────────────

/**
 * Put a set of candidate times on the table. Replaces whatever was there:
 * re-proposing is how an organizer changes their mind, and half-voted stale
 * slots would only confuse the standing.
 */
async function proposeSlots(activityId, startTimes) {
	const times = (startTimes || [])
		.map(t => new Date(t))
		.filter(d => !Number.isNaN(d.getTime()))
		.slice(0, 12);

	if (times.length === 0) throw codedError('slot_required');

	return transaction(async (client) => {
		await client.query('DELETE FROM slots WHERE activity_id = $1', [activityId]);
		const rows = [];
		for (const [index, at] of times.entries()) {
			const res = await client.query(
				'INSERT INTO slots (id, activity_id, starts_at, position) VALUES ($1, $2, $3, $4) RETURNING *',
				[newId('slt'), activityId, at, index],
			);
			rows.push({ id: res.rows[0].id, startsAt: res.rows[0].starts_at, position: res.rows[0].position });
		}
		return rows;
	});
}

async function voteSlot(slotId, participantId, answer) {
	if (!SLOT_ANSWERS.includes(answer)) throw new Error(`invalid slot answer: ${answer}`);
	await query(
		`INSERT INTO slot_votes (id, slot_id, participant_id, answer)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (slot_id, participant_id) DO UPDATE
		 SET answer = EXCLUDED.answer, updated_at = now()`,
		[newId('vot'), slotId, participantId, answer],
	);
}

/**
 * How each proposed time is doing, best first.
 *
 * `blocked` is the count of people who said no — a slot with any of those is
 * only chosen when nothing else is left.
 */
function slotStanding(activity) {
	const votesBySlot = new Map(activity.slots.map(s => [s.id, []]));
	for (const vote of activity.slotVotes || []) {
		votesBySlot.get(vote.slotId)?.push(vote);
	}

	const rows = activity.slots.map((slot) => {
		const votes = votesBySlot.get(slot.id) || [];
		const tally = { yes: 0, maybe: 0, no: 0 };
		let score = 0;
		for (const v of votes) {
			tally[v.answer] += 1;
			score += SLOT_WEIGHT[v.answer];
		}
		return {
			slotId: slot.id,
			startsAt: slot.startsAt,
			position: slot.position,
			...tally,
			blocked: tally.no,
			answered: votes.length,
			score,
			voters: votes.map(v => ({ participantId: v.participantId, answer: v.answer })),
		};
	});

	rows.sort((a, b) => (
		a.blocked - b.blocked
		|| b.score - a.score
		|| b.yes - a.yes
		|| new Date(a.startsAt) - new Date(b.startsAt)
	));

	return rows;
}

/**
 * Whether Megu has heard enough to call it. She waits for everyone who is
 * still pending, but never guesses from a half-filled ballot — every
 * participant must answer every option before the answer is in.
 */
function pollAnsweredCount(activity) {
	if (activity.slots.length === 0) return 0;
	return activity.participants.filter(p => activity.slots.every(slot => (
		(activity.slotVotes || []).some(v => v.participantId === p.id && v.slotId === slot.id)
	))).length;
}

function pollReady(activity) {
	return activity.slots.length > 0 && pollAnsweredCount(activity) === activity.participants.length;
}

function bestSlot(activity) {
	const standing = slotStanding(activity);
	return standing.length > 0 ? standing[0] : null;
}

/**
 * Lock the winning time in and move the plan forward. This is the moment the
 * group has been avoiding, and the reason Megu exists.
 */
async function lockBestSlot(activityId) {
	const activity = await getActivity(activityId);
	if (!activity) throw new Error('activity not found');
	if (!pollReady(activity)) {
		throw codedError('poll_not_ready', 'Wait until everyone has answered before locking a time');
	}

	const winner = bestSlot(activity);
	if (!winner) throw codedError('time_not_set');

	await query(
		'UPDATE activities SET starts_at = $2, updated_at = now() WHERE id = $1',
		[activityId, winner.startsAt],
	);

	if (activity.planState === 'open') {
		await setPlanState(activityId, 'confirmed');
	}

	// People who said no to the winning time are not coming; everyone else is.
	for (const p of activity.participants) {
		const vote = (activity.slotVotes || []).find(v => v.slotId === winner.slotId && v.participantId === p.id);
		if (vote) await setRsvp(p.id, vote.answer === 'no' ? 'no' : 'yes');
	}

	return winner;
}

// ── periods ─────────────────────────────────────────────────────────────────

/**
 * Make sure the period covering `date` exists, and bill it if it is new.
 * Called when a monthly agreement rolls over.
 */
async function ensurePeriod(activityId, date = new Date()) {
	const activity = await getActivity(activityId);
	if (!activity) throw new Error('activity not found');
	if (activity.kind !== 'recurring') throw new Error('only recurring activities have periods');

	const key = periodKeyFor(date);
	const existing = activity.periods.find(p => p.key === key);
	if (existing) return { period: existing, created: false };

	const period = await transaction(async (client) => {
		const res = await client.query(
			`INSERT INTO periods (id, activity_id, period_key, label, due_at)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (activity_id, period_key) DO NOTHING
			 RETURNING *`,
			[newId('per'), activityId, key, periodLabelFor(key), periodDueAt(key, activity.dueDay)],
		);
		if (res.rows.length === 0) return null;
		return rowToPeriod(res.rows[0]);
	});

	if (!period) {
		const again = await getActivity(activityId);
		return { period: again.periods.find(p => p.key === key), created: false };
	}
	return { period, created: true };
}

// ── money axis ──────────────────────────────────────────────────────────────

async function addExpense(activityId, input) {
	const { label, amountSatang, paidBy, shareParticipantIds = null, periodId = null, split: splitSpec = null } = input;

	if (!Number.isInteger(amountSatang) || amountSatang <= 0) {
		throw codedError('amount_invalid');
	}

	return transaction(async (client) => {
		const roster = await client.query(
			`SELECT id, rsvp,
			        (SELECT kind FROM activities WHERE id = $1) AS activity_kind
			 FROM participants WHERE activity_id = $1 ORDER BY position, created_at`,
			[activityId],
		);
		if (roster.rows.length === 0) throw codedError('participant_required');

		let ids = shareParticipantIds;
		if (!Array.isArray(ids) || ids.length === 0) {
			// A one-off bill must name its split explicitly. RSVP is a planning
			// answer, not permission to charge somebody, and using the current
			// yes-list made an early bill look settled when only the organizer had
			// answered. Monthly agreements have a fixed roster, so all members are
			// still the safe and unsurprising default there.
			if (roster.rows[0].activity_kind === 'event') {
				throw codedError('split_people_required', 'Choose who shares this expense');
			}
			ids = roster.rows.map(r => r.id);
		}
		ids = [...new Set(ids)];

		const known = new Set(roster.rows.map(r => r.id));
		for (const id of ids) {
			if (!known.has(id)) throw codedError('participant_not_in_activity');
		}
		if (!known.has(paidBy)) throw codedError('participant_not_in_activity');

		// Resolved before anything is written, so an unbalanced split is a
		// refusal rather than half an expense with shares that do not add up.
		const resolved = resolveSplit(amountSatang, ids, splitSpec);

		const expenseId = newId('exp');
		await client.query(
			`INSERT INTO expenses (id, activity_id, period_id, label, amount_satang, paid_by, split_mode, split_values)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
			[
				expenseId, activityId, periodId, String(label || 'Expense').trim(), amountSatang, paidBy,
				resolved.mode, resolved.values ? JSON.stringify(resolved.values) : null,
			],
		);

		const split = resolved.split;
		for (const [participantId, share] of Object.entries(split)) {
			await client.query(
				'INSERT INTO shares (id, expense_id, participant_id, amount_satang) VALUES ($1, $2, $3, $4)',
				[newId('shr'), expenseId, participantId, share],
			);
		}

		await client.query('UPDATE activities SET updated_at = now() WHERE id = $1', [activityId]);
		return { id: expenseId, activityId, periodId, label, amountSatang, paidBy, split, splitMode: resolved.mode };
	});
}

/**
 * Correct an expense. The split is recomputed from scratch rather than
 * patched, so the shares always sum back to whatever the amount now is.
 */
async function updateExpense(expenseId, input) {
	return transaction(async (client) => {
		const found = await client.query('SELECT * FROM expenses WHERE id = $1 FOR UPDATE', [expenseId]);
		if (found.rows.length === 0) throw codedError('expense_not_found');
		const expense = found.rows[0];

		const label = input.label != null ? String(input.label).trim() : expense.label;
		const amountSatang = input.amountSatang != null ? Number(input.amountSatang) : Number(expense.amount_satang);
		const paidBy = input.paidBy || expense.paid_by;

		if (!Number.isInteger(amountSatang) || amountSatang <= 0) {
			throw codedError('amount_invalid');
		}

		let ids = input.shareParticipantIds;
		if (!ids || ids.length === 0) {
			const existing = await client.query('SELECT participant_id FROM shares WHERE expense_id = $1', [expenseId]);
			ids = existing.rows.map(r => r.participant_id);
		}
		if (ids.length === 0) throw codedError('split_people_required');

		// Same guard addExpense has. Without it a stale or mistyped id reaches
		// the database and surfaces as a foreign key error nobody can read.
		const roster = await client.query(
			'SELECT id FROM participants WHERE activity_id = $1',
			[expense.activity_id],
		);
		const known = new Set(roster.rows.map(r => r.id));
		for (const id of ids) {
			if (!known.has(id)) throw codedError('participant_not_in_activity');
		}
		if (!known.has(paidBy)) throw codedError('participant_not_in_activity');

		// A correction keeps the division it was given unless the caller sends a
		// new one. Correcting ฿1,000 to ฿1,200 on a bill split 70/30 has to come
		// back 70/30; recomputing an even split — which is what this did while
		// even was the only kind — would quietly move money between people who
		// had already agreed how it was divided.
		//
		// Changing who shares the expense without saying how is the one case
		// that cannot honour the old instruction: a stored 70/30 names two
		// people, and there is nothing sensible it can mean once a third joins.
		// That falls back to even, which is at least a rule everybody can see.
		const rosterChanged = Array.isArray(input.shareParticipantIds) && input.shareParticipantIds.length > 0;
		const storedSpec = expense.split_mode && expense.split_mode !== 'even' && expense.split_values
			? { mode: expense.split_mode, values: expense.split_values }
			: null;
		const wantedSpec = input.split !== undefined
			? input.split
			: (rosterChanged ? null : storedSpec);
		const resolved = resolveSplit(amountSatang, ids, wantedSpec);

		await client.query(
			'UPDATE expenses SET label = $2, amount_satang = $3, paid_by = $4, split_mode = $5, split_values = $6::jsonb WHERE id = $1',
			[expenseId, label, amountSatang, paidBy, resolved.mode, resolved.values ? JSON.stringify(resolved.values) : null],
		);
		await client.query('DELETE FROM shares WHERE expense_id = $1', [expenseId]);

		const split = resolved.split;
		for (const [participantId, share] of Object.entries(split)) {
			await client.query(
				'INSERT INTO shares (id, expense_id, participant_id, amount_satang) VALUES ($1, $2, $3, $4)',
				[newId('shr'), expenseId, participantId, share],
			);
		}

		return { id: expenseId, label, amountSatang, paidBy, split, splitMode: resolved.mode };
	});
}

async function removeExpense(expenseId) {
	const res = await query('DELETE FROM expenses WHERE id = $1 RETURNING id', [expenseId]);
	return res.rows.length > 0;
}

// How long "not now" buys. Long enough that the answer is respected — nobody
// wants to explain twice that payday is the 25th — and short enough that it
// cannot be used to switch Megu off: two days later she asks again, and the
// person still appears as unpaid to the organizer the whole time.
const DEFERRAL_SNOOZE_HOURS = 48;

/**
 * "Not now, and here is why."
 *
 * The reason is the entire point. A reminder with only a Pay button leaves the
 * honest answer with nowhere to go, so the person who would have given it says
 * nothing instead, and the organizer is left guessing in a group chat. This
 * writes it down, holds the next reminder off for `DEFERRAL_SNOOZE_HOURS`, and
 * changes nothing about what is owed.
 */
async function deferPayment({ activityId, participantId, periodId = null, reason, source = 'web', snoozeHours = DEFERRAL_SNOOZE_HOURS, now = new Date() }) {
	const text = String(reason || '').trim();
	if (!text) throw codedError('defer_reason_required');
	if ([...text].length > 200) throw codedError('defer_reason_too_long');

	const res = await query(
		`INSERT INTO payment_deferrals (id, activity_id, period_id, participant_id, reason, source, snooze_until)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
		[newId('dfr'), activityId, periodId, participantId, text, source, new Date(now.getTime() + snoozeHours * 3600 * 1000)],
	);
	return rowToDeferral(res.rows[0]);
}

/**
 * The current excuse for each of these people, if it is still current.
 *
 * Keyed by participant id, and only rows whose snooze has not run out — an
 * expired deferral is history, not a reason to stay quiet.
 */
async function activeDeferrals(participantIds, { now = new Date() } = {}) {
	if (participantIds.length === 0) return new Map();
	const res = await query(
		`SELECT DISTINCT ON (participant_id) *
		 FROM payment_deferrals
		 WHERE participant_id = ANY($1::text[]) AND snooze_until > $2
		 ORDER BY participant_id, created_at DESC`,
		[participantIds, now],
	);
	return new Map(res.rows.map(row => [row.participant_id, rowToDeferral(row)]));
}

/**
 * The activity a roster row belongs to.
 *
 * A Discord button carries a participant id and nothing else — it is pressed in
 * a DM, where there is no channel, no guild and no page to read context from.
 */
async function getActivityByParticipant(participantId) {
	const res = await query('SELECT activity_id FROM participants WHERE id = $1', [participantId]);
	if (res.rows.length === 0) return null;
	return getActivity(res.rows[0].activity_id);
}

async function updateActivity(activityId, input) {
	const fields = [];
	const values = [activityId];

	for (const [key, column] of [['title', 'title'], ['location', 'location'], ['startsAt', 'starts_at'], ['dueDay', 'due_day']]) {
		if (input[key] === undefined) continue;
		const value = key === 'title' ? String(input[key]).trim()
			: key === 'startsAt' ? cleanStartsAt(input[key])
				: input[key];
		values.push(value);
		fields.push(`${column} = $${values.length}`);
	}
	// Checked against undefined rather than truthiness: clearing the deadline is
	// a real edit an organizer makes, and `null` must not read as "not supplied".
	if (input.paymentDueAt !== undefined) {
		values.push(cleanPaymentDueAt(input.paymentDueAt));
		fields.push(`payment_due_at = $${values.length}`);
	}
	if (input.paymentOptions !== undefined) {
		values.push(JSON.stringify(normalisePaymentOptions(input.paymentOptions)));
		fields.push(`payment_options = $${values.length}::jsonb`);
	}
	if (fields.length === 0) return null;

	const res = await query(
		`UPDATE activities SET ${fields.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
		values,
	);
	return rowToActivity(res.rows[0]);
}

/**
 * `expectedSatang` and `promptpayTarget` are what we asked for and where we
 * told them to send it, copied onto the row rather than looked up later.
 * Both move: the owner changes their PromptPay number, or a ฿4,000 typo is
 * corrected to ฿400. Without the copy, a payment settled months ago stops
 * agreeing with the page that produced it.
 */
async function recordPayment(activityId, participantId, input) {
	const {
		amountSatang,
		method = 'manual',
		reference = null,
		periodId = null,
		allocations = null,
		expectedSatang = null,
		promptpayTarget = null,
		paymentDestination = null,
		confirmation = null,
		creditorParticipantId = null,
	} = input;
	const normalized = validateAllocations(
		amountSatang,
		allocations || [{ periodId, amountSatang }],
	);
	// Sending money to yourself is not a payment, it is a typo — and one that
	// would quietly cancel itself out of the pair arithmetic instead of failing.
	if (creditorParticipantId && creditorParticipantId === participantId) {
		throw codedError('cannot_pay_yourself');
	}

	return transaction(async (client) => {
		// Both ends of the transfer checked in one query, and both against this
		// activity: a creditor id borrowed from another group would otherwise
		// write a payment that no settlement anywhere could see.
		const wanted = creditorParticipantId ? [participantId, creditorParticipantId] : [participantId];
		const roster = await client.query(
			'SELECT id FROM participants WHERE activity_id = $1 AND id = ANY($2::text[])',
			[activityId, wanted],
		);
		const present = new Set(roster.rows.map(row => row.id));
		if (!present.has(participantId)) throw codedError('participant_not_in_activity');
		if (creditorParticipantId && !present.has(creditorParticipantId)) {
			throw codedError('creditor_not_in_activity');
		}

		const periodIds = normalized.map(item => item.periodId).filter(Boolean);
		if (periodIds.length) {
			const periods = await client.query(
				'SELECT id FROM periods WHERE activity_id = $1 AND id = ANY($2::text[])',
				[activityId, periodIds],
			);
			if (periods.rows.length !== periodIds.length) throw codedError('period_not_in_activity');
		}

		const paymentId = newId('pay');
		const primaryPeriodId = normalized.length === 1 ? normalized[0].periodId : null;
		const res = await client.query(
			`INSERT INTO payments
			   (id, activity_id, period_id, participant_id, creditor_participant_id, amount_satang, method, reference,
			    expected_satang, promptpay_target, payment_destination, status, confirmed_by, confirmed_at,
			    confirmation_source, verification_level)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
			         $12, $13, CASE WHEN $12 = 'confirmed' THEN now() ELSE NULL END, $14, $15)
			 RETURNING *`,
			[
				paymentId, activityId, primaryPeriodId, participantId, creditorParticipantId || null,
				amountSatang, method, reference,
				expectedSatang == null ? Number(amountSatang) : Number(expectedSatang),
				promptpayTarget,
				paymentDestination ? JSON.stringify(paymentDestination) : null,
				confirmation ? 'confirmed' : 'pending',
				confirmation?.actorUserId || null,
				confirmation?.source || null,
				confirmation?.verificationLevel || 'none',
			],
		);
		for (const allocation of normalized) {
			await client.query(
				`INSERT INTO payment_allocations (id, payment_id, period_id, amount_satang)
				 VALUES ($1, $2, $3, $4)`,
				[newId('pal'), paymentId, allocation.periodId, allocation.amountSatang],
			);
		}
		await addPaymentEvent(client, {
			paymentId,
			activityId,
			type: 'created',
			actorParticipantId: participantId,
			metadata: { method, allocations: normalized, creditorParticipantId: creditorParticipantId || null },
		});
		if (confirmation) {
			await addPaymentEvent(client, {
				paymentId,
				activityId,
				type: 'confirmed',
				actorUserId: confirmation.actorUserId || null,
				reason: confirmation.reason || null,
				metadata: {
					source: confirmation.source || 'owner',
					verificationLevel: confirmation.verificationLevel || 'owner_confirmed',
				},
			});
		}
		const row = res.rows[0];
		return {
			id: row.id,
			participantId: row.participant_id,
			creditorParticipantId: row.creditor_participant_id || null,
			amountSatang: Number(row.amount_satang),
			status: row.status,
			allocations: normalized,
		};
	});
}

async function addPaymentEvent(client, {
	paymentId,
	activityId,
	type,
	actorUserId = null,
	actorParticipantId = null,
	reason = null,
	metadata = {},
}) {
	await client.query(
		`INSERT INTO payment_events
		   (id, payment_id, activity_id, event_type, actor_user_id, actor_participant_id, reason, metadata)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
		[
			newId('pev'), paymentId, activityId, type, actorUserId, actorParticipantId,
			reason, JSON.stringify(metadata),
		],
	);
}

// ── slips ───────────────────────────────────────────────────────────────────
//
// A slip is evidence, not bank proof. The optimistic policy may count a strict
// amount/receiver/time/reference match immediately, but labels that decision as
// `slip_matched`, never `bank_verified`, and the owner can reverse it.

const SLIP_VERDICTS = ['unread', 'review', 'matched', 'duplicate'];

/**
 * Attach an image to a payment claim.
 *
 * `ref` is the transaction reference the HTTP/Discord adapter re-parsed from a
 * checksummed slip QR. It is unique across Megu. OCR readings can still be
 * wrong, so the decision level remains explicit and reversible.
 */
async function attachSlip(paymentId, {
	image,
	mime,
	evidenceImage = null,
	evidenceMime = 'image/png',
	evidenceHash = null,
	ref = null,
	bank = null,
	amountSatang = null,
	when = null,
	senderName = null,
	receiverName = null,
	senderAccountTail = null,
	receiverAccountTail = null,
	expectedReceiverName = null,
}) {
	if (!Buffer.isBuffer(image) || image.length === 0) throw new Error('slip_unreadable');
	const read = Number.isInteger(amountSatang) && amountSatang > 0 ? amountSatang : null;

	try {
		return await transaction(async (client) => {
			const locked = await client.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
			if (locked.rows.length === 0) throw new Error('payment_not_found');
			const payment = locked.rows[0];
			if (!['pending', 'rejected'].includes(payment.status)) throw codedError('payment_not_pending');

			const assessment = assessSlip({
				ref,
				expectedSatang: Number(payment.expected_satang || payment.amount_satang),
				amountSatang: read,
				expectedReceiverName,
				receiverName,
				transferredAt: when,
			});
			const autoConfirmed = assessment.decision === 'confirm' && Buffer.isBuffer(evidenceImage) && evidenceImage.length > 0;
			const verdict = autoConfirmed ? 'matched' : (ref ? 'review' : 'unread');
			const original = autoConfirmed ? null : image;
			const transferredAt = assessment.transferredAt;

			const res = await client.query(
				`UPDATE payments
				 SET slip_image = $2, slip_mime = $3, slip_ref = $4,
				     slip_verdict = $5, slip_uploaded_at = now(), method = 'bank_transfer',
				     slip_bank = $6, slip_amount_satang = $7, slip_when = $8,
				     slip_sender_name = $9, slip_receiver_name = $10,
				     slip_sender_account_tail = $11, slip_receiver_account_tail = $12,
				     slip_transferred_at = $13,
				     evidence_image = $14, evidence_mime = $15, evidence_hash = $16,
				     status = CASE WHEN $17 THEN 'confirmed' ELSE 'pending' END,
				     confirmation_source = CASE WHEN $17 THEN 'system_slip_match' ELSE NULL END,
				     verification_level = CASE WHEN $17 THEN 'slip_matched' ELSE 'none' END,
				     confirmed_by = NULL,
				     confirmed_at = CASE WHEN $17 THEN now() ELSE NULL END,
				     reversed_by = NULL, reversed_at = NULL, reversal_reason = NULL
				 WHERE id = $1
				 RETURNING id, activity_id, slip_verdict, slip_uploaded_at, status`,
				[
					paymentId, original, mime || 'image/jpeg', ref, verdict, bank || null, read, when || null,
					senderName || null, receiverName || null,
					onlyAccountTail(senderAccountTail), onlyAccountTail(receiverAccountTail),
					transferredAt, Buffer.isBuffer(evidenceImage) ? evidenceImage : null,
					evidenceMime || 'image/png', evidenceHash || null, autoConfirmed,
				],
			);
			await addPaymentEvent(client, {
				paymentId,
				activityId: payment.activity_id,
				type: 'slip_attached',
				actorParticipantId: payment.participant_id,
				metadata: {
					bank: bank || null,
					ref: ref || null,
					decision: assessment.decision,
					reasons: assessment.reasons,
					flags: assessment.flags,
				},
			});
			if (autoConfirmed) {
				await addPaymentEvent(client, {
					paymentId,
					activityId: payment.activity_id,
					type: 'auto_confirmed',
					metadata: { source: 'system_slip_match', verificationLevel: 'slip_matched' },
				});
			}
			return {
				id: res.rows[0].id,
				verdict: res.rows[0].slip_verdict,
				status: res.rows[0].status,
				autoConfirmed,
				reasons: assessment.reasons,
				flags: assessment.flags,
			};
		});
	}
	catch (error) {
		// 23505 is a unique violation, and the only unique thing about a slip
		// is its reference — this slip has already been used somewhere.
		if (error.code === '23505') {
			// Best effort: leaving a note on the row is useful, but the caller
			// has to hear about the duplicate either way, so a failure here
			// must not replace the error that actually matters.
			await query(
				'UPDATE payments SET slip_verdict = \'duplicate\' WHERE id = $1',
				[paymentId],
			).catch(() => null);
			const duplicate = new Error('slip_duplicate');
			duplicate.code = 'slip_duplicate';
			throw duplicate;
		}
		throw error;
	}
}

function onlyAccountTail(value) {
	const digits = String(value || '').replace(/\D/g, '');
	return digits ? digits.slice(-4) : null;
}

async function getSlip(paymentId) {
	const res = await query(
		`SELECT CASE WHEN status = 'pending' AND slip_image IS NOT NULL THEN slip_image
		             ELSE COALESCE(evidence_image, slip_image) END AS image,
		        CASE WHEN status = 'pending' AND slip_image IS NOT NULL THEN slip_mime
		             WHEN evidence_image IS NOT NULL THEN evidence_mime ELSE slip_mime END AS mime
		 FROM payments
		 WHERE id = $1 AND (evidence_image IS NOT NULL OR slip_image IS NOT NULL)`,
		[paymentId],
	);
	if (res.rows.length === 0) return null;
	return { image: res.rows[0].image, mime: res.rows[0].mime || 'image/jpeg' };
}

/**
 * Expire temporary source images while retaining standardized evidence.
 *
 * These are other people's bank documents, carrying account names and partial
 * account numbers. A final decision drops the source immediately; an owner has
 * seven days to inspect a pending exception before only the allow-listed
 * evidence card and structured fields remain.
 */
async function forgetOldSlips(olderThanDays = 7) {
	const res = await query(
		`UPDATE payments
		 SET slip_image = NULL
		 WHERE slip_image IS NOT NULL
		   AND (status <> 'pending'
		        OR slip_uploaded_at < now() - ($1 * INTERVAL '1 day'))
		 RETURNING id`,
		[olderThanDays],
	);
	return res.rowCount || 0;
}

async function confirmPayment(paymentId, confirmedByUserId, {
	source = 'owner',
	verificationLevel = 'owner_confirmed',
	reason = null,
} = {}) {
	return transaction(async (client) => {
		const res = await client.query(
			`UPDATE payments
			 SET status = 'confirmed', confirmed_by = $2, confirmed_at = now(),
			     confirmation_source = $3, verification_level = $4,
			     reversed_by = NULL, reversed_at = NULL, reversal_reason = NULL,
			     slip_image = NULL
			 WHERE id = $1 AND status IN ('pending', 'rejected', 'reversed') RETURNING *`,
			[paymentId, confirmedByUserId, source, verificationLevel],
		);
		if (res.rows.length === 0) return null;
		const row = res.rows[0];
		await addPaymentEvent(client, {
			paymentId,
			activityId: row.activity_id,
			type: 'confirmed',
			actorUserId: confirmedByUserId,
			reason,
			metadata: { source, verificationLevel },
		});
		return { id: row.id, participantId: row.participant_id, amountSatang: Number(row.amount_satang), status: row.status };
	});
}

/**
 * Take back a confirmation. Confirming the wrong person's payment is the
 * easiest mistake to make on this screen and, until now, the only one that
 * could not be undone.
 */
async function reversePayment(paymentId, actorUserId, reason) {
	const note = String(reason || '').trim();
	if (!note) throw codedError('reversal_reason_required');
	return transaction(async (client) => {
		const res = await client.query(
			`UPDATE payments
			 SET status = 'reversed', reversed_by = $2, reversed_at = now(), reversal_reason = $3,
			     slip_image = NULL
			 WHERE id = $1 AND status = 'confirmed' RETURNING *`,
			[paymentId, actorUserId, note],
		);
		if (res.rows.length === 0) return null;
		const row = res.rows[0];
		await addPaymentEvent(client, {
			paymentId,
			activityId: row.activity_id,
			type: 'reversed',
			actorUserId,
			reason: note,
			metadata: { previousSource: row.confirmation_source },
		});
		return { id: row.id, status: row.status, reason: note };
	});
}

async function unconfirmPayment(paymentId, actorUserId = null, reason = 'owner_undid_confirmation') {
	return reversePayment(paymentId, actorUserId, reason);
}

async function removePayment(paymentId, actorUserId = null, reason = 'owner_removed_claim') {
	return transaction(async (client) => {
		const res = await client.query(
			`UPDATE payments
			 SET status = 'voided', reversed_by = $2, reversed_at = now(), reversal_reason = $3,
			     slip_image = NULL
			 WHERE id = $1 AND status <> 'confirmed' RETURNING *`,
			[paymentId, actorUserId, reason],
		);
		if (res.rows.length === 0) return false;
		await addPaymentEvent(client, {
			paymentId,
			activityId: res.rows[0].activity_id,
			type: 'voided',
			actorUserId,
			reason,
		});
		return true;
	});
}

async function rejectPayment(paymentId, confirmedByUserId, reason) {
	const note = String(reason || '').trim();
	if (!note) throw codedError('rejection_reason_required');
	return transaction(async (client) => {
		const res = await client.query(
			`UPDATE payments
			 SET status = 'rejected', reversed_by = $2, reversed_at = now(), reversal_reason = $3,
			     slip_image = NULL
			 WHERE id = $1 AND status = 'pending' RETURNING *`,
			[paymentId, confirmedByUserId, note],
		);
		if (res.rows.length === 0) return false;
		await addPaymentEvent(client, {
			paymentId,
			activityId: res.rows[0].activity_id,
			type: 'rejected',
			actorUserId: confirmedByUserId,
			reason: note,
		});
		return true;
	});
}

/**
 * Who owes what.
 *
 * Pass a periodId to scope it to one month of a recurring agreement; pass
 * nothing for the whole activity. `state` is the money axis, derived here and
 * never written down, so it can never drift from the rows it summarises.
 */
function settlement(activity, periodId = null) {
	const inScope = row => (periodId === null ? true : row.periodId === periodId);
	// Shared with the pair calculation rather than written twice. Two copies of
	// "how much of this payment belongs to August" is two answers waiting to
	// disagree, and the disagreement would show up as a roster line and a
	// payment screen quoting different numbers for the same month.
	const amountHere = payment => paymentAmountInScope(payment, periodId);

	const byParticipant = new Map(activity.participants.map(p => [p.id, {
		participantId: p.id,
		displayName: p.displayName,
		owes: 0,
		paidOut: 0,
		settled: 0,
		pending: 0,
	}]));

	for (const share of activity.shares.filter(inScope)) {
		const entry = byParticipant.get(share.participantId);
		if (entry) entry.owes += share.amountSatang;
	}
	for (const expense of activity.expenses.filter(inScope)) {
		const entry = byParticipant.get(expense.paidBy);
		if (entry) entry.paidOut += expense.amountSatang;
	}
	for (const payment of activity.payments) {
		const entry = byParticipant.get(payment.participantId);
		if (!entry) continue;
		const amount = amountHere(payment);
		if (payment.status === 'confirmed') entry.settled += amount;
		else if (payment.status === 'pending') entry.pending += amount;
	}

	// Who owes whom, alongside how much each person is up or down.
	//
	// `net` and `outstanding` are unchanged and stay the number every existing
	// caller reads. The pairs are additional: the same money, said in the form
	// somebody can act on, because "you are ฿300 down" does not tell you which
	// two people to send it to.
	const obligations = pairwiseObligations(activity, periodId);

	const rows = [...byParticipant.values()].map((entry) => {
		const net = entry.owes - entry.paidOut;
		const mine = obligationsFor(obligations, entry.participantId);
		return {
			...entry,
			net,
			outstanding: net - entry.settled,
			owesTo: mine.owesTo,
			owedBy: mine.owedBy,
			owesTotal: mine.owesTotalSatang,
			owedTotal: mine.owedTotalSatang,
			overpaid: mine.overpaidSatang,
		};
	});

	const expenses = activity.expenses.filter(inScope);
	const total = expenses.reduce((sum, e) => sum + e.amountSatang, 0);
	const unpaid = rows.filter(r => r.outstanding > 0);

	let state = 'none';
	if (expenses.length > 0) state = unpaid.length === 0 ? 'settled' : 'open';

	// Confirmed money that predates the creditor column, and therefore had to be
	// spread across this person's debts by guesswork. A screen showing a figure
	// derived this way is required to say so.
	const hasLegacyPayments = (activity.payments || []).some(payment => payment.status === 'confirmed'
		&& !payment.creditorParticipantId
		&& amountHere(payment) > 0);

	return { state, total, rows, unpaid, obligations, hasLegacyPayments, fullySettled: state === 'settled' };
}

/**
 * The current month for a recurring agreement, or null for a one-off.
 */
function currentPeriod(activity, date = new Date()) {
	if (activity.kind !== 'recurring') return null;
	const key = periodKeyFor(date);
	return activity.periods.find(p => p.key === key) || activity.periods[0] || null;
}

/** Explicit Discord payment intake. This is only called by `/จ่าย`; ordinary
 * channel messages are never scanned for financial evidence. */
async function listPaymentCandidatesForDiscord(discordUid, guildId = null, search = '') {
	const identity = await query(
		'SELECT user_id FROM identities WHERE provider = \'discord\' AND provider_uid = $1 LIMIT 1',
		[String(discordUid)],
	);
	const linkedUserId = identity.rows[0]?.user_id || null;
	const found = await query(
		`SELECT DISTINCT p.activity_id
		 FROM participants p
		 JOIN activities a ON a.id = p.activity_id
		 LEFT JOIN identities i
		   ON i.user_id = p.user_id AND i.provider = 'discord'
		 WHERE (p.discord_uid = $1 OR i.provider_uid = $1)
		   AND ($2::text IS NULL OR a.guild_id = $2 OR a.guild_id IS NULL)`,
		[String(discordUid), guildId ? String(guildId) : null],
	);
	const needle = String(search || '').trim().toLocaleLowerCase('th-TH');
	const candidates = [];
	for (const row of found.rows) {
		const activity = await getActivity(row.activity_id);
		if (!activity) continue;
		if (needle && activity.code.toLocaleLowerCase('th-TH') !== needle
			&& !activity.title.toLocaleLowerCase('th-TH').includes(needle)) continue;
		const participant = activity.participants.find(item => item.discordUid === String(discordUid))
			|| activity.participants.find(item => linkedUserId && item.userId === linkedUserId);
		if (!participant) continue;

		const periods = [];
		if (activity.kind === 'recurring') {
			for (const period of activity.periods) {
				const standing = settlement(activity, period.id).rows.find(item => item.participantId === participant.id);
				const available = Math.max(0, (standing?.outstanding || 0) - (standing?.pending || 0));
				if (available > 0) periods.push({ id: period.id, key: period.key, outstandingSatang: available });
			}
		}
		else {
			const standing = settlement(activity).rows.find(item => item.participantId === participant.id);
			const available = Math.max(0, (standing?.outstanding || 0) - (standing?.pending || 0));
			if (available > 0) periods.push({ id: null, key: null, outstandingSatang: available });
		}
		if (periods.length === 0) continue;

		const ownerIdentity = await query(
			`SELECT provider_uid FROM identities
			 WHERE user_id = $1 AND provider = 'discord' LIMIT 1`,
			[activity.ownerUserId],
		);
		candidates.push({
			activityId: activity.id,
			code: activity.code,
			title: activity.title,
			kind: activity.kind,
			participantId: participant.id,
			participantName: participant.displayName,
			payee: activity.payee,
			ownerUserId: activity.ownerUserId,
			ownerDiscordUid: ownerIdentity.rows[0]?.provider_uid || null,
			periods,
			outstandingSatang: periods.reduce((total, period) => total + period.outstandingSatang, 0),
		});
	}
	return candidates.sort((a, b) => a.title.localeCompare(b.title, 'th'));
}

module.exports = {
	PLAN_STATES,
	PLAN_TRANSITIONS,
	MONEY_STATES,
	KINDS,
	RSVP,
	SLOT_ANSWERS,
	SUPPORTED_CURRENCIES,
	PAYMENT_OPTION_TYPES,
	SLIP_VERDICTS,
	normalisePaymentOptions,
	canTransition,
	proposeSlots,
	voteSlot,
	slotStanding,
	pollReady,
	pollAnsweredCount,
	bestSlot,
	lockBestSlot,
	createActivity,
	getActivity,
	getActivityByCode,
	getActivityByParticipant,
	listActivitiesForOwner,
	addParticipant,
	claimParticipant,
	renameParticipant,
	removeParticipant,
	resetClaim,
	setRsvp,
	setAttended,
	setPlanState,
	updateActivity,
	DEFERRAL_SNOOZE_HOURS,
	deferPayment,
	activeDeferrals,
	ensurePeriod,
	periodKeyFor,
	periodLabelFor,
	periodDueAt,
	currentPeriod,
	listPaymentCandidatesForDiscord,
	addExpense,
	updateExpense,
	removeExpense,
	recordPayment,
	confirmPayment,
	reversePayment,
	unconfirmPayment,
	removePayment,
	rejectPayment,
	settlement,
	resolvePayee,
	setPayee,
	attachSlip,
	getSlip,
	forgetOldSlips,
};
