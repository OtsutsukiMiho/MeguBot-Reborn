'use strict';

// Invoked inside the core schema transaction (and its advisory lock) once the
// company compatibility layer is ready. Keeping DDL separate makes migration
// tests exercise the exact production statements, not a second test schema.
const STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS companies (
		id TEXT PRIMARY KEY,
		discord_guild_id TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		icon TEXT,
		lifecycle TEXT NOT NULL DEFAULT 'unclaimed' CHECK (lifecycle IN ('unclaimed','active','archived')),
		revision INTEGER NOT NULL DEFAULT 0,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		archived_at TIMESTAMPTZ,
		CHECK ((lifecycle='archived') = (archived_at IS NOT NULL))
	)`,
	`CREATE TABLE IF NOT EXISTS company_memberships (
		company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
		role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
		joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		revoked_at TIMESTAMPTZ,
		PRIMARY KEY (company_id,user_id)
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS company_memberships_one_owner_key
	 ON company_memberships(company_id) WHERE role='owner' AND revoked_at IS NULL`,
	`CREATE INDEX IF NOT EXISTS company_memberships_user_idx ON company_memberships(user_id,company_id) WHERE revoked_at IS NULL`,
	`ALTER TABLE teams ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES companies(id) ON DELETE RESTRICT`,
	`CREATE INDEX IF NOT EXISTS teams_company_idx ON teams(company_id,archived_at,name,id)`,
	`CREATE TABLE IF NOT EXISTS company_events (
		id TEXT PRIMARY KEY,
		company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
		actor_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
		event_type TEXT NOT NULL,
		payload JSONB NOT NULL DEFAULT '{}'::jsonb,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`,
	`CREATE TABLE IF NOT EXISTS company_migrations (
		name TEXT PRIMARY KEY,
		completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		summary JSONB NOT NULL DEFAULT '{}'::jsonb
	)`,
	`CREATE TABLE IF NOT EXISTS company_join_links (
		id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
		token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ,
		created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS company_join_links_active_key ON company_join_links(company_id) WHERE revoked_at IS NULL`,
	`CREATE TABLE IF NOT EXISTS company_join_requests (
		id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
		company_link_id TEXT REFERENCES company_join_links(id) ON DELETE RESTRICT,
		team_link_id TEXT REFERENCES team_join_links(id) ON DELETE RESTRICT,
		status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
		request_cycle INTEGER NOT NULL DEFAULT 1 CHECK(request_cycle>0),
		requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), reviewed_at TIMESTAMPTZ,
		reviewed_by TEXT REFERENCES users(id) ON DELETE RESTRICT, rejection_reason TEXT,
		UNIQUE(company_id,user_id),
		CHECK ((company_link_id IS NOT NULL) <> (team_link_id IS NOT NULL))
	)`,
	`CREATE INDEX IF NOT EXISTS company_requests_pending_idx ON company_join_requests(company_id,requested_at,id) WHERE status='pending'`,
	`CREATE TABLE IF NOT EXISTS company_ownership_transfers (
		id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
		current_owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
		proposed_owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
		expires_at TIMESTAMPTZ NOT NULL, accepted_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		CHECK(current_owner_id<>proposed_owner_id OR cancelled_at IS NOT NULL),
		CHECK(accepted_at IS NULL OR cancelled_at IS NULL)
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS company_transfer_pending_key ON company_ownership_transfers(company_id)
	 WHERE accepted_at IS NULL AND cancelled_at IS NULL`,
];

async function installCompanySchema(client) {
	for (const sql of STATEMENTS) await client.query(sql);
}

/** One-time access-preserving migration. Never rerun union admission at boot:
 * doing so would restore a company membership deliberately revoked later.
 * Caller holds the schema lock and wraps all statements in one transaction.
 */
async function backfillCompanies(client) {
	const marker = 'connected-teams-to-companies-v1';
	const done = await client.query('SELECT 1 FROM company_migrations WHERE name=$1', [marker]);
	if (done.rowCount) return { alreadyApplied: true };
	const inserted = await client.query(`
		INSERT INTO companies(id,discord_guild_id,name,icon)
		SELECT 'com_' || md5(t.discord_guild_id),t.discord_guild_id,
		 COALESCE((SELECT NULLIF(trim(s.discord_guild_name),'') FROM teams s
		   WHERE s.discord_guild_id=t.discord_guild_id AND NULLIF(trim(s.discord_guild_name),'') IS NOT NULL
		   ORDER BY s.updated_at DESC,s.id LIMIT 1),'Discord server'),
		 (SELECT s.discord_guild_icon FROM teams s WHERE s.discord_guild_id=t.discord_guild_id
		   AND NULLIF(s.discord_guild_icon,'') IS NOT NULL ORDER BY s.updated_at DESC,s.id LIMIT 1)
		FROM (SELECT DISTINCT discord_guild_id FROM teams WHERE discord_guild_id IS NOT NULL) t
		ON CONFLICT (discord_guild_id) DO NOTHING`);
	const attached = await client.query(`UPDATE teams t SET company_id=c.id FROM companies c
		WHERE t.discord_guild_id=c.discord_guild_id AND t.company_id IS NULL`);
	const members = await client.query(`INSERT INTO company_memberships(company_id,user_id,role,joined_at)
		SELECT t.company_id,m.user_id,'member',min(m.joined_at)
		FROM teams t JOIN team_memberships m ON m.team_id=t.id
		WHERE t.company_id IS NOT NULL AND m.revoked_at IS NULL
		GROUP BY t.company_id,m.user_id
		ON CONFLICT (company_id,user_id) DO NOTHING`);
	const summary = { companies: inserted.rowCount, teams: attached.rowCount, members: members.rowCount };
	await client.query('INSERT INTO company_migrations(name,summary) VALUES ($1,$2)', [marker, JSON.stringify(summary)]);
	return { alreadyApplied: false, ...summary };
}

module.exports = { installCompanySchema, backfillCompanies };
