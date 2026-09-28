'use strict';

// Guild-scoped configuration, not a second organization or membership roster.
async function installServerRoleSchema(client) {
	await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS teams_id_discord_guild_key ON teams(id,discord_guild_id)`);
	await client.query(`CREATE TABLE IF NOT EXISTS server_role_mappings (
		id TEXT PRIMARY KEY,
		guild_id TEXT NOT NULL CHECK (guild_id ~ '^[0-9]{17,20}$'),
		kind TEXT NOT NULL CHECK (kind IN ('team','title')),
		team_id TEXT,
		title TEXT,
		mode TEXT NOT NULL DEFAULT 'approval' CHECK (mode IN ('approval','automatic')),
		enabled BOOLEAN NOT NULL DEFAULT false,
		revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
		created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
		owner_consent_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
		owner_consent_at TIMESTAMPTZ,
		server_consent_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
		server_consent_at TIMESTAMPTZ,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		CHECK ((kind='team' AND team_id IS NOT NULL AND title IS NULL) OR
		       (kind='title' AND team_id IS NULL AND title IS NOT NULL AND length(trim(title)) BETWEEN 1 AND 120)),
		CHECK ((owner_consent_by IS NULL) = (owner_consent_at IS NULL)),
		CHECK ((server_consent_by IS NULL) = (server_consent_at IS NULL)),
		CHECK (NOT enabled OR (server_consent_by IS NOT NULL AND (kind='title' OR owner_consent_by IS NOT NULL))),
		CHECK (kind <> 'title' OR mode='approval')
	)`);
	await client.query('ALTER TABLE server_role_mappings ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ');
	await client.query(`ALTER TABLE server_role_mappings
	 ADD COLUMN IF NOT EXISTS delegation_version INTEGER CHECK(delegation_version IS NULL OR delegation_version=1),
	 ADD COLUMN IF NOT EXISTS sync_action TEXT CHECK(sync_action IN ('enable','disable','approval','unlink')),
	 ADD COLUMN IF NOT EXISTS sync_requested_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
	 ADD COLUMN IF NOT EXISTS sync_requested_at TIMESTAMPTZ,
	 ADD COLUMN IF NOT EXISTS sync_request_revision INTEGER,
	 ADD COLUMN IF NOT EXISTS sync_preview_hash TEXT,
	 ADD COLUMN IF NOT EXISTS sync_preview_owner TEXT REFERENCES users(id) ON DELETE RESTRICT,
	 ADD COLUMN IF NOT EXISTS sync_preview_team_revision INTEGER,
	 ADD COLUMN IF NOT EXISTS sync_preview_expires_at TIMESTAMPTZ`);
	await client.query(`ALTER TABLE server_role_mappings ADD COLUMN IF NOT EXISTS active_team_id TEXT GENERATED ALWAYS AS (CASE WHEN retired_at IS NULL THEN team_id ELSE NULL END) STORED`);
	await client.query(`DO $$ BEGIN
	 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='server_role_mappings'::regclass AND conname='server_role_mappings_history_team_fk') THEN
	  ALTER TABLE server_role_mappings ADD CONSTRAINT server_role_mappings_history_team_fk FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE RESTRICT;
	 END IF;
	 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='server_role_mappings'::regclass AND conname='server_role_mappings_active_team_fk') THEN
	  ALTER TABLE server_role_mappings ADD CONSTRAINT server_role_mappings_active_team_fk FOREIGN KEY(active_team_id,guild_id) REFERENCES teams(id,discord_guild_id) ON DELETE RESTRICT;
	 END IF;
	 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='server_role_mappings'::regclass AND conname='server_role_mappings_retired_check') THEN
	  ALTER TABLE server_role_mappings ADD CONSTRAINT server_role_mappings_retired_check CHECK(retired_at IS NULL OR NOT enabled);
	 END IF;
	 IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
	  WHERE i.indrelid='server_role_mappings'::regclass AND c.relname='server_role_mappings_team_key'
	  AND pg_get_expr(i.indpred,i.indrelid) NOT LIKE '%retired_at IS NULL%') THEN
	  DROP INDEX server_role_mappings_team_key;
	 END IF;
	END $$`);
	// Retired mappings retain the old server snapshot, while only active mappings
	// bind the team's current server. Validate replacement FKs before retiring it.
	await client.query(`DO $$ DECLARE old_fk record; BEGIN
	 FOR old_fk IN SELECT conname FROM pg_constraint WHERE conrelid='server_role_mappings'::regclass AND confrelid='teams'::regclass AND contype='f'
	  AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (team_id, guild_id)%'
	 LOOP EXECUTE format('ALTER TABLE server_role_mappings DROP CONSTRAINT %I',old_fk.conname); END LOOP;
	END $$`);
	await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS server_role_mappings_team_key ON server_role_mappings(team_id) WHERE kind='team' AND retired_at IS NULL`);
	await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS server_role_mappings_title_guild_key ON server_role_mappings(guild_id) WHERE kind='title'`);
	await client.query(`CREATE INDEX IF NOT EXISTS server_role_mappings_guild_idx ON server_role_mappings(guild_id,id)`);
	await client.query(`CREATE TABLE IF NOT EXISTS server_role_mapping_roles (
		mapping_id TEXT NOT NULL REFERENCES server_role_mappings(id) ON DELETE CASCADE,
		role_id TEXT NOT NULL CHECK (role_id ~ '^[0-9]{17,20}$'),
		name_snapshot TEXT NOT NULL,
		PRIMARY KEY(mapping_id,role_id)
	)`);
	await client.query(`CREATE TABLE IF NOT EXISTS server_role_suggestion_dismissals (
		mapping_id TEXT NOT NULL REFERENCES server_role_mappings(id) ON DELETE CASCADE,
		discord_user_id TEXT NOT NULL CHECK (discord_user_id ~ '^[0-9]{17,20}$'),
		dismissed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
		dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		PRIMARY KEY(mapping_id,discord_user_id)
	)`);
	await client.query(`CREATE TABLE IF NOT EXISTS server_role_events (
		id TEXT PRIMARY KEY,
		guild_id TEXT NOT NULL CHECK (guild_id ~ '^[0-9]{17,20}$'),
		actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
		event_type TEXT NOT NULL CHECK (event_type='title_roles_changed'),
		payload JSONB NOT NULL,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`);
	await client.query('CREATE INDEX IF NOT EXISTS server_role_events_guild_idx ON server_role_events(guild_id,created_at,id)');
	await client.query(`CREATE TABLE IF NOT EXISTS server_role_team_creations (
		guild_id TEXT NOT NULL CHECK (guild_id ~ '^[0-9]{17,20}$'),
		request_key TEXT NOT NULL CHECK (length(request_key) BETWEEN 16 AND 100),
		actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
		request_hash TEXT NOT NULL,
		result JSONB NOT NULL,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		PRIMARY KEY(guild_id,request_key)
	)`);
	await client.query(`CREATE TABLE IF NOT EXISTS server_role_sync_jobs (
		id TEXT PRIMARY KEY,
		mapping_id TEXT NOT NULL REFERENCES server_role_mappings(id) ON DELETE RESTRICT,
		user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
		mapping_revision INTEGER NOT NULL CHECK(mapping_revision>=0),
		generation INTEGER NOT NULL DEFAULT 1 CHECK(generation>0),
		cursor_user_id TEXT,
		state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','idle','degraded','blocked')),
		lease_token TEXT,
		lease_until TIMESTAMPTZ,
		next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
		counts JSONB NOT NULL DEFAULT '{}'::jsonb,
		last_success_at TIMESTAMPTZ,
		last_error TEXT,
		updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		CHECK((lease_token IS NULL)=(lease_until IS NULL))
	)`);
	await client.query("CREATE UNIQUE INDEX IF NOT EXISTS server_role_sync_jobs_scope_key ON server_role_sync_jobs(mapping_id,COALESCE(user_id,''))");
	await client.query(`ALTER TABLE server_role_sync_jobs ADD COLUMN IF NOT EXISTS attention_cycle INTEGER NOT NULL DEFAULT 0 CHECK(attention_cycle>=0),ADD COLUMN IF NOT EXISTS attention_open BOOLEAN NOT NULL DEFAULT false`);
	await client.query('CREATE INDEX IF NOT EXISTS server_role_sync_jobs_due_idx ON server_role_sync_jobs(next_attempt_at,id)');
}

module.exports = { installServerRoleSchema };
