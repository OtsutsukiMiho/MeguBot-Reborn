const { query } = require('./db.js');
const { log } = require('./log.js');

// Legacy bot tables live unprefixed in the same database; everything core
// owns is prefixed megu_ so the two never collide.
const STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS megu_users (
		id            TEXT PRIMARY KEY,
		display_name  TEXT NOT NULL,
		avatar_url    TEXT,
		created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
	);`,

	`CREATE TABLE IF NOT EXISTS megu_identities (
		id            TEXT PRIMARY KEY,
		user_id       TEXT NOT NULL REFERENCES megu_users(id) ON DELETE CASCADE,
		provider      TEXT NOT NULL,
		provider_uid  TEXT NOT NULL,
		email         TEXT,
		username      TEXT,
		avatar_url    TEXT,
		created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
		UNIQUE (provider, provider_uid)
	);`,
	'CREATE INDEX IF NOT EXISTS megu_identities_user_idx ON megu_identities (user_id);',

	// Two independent axes, not one pipeline.
	//
	//   plan  — open → confirmed → done          (what the group agreed to do)
	//   money — none → open → settled            (what they owe each other)
	//
	// They are orthogonal on purpose: a badminton court has a known price
	// before anyone turns up, a dinner bill only after. Forcing money into the
	// plan timeline is what made the old order wrong.
	`CREATE TABLE IF NOT EXISTS megu_activities (
		id            TEXT PRIMARY KEY,
		code          TEXT NOT NULL UNIQUE,
		owner_user_id TEXT NOT NULL REFERENCES megu_users(id) ON DELETE RESTRICT,
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
	'ALTER TABLE megu_activities ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT \'event\';',
	'ALTER TABLE megu_activities ADD COLUMN IF NOT EXISTS plan_state TEXT NOT NULL DEFAULT \'open\';',
	'ALTER TABLE megu_activities ADD COLUMN IF NOT EXISTS recurrence TEXT;',
	'ALTER TABLE megu_activities ADD COLUMN IF NOT EXISTS due_day INTEGER;',
	'CREATE INDEX IF NOT EXISTS megu_activities_owner_idx ON megu_activities (owner_user_id);',
	'CREATE INDEX IF NOT EXISTS megu_activities_guild_idx ON megu_activities (guild_id);',

	// One row per month of a recurring agreement. Expenses and payments point
	// at a period when there is one, and at nothing when the activity is a
	// single event.
	`CREATE TABLE IF NOT EXISTS megu_periods (
		id           TEXT PRIMARY KEY,
		activity_id  TEXT NOT NULL REFERENCES megu_activities(id) ON DELETE CASCADE,
		period_key   TEXT NOT NULL,
		label        TEXT NOT NULL,
		due_at       TIMESTAMPTZ,
		created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
		UNIQUE (activity_id, period_key)
	);`,
	'CREATE INDEX IF NOT EXISTS megu_periods_activity_idx ON megu_periods (activity_id);',

	`CREATE TABLE IF NOT EXISTS megu_participants (
		id            TEXT PRIMARY KEY,
		activity_id   TEXT NOT NULL REFERENCES megu_activities(id) ON DELETE CASCADE,
		display_name  TEXT NOT NULL,
		user_id       TEXT REFERENCES megu_users(id) ON DELETE SET NULL,
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
	'ALTER TABLE megu_participants ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;',
	'CREATE INDEX IF NOT EXISTS megu_participants_activity_idx ON megu_participants (activity_id);',
	'CREATE INDEX IF NOT EXISTS megu_participants_user_idx ON megu_participants (user_id);',
	'CREATE INDEX IF NOT EXISTS megu_participants_discord_idx ON megu_participants (discord_uid);',

	// The part nobody in a group chat wants to own: proposing times, chasing
	// answers, and saying out loud which one wins. Megu holds the slots and
	// the votes so no human has to be the one who decides.
	`CREATE TABLE IF NOT EXISTS megu_slots (
		id          TEXT PRIMARY KEY,
		activity_id TEXT NOT NULL REFERENCES megu_activities(id) ON DELETE CASCADE,
		starts_at   TIMESTAMPTZ NOT NULL,
		position    INTEGER NOT NULL DEFAULT 0,
		created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
	);`,
	'CREATE INDEX IF NOT EXISTS megu_slots_activity_idx ON megu_slots (activity_id);',

	`CREATE TABLE IF NOT EXISTS megu_slot_votes (
		id             TEXT PRIMARY KEY,
		slot_id        TEXT NOT NULL REFERENCES megu_slots(id) ON DELETE CASCADE,
		participant_id TEXT NOT NULL REFERENCES megu_participants(id) ON DELETE CASCADE,
		answer         TEXT NOT NULL,
		updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
		UNIQUE (slot_id, participant_id)
	);`,
	'CREATE INDEX IF NOT EXISTS megu_slot_votes_participant_idx ON megu_slot_votes (participant_id);',

	`CREATE TABLE IF NOT EXISTS megu_expenses (
		id            TEXT PRIMARY KEY,
		activity_id   TEXT NOT NULL REFERENCES megu_activities(id) ON DELETE CASCADE,
		period_id     TEXT REFERENCES megu_periods(id) ON DELETE CASCADE,
		label         TEXT NOT NULL,
		amount_satang BIGINT NOT NULL CHECK (amount_satang > 0),
		paid_by       TEXT NOT NULL REFERENCES megu_participants(id) ON DELETE RESTRICT,
		created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
	);`,
	'ALTER TABLE megu_expenses ADD COLUMN IF NOT EXISTS period_id TEXT REFERENCES megu_periods(id) ON DELETE CASCADE;',
	'CREATE INDEX IF NOT EXISTS megu_expenses_activity_idx ON megu_expenses (activity_id);',
	'CREATE INDEX IF NOT EXISTS megu_expenses_period_idx ON megu_expenses (period_id);',

	`CREATE TABLE IF NOT EXISTS megu_shares (
		id             TEXT PRIMARY KEY,
		expense_id     TEXT NOT NULL REFERENCES megu_expenses(id) ON DELETE CASCADE,
		participant_id TEXT NOT NULL REFERENCES megu_participants(id) ON DELETE CASCADE,
		amount_satang  BIGINT NOT NULL CHECK (amount_satang >= 0),
		UNIQUE (expense_id, participant_id)
	);`,
	'CREATE INDEX IF NOT EXISTS megu_shares_participant_idx ON megu_shares (participant_id);',

	`CREATE TABLE IF NOT EXISTS megu_payments (
		id             TEXT PRIMARY KEY,
		activity_id    TEXT NOT NULL REFERENCES megu_activities(id) ON DELETE CASCADE,
		period_id      TEXT REFERENCES megu_periods(id) ON DELETE CASCADE,
		participant_id TEXT NOT NULL REFERENCES megu_participants(id) ON DELETE CASCADE,
		amount_satang  BIGINT NOT NULL CHECK (amount_satang > 0),
		method         TEXT NOT NULL DEFAULT 'manual',
		status         TEXT NOT NULL DEFAULT 'pending',
		reference      TEXT,
		confirmed_by   TEXT REFERENCES megu_users(id) ON DELETE SET NULL,
		created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
		confirmed_at   TIMESTAMPTZ
	);`,
	'ALTER TABLE megu_payments ADD COLUMN IF NOT EXISTS period_id TEXT REFERENCES megu_periods(id) ON DELETE CASCADE;',
	'CREATE INDEX IF NOT EXISTS megu_payments_activity_idx ON megu_payments (activity_id);',
	'CREATE INDEX IF NOT EXISTS megu_payments_participant_idx ON megu_payments (participant_id);',

	// Nagging without spamming: one row per reminder actually delivered, so
	// the scheduler can hold off if Megu already spoke to this person today.
	`CREATE TABLE IF NOT EXISTS megu_reminders (
		id             TEXT PRIMARY KEY,
		activity_id    TEXT NOT NULL REFERENCES megu_activities(id) ON DELETE CASCADE,
		period_id      TEXT REFERENCES megu_periods(id) ON DELETE CASCADE,
		participant_id TEXT NOT NULL REFERENCES megu_participants(id) ON DELETE CASCADE,
		channel        TEXT NOT NULL,
		amount_satang  BIGINT NOT NULL,
		sent_at        TIMESTAMPTZ NOT NULL DEFAULT now()
	);`,
	'CREATE INDEX IF NOT EXISTS megu_reminders_participant_idx ON megu_reminders (participant_id, sent_at DESC);',
];

async function initCoreSchema() {
	for (const statement of STATEMENTS) {
		await query(statement);
	}
	log('Core', 'Megu core schema verified.');
}

module.exports = { initCoreSchema };
