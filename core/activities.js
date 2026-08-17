const { query, transaction } = require('./db.js');
const { newId, newActivityCode } = require('./ids.js');
const { splitEvenlyBy } = require('./money.js');

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

// A single "no" sinks a slot faster than a "yes" lifts it: the point of the
// poll is to find a time nobody is blocked on, not the most popular one.
const SLOT_WEIGHT = { yes: 2, maybe: 1, no: -3 };

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
		recurrence: row.recurrence,
		dueDay: row.due_day,
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
		participants = [],
	} = input;

	if (!ownerUserId) throw new Error('ownerUserId is required');
	if (!title || !title.trim()) throw new Error('title is required');
	if (!KINDS.includes(kind)) throw new Error(`unknown activity kind: ${kind}`);
	if (kind === 'recurring' && recurrence !== 'monthly') {
		throw new Error('recurring activities currently support monthly only');
	}

	return transaction(async (client) => {
		const activityId = newId('act');
		const res = await client.query(
			`INSERT INTO activities
			   (id, code, owner_user_id, title, kind, location, starts_at, guild_id, channel_id, recurrence, due_day, plan_state)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
			[
				activityId, newActivityCode(), ownerUserId, title.trim(), kind,
				location, startsAt, guildId, channelId, recurrence, dueDay,
				// A monthly agreement has nothing to agree on — it just runs.
				kind === 'recurring' ? 'confirmed' : 'open',
			],
		);

		for (const [index, p] of participants.entries()) {
			await client.query(
				`INSERT INTO participants (id, activity_id, display_name, user_id, discord_uid, rsvp, position)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				[
					newId('par'),
					activityId,
					String(p.displayName || 'ใครไม่รู้').trim(),
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

	const [participants, periods, slots, slotVotes, expenses, shares, payments] = await Promise.all([
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
	]);

	activity.participants = participants.rows.map(rowToParticipant);
	activity.periods = periods.rows.map(rowToPeriod);
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
		amountSatang: Number(r.amount_satang),
		expectedSatang: r.expected_satang == null ? null : Number(r.expected_satang),
		promptpayTarget: r.promptpay_target || null,
		method: r.method,
		status: r.status,
		reference: r.reference,
		// The image itself is never loaded here — it is fetched by the one route
		// that serves it, so a page render does not drag a megabyte of other
		// people's bank slips through memory to display a list of names.
		hasSlip: Boolean(r.slip_uploaded_at),
		slipVerdict: r.slip_verdict || null,
		slipUploadedAt: r.slip_uploaded_at,
		confirmedBy: r.confirmed_by,
		createdAt: r.created_at,
		confirmedAt: r.confirmed_at,
	}));

	activity.payee = await resolvePayee(activity);

	return activity;
}

/**
 * Who the group actually pays, and where.
 *
 * Whoever fronted the money is the one owed it, which is usually but not
 * always the owner — on a shared subscription it is whoever's card the bill
 * lands on. An explicit `payee_participant_id` wins; otherwise it falls back
 * to the owner's own row on the roster.
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

	if (!participant) return null;

	const base = {
		participantId: participant.id,
		displayName: participant.displayName,
		userId: participant.userId || null,
		promptpayId: null,
		promptpayName: null,
	};
	if (!participant.userId) return base;

	const res = await query(
		'SELECT promptpay_id, promptpay_name FROM users WHERE id = $1',
		[participant.userId],
	);
	return {
		...base,
		promptpayId: res.rows[0]?.promptpay_id || null,
		promptpayName: res.rows[0]?.promptpay_name || null,
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

async function listActivitiesForOwner(ownerUserId) {
	const res = await query(
		'SELECT * FROM activities WHERE owner_user_id = $1 ORDER BY created_at DESC',
		[ownerUserId],
	);
	return res.rows.map(rowToActivity);
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
	if (!name) throw new Error('ต้องมีชื่อ');
	const res = await query(
		'UPDATE participants SET display_name = $2 WHERE id = $1 RETURNING *',
		[participantId, name],
	);
	if (res.rows.length === 0) throw new Error('ไม่พบคนนี้ในกิจกรรม');
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
			   (SELECT count(*) FROM expenses WHERE paid_by = $1)           AS paid`,
			[participantId],
		);
		const { shares, payments, paid } = money.rows[0];
		if (Number(paid) > 0) throw new Error('คนนี้ออกเงินให้กลุ่มอยู่ ลบรายการค่าใช้จ่ายก่อน');
		if (Number(shares) > 0 || Number(payments) > 0) {
			throw new Error('คนนี้มีรายการเงินอยู่ ลบค่าใช้จ่ายที่เกี่ยวข้องก่อน');
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
	if (res.rows.length === 0) throw new Error('ไม่พบคนนี้ในกิจกรรม');
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
			'SELECT plan_state FROM activities WHERE id = $1 FOR UPDATE',
			[activityId],
		);
		if (current.rows.length === 0) throw new Error('activity not found');

		const from = current.rows[0].plan_state;
		if (from === nextState) return { changed: false, planState: from };
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

	if (times.length === 0) throw new Error('ต้องเสนออย่างน้อยหนึ่งช่วงเวลา');

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
 * still pending, but never forever — once every participant has touched the
 * poll the answer is in.
 */
function pollReady(activity) {
	if (activity.slots.length === 0) return false;
	const voted = new Set((activity.slotVotes || []).map(v => v.participantId));
	return activity.participants.every(p => voted.has(p.id));
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

	const winner = bestSlot(activity);
	if (!winner) throw new Error('ยังไม่มีช่วงเวลาให้เลือก');

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
	const { label, amountSatang, paidBy, shareParticipantIds = null, periodId = null } = input;

	if (!Number.isInteger(amountSatang) || amountSatang <= 0) {
		throw new Error('amountSatang must be a positive integer');
	}

	return transaction(async (client) => {
		const roster = await client.query(
			'SELECT id, rsvp FROM participants WHERE activity_id = $1 ORDER BY position, created_at',
			[activityId],
		);
		if (roster.rows.length === 0) throw new Error('activity has no participants');

		let ids = shareParticipantIds;
		if (!ids || ids.length === 0) {
			ids = roster.rows.filter(r => r.rsvp === 'yes').map(r => r.id);
			if (ids.length === 0) ids = roster.rows.map(r => r.id);
		}

		const known = new Set(roster.rows.map(r => r.id));
		for (const id of ids) {
			if (!known.has(id)) throw new Error(`participant ${id} is not in this activity`);
		}
		if (!known.has(paidBy)) throw new Error('paidBy is not a participant of this activity');

		const expenseId = newId('exp');
		await client.query(
			`INSERT INTO expenses (id, activity_id, period_id, label, amount_satang, paid_by)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			[expenseId, activityId, periodId, String(label || 'ค่าใช้จ่าย').trim(), amountSatang, paidBy],
		);

		const split = splitEvenlyBy(amountSatang, ids);
		for (const [participantId, share] of Object.entries(split)) {
			await client.query(
				'INSERT INTO shares (id, expense_id, participant_id, amount_satang) VALUES ($1, $2, $3, $4)',
				[newId('shr'), expenseId, participantId, share],
			);
		}

		await client.query('UPDATE activities SET updated_at = now() WHERE id = $1', [activityId]);
		return { id: expenseId, activityId, periodId, label, amountSatang, paidBy, split };
	});
}

/**
 * Correct an expense. The split is recomputed from scratch rather than
 * patched, so the shares always sum back to whatever the amount now is.
 */
async function updateExpense(expenseId, input) {
	return transaction(async (client) => {
		const found = await client.query('SELECT * FROM expenses WHERE id = $1 FOR UPDATE', [expenseId]);
		if (found.rows.length === 0) throw new Error('ไม่พบรายการนี้');
		const expense = found.rows[0];

		const label = input.label != null ? String(input.label).trim() : expense.label;
		const amountSatang = input.amountSatang != null ? Number(input.amountSatang) : Number(expense.amount_satang);
		const paidBy = input.paidBy || expense.paid_by;

		if (!Number.isInteger(amountSatang) || amountSatang <= 0) {
			throw new Error('จำนวนเงินต้องมากกว่า 0');
		}

		let ids = input.shareParticipantIds;
		if (!ids || ids.length === 0) {
			const existing = await client.query('SELECT participant_id FROM shares WHERE expense_id = $1', [expenseId]);
			ids = existing.rows.map(r => r.participant_id);
		}
		if (ids.length === 0) throw new Error('ต้องมีคนอย่างน้อยหนึ่งคนในรายการนี้');

		// Same guard addExpense has. Without it a stale or mistyped id reaches
		// the database and surfaces as a foreign key error nobody can read.
		const roster = await client.query(
			'SELECT id FROM participants WHERE activity_id = $1',
			[expense.activity_id],
		);
		const known = new Set(roster.rows.map(r => r.id));
		for (const id of ids) {
			if (!known.has(id)) throw new Error(`participant ${id} is not in this activity`);
		}
		if (!known.has(paidBy)) throw new Error('paidBy is not a participant of this activity');

		await client.query(
			'UPDATE expenses SET label = $2, amount_satang = $3, paid_by = $4 WHERE id = $1',
			[expenseId, label, amountSatang, paidBy],
		);
		await client.query('DELETE FROM shares WHERE expense_id = $1', [expenseId]);

		const split = splitEvenlyBy(amountSatang, ids);
		for (const [participantId, share] of Object.entries(split)) {
			await client.query(
				'INSERT INTO shares (id, expense_id, participant_id, amount_satang) VALUES ($1, $2, $3, $4)',
				[newId('shr'), expenseId, participantId, share],
			);
		}

		return { id: expenseId, label, amountSatang, paidBy, split };
	});
}

async function removeExpense(expenseId) {
	const res = await query('DELETE FROM expenses WHERE id = $1 RETURNING id', [expenseId]);
	return res.rows.length > 0;
}

async function updateActivity(activityId, input) {
	const fields = [];
	const values = [activityId];

	for (const [key, column] of [['title', 'title'], ['location', 'location'], ['startsAt', 'starts_at'], ['dueDay', 'due_day']]) {
		if (input[key] === undefined) continue;
		values.push(key === 'title' ? String(input[key]).trim() : input[key]);
		fields.push(`${column} = $${values.length}`);
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
		expectedSatang = null,
		promptpayTarget = null,
	} = input;
	if (!Number.isInteger(amountSatang) || amountSatang <= 0) {
		throw new Error('amountSatang must be a positive integer');
	}

	const res = await query(
		`INSERT INTO payments
		   (id, activity_id, period_id, participant_id, amount_satang, method, reference, expected_satang, promptpay_target)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
		[
			newId('pay'), activityId, periodId, participantId, amountSatang, method, reference,
			expectedSatang == null ? null : Number(expectedSatang),
			promptpayTarget,
		],
	);
	const row = res.rows[0];
	return { id: row.id, participantId: row.participant_id, amountSatang: Number(row.amount_satang), status: row.status };
}

// ── slips ───────────────────────────────────────────────────────────────────
//
// A slip is evidence, not proof. Nothing here contacts a bank, so nothing here
// can say the money arrived — the owner still confirms, exactly as they did
// before. What a slip buys is that confirming takes one glance instead of a
// trip to a banking app, and that the same slip cannot be sent twice.
//
// That last part is the only check with teeth, and it is enforced by a unique
// index rather than by reading anything out of the image.

const SLIP_VERDICTS = ['unread', 'matched', 'duplicate'];

/**
 * Attach an image to a payment claim.
 *
 * `ref` is the transaction reference read off the slip's own QR by the browser
 * that uploaded it. A caller could invent one, which is why it is not trusted
 * to *confirm* anything — it only has to be unique. Inventing a reference gets
 * you a row that still says "waiting for confirmation"; reusing a real one is
 * refused by the database.
 */
async function attachSlip(paymentId, { image, mime, ref = null }) {
	if (!Buffer.isBuffer(image) || image.length === 0) throw new Error('slip_unreadable');

	const verdict = ref ? 'matched' : 'unread';
	try {
		const res = await query(
			`UPDATE payments
			 SET slip_image = $2, slip_mime = $3, slip_ref = $4,
			     slip_verdict = $5, slip_uploaded_at = now(), method = 'promptpay'
			 WHERE id = $1
			 RETURNING id, slip_verdict, slip_uploaded_at`,
			[paymentId, image, mime || 'image/jpeg', ref, verdict],
		);
		if (res.rows.length === 0) throw new Error('payment_not_found');
		return { id: res.rows[0].id, verdict: res.rows[0].slip_verdict };
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

async function getSlip(paymentId) {
	const res = await query(
		'SELECT slip_image, slip_mime FROM payments WHERE id = $1 AND slip_image IS NOT NULL',
		[paymentId],
	);
	if (res.rows.length === 0) return null;
	return { image: res.rows[0].slip_image, mime: res.rows[0].slip_mime || 'image/jpeg' };
}

/**
 * Forget the slips for activities that finished long enough ago.
 *
 * These are other people's bank documents, carrying account names and partial
 * account numbers. Keeping them past the point where anyone might dispute the
 * payment is storing a liability for no benefit, so the images are dropped
 * while the payment rows they belonged to stay exactly as they were.
 */
async function forgetOldSlips(olderThanDays = 90) {
	const res = await query(
		`UPDATE payments
		 SET slip_image = NULL
		 WHERE slip_image IS NOT NULL
		   AND status = 'confirmed'
		   AND confirmed_at < now() - ($1 * INTERVAL '1 day')
		 RETURNING id`,
		[olderThanDays],
	);
	return res.rowCount || 0;
}

async function confirmPayment(paymentId, confirmedByUserId) {
	const res = await query(
		`UPDATE payments SET status = 'confirmed', confirmed_by = $2, confirmed_at = now()
		 WHERE id = $1 AND status = 'pending' RETURNING *`,
		[paymentId, confirmedByUserId],
	);
	if (res.rows.length === 0) return null;
	const row = res.rows[0];
	return { id: row.id, participantId: row.participant_id, amountSatang: Number(row.amount_satang), status: row.status };
}

/**
 * Take back a confirmation. Confirming the wrong person's payment is the
 * easiest mistake to make on this screen and, until now, the only one that
 * could not be undone.
 */
async function unconfirmPayment(paymentId) {
	const res = await query(
		`UPDATE payments
		 SET status = 'pending', confirmed_by = NULL, confirmed_at = NULL
		 WHERE id = $1 AND status <> 'pending'
		 RETURNING *`,
		[paymentId],
	);
	if (res.rows.length === 0) return null;
	return { id: res.rows[0].id, status: res.rows[0].status };
}

async function removePayment(paymentId) {
	const res = await query('DELETE FROM payments WHERE id = $1 RETURNING id', [paymentId]);
	return res.rows.length > 0;
}

async function rejectPayment(paymentId, confirmedByUserId) {
	const res = await query(
		`UPDATE payments SET status = 'rejected', confirmed_by = $2, confirmed_at = now()
		 WHERE id = $1 AND status = 'pending' RETURNING id`,
		[paymentId, confirmedByUserId],
	);
	return res.rows.length > 0;
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
	for (const payment of activity.payments.filter(inScope)) {
		const entry = byParticipant.get(payment.participantId);
		if (!entry) continue;
		if (payment.status === 'confirmed') entry.settled += payment.amountSatang;
		else if (payment.status === 'pending') entry.pending += payment.amountSatang;
	}

	const rows = [...byParticipant.values()].map((entry) => {
		const net = entry.owes - entry.paidOut;
		return { ...entry, net, outstanding: net - entry.settled };
	});

	const expenses = activity.expenses.filter(inScope);
	const total = expenses.reduce((sum, e) => sum + e.amountSatang, 0);
	const unpaid = rows.filter(r => r.outstanding > 0);

	let state = 'none';
	if (expenses.length > 0) state = unpaid.length === 0 ? 'settled' : 'open';

	return { state, total, rows, unpaid, fullySettled: state === 'settled' };
}

/**
 * The current month for a recurring agreement, or null for a one-off.
 */
function currentPeriod(activity, date = new Date()) {
	if (activity.kind !== 'recurring') return null;
	const key = periodKeyFor(date);
	return activity.periods.find(p => p.key === key) || activity.periods[0] || null;
}

module.exports = {
	PLAN_STATES,
	PLAN_TRANSITIONS,
	MONEY_STATES,
	KINDS,
	RSVP,
	SLOT_ANSWERS,
	SLIP_VERDICTS,
	canTransition,
	proposeSlots,
	voteSlot,
	slotStanding,
	pollReady,
	bestSlot,
	lockBestSlot,
	createActivity,
	getActivity,
	getActivityByCode,
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
	ensurePeriod,
	periodKeyFor,
	periodLabelFor,
	periodDueAt,
	currentPeriod,
	addExpense,
	updateExpense,
	removeExpense,
	recordPayment,
	confirmPayment,
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
