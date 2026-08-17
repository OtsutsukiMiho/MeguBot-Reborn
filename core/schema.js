const { query } = require('./db.js');
const { log } = require('./log.js');

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

async function initCoreSchema() {
	for (const statement of MIGRATIONS) {
		await query(statement);
	}
	for (const statement of STATEMENTS) {
		await query(statement);
	}
	log('Core', 'Megu core schema verified.');
}

module.exports = { initCoreSchema };
