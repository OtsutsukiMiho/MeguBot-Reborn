'use strict';

// Core startup installs this under its schema transaction/lock when opted in,
// or maintains existing storage when the Goals UI is subsequently disabled.
async function installTeamGoalSchema(client) {
	await client.query(`CREATE TABLE IF NOT EXISTS team_goals (
	 id TEXT PRIMARY KEY,
	 team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
	 subject_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
	 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
	 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	 current_version INTEGER NOT NULL DEFAULT 1 CHECK(current_version > 0),
	 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)
	)`);
	await client.query('ALTER TABLE team_goals ADD COLUMN IF NOT EXISTS creation_request_key TEXT, ADD COLUMN IF NOT EXISTS creation_request_hash TEXT');
	await client.query(`DO $$ BEGIN
	 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='team_goals'::regclass AND conname='team_goals_creation_request_check') THEN
	  ALTER TABLE team_goals ADD CONSTRAINT team_goals_creation_request_check CHECK (
	   (creation_request_key IS NULL AND creation_request_hash IS NULL) OR
	   (creation_request_key IS NOT NULL AND creation_request_hash IS NOT NULL
	    AND creation_request_key ~ '^[a-zA-Z0-9_-]{16,100}$' AND creation_request_hash ~ '^[a-f0-9]{64}$'));
	 END IF;
	END $$`);
	await client.query('CREATE UNIQUE INDEX IF NOT EXISTS team_goals_creation_request_idx ON team_goals(creation_request_key) WHERE creation_request_key IS NOT NULL');
	await client.query(`CREATE TABLE IF NOT EXISTS team_goal_versions (
	 goal_id TEXT NOT NULL REFERENCES team_goals(id) ON DELETE RESTRICT,
	 version INTEGER NOT NULL CHECK(version > 0),
	 reviewer_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
	 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
	 success_description TEXT NOT NULL CHECK(length(trim(success_description)) BETWEEN 1 AND 4000),
	 period_start DATE NOT NULL, period_end DATE NOT NULL CHECK(period_end >= period_start),
	 timezone TEXT NOT NULL CHECK(length(timezone) BETWEEN 1 AND 100),
	 measurement JSONB NOT NULL CHECK(jsonb_typeof(measurement)='object' AND measurement ? 'kind' AND measurement->>'kind' IS NOT NULL AND measurement->>'kind' IN ('numeric','milestone')),
	 lifecycle TEXT NOT NULL DEFAULT 'draft' CHECK(lifecycle IN ('draft','proposed','active','submitted','reviewed','archived','cancelled')),
	 subject_accepted_at TIMESTAMPTZ, reviewer_accepted_at TIMESTAMPTZ,
	 needs_reviewer BOOLEAN NOT NULL DEFAULT false,
	 self_review TEXT CHECK(length(self_review) <= 4000),
	 prior_version INTEGER,
	 reason TEXT CHECK(length(reason) BETWEEN 1 AND 4000),
	 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
	 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	 PRIMARY KEY(goal_id,version),
	 FOREIGN KEY(goal_id,prior_version) REFERENCES team_goal_versions(goal_id,version) ON DELETE RESTRICT,
	 CHECK(prior_version IS NULL OR (prior_version < version AND reason IS NOT NULL)),
	 CHECK(reviewer_accepted_at IS NULL OR reviewer_id IS NOT NULL),
	 CHECK(lifecycle NOT IN ('active','submitted','reviewed') OR subject_accepted_at IS NOT NULL),
	 CHECK(lifecycle NOT IN ('active','submitted','reviewed') OR reviewer_id IS NULL OR reviewer_accepted_at IS NOT NULL OR needs_reviewer),
	 CHECK(lifecycle <> 'reviewed' OR (reviewer_id IS NOT NULL AND reviewer_accepted_at IS NOT NULL AND NOT needs_reviewer))
	)`);
	await client.query(`CREATE TABLE IF NOT EXISTS team_goal_updates (
	 id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, version INTEGER NOT NULL,
	 author_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
	 reported_value DOUBLE PRECISION CHECK(reported_value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)),
	 note TEXT NOT NULL CHECK(length(trim(note)) BETWEEN 1 AND 4000),
	 links JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(links)='array' AND jsonb_array_length(links)<=10),
	 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	 FOREIGN KEY(goal_id,version) REFERENCES team_goal_versions(goal_id,version) ON DELETE RESTRICT
	)`);
	await client.query('ALTER TABLE team_goal_updates ADD COLUMN IF NOT EXISTS project_id TEXT, ADD COLUMN IF NOT EXISTS topic_id TEXT');
	await client.query(`DO $$ BEGIN
	 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='team_goal_updates'::regclass AND conname='team_goal_updates_project_fk') THEN
	  ALTER TABLE team_goal_updates ADD CONSTRAINT team_goal_updates_project_fk FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT;
	 END IF;
	 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='team_goal_updates'::regclass AND conname='team_goal_updates_topic_fk') THEN
	  ALTER TABLE team_goal_updates ADD CONSTRAINT team_goal_updates_topic_fk FOREIGN KEY(project_id,topic_id) REFERENCES project_topics(project_id,id) ON DELETE RESTRICT;
	 END IF;
	 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='team_goal_updates'::regclass AND conname='team_goal_updates_topic_project_check') THEN
	  ALTER TABLE team_goal_updates ADD CONSTRAINT team_goal_updates_topic_project_check CHECK(topic_id IS NULL OR project_id IS NOT NULL);
	 END IF;
	END $$`);
	// Deferred because creation inserts the goal before its first version in
	// the same transaction. Validate existing rows too; never discard history.
	await client.query(`DO $$ BEGIN
	 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='team_goals'::regclass AND conname='team_goals_current_version_fk') THEN
	  ALTER TABLE team_goals ADD CONSTRAINT team_goals_current_version_fk
	   FOREIGN KEY(id,current_version) REFERENCES team_goal_versions(goal_id,version)
	   DEFERRABLE INITIALLY DEFERRED;
	 END IF;
	END $$`);
	await client.query(`CREATE TABLE IF NOT EXISTS team_goal_reviews (
	 id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, version INTEGER NOT NULL,
	 reviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
	 outcome TEXT NOT NULL CHECK(outcome IN ('exceeded','met','partially_met','not_met','not_assessed')),
	 explanation TEXT NOT NULL CHECK(length(trim(explanation)) BETWEEN 1 AND 4000),
	 next_step TEXT NOT NULL CHECK(length(trim(next_step)) BETWEEN 1 AND 4000),
	 published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	 UNIQUE(goal_id,version),
	 FOREIGN KEY(goal_id,version) REFERENCES team_goal_versions(goal_id,version) ON DELETE RESTRICT
	)`);
	await client.query(`CREATE TABLE IF NOT EXISTS team_goal_responses (
	 id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES team_goal_reviews(id) ON DELETE RESTRICT,
	 author_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
	 response TEXT CHECK(length(trim(response)) BETWEEN 1 AND 4000),
	 acknowledged BOOLEAN NOT NULL DEFAULT false,
	 CHECK(acknowledged OR response IS NOT NULL),
	 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`);
	await client.query(`CREATE TABLE IF NOT EXISTS team_goal_events (
	 id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES team_goals(id) ON DELETE RESTRICT,
	 version INTEGER NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
	 event_type TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb,
	 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	 FOREIGN KEY(goal_id,version) REFERENCES team_goal_versions(goal_id,version) ON DELETE RESTRICT
	)`);
	await client.query('CREATE INDEX IF NOT EXISTS team_goals_subject_idx ON team_goals(team_id,subject_id,id)');
	await client.query('CREATE INDEX IF NOT EXISTS team_goal_versions_reviewer_idx ON team_goal_versions(reviewer_id,goal_id)');
	await client.query('CREATE INDEX IF NOT EXISTS team_goal_updates_history_idx ON team_goal_updates(goal_id,version,created_at,id)');
	// Identity references may be remapped by account merge; content never changes.
	await client.query(`CREATE OR REPLACE FUNCTION protect_team_goal_history() RETURNS trigger LANGUAGE plpgsql AS $$
	 BEGIN
	  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'goal_history_immutable' USING ERRCODE='23514'; END IF;
	  IF (to_jsonb(NEW) - TG_ARGV::text[]) IS DISTINCT FROM (to_jsonb(OLD) - TG_ARGV::text[]) THEN
	   RAISE EXCEPTION 'goal_history_immutable' USING ERRCODE='23514';
	  END IF;
	  RETURN NEW;
	 END $$`);
	for (const [table, actor] of [['team_goal_updates', 'author_id'], ['team_goal_reviews', 'reviewer_id'], ['team_goal_responses', 'author_id'], ['team_goal_events', 'actor_id']]) {
		await client.query(`CREATE OR REPLACE TRIGGER ${table}_immutable BEFORE UPDATE OR DELETE ON ${table}
		 FOR EACH ROW EXECUTE FUNCTION protect_team_goal_history('${actor}')`);
	}
	await client.query(`CREATE OR REPLACE FUNCTION protect_reviewed_goal_version() RETURNS trigger LANGUAGE plpgsql AS $$
	 BEGIN
	  IF OLD.lifecycle='reviewed' THEN
	   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'goal_review_immutable' USING ERRCODE='23514'; END IF;
	   IF (to_jsonb(NEW) - ARRAY['reviewer_id','created_by']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['reviewer_id','created_by']) THEN
	    RAISE EXCEPTION 'goal_review_immutable' USING ERRCODE='23514';
	   END IF;
	  END IF;
	  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
	  RETURN NEW;
	 END $$`);
	await client.query(`CREATE OR REPLACE TRIGGER team_goal_versions_reviewed_immutable BEFORE UPDATE OR DELETE ON team_goal_versions
	 FOR EACH ROW EXECUTE FUNCTION protect_reviewed_goal_version()`);
}

module.exports = { installTeamGoalSchema };
