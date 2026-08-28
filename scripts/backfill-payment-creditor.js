require('dotenv').config();
const core = require('../core/index.js');
const { newId } = require('../core/ids.js');

// Give every payment written before `creditor_participant_id` existed a
// creditor, where one can be worked out — and leave the rest alone.
//
// This is a reconstruction, not a migration. Nothing in the database recorded
// who a payment was sent to, so nothing here can look it up; every answer below
// is inferred from something else that was written at the time, and the whole
// script is built around being honest about which inference was used.
//
// Three consequences, all deliberate:
//
//   · `--dry-run` is the default. Writing requires `--commit`, typed out.
//   · Every row it touches gets a `creditor_backfilled` event recording the
//     basis and what the row looked like before. The payments table is history;
//     a guess written into it without a trail is indistinguishable from a fact.
//   · A payment it cannot place keeps its NULL. `settlement()` already handles
//     those — it reconstructs them at read time and reports that it did — and a
//     NULL that says "unknown" beats a plausible wrong name.
//
// Balances do not move. `rows[].outstanding`, the figure every screen and every
// reminder currently shows, is computed from who paid and never from who was
// paid; this script only changes which pair the money is attributed to. That is
// what makes it safe to run on a live database in the middle of the afternoon.

const COMMIT = process.argv.includes('--commit');

/**
 * The name and number a payer was actually shown, if the row kept them.
 *
 * This is the strongest evidence available, and it is evidence rather than
 * inference: `payment_destination` and `promptpay_target` were frozen onto the
 * row precisely so a settled month would still make sense after the organizer
 * changed their bank details. A match here is what the person saw on screen at
 * the moment they transferred the money.
 */
function destinationOf(payment) {
	const destination = payment.payment_destination || {};
	return {
		promptpay: payment.promptpay_target || destination.destination || null,
		accountName: destination.accountName || null,
	};
}

function normaliseName(value) {
	return String(value || '').trim().toLocaleLowerCase('th-TH').replace(/\s+/g, ' ');
}

function normaliseTarget(value) {
	return String(value || '').replace(/\D/g, '');
}

/**
 * Which roster row this payment was most likely sent to.
 *
 * Ordered by how much the answer is worth trusting, and it stops at the first
 * one that produces a participant. `basis` travels with the answer all the way
 * into the event row, so a dispute six months from now can see whether the
 * creditor was read off the payment or assumed from the activity.
 */
function inferCreditor(payment, context) {
	const { promptpay, accountName } = destinationOf(payment);

	if (promptpay) {
		const target = normaliseTarget(promptpay);
		const match = context.roster.find(p => p.promptpay_id && normaliseTarget(p.promptpay_id) === target);
		if (match && match.id !== payment.participant_id) {
			return { participantId: match.id, basis: 'promptpay_target', confidence: 'high' };
		}
	}

	if (accountName) {
		const wanted = normaliseName(accountName);
		const matches = context.roster.filter(p => wanted
			&& (normaliseName(p.promptpay_name) === wanted || normaliseName(p.display_name) === wanted));
		// Only when it names exactly one person. Two people called ฟิก on one
		// roster is not a rare thing, and picking the first is how a guess turns
		// into a wrong answer that looks certain.
		if (matches.length === 1 && matches[0].id !== payment.participant_id) {
			return { participantId: matches[0].id, basis: 'account_name', confidence: 'medium' };
		}
	}

	if (context.payeeParticipantId && context.payeeParticipantId !== payment.participant_id) {
		return { participantId: context.payeeParticipantId, basis: 'activity_payee', confidence: 'low' };
	}

	const ownerRow = context.roster.find(p => p.user_id && p.user_id === context.ownerUserId);
	if (ownerRow && ownerRow.id !== payment.participant_id) {
		return { participantId: ownerRow.id, basis: 'owner_row', confidence: 'low' };
	}

	return null;
}

/**
 * @param {{commit?: boolean, quiet?: boolean}} [options]
 *        `commit` is taken from the command line when this file is run, and
 *        passed explicitly by the test — which exercises the write path against
 *        the isolated test database rather than anyone's real one.
 */
async function main({ commit = COMMIT, quiet = false } = {}) {
	const say = quiet ? () => {} : (...args) => console.log(...args);
	const pending = await core.db.query(`
		SELECT p.id, p.activity_id, p.participant_id, p.amount_satang, p.status,
		       p.promptpay_target, p.payment_destination,
		       a.payee_participant_id, a.owner_user_id, a.code, a.title
		FROM payments p
		JOIN activities a ON a.id = p.activity_id
		WHERE p.creditor_participant_id IS NULL
		ORDER BY p.created_at
	`);

	if (pending.rows.length === 0) {
		say('\nNothing to do — every payment already names its creditor.\n');
		return { pending: 0, placed: 0, skipped: 0, byBasis: {}, written: false };
	}

	// One query for every roster involved, rather than one per payment. A
	// database with a few thousand payments across a few hundred activities
	// would otherwise spend the whole run on round trips.
	const activityIds = [...new Set(pending.rows.map(r => r.activity_id))];
	const roster = await core.db.query(`
		SELECT pa.id, pa.activity_id, pa.display_name, pa.user_id,
		       u.promptpay_id, u.promptpay_name
		FROM participants pa
		LEFT JOIN users u ON u.id = pa.user_id
		WHERE pa.activity_id = ANY($1::text[])
		ORDER BY pa.position, pa.created_at
	`, [activityIds]);

	const byActivity = new Map();
	for (const row of roster.rows) {
		if (!byActivity.has(row.activity_id)) byActivity.set(row.activity_id, []);
		byActivity.get(row.activity_id).push(row);
	}

	const decided = [];
	const skipped = [];
	for (const payment of pending.rows) {
		const context = {
			roster: byActivity.get(payment.activity_id) || [],
			payeeParticipantId: payment.payee_participant_id,
			ownerUserId: payment.owner_user_id,
		};
		const guess = inferCreditor(payment, context);
		if (guess) decided.push({ payment, guess, context });
		else skipped.push(payment);
	}

	const byBasis = decided.reduce((tally, item) => {
		tally[item.guess.basis] = (tally[item.guess.basis] || 0) + 1;
		return tally;
	}, {});

	say(`\npayments with no creditor: ${pending.rows.length}`);
	say(`  can be placed:   ${decided.length}`);
	for (const [basis, n] of Object.entries(byBasis).sort((a, b) => b[1] - a[1])) {
		say(`    ${basis.padEnd(18)} ${n}`);
	}
	say(`  left as unknown: ${skipped.length}`);

	if (skipped.length > 0) {
		say('\n  left alone (settlement will reconstruct these at read time):');
		for (const payment of skipped.slice(0, 20)) {
			say(`    ${payment.id}  ${payment.title} (${payment.code})  ${core.money.formatTHB(Number(payment.amount_satang))}`);
		}
		if (skipped.length > 20) say(`    … and ${skipped.length - 20} more`);
	}

	const summary = {
		pending: pending.rows.length,
		placed: decided.length,
		skipped: skipped.length,
		byBasis,
		written: false,
	};

	if (!commit) {
		say('\nDry run — nothing written. Re-run with --commit to apply.\n');
		return summary;
	}

	// One transaction. A half-applied backfill would leave some payments placed
	// and some not, which is the one state nobody could reason about afterwards.
	await core.db.transaction(async (client) => {
		for (const { payment, guess } of decided) {
			await client.query(
				'UPDATE payments SET creditor_participant_id = $2 WHERE id = $1 AND creditor_participant_id IS NULL',
				[payment.id, guess.participantId],
			);
			await client.query(
				`INSERT INTO payment_events
				   (id, payment_id, activity_id, event_type, reason, metadata)
				 VALUES ($1, $2, $3, 'creditor_backfilled', $4, $5::jsonb)`,
				[
					newId('pev'),
					payment.id,
					payment.activity_id,
					`inferred from ${guess.basis}`,
					JSON.stringify({
						creditorParticipantId: guess.participantId,
						basis: guess.basis,
						confidence: guess.confidence,
						previousCreditorParticipantId: null,
						activityPayeeParticipantId: payment.payee_participant_id || null,
						script: 'backfill-payment-creditor',
					}),
				],
			);
		}
	});

	say(`\nWritten: ${decided.length} payments now name a creditor, each with an event recording how.\n`);
	return { ...summary, written: true };
}

// `inferCreditor` is the whole of the judgement in this file and the only part
// worth testing, so it is exported — and `main` only runs when this file is the
// one that was invoked. Importing the module must never touch the database.
if (require.main === module) {
	main().then(() => core.db.close()).catch(async (e) => {
		console.error(e.message);
		await core.db.close();
		process.exitCode = 1;
	});
}

module.exports = { inferCreditor, destinationOf, main };
