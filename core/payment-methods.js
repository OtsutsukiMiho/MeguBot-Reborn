// Where a person can be paid.
//
// The mental model this is built around is the one the payer has: *where do I
// send this?* Not "configure a payment gateway" — Megu never touches the money
// and has no account to configure. A method is an address and, sometimes, a
// sentence about how to use it.
//
// It belongs to the person. Their PromptPay number already did, which is why it
// followed them between groups and never had to be retyped; their bank account
// did not, and lived in `activities.payment_options`, so an organizer entered
// the same details into every activity and anybody who was not the organizer
// could not be paid by bank at all. That second half stopped being survivable
// the moment a payment could name a creditor who was not the organizer.
//
// Each type carries different fields, and the validation below is what lets the
// interface ask for only the ones that apply. A single form with every field on
// it, most of them irrelevant, is how the old one got away with knowing nothing
// about what it was collecting.

const { query, transaction } = require('./db.js');
const { newId } = require('./ids.js');
const { normaliseTarget } = require('./promptpay.js');

const TYPES = ['promptpay', 'bank_transfer', 'payment_link', 'cash', 'custom'];

// What each type actually needs. `destination` is the address money is sent to
// and means something different for each — a PromptPay target, an account
// number — which is why the label for it is written by the interface and not
// stored here.
const REQUIRES = {
	promptpay: ['destination'],
	bank_transfer: ['destination'],
	payment_link: ['url'],
	cash: [],
	custom: [],
};

const LIMITS = { label: 60, destination: 180, accountName: 120, instructions: 500 };

function codedError(code, message = code) {
	const error = new Error(message);
	error.code = code;
	return error;
}

function text(value, max) {
	const trimmed = String(value == null ? '' : value).trim();
	if (!trimmed) return null;
	if ([...trimmed].length > max) throw codedError('payment_method_too_long');
	return trimmed;
}

function rowToMethod(row) {
	return {
		id: row.id,
		userId: row.user_id,
		type: row.type,
		label: row.label,
		destination: row.destination || null,
		accountName: row.account_name || null,
		url: row.url || null,
		instructions: row.instructions || null,
		position: row.position,
	};
}

/**
 * Check one method and return it in the shape the table stores.
 *
 * Every type is validated for what it needs and nothing else, so a cash entry
 * is not asked for an account number and a payment link is not accepted without
 * a URL. A PromptPay target goes through `normaliseTarget`, which is the same
 * check the QR builder makes — a number that cannot become a QR must not be
 * saveable, or the failure surfaces later in front of somebody trying to pay.
 */
function validate(input) {
	const type = String(input?.type || '');
	if (!TYPES.includes(type)) throw codedError('payment_method_type_invalid');

	const label = text(input?.label, LIMITS.label);
	if (!label) throw codedError('payment_method_label_required');

	const destination = text(input?.destination, LIMITS.destination);
	const accountName = text(input?.accountName, LIMITS.accountName);
	const instructions = text(input?.instructions, LIMITS.instructions);
	let url = text(input?.url, LIMITS.destination);

	for (const field of REQUIRES[type]) {
		if (field === 'destination' && !destination) throw codedError('payment_method_destination_required');
		if (field === 'url' && !url) throw codedError('payment_method_url_required');
	}

	if (type === 'promptpay') {
		// Throws `promptpay_unrecognised`, which the interface already has words
		// for — this is the same rejection the profile field always gave.
		normaliseTarget(destination);
	}

	if (url) {
		let parsed;
		try { parsed = new URL(url); }
		catch { throw codedError('payment_link_invalid'); }
		if (!['https:', 'http:'].includes(parsed.protocol)) throw codedError('payment_link_invalid');
		url = parsed.toString();
	}

	return {
		type,
		label,
		// Fields a type does not use are dropped rather than carried, so
		// switching a bank transfer to cash cannot leave an account number
		// attached to something that is handed over in notes.
		destination: type === 'promptpay' || type === 'bank_transfer' ? destination : null,
		accountName: type === 'payment_link' || type === 'cash' ? null : accountName,
		url: type === 'payment_link' ? url : null,
		instructions,
	};
}

async function listForUser(userId) {
	const res = await query(
		'SELECT * FROM payment_methods WHERE user_id = $1 ORDER BY position, created_at',
		[userId],
	);
	return res.rows.map(rowToMethod);
}

/**
 * Every method for a set of people, in one query.
 *
 * `loadActivity` needs these for the whole roster — anybody who fronted money
 * can be the far end of a transfer — and one query per participant would put a
 * round trip per person on the path of every page load.
 */
async function listForUsers(userIds) {
	const ids = [...new Set((userIds || []).filter(Boolean))];
	const byUser = new Map(ids.map(id => [id, []]));
	if (ids.length === 0) return byUser;

	const res = await query(
		'SELECT * FROM payment_methods WHERE user_id = ANY($1::text[]) ORDER BY position, created_at',
		[ids],
	);
	for (const row of res.rows) {
		byUser.get(row.user_id)?.push(rowToMethod(row));
	}
	return byUser;
}

/** Added at the end, so the first one somebody saved stays the one offered first. */
async function create(userId, input) {
	const clean = validate(input);
	const res = await query(
		`INSERT INTO payment_methods (id, user_id, type, label, destination, account_name, url, instructions, position)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
		         (SELECT COALESCE(MAX(position) + 1, 0) FROM payment_methods WHERE user_id = $2))
		 RETURNING *`,
		[newId('pmt'), userId, clean.type, clean.label, clean.destination, clean.accountName, clean.url, clean.instructions],
	);
	return rowToMethod(res.rows[0]);
}

async function update(methodId, userId, input) {
	const clean = validate(input);
	const res = await query(
		`UPDATE payment_methods
		 SET type = $3, label = $4, destination = $5, account_name = $6, url = $7, instructions = $8, updated_at = now()
		 WHERE id = $1 AND user_id = $2
		 RETURNING *`,
		[methodId, userId, clean.type, clean.label, clean.destination, clean.accountName, clean.url, clean.instructions],
	);
	if (res.rows.length === 0) throw codedError('payment_method_not_found');
	return rowToMethod(res.rows[0]);
}

/**
 * Remove one.
 *
 * Payments that were made to it keep their own frozen copy of where they were
 * sent — `payments.payment_destination` exists for exactly this — so deleting a
 * method never rewrites what a settled transfer says about itself.
 */
async function remove(methodId, userId) {
	const res = await query(
		'DELETE FROM payment_methods WHERE id = $1 AND user_id = $2 RETURNING id',
		[methodId, userId],
	);
	return res.rows.length > 0;
}

/**
 * Put them in the order the owner wants them offered in.
 *
 * The first is the default, which is why this is a reorder and not a flag: one
 * fact, stored once. Ids that do not belong to this person are ignored rather
 * than rejected, and anything left out keeps its place after the ones named.
 */
async function reorder(userId, methodIds) {
	return transaction(async (client) => {
		const owned = await client.query(
			'SELECT id FROM payment_methods WHERE user_id = $1',
			[userId],
		);
		const mine = new Set(owned.rows.map(r => r.id));
		const ordered = (methodIds || []).filter(id => mine.has(id));

		for (let i = 0; i < ordered.length; i++) {
			await client.query(
				'UPDATE payment_methods SET position = $3, updated_at = now() WHERE id = $1 AND user_id = $2',
				[ordered[i], userId, i],
			);
		}
		// Anything not named keeps a stable place behind the named ones.
		let next = ordered.length;
		for (const row of owned.rows) {
			if (ordered.includes(row.id)) continue;
			await client.query(
				'UPDATE payment_methods SET position = $3 WHERE id = $1 AND user_id = $2',
				[row.id, userId, next++],
			);
		}
		const res = await client.query(
			'SELECT * FROM payment_methods WHERE user_id = $1 ORDER BY position, created_at',
			[userId],
		);
		return res.rows.map(rowToMethod);
	});
}

module.exports = { TYPES, REQUIRES, validate, listForUser, listForUsers, create, update, remove, reorder };
