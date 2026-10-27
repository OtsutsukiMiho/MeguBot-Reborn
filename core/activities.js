const crypto = require('node:crypto');
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
const CREATION_MODES = {
	planning: 'open',
	scheduled: 'confirmed',
	settle: 'done',
};

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
		recurringChange: row.recurring_change || null,
		guildId: row.guild_id,
		channelId: row.channel_id,
		cardMessageId: row.card_message_id || null,
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
	return require('./format.js').periodKeyFor(new Date(date));
}

function periodLabelFor(key) {
	const [year, month] = key.split('-').map(Number);
	return `${THAI_MONTHS[month - 1]} ${year + 543}`;
}

function periodDueAt(key, dueDay) {
	const [year, month] = key.split('-').map(Number);
	const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
	const day = Math.min(dueDay || 1, lastDay);
	// The last second of the due day in Bangkok, the same convention as a
	// one-off bill's paymentDueAt. It used to be 17:00Z — midnight *after* the
	// due day — so "due on the 5th" was announced and printed as the 6th.
	return new Date(Date.UTC(year, month - 1, day, 16, 59, 59));
}

const SPLIT_MODES = new Set(['even', 'exact', 'percent', 'shares']);

function stableValue(value) {
	if (value === undefined) return null;
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return value.map(stableValue);
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
	}
	return value;
}

function creationFingerprint(input) {
	const copy = { ...input };
	delete copy.requestId;
	delete copy.idempotencyKey;
	return crypto.createHash('sha256')
		.update(JSON.stringify(stableValue(copy)))
		.digest('hex');
}

function normaliseRequestId(value) {
	if (value === undefined || value === null || value === '') return null;
	if (typeof value !== 'string') throw codedError('request_id_invalid');
	const requestId = value.trim();
	if (!requestId || requestId.length > 200) throw codedError('request_id_invalid');
	return requestId;
}

function markIdempotent(activity, idempotent) {
	Object.defineProperty(activity, 'idempotent', {
		value: Boolean(idempotent),
		enumerable: false,
		configurable: true,
	});
	return activity;
}

function initialExpenseError(code, message = code) {
	return codedError(code, message);
}

function positionValue(value, participantCount, code) {
	if (!Number.isSafeInteger(value) || value < 0 || value >= participantCount) {
		throw initialExpenseError(code);
	}
	return value;
}

/**
 * The creation wizard names people by their roster position because it has no
 * database ids until the activity is saved. Keep that representation through
 * validation, then map it to participant ids immediately before addExpense.
 */
function normaliseInitialSplit(split, sharePositions, participantCount) {
	if (split === undefined || split === null) return null;
	if (!split || typeof split !== 'object' || Array.isArray(split)) {
		throw initialExpenseError('initial_expense_split_invalid');
	}
	const mode = String(split.mode || '');
	if (!SPLIT_MODES.has(mode)) throw initialExpenseError('initial_expense_split_invalid');
	if (mode === 'even') return { mode: 'even', values: null };

	const raw = split.values;
	if (!raw || (typeof raw !== 'object' && !Array.isArray(raw))) {
		throw initialExpenseError('initial_expense_split_invalid');
	}
	const values = {};
	if (Array.isArray(raw)) {
		if (raw.length === sharePositions.length) {
			sharePositions.forEach((position, index) => { values[position] = raw[index]; });
		}
		else if (raw.length === participantCount) {
			sharePositions.forEach(position => { values[position] = raw[position]; });
		}
		else throw initialExpenseError('initial_expense_split_invalid');
	}
	else {
		for (const [key, value] of Object.entries(raw)) {
			if (!/^\d+$/.test(key)) throw initialExpenseError('initial_expense_split_invalid');
			const position = Number(key);
			if (!sharePositions.includes(position)) throw initialExpenseError('initial_expense_split_invalid');
			values[position] = value;
		}
	}

	for (const position of sharePositions) {
		if (!Object.prototype.hasOwnProperty.call(values, position)) {
			throw initialExpenseError('initial_expense_split_invalid');
		}
	}
	if (mode === 'exact') {
		for (const value of Object.values(values)) {
			const amount = Number(value);
			if (!Number.isSafeInteger(amount) || amount < 0) {
				throw initialExpenseError('initial_expense_split_invalid');
			}
		}
	}
	if (mode === 'shares') {
		for (const value of Object.values(values)) {
			const weight = Number(value);
			if (!Number.isSafeInteger(weight) || weight < 0) {
				throw initialExpenseError('initial_expense_split_invalid');
			}
		}
	}
	return { mode, values };
}

function normaliseInitialExpenses(rawExpenses, participants) {
	if (!Array.isArray(rawExpenses) || rawExpenses.length > 50) {
		throw initialExpenseError('initial_expenses_invalid');
	}
	return rawExpenses.map((expense) => {
		if (!expense || typeof expense !== 'object' || Array.isArray(expense)) {
			throw initialExpenseError('initial_expenses_invalid');
		}
		const label = String(expense.label ?? '').trim();
		if (!label) throw initialExpenseError('initial_expense_label_required');

		let amountSatang = expense.amountSatang;
		if (amountSatang === undefined && expense.amountBaht !== undefined) {
			const amountBaht = Number(expense.amountBaht);
			amountSatang = Number.isFinite(amountBaht) ? Math.round(amountBaht * 100) : amountBaht;
		}
		if (!Number.isSafeInteger(amountSatang) || amountSatang <= 0) {
			throw initialExpenseError('initial_expense_amount_invalid');
		}

		const paidByPosition = positionValue(
			expense.paidByPosition,
			participants.length,
			'initial_expense_paid_by_position_invalid',
		);
		if (!Array.isArray(expense.sharePositions) || expense.sharePositions.length === 0) {
			throw initialExpenseError('initial_expense_share_positions_invalid');
		}
		const sharePositions = expense.sharePositions.map(position => positionValue(
			position,
			participants.length,
			'initial_expense_position_invalid',
		));
		if (new Set(sharePositions).size !== sharePositions.length) {
			throw initialExpenseError('initial_expense_share_positions_invalid');
		}

		const split = normaliseInitialSplit(expense.split, sharePositions, participants.length);
		// Resolve once against the position names before opening the transaction.
		// This catches an unbalanced exact/percent/weighted split before the first
		// activity row is written, while the real write below resolves it again
		// against the newly-created participant ids.
		if (split) {
			resolveSplit(
				amountSatang,
				sharePositions.map(String),
				{
					mode: split.mode,
					values: split.values && Object.fromEntries(
						Object.entries(split.values).map(([position, value]) => [String(position), value]),
					),
				},
			);
		}

		return {
			label,
			amountSatang,
			paidByPosition,
			sharePositions,
			split,
		};
	});
}

function mapInitialSplit(split, sharePositions, participantIds) {
	if (!split) return null;
	if (split.mode === 'even') return { mode: 'even' };
	return {
		mode: split.mode,
		values: Object.fromEntries(sharePositions.map(position => [participantIds[position], split.values[position]])),
	};
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
		creationMode = null,
		planState = null,
		requestId = null,
		periodAt = null,
	} = input;

	if (!ownerUserId) throw new Error('ownerUserId is required');
	if (typeof title !== 'string' || !title.trim()) throw new Error('title is required');
	if (!KINDS.includes(kind)) throw new Error(`unknown activity kind: ${kind}`);
	if (kind === 'recurring' && recurrence !== 'monthly') {
		throw new Error('recurring activities currently support monthly only');
	}
	if (!Array.isArray(participants) || participants.length === 0) {
		throw codedError('participant_required');
	}
	if (participants.length > 50) throw codedError('participants_too_many');
	const cleanParticipants = participants.map((participant) => {
		if (!participant || typeof participant !== 'object' || Array.isArray(participant)) {
			throw codedError('participant_invalid');
		}
		return {
			displayName: cleanDisplayName(participant.displayName),
			userId: participant.userId || null,
			discordUid: participant.discordUid ? String(participant.discordUid) : null,
		};
	});
	if (creationMode !== null && creationMode !== undefined && !Object.prototype.hasOwnProperty.call(CREATION_MODES, creationMode)) {
		throw codedError('creation_mode_invalid');
	}
	if (kind === 'recurring' && creationMode) {
		throw codedError('creation_mode_invalid');
	}
	const storedPlanState = creationMode
		? CREATION_MODES[creationMode]
		: (planState || (kind === 'recurring' ? 'confirmed' : 'open'));
	if (!['open', 'confirmed', 'done'].includes(storedPlanState)) {
		throw codedError('plan_state_invalid');
	}
	const hasInitialExpenses = Object.prototype.hasOwnProperty.call(input, 'initialExpenses');
	const initialExpenses = hasInitialExpenses
		? normaliseInitialExpenses(input.initialExpenses, cleanParticipants)
		: [];
	const storedRequestId = normaliseRequestId(requestId);
	const requestHash = storedRequestId
		? crypto.createHash('sha256').update(`${ownerUserId}\0${storedRequestId}`).digest('hex').slice(0, 40)
		: null;
	const bodyHash = storedRequestId ? creationFingerprint({
		ownerUserId,
		title: title.trim(),
		kind,
		location,
		startsAt,
		guildId,
		channelId,
		recurrence,
		dueDay,
		paymentDueAt,
		currency,
		paymentOptions,
		participants: cleanParticipants,
		creationMode,
		planState: storedPlanState,
		hasInitialExpenses,
		initialExpenses,
	}).slice(0, 40) : null;
	const deterministicActivityId = requestHash && bodyHash
		? `act_req_${requestHash}_${bodyHash}`
		: null;
	const storedCurrency = cleanCurrency(currency);
	const storedPaymentOptions = normalisePaymentOptions(paymentOptions);

	return transaction(async (client) => {
		if (storedRequestId) {
			// The lock makes two simultaneous first attempts converge before either
			// one checks the durable activity key. It is database-scoped and lives
			// only for this transaction; no process-local cache is involved.
			await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`activity-create:${ownerUserId}:${storedRequestId}`]);
			const previous = await client.query(
				`SELECT id, code, owner_user_id, title, kind, plan_state, location,
				        starts_at, currency, payment_options, recurrence, due_day,
				        payment_due_at, payee_participant_id, guild_id, channel_id,
				        created_at, updated_at, closed_at
				 FROM activities
				 WHERE owner_user_id = $1 AND id LIKE $2
				 ORDER BY created_at DESC`,
				[ownerUserId, `act_req_${requestHash}_%`],
			);
			if (previous.rows.length > 0) {
				const existing = previous.rows.find(row => row.id === deterministicActivityId);
				if (!existing) throw codedError('request_id_conflict');
				return markIdempotent(rowToActivity(existing), true);
			}
		}

		const activityId = deterministicActivityId || newId('act');
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
				// A monthly agreement has nothing to agree on — it just runs unless
				// a wizard explicitly supplied a plan state for a one-off activity.
				storedPlanState,
				JSON.stringify(storedPaymentOptions),
			],
		);

		const participantIds = [];
		for (const [index, p] of cleanParticipants.entries()) {
			const participant = await client.query(
				`INSERT INTO participants (id, activity_id, display_name, user_id, discord_uid, rsvp, position)
				 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
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
			participantIds.push(participant.rows[0].id);
		}

		let periodId = null;
		// A wizard-created recurring activity owns its first period from the
		// beginning. Legacy callers without `initialExpenses` keep the previous
		// deferred ensurePeriod behavior, which is used by the monthly suites.
		if (kind === 'recurring' && hasInitialExpenses) {
			const at = periodAt == null ? new Date() : new Date(periodAt);
			if (Number.isNaN(at.getTime())) throw codedError('period_date_invalid');
			const key = periodKeyFor(at);
			const period = await client.query(
				`INSERT INTO periods (id, activity_id, period_key, label, due_at)
				 VALUES ($1, $2, $3, $4, $5)
				 ON CONFLICT (activity_id, period_key) DO NOTHING RETURNING *`,
				[newId('per'), activityId, key, periodLabelFor(key), periodDueAt(key, dueDay)],
			);
			periodId = period.rows[0]?.id || null;
			if (!periodId) throw codedError('period_create_failed');
		}

		for (const expense of initialExpenses) {
			await addExpense(activityId, {
				label: expense.label,
				amountSatang: expense.amountSatang,
				paidBy: participantIds[expense.paidByPosition],
				shareParticipantIds: expense.sharePositions.map(position => participantIds[position]),
				periodId,
				split: mapInitialSplit(expense.split, expense.sharePositions, participantIds),
			}, client);
		}

		return markIdempotent(rowToActivity(res.rows[0]), false);
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
		// Something to show only while it waits (the original) or once it is
		// confirmed (the virtual slip, drawn on request); see getSlip.
		hasSlip: Boolean(r.slip_uploaded_at) && ['pending', 'confirmed'].includes(r.status),
		hasEvidence: Boolean(r.slip_uploaded_at) && r.status === 'confirmed',
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
		slipReceiverName: r.slip_receiver_name || null,
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
		'UPDATE activities SET learned_receiver_name = CASE WHEN payee_participant_id IS DISTINCT FROM $2 THEN NULL ELSE learned_receiver_name END, payee_participant_id = $2, updated_at = now() WHERE id = $1 RETURNING *',
		[activityId, participantId || null],
	);
	return rowToActivity(res.rows[0]);
}

/**
 * Whose card the subscription is on. That person fronted the money, so this
 * month's bill is marked as paid by them and everybody's share goes to their
 * PromptPay. Later months copy the bill, so they follow without being told.
 *
 * Refused once any money has been sent for the month: a slip already checked
 * against one person's account must not quietly become a debt to another.
 */
async function setRecurringPayer(activityId, participantId, { now = new Date() } = {}) {
	// This month, opened here if the rollover has not run yet. Taking the
	// period from the caller let a pick on the 1st, before the new month
	// existed, rewrite last month's bill instead.
	await ensurePeriod(activityId, now, { rollover: true });
	return transaction(async (client) => {
		const locked = await client.query('SELECT kind FROM activities WHERE id = $1 FOR UPDATE', [activityId]);
		if (!locked.rows.length) throw codedError('activity_not_found');
		if (locked.rows[0].kind !== 'recurring') throw codedError('not_recurring');
		const member = await client.query('SELECT id FROM participants WHERE id = $1 AND activity_id = $2', [participantId, activityId]);
		if (!member.rows.length) throw codedError('participant_not_in_activity');
		const periodId = await thisMonthPeriodId(client, activityId, now);
		if (await monthHasMoney(client, activityId, periodId)) throw codedError('payer_locked');
		await client.query('UPDATE activities SET learned_receiver_name = CASE WHEN payee_participant_id IS DISTINCT FROM $2 THEN NULL ELSE learned_receiver_name END, payee_participant_id = $2, updated_at = now() WHERE id = $1', [activityId, participantId]);
		await client.query('UPDATE expenses SET paid_by = $3 WHERE activity_id = $1 AND period_id = $2', [activityId, periodId, participantId]);
		return { participantId, periodId };
	});
}

/**
 * Who paid first on a one-off bill: the creator unless told otherwise. The
 * bill is marked as paid by them and everybody's share goes to them, the
 * same move setRecurringPayer makes for one month of a subscription.
 *
 * Refused once any money has been sent, for the same reason, and when the
 * bill already has more than one person paying for parts of it (set up on
 * the web), since moving all of it to one person would erase that.
 */
async function setEventPayer(activityId, participantId) {
	return transaction(async (client) => {
		const locked = await client.query('SELECT kind FROM activities WHERE id = $1 FOR UPDATE', [activityId]);
		if (!locked.rows.length) throw codedError('activity_not_found');
		if (locked.rows[0].kind === 'recurring') throw codedError('not_event');
		const member = await client.query('SELECT id FROM participants WHERE id = $1 AND activity_id = $2', [participantId, activityId]);
		if (!member.rows.length) throw codedError('participant_not_in_activity');
		const sent = await client.query(
			"SELECT 1 FROM payments WHERE activity_id = $1 AND status IN ('pending', 'confirmed') LIMIT 1",
			[activityId],
		);
		if (sent.rows.length) throw codedError('payer_locked');
		const payers = await client.query('SELECT DISTINCT paid_by FROM expenses WHERE activity_id = $1', [activityId]);
		if (payers.rows.length > 1) throw codedError('payer_mixed');
		await client.query(
			'UPDATE activities SET learned_receiver_name = CASE WHEN payee_participant_id IS DISTINCT FROM $2 THEN NULL ELSE learned_receiver_name END, payee_participant_id = $2, updated_at = now() WHERE id = $1',
			[activityId, participantId],
		);
		await client.query('UPDATE expenses SET paid_by = $2 WHERE activity_id = $1', [activityId, participantId]);
		return { participantId };
	});
}

/** The id of the period covering `now`. The caller has already opened it. */
async function thisMonthPeriodId(client, activityId, now) {
	const period = await client.query('SELECT id FROM periods WHERE activity_id = $1 AND period_key = $2', [activityId, periodKeyFor(now)]);
	if (!period.rows.length) throw codedError('period_missing');
	return period.rows[0].id;
}

/**
 * Whether any money has been sent for a month, confirmed or still being
 * checked. The one rule behind both locks: once it has, neither the payer nor
 * the split of that month may change under it.
 */
async function monthHasMoney(client, activityId, periodId) {
	const sent = await client.query(
		`SELECT 1 FROM payments p
		 LEFT JOIN payment_allocations pa ON pa.payment_id = p.id
		 WHERE p.activity_id = $1 AND p.status IN ('pending', 'confirmed')
		   AND (p.period_id = $2 OR pa.period_id = $2)
		 LIMIT 1`,
		[activityId, periodId],
	);
	return sent.rows.length > 0;
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

/**
 * Open the current month for every recurring activity owned by a user.
 * Creating a period is idempotent, so this is safe to run when a dashboard
 * or reminder sweep crosses a month boundary.
 */
async function ensureCurrentPeriodsForOwner(ownerUserId, at = new Date()) {
	const rows = await query(
		`SELECT id FROM activities WHERE owner_user_id = $1 AND kind = 'recurring' AND plan_state <> 'cancelled'`,
		[ownerUserId],
	);
	const results = [];
	for (const row of rows.rows) results.push(await ensurePeriod(row.id, at, { rollover: true }));
	return results;
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
 * Whether Megu has heard enough to call it. Megu waits for everyone who is
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
async function ensurePeriod(activityId, date = new Date(), { rollover = false, expense = null } = {}) {
	const activity = await getActivity(activityId);
	if (!activity) throw new Error('activity not found');
	if (activity.kind !== 'recurring') throw new Error('only recurring activities have periods');

	const key = periodKeyFor(date);
	const existing = activity.periods.find(p => p.key === key);
	if (existing) return { period: existing, created: false };

	const period = await transaction(async (client) => {
		const locked = await client.query('SELECT plan_state FROM activities WHERE id = $1 FOR UPDATE', [activityId]);
		if (!locked.rows.length) throw new Error('activity not found');
		if (rollover && locked.rows[0].plan_state === 'cancelled') throw codedError('activity_cancelled');
		const res = await client.query(
			`INSERT INTO periods (id, activity_id, period_key, label, due_at)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (activity_id, period_key) DO NOTHING
			 RETURNING *`,
			[newId('per'), activityId, key, periodLabelFor(key), periodDueAt(key, activity.dueDay)],
		);
		if (res.rows.length === 0) return null;
		if (expense) await addExpense(activityId, { ...expense, periodId: res.rows[0].id }, client);
		else if (rollover) await copyPreviousPeriod(client, activityId, key, res.rows[0].id);
		return rowToPeriod(res.rows[0]);
	});

	if (!period) {
		const again = await getActivity(activityId);
		return { period: again.periods.find(p => p.key === key), created: false };
	}
	return { period, created: true };
}

// Only a newly inserted period inherits the prior month's ledger. Payments
// remain attached to their original periods. The caller owns the transaction.
async function copyPreviousPeriod(client, activityId, key, periodId) {
	const previous = await client.query(
		'SELECT id FROM periods WHERE activity_id = $1 AND period_key < $2 ORDER BY period_key DESC LIMIT 1',
		[activityId, key],
	);
	if (!previous.rows.length) return;
	const expenses = await client.query('SELECT * FROM expenses WHERE activity_id = $1 AND period_id = $2 ORDER BY id FOR SHARE', [activityId, previous.rows[0].id]);

	// A change that was waiting for this month: the new price and people, split
	// evenly, instead of a copy of last month. Only a single-bill month has an
	// unambiguous "the price", which is what changeSubscription() allows.
	const waiting = await client.query('SELECT recurring_change FROM activities WHERE id = $1', [activityId]);
	const change = waiting.rows[0]?.recurring_change;
	if (change && key >= change.from && expenses.rows.length === 1) {
		const [expense] = expenses.rows;
		const shares = await client.query('SELECT participant_id FROM shares WHERE expense_id = $1 ORDER BY id', [expense.id]);
		const target = applySubscriptionChange(shares.rows.map(r => r.participant_id), Number(expense.amount_satang), change);
		await insertEvenExpense(client, { activityId, periodId, label: expense.label, paidBy: expense.paid_by, ...target });
		await client.query('UPDATE activities SET recurring_change = NULL WHERE id = $1', [activityId]);
		return;
	}
	// Due, but the month has since grown a second cost on the web, so "the
	// price" no longer means one thing. Dropped rather than left waiting for a
	// month it can never apply to, announced on the card forever.
	if (change && key >= change.from) {
		await client.query('UPDATE activities SET recurring_change = NULL WHERE id = $1', [activityId]);
	}

	for (const expense of expenses.rows) {
		const shares = await client.query('SELECT participant_id, amount_satang FROM shares WHERE expense_id = $1', [expense.id]);
		if (shares.rows.reduce((sum, share) => sum + BigInt(share.amount_satang), 0n) !== BigInt(expense.amount_satang)) {
			throw codedError('recurring_split_invalid');
		}
		const expenseId = newId('exp');
		await client.query(
			`INSERT INTO expenses (id, activity_id, period_id, label, amount_satang, paid_by, split_mode, split_values)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
			[expenseId, activityId, periodId, expense.label, expense.amount_satang, expense.paid_by, expense.split_mode, expense.split_values == null ? null : JSON.stringify(expense.split_values)],
		);
		for (const share of shares.rows) {
			await client.query('INSERT INTO shares (id, expense_id, participant_id, amount_satang) VALUES ($1, $2, $3, $4)', [newId('shr'), expenseId, share.participant_id, share.amount_satang]);
		}
	}
}

// ── a subscription that changes ─────────────────────────────────────────────

function nextPeriodKey(key) {
	const [year, month] = key.split('-').map(Number);
	const next = new Date(Date.UTC(year, month, 1));
	return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Fold a new change into one already waiting. The latest word on a person or the price wins. */
function mergeSubscriptionChange(previous, change) {
	const leave = new Set(previous?.leave || []);
	const join = new Set(previous?.join || []);
	for (const id of change.leave || []) { leave.add(id); join.delete(id); }
	for (const id of change.join || []) { join.add(id); leave.delete(id); }
	return {
		amountSatang: change.amountSatang ?? previous?.amountSatang ?? null,
		leave: [...leave],
		join: [...join],
	};
}

/** Who shares the bill and for how much once a change is applied. Order is kept, newcomers last. */
function applySubscriptionChange(sharerIds, amountSatang, change) {
	const leave = new Set(change?.leave || []);
	const ids = sharerIds.filter(id => !leave.has(id));
	for (const id of change?.join || []) if (!ids.includes(id) && !leave.has(id)) ids.push(id);
	return { sharerIds: ids, amountSatang: change?.amountSatang ?? amountSatang };
}

async function insertEvenExpense(client, { activityId, periodId, label, paidBy, sharerIds, amountSatang }) {
	const resolved = resolveSplit(amountSatang, sharerIds, null);
	const expenseId = newId('exp');
	await client.query(
		`INSERT INTO expenses (id, activity_id, period_id, label, amount_satang, paid_by, split_mode, split_values)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
		[expenseId, activityId, periodId, label, amountSatang, paidBy, resolved.mode, resolved.values ? JSON.stringify(resolved.values) : null],
	);
	for (const [participantId, share] of Object.entries(resolved.split)) {
		await client.query('INSERT INTO shares (id, expense_id, participant_id, amount_satang) VALUES ($1, $2, $3, $4)', [newId('shr'), expenseId, participantId, share]);
	}
	return expenseId;
}

/**
 * Change a monthly bill: a new price, people joining, people leaving.
 *
 * While nobody has sent money for the current month it is simply rewritten.
 * Once someone has, this month stays as everybody already agreed to and paid
 * against, and the change waits for next month (`recurring_change`). That is
 * the rule the user chose; the alternative was refunds and top-ups by hand.
 *
 * The person whose card pays cannot leave: they are the one being paid back.
 * Bills with more than one cost a month are edited on the web instead, since
 * "the price" would not mean one thing.
 *
 * @returns {{ when: 'now'|'next', periodKey: string, sharerIds: string[], amountSatang: number }}
 */
async function changeSubscription(activityId, change, { now = new Date() } = {}) {
	const amountSatang = change.amountSatang == null ? null : Number(change.amountSatang);
	if (amountSatang != null && (!Number.isSafeInteger(amountSatang) || amountSatang <= 0)) throw codedError('amount_invalid');
	// The month a change is about has to exist. On the 1st, before the hourly
	// rollover, it may not yet, and a join or a leave must not fail for that.
	await ensurePeriod(activityId, now, { rollover: true });
	return transaction(async (client) => {
		const locked = await client.query('SELECT kind, payee_participant_id, recurring_change FROM activities WHERE id = $1 FOR UPDATE', [activityId]);
		if (!locked.rows.length) throw codedError('activity_not_found');
		if (locked.rows[0].kind !== 'recurring') throw codedError('not_recurring');
		const roster = new Set((await client.query('SELECT id FROM participants WHERE activity_id = $1', [activityId])).rows.map(r => r.id));
		for (const id of [...(change.join || []), ...(change.leave || [])]) {
			if (!roster.has(id)) throw codedError('participant_not_in_activity');
		}

		const key = periodKeyFor(now);
		const periodId = await thisMonthPeriodId(client, activityId, now);
		const expenses = await client.query('SELECT * FROM expenses WHERE period_id = $1 FOR UPDATE', [periodId]);
		if (expenses.rows.length !== 1) throw codedError('change_needs_web');
		const [expense] = expenses.rows;
		const payer = locked.rows[0].payee_participant_id || expense.paid_by;
		if ((change.leave || []).includes(payer) || (change.leave || []).includes(expense.paid_by)) throw codedError('payer_cannot_leave');

		const shares = await client.query('SELECT participant_id FROM shares WHERE expense_id = $1 ORDER BY id', [expense.id]);
		const merged = mergeSubscriptionChange(locked.rows[0].recurring_change, { ...change, amountSatang });
		const target = applySubscriptionChange(shares.rows.map(r => r.participant_id), Number(expense.amount_satang), merged);
		if (target.sharerIds.length === 0) throw codedError('nobody_left');

		if (!(await monthHasMoney(client, activityId, periodId))) {
			const resolved = resolveSplit(target.amountSatang, target.sharerIds, null);
			await client.query(
				'UPDATE expenses SET amount_satang = $2, split_mode = $3, split_values = $4::jsonb WHERE id = $1',
				[expense.id, target.amountSatang, resolved.mode, resolved.values ? JSON.stringify(resolved.values) : null],
			);
			await client.query('DELETE FROM shares WHERE expense_id = $1', [expense.id]);
			for (const [participantId, share] of Object.entries(resolved.split)) {
				await client.query('INSERT INTO shares (id, expense_id, participant_id, amount_satang) VALUES ($1, $2, $3, $4)', [newId('shr'), expense.id, participantId, share]);
			}
			// This month already is the new plan, so nothing is left waiting.
			await client.query('UPDATE activities SET recurring_change = NULL, updated_at = now() WHERE id = $1', [activityId]);
			return { when: 'now', periodKey: key, ...target };
		}

		const from = nextPeriodKey(key);
		await client.query('UPDATE activities SET recurring_change = $2::jsonb, updated_at = now() WHERE id = $1', [activityId, JSON.stringify({ ...merged, from })]);
		return { when: 'next', periodKey: from, ...target };
	});
}

/** What next month will look like, when a change is waiting for it. For the card. */
function upcomingSubscription(activity, period) {
	const change = activity.recurringChange;
	if (!change || !period) return null;
	const expenses = activity.expenses.filter(e => e.periodId === period.id);
	if (expenses.length !== 1) return null;
	const sharers = activity.shares.filter(s => s.expenseId === expenses[0].id).map(s => s.participantId);
	return { periodKey: change.from, join: change.join || [], leave: change.leave || [], ...applySubscriptionChange(sharers, expenses[0].amountSatang, change) };
}

// ── money axis ──────────────────────────────────────────────────────────────

async function addExpense(activityId, input, transactionClient = null) {
	const { label, amountSatang, paidBy, shareParticipantIds = null, periodId = null, split: splitSpec = null } = input;

	if (!Number.isInteger(amountSatang) || amountSatang <= 0) {
		throw codedError('amount_invalid');
	}

	const run = transactionClient ? operation => operation(transactionClient) : transaction;
	return run(async (client) => {
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
// cannot be used to switch Megu off: two days later Megu asks again, and the
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
 * Where the bill's Discord messages go. Kept out of updateActivity on
 * purpose: that one takes input from the web, and a channel is decided by
 * the bot when it creates the bill's private thread, never by a form.
 */
async function setActivityChannel(activityId, channelId) {
	await query('UPDATE activities SET channel_id = $2, updated_at = now() WHERE id = $1', [activityId, channelId || null]);
}

/**
 * The bill whose own thread this is, by code. Null when no bill or more than
 * one bill points at the channel: a channel shared by several bills says
 * nothing about which one is meant.
 */
async function getActivityCodeByChannel(channelId) {
	if (!channelId) return null;
	const res = await query('SELECT code FROM activities WHERE channel_id = $1 LIMIT 2', [String(channelId)]);
	return res.rows.length === 1 ? res.rows[0].code : null;
}

/** Which message in the bill's channel is its card. */
async function setCardMessage(activityId, messageId) {
	await query('UPDATE activities SET card_message_id = $2 WHERE id = $1', [activityId, messageId || null]);
}

/** The server's bills channel, or null when Megu has not opened one yet. */
async function getBillChannel(guildId) {
	const res = await query('SELECT channel_id FROM bill_channels WHERE guild_id = $1', [guildId]);
	return res.rows[0]?.channel_id || null;
}

async function setBillChannel(guildId, channelId) {
	await query(
		`INSERT INTO bill_channels (guild_id, channel_id) VALUES ($1, $2)
		ON CONFLICT (guild_id) DO UPDATE SET channel_id = EXCLUDED.channel_id, updated_at = now()`,
		[guildId, channelId],
	);
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
 *
 * No evidence card is drawn here. The card is the record of money that
 * arrived, so it exists only for a confirmed payment and is drawn from the
 * stored fields when someone asks to see it (getSlip). Until then the
 * original stays for the receiver to look at, and goes once they decide.
 */
async function attachSlip(paymentId, {
	image,
	mime,
	ref = null,
	bank = null,
	amountSatang = null,
	when = null,
	receiverName = null,
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

			// What the slip is checked against besides the amount: the name the
			// receiver confirmed on an earlier slip of this bill, and the
			// earliest a transfer for this bill can plausibly be dated.
			const context = await client.query(
				`SELECT a.created_at, a.starts_at, a.learned_receiver_name,
				        (SELECT MIN(per.period_key) FROM payment_allocations pa
				         JOIN periods per ON per.id = pa.period_id
				         WHERE pa.payment_id = $2) AS first_period
				 FROM activities a WHERE a.id = $1`,
				[payment.activity_id, paymentId],
			);
			const bill = context.rows[0] || {};

			const assessment = assessSlip({
				ref,
				expectedSatang: Number(payment.expected_satang || payment.amount_satang),
				amountSatang: read,
				expectedReceiverName: [expectedReceiverName, bill.learned_receiver_name].filter(Boolean),
				receiverName,
				transferredAt: when,
				earliestAt: earliestTransferFor({ createdAt: bill.created_at, startsAt: bill.starts_at, firstPeriodKey: bill.first_period }),
			});
			const autoConfirmed = assessment.decision === 'confirm';
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
				     evidence_image = NULL, evidence_mime = NULL, evidence_hash = NULL,
				     status = CASE WHEN $14 THEN 'confirmed' ELSE 'pending' END,
				     confirmation_source = CASE WHEN $14 THEN 'system_slip_match' ELSE NULL END,
				     verification_level = CASE WHEN $14 THEN 'slip_matched' ELSE 'none' END,
				     confirmed_by = NULL,
				     confirmed_at = CASE WHEN $14 THEN now() ELSE NULL END,
				     reversed_by = NULL, reversed_at = NULL, reversal_reason = NULL
				 WHERE id = $1
				 RETURNING id, activity_id, slip_verdict, slip_uploaded_at, status`,
				[
					paymentId, original, mime || 'image/jpeg', ref, verdict, bank || null, read, when || null,
					// The sender's bank name and account digits are never kept: the
					// payer is already known from the bill, and these columns are
					// cleared on rows written before this rule (core/schema.js).
					null, receiverName || null,
					null, onlyAccountTail(receiverAccountTail),
					transferredAt, autoConfirmed,
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

/**
 * The earliest a transfer for this bill can be dated, as the start of a day
 * in Bangkok.
 *
 * A monthly payment: the day before the month it pays opened. Months are
 * often logged after the fact, so the bill's own creation date says nothing.
 * A one-off bill: the day before it was made, or before the day it happened
 * when that is known and earlier. The day of slack is for the ordinary order
 * of things, where people transfer at the restaurant and the bill is written
 * up the next day. Earlier slips are not refused, only held for the receiver.
 */
function earliestTransferFor({ createdAt = null, startsAt = null, firstPeriodKey = null } = {}) {
	const DAY = 24 * 60 * 60 * 1000;
	const BANGKOK = 7 * 60 * 60 * 1000;
	const dayStart = time => Math.floor((time + BANGKOK) / DAY) * DAY - BANGKOK;
	if (firstPeriodKey) {
		const [year, month] = String(firstPeriodKey).split('-').map(Number);
		if (year && month) return new Date(Date.UTC(year, month - 1, 1) - BANGKOK - DAY);
	}
	const known = [createdAt, startsAt].map(value => (value ? new Date(value).getTime() : NaN)).filter(Number.isFinite);
	return known.length ? new Date(dayStart(Math.min(...known)) - DAY) : null;
}

function onlyAccountTail(value) {
	const digits = String(value || '').replace(/\D/g, '');
	return digits ? digits.slice(-4) : null;
}

/**
 * What can be shown for a payment's slip.
 *
 * While the payment waits for the receiver, the original upload, so they can
 * check it. Once confirmed, the fields of a virtual slip for the caller to
 * draw (adapters/payment-evidence-card.js): who paid as the bill names them,
 * to whom, how much, when, and the end of the reference. Anything else, a
 * rejected or reversed slip, has nothing to show.
 */
async function getSlip(paymentId) {
	const res = await query(
		`SELECT p.status, p.slip_image, p.slip_mime, p.slip_uploaded_at, p.slip_bank, p.slip_ref,
		        p.amount_satang, p.slip_when, p.slip_receiver_name, p.confirmed_at,
		        pt.display_name AS payer_name
		 FROM payments p
		 JOIN participants pt ON pt.id = p.participant_id
		 WHERE p.id = $1`,
		[paymentId],
	);
	const row = res.rows[0];
	if (!row) return null;
	if (row.status === 'pending' && row.slip_image) {
		return { image: row.slip_image, mime: row.slip_mime || 'image/jpeg' };
	}
	if (row.status === 'confirmed' && row.slip_uploaded_at) {
		return {
			evidence: {
				payerName: row.payer_name,
				bank: row.slip_bank || null,
				ref: row.slip_ref || null,
				// What was confirmed, not what was read: a receiver who confirms a
				// slip the reader got wrong has said what actually arrived.
				amountSatang: Number(row.amount_satang),
				when: row.slip_when || null,
				receiverName: row.slip_receiver_name || null,
				confirmedAt: row.confirmed_at || null,
			},
		};
	}
	return null;
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
		// The first slip a person confirms by hand teaches Megu the name on
		// their account, as their bank prints it. Later slips on this bill are
		// checked against it and can confirm themselves, which is what makes a
		// bill with no PromptPay set up stop needing the receiver every time.
		// Forgotten when the bill's payee changes (setPayee, setRecurringPayer).
		if (row.slip_receiver_name) {
			await client.query(
				'UPDATE activities SET learned_receiver_name = $2 WHERE id = $1 AND learned_receiver_name IS NULL',
				[row.activity_id, row.slip_receiver_name],
			);
		}
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

/** Explicit Discord payment intake: `/pay`, and a message in a bill's own
 * private thread that starts with a payment keyword and carries an image
 * (adapters/discord/thread-pay.js). Other messages are never read. */
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
			// A slip from Discord is checked against today's payee, so it may
			// only pay months whose bill that person paid. A month from before
			// the payer changed is owed to someone else, and sweeping it into
			// this transfer would send that money to the wrong account.
			const payeeId = activity.payee?.participantId || null;
			const receiverOf = (period) => {
				const bills = activity.expenses.filter(e => e.periodId === period.id);
				return bills.length === 1 ? bills[0].paidBy : payeeId;
			};
			for (const period of activity.periods) {
				if (payeeId && receiverOf(period) !== payeeId) continue;
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
		// The person the money goes to is the one who can tell whether it
		// arrived. On a subscription that is often not the owner.
		const payeeRow = activity.payee?.participantId
			? activity.participants.find(item => item.id === activity.payee.participantId)
			: null;
		const payeeIdentity = !payeeRow?.discordUid && activity.payee?.userId
			? await query(
				`SELECT provider_uid FROM identities
				 WHERE user_id = $1 AND provider = 'discord' LIMIT 1`,
				[activity.payee.userId],
			)
			: null;
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
			payeeDiscordUid: payeeRow?.discordUid || payeeIdentity?.rows[0]?.provider_uid || null,
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
	ensureCurrentPeriodsForOwner,
	addParticipant,
	claimParticipant,
	renameParticipant,
	removeParticipant,
	resetClaim,
	setRsvp,
	setAttended,
	setPlanState,
	updateActivity,
	setActivityChannel,
	getBillChannel,
	setCardMessage,
	setBillChannel,
	getActivityCodeByChannel,
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
	setRecurringPayer,
	setEventPayer,
	changeSubscription,
	upcomingSubscription,
	nextPeriodKey,
	attachSlip,
	earliestTransferFor,
	getSlip,
	forgetOldSlips,
};
