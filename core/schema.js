const { transaction } = require('./db.js');
const { log } = require('./log.js');

// 'MEGU' read as a big-endian int32. Any fixed number would do; this one is
// recognisable in pg_locks when you are trying to work out who is holding it.
const SCHEMA_LOCK = 1296385877;

// These tables are the product's own domain, so they carry plain names. The
// Discord bot's tables — guild_variables, user_nicks, reminders, audit_logs —
// are the ones that belong to a single adapter, and they are what will move
// into a schema of their own once Discord stops being the only way in.
//
// The old megu_ prefix drew the line in the wrong place: it separated "written
// recently" from "written before", which is a migration boundary and therefore
// temporary, not a fact about what any of this data is.
const RENAMED = [
	['megu_users', 'users'],
	['megu_identities', 'identities'],
	['megu_activities', 'activities'],
	['megu_periods', 'periods'],
	['megu_participants', 'participants'],
	['megu_slots', 'slots'],
	['megu_slot_votes', 'slot_votes'],
	['megu_expenses', 'expenses'],
	['megu_shares', 'shares'],
	['megu_payments', 'payments'],
	// Not `reminders`. The bot has owned a table by that name since long before
	// core existed, and the two are not the same idea: that one is a scheduled
	// message in a Discord channel, this one is a record of a payment nag.
	['megu_reminders', 'payment_reminders'],
];

// Renames run before the CREATE statements below, or a database that already
// holds data would grow a second, empty set of tables next to the full ones.
// Every step is guarded, so this is a no-op on a fresh database and on the
// second boot of a migrated one.
const MIGRATIONS = [
	...RENAMED.map(([from, to]) => `
		DO $$ BEGIN
			IF to_regclass('public.${from}') IS NOT NULL
				AND to_regclass('public.${to}') IS NULL THEN
				ALTER TABLE public.${from} RENAME TO ${to};
			END IF;
		END $$;
	`),

	// Renaming a table leaves its constraints and indexes still carrying the old
	// name, which is most of what looked cluttered in the first place. Renaming
	// a constraint renames the index underneath it, so the second pass only has
	// to collect the plain indexes that no constraint owns.
	`DO $$
	DECLARE r RECORD;
	BEGIN
		FOR r IN
			SELECT c.conname, t.relname AS tbl,
				CASE WHEN c.conname LIKE 'megu\\_reminders\\_%'
					THEN 'payment_' || substring(c.conname from 6)
					ELSE substring(c.conname from 6) END AS renamed
			FROM pg_constraint c
			JOIN pg_class t ON t.oid = c.conrelid
			JOIN pg_namespace n ON n.oid = t.relnamespace
			WHERE n.nspname = 'public' AND c.conname LIKE 'megu\\_%'
		LOOP
			EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I', r.tbl, r.conname, r.renamed);
		END LOOP;
	END $$;`,

	`DO $$
	DECLARE r RECORD;
	BEGIN
		FOR r IN
			SELECT c.relname AS idx,
				CASE WHEN c.relname LIKE 'megu\\_reminders\\_%'
					THEN 'payment_' || substring(c.relname from 6)
					ELSE substring(c.relname from 6) END AS renamed
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'public' AND c.relkind = 'i' AND c.relname LIKE 'megu\\_%'
		LOOP
			EXECUTE format('ALTER INDEX public.%I RENAME TO %I', r.idx, r.renamed);
		END LOOP;
	END $$;`,
];

const STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS users (
		id            TEXT PRIMARY KEY,
		display_name  TEXT NOT NULL,
		avatar_url    TEXT,
		created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
	);`,

	// Where money sent to this person ends up. It is their own bank account,
	// reached by PromptPay, and Megu never stands between the two ends of that
	// transfer — she only knows the address to print on the QR.
	//
	// `promptpay_name` is shown beside the number so whoever is about to send
	// ฿60 can check the name their banking app offers back matches the person
	// they think they are paying.
	'ALTER TABLE users ADD COLUMN IF NOT EXISTS promptpay_id TEXT;',
	'ALTER TABLE users ADD COLUMN IF NOT EXISTS promptpay_name TEXT;',

	`CREATE TABLE IF NOT EXISTS identities (
		id            TEXT PRIMARY KEY,
		user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		provider      TEXT NOT NULL,
		provider_uid  TEXT NOT NULL,
		email         TEXT,
		username      TEXT,
		avatar_url    TEXT,
		created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
		UNIQUE (provider, provider_uid)
	);`,
	'CREATE INDEX IF NOT EXISTS identities_user_idx ON identities (user_id);',

	// Two independent axes, not one pipeline.
	//
	//   plan  — open → confirmed → done          (what the group agreed to do)
	//   money — none → open → settled            (what they owe each other)
	//
	// They are orthogonal on purpose: a badminton court has a known price
	// before anyone turns up, a dinner bill only after. Forcing money into the
	// plan timeline is what made the old order wrong.
	`CREATE TABLE IF NOT EXISTS activities (
		id            TEXT PRIMARY KEY,
		code          TEXT NOT NULL UNIQUE,
		owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
		title         TEXT NOT NULL,
		kind          TEXT NOT NULL DEFAULT 'event',
		plan_state    TEXT NOT NULL DEFAULT 'open',
		location      TEXT,
		starts_at     TIMESTAMPTZ,
		currency      TEXT NOT NULL DEFAULT 'THB',
		recurrence    TEXT,
		due_day       INTEGER,
		guild_id      TEXT,
		channel_id    TEXT,
		created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
		updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
		closed_at     TIMESTAMPTZ
	);`,
	'ALTER TABLE activities ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT \'event\';',
	'ALTER TABLE activities ADD COLUMN IF NOT EXISTS plan_state TEXT NOT NULL DEFAULT \'open\';',
	'ALTER TABLE activities ADD COLUMN IF NOT EXISTS recurrence TEXT;',
	'ALTER TABLE activities ADD COLUMN IF NOT EXISTS due_day INTEGER;',
	'CREATE INDEX IF NOT EXISTS activities_owner_idx ON activities (owner_user_id);',
	'CREATE INDEX IF NOT EXISTS activities_guild_idx ON activities (guild_id);',

	// One row per month of a recurring agreement. Expenses and payments point
	// at a period when there is one, and at nothing when the activity is a
	// single event.
	`CREATE TABLE IF NOT EXISTS periods (
		id           TEXT PRIMARY KEY,
		activity_id  TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
		period_key   TEXT NOT NULL,
		label        TEXT NOT NULL,
		due_at       TIMESTAMPTZ,
		created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
		UNIQUE (activity_id, period_key)
	);`,
	'CREATE INDEX IF NOT EXISTS periods_activity_idx ON periods (activity_id);',

	`CREATE TABLE IF NOT EXISTS participants (
		id            TEXT PRIMARY KEY,
		activity_id   TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
		display_name  TEXT NOT NULL,
		user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
		discord_uid   TEXT,
		device_token  TEXT,
		rsvp          TEXT NOT NULL DEFAULT 'pending',
		attended      BOOLEAN,
		claimed_at    TIMESTAMPTZ,
		position      INTEGER NOT NULL DEFAULT 0,
		created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
	);`,
	// created_at alone cannot order a roster: now() is the transaction
	// timestamp, so everyone inserted together shares it to the microsecond.
	'ALTER TABLE participants ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;',
	'CREATE INDEX IF NOT EXISTS participants_activity_idx ON participants (activity_id);',
	'CREATE INDEX IF NOT EXISTS participants_user_idx ON participants (user_id);',
	'CREATE INDEX IF NOT EXISTS participants_discord_idx ON participants (discord_uid);',

	// Who the group pays. Usually the owner, but not always — whoever fronted
	// the court fee is the one owed the money, and on a shared subscription it
	// is whoever's card the bill lands on.
	//
	// This sits here rather than with the other `activities` columns because it
	// points at `participants`, which does not exist yet when that table is
	// created. Left up there it would fail on a fresh database and succeed on
	// an existing one, which is the worst of both.
	'ALTER TABLE activities ADD COLUMN IF NOT EXISTS payee_participant_id TEXT REFERENCES participants(id) ON DELETE SET NULL;',

	// The part nobody in a group chat wants to own: proposing times, chasing
	// answers, and saying out loud which one wins. Megu holds the slots and
	// the votes so no human has to be the one who decides.
	`CREATE TABLE IF NOT EXISTS slots (
		id          TEXT PRIMARY KEY,
		activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
		starts_at   TIMESTAMPTZ NOT NULL,
		position    INTEGER NOT NULL DEFAULT 0,
		created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
	);`,
	'CREATE INDEX IF NOT EXISTS slots_activity_idx ON slots (activity_id);',

	`CREATE TABLE IF NOT EXISTS slot_votes (
		id             TEXT PRIMARY KEY,
		slot_id        TEXT NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
		participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
		answer         TEXT NOT NULL,
		updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
		UNIQUE (slot_id, participant_id)
	);`,
	'CREATE INDEX IF NOT EXISTS slot_votes_participant_idx ON slot_votes (participant_id);',

	`CREATE TABLE IF NOT EXISTS expenses (
		id            TEXT PRIMARY KEY,
		activity_id   TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
		period_id     TEXT REFERENCES periods(id) ON DELETE CASCADE,
		label         TEXT NOT NULL,
		amount_satang BIGINT NOT NULL CHECK (amount_satang > 0),
		paid_by       TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
		created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
	);`,
	'ALTER TABLE expenses ADD COLUMN IF NOT EXISTS period_id TEXT REFERENCES periods(id) ON DELETE CASCADE;',
	'CREATE INDEX IF NOT EXISTS expenses_activity_idx ON expenses (activity_id);',
	'CREATE INDEX IF NOT EXISTS expenses_period_idx ON expenses (period_id);',

	`CREATE TABLE IF NOT EXISTS shares (
		id             TEXT PRIMARY KEY,
		expense_id     TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
		participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
		amount_satang  BIGINT NOT NULL CHECK (amount_satang >= 0),
		UNIQUE (expense_id, participant_id)
	);`,
	'CREATE INDEX IF NOT EXISTS shares_participant_idx ON shares (participant_id);',

	`CREATE TABLE IF NOT EXISTS payments (
		id             TEXT PRIMARY KEY,
		activity_id    TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
		period_id      TEXT REFERENCES periods(id) ON DELETE CASCADE,
		participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
		amount_satang  BIGINT NOT NULL CHECK (amount_satang > 0),
		method         TEXT NOT NULL DEFAULT 'manual',
		status         TEXT NOT NULL DEFAULT 'pending',
		reference      TEXT,
		confirmed_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
		created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
		confirmed_at   TIMESTAMPTZ
	);`,
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS period_id TEXT REFERENCES periods(id) ON DELETE CASCADE;',
	'CREATE INDEX IF NOT EXISTS payments_activity_idx ON payments (activity_id);',
	'CREATE INDEX IF NOT EXISTS payments_participant_idx ON payments (participant_id);',

	// What we asked for, and where we told them to send it.
	//
	// Both are copied onto the row rather than looked up later, because both
	// can move: the owner changes their PromptPay number, or the expense is
	// corrected from ฿4,000 to ฿400. A payment has to keep saying what it was
	// at the time, or a settled month stops making sense the moment anything
	// upstream of it is edited.
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS expected_satang BIGINT;',
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS promptpay_target TEXT;',

	// The slip.
	//
	// It lives in the database rather than on a disk or a bucket because it is
	// a handful of images per group per year, and because every alternative
	// starts by making them reachable over HTTP — which is the one thing a
	// document carrying someone's bank account name must not be. Reading one
	// goes through a route that checks who is asking.
	//
	// `slip_ref` is the transaction reference read off the slip's own QR. It is
	// the only part of a slip worth trusting as an identifier, and it is what
	// makes sending the same slip twice a thing the database refuses rather
	// than a thing somebody has to notice.
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS slip_image BYTEA;',
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS slip_mime TEXT;',
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS slip_ref TEXT;',
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS slip_verdict TEXT;',
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS slip_uploaded_at TIMESTAMPTZ;',

	// What the slip appeared to say, as against what it proves.
	//
	// `slip_bank` comes out of the slip's own QR and is as solid as `slip_ref`.
	// The other two are OCR — a reading of a photograph, which can be wrong in
	// ways that look perfectly confident — and they exist for exactly one
	// purpose: so the owner confirming a payment sees "the slip says ฿1,250,
	// you asked for ฿1,250" on one line instead of opening a banking app.
	//
	// Strict matches may settle optimistically, but remain labelled
	// `slip_matched` rather than `bank_verified` and can be reversed by the owner.
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS slip_bank TEXT;',
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS slip_amount_satang BIGINT;',
	// The wall clock printed on the slip, stored as the text it was written in.
	// A slip carries an hour in Bangkok and no timezone at all, and this
	// codebase has already been bitten once by a month that turned over at the
	// wrong hour — a TIMESTAMPTZ here would be inventing an offset nobody
	// wrote down.
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS slip_when TEXT;',
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS slip_sender_name TEXT;',
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS slip_receiver_name TEXT;',
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS slip_sender_account_tail TEXT;',
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS slip_receiver_account_tail TEXT;',
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS slip_transferred_at TIMESTAMPTZ;',

	// A derived evidence card contains only the fields needed for a dispute.
	// The original upload is temporary and is discarded as soon as a decision
	// can be made; the evidence card carries no EXIF and no unused slip areas.
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS evidence_image BYTEA;',
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS evidence_mime TEXT;',
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS evidence_hash TEXT;',

	// Confirmation is intentionally two-dimensional. `status` says what the
	// ledger currently counts, while these columns say why it was allowed to
	// count. A bank API can later add `bank_verified` without rewriting history.
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS confirmation_source TEXT;',
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS verification_level TEXT NOT NULL DEFAULT \'none\';',
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS reversed_by TEXT REFERENCES users(id) ON DELETE SET NULL;',
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;',
	'ALTER TABLE payments ADD COLUMN IF NOT EXISTS reversal_reason TEXT;',

	// Unique across every activity, not just within one: a slip reused from
	// another group is exactly the case worth catching, and it is the only one
	// a per-activity constraint would miss. Partial, because almost every
	// payment has no slip at all and NULLs must not collide.
	'CREATE UNIQUE INDEX IF NOT EXISTS payments_slip_ref_key ON payments (slip_ref) WHERE slip_ref IS NOT NULL;',

	// One bank transfer may settle several recurring periods, and one period
	// may receive several partial transfers. Existing rows keep `period_id` as
	// a compatibility fallback; all new writes also create allocations here.
	`CREATE TABLE IF NOT EXISTS payment_allocations (
		id             TEXT PRIMARY KEY,
		payment_id     TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
		period_id      TEXT REFERENCES periods(id) ON DELETE CASCADE,
		amount_satang  BIGINT NOT NULL CHECK (amount_satang > 0),
		created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
	);`,
	'CREATE INDEX IF NOT EXISTS payment_allocations_payment_idx ON payment_allocations (payment_id);',
	'CREATE UNIQUE INDEX IF NOT EXISTS payment_allocations_period_key ON payment_allocations (payment_id, period_id) WHERE period_id IS NOT NULL;',
	'CREATE UNIQUE INDEX IF NOT EXISTS payment_allocations_event_key ON payment_allocations (payment_id) WHERE period_id IS NULL;',

	// Payment history is append-only. Rejection, reversal and voiding are state
	// transitions with actors and reasons, never an unexplained DELETE.
	`CREATE TABLE IF NOT EXISTS payment_events (
		id                   TEXT PRIMARY KEY,
		payment_id           TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
		activity_id          TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
		event_type           TEXT NOT NULL,
		actor_user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
		actor_participant_id TEXT REFERENCES participants(id) ON DELETE SET NULL,
		reason               TEXT,
		metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
		created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
	);`,
	'CREATE INDEX IF NOT EXISTS payment_events_payment_idx ON payment_events (payment_id, created_at);',
	'CREATE INDEX IF NOT EXISTS payment_events_activity_idx ON payment_events (activity_id, created_at);',

	// Nagging without spamming: one row per reminder actually delivered, so
	// the scheduler can hold off if Megu already spoke to this person today.
	`CREATE TABLE IF NOT EXISTS payment_reminders (
		id             TEXT PRIMARY KEY,
		activity_id    TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
		period_id      TEXT REFERENCES periods(id) ON DELETE CASCADE,
		participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
		channel        TEXT NOT NULL,
		amount_satang  BIGINT NOT NULL,
		sent_at        TIMESTAMPTZ NOT NULL DEFAULT now()
	);`,
	'CREATE INDEX IF NOT EXISTS payment_reminders_participant_idx ON payment_reminders (participant_id, sent_at DESC);',
];

/**
 * One transaction, one process at a time.
 *
 * `index.js` forks the bot and the web process and both of them boot this, so
 * without the lock they race. On a database that still has the old names that
 * race is not harmless: both would see `megu_users` present and `users` absent,
 * both would issue the rename, and the one that arrives second finds the table
 * it named no longer exists. Whoever loses then logs "schema init failed" and
 * runs with activity features off — having already renamed some tables and not
 * others, because each statement used to commit on its own.
 *
 * The transaction is what removes the half-migrated database as a possible
 * outcome; the lock is what stops the second process from having to recover
 * from one. The loser waits, then finds every guard false and does nothing.
 */
async function initCoreSchema() {
	await transaction(async (client) => {
		await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK]);
		for (const statement of MIGRATIONS) {
			await client.query(statement);
		}
		for (const statement of STATEMENTS) {
			await client.query(statement);
		}
	});
	log('Core', 'Megu core schema verified.');
}

module.exports = { initCoreSchema };
