-- Allow 'needs_discussion' as a session status. SQLite can't ALTER a CHECK
-- constraint in place, so we rebuild the sessions table with the wider set
-- of allowed values.
--
-- D1 enforces foreign keys, so dropping the old sessions table would cascade
-- into participants / rounds / final_estimates (ON DELETE CASCADE) and wipe
-- their rows. PRAGMA defer_foreign_keys = ON tells SQLite to skip FK checks
-- until the end of the transaction, so the drop + rename works without
-- collateral deletes. The new sessions table preserves the same `id`
-- primary keys, so by the time the transaction commits the child rows are
-- still valid against the renamed table.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE sessions_new (
  id              TEXT PRIMARY KEY,
  team_id         TEXT NOT NULL,
  project_id      TEXT NOT NULL,
  issue_id        TEXT NOT NULL,
  facilitator_id  TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('voting', 'needs_discussion', 'revealed', 'finalized')),
  current_round_no INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  meta_json       TEXT NOT NULL DEFAULT '{}'
);

INSERT INTO sessions_new (
  id, team_id, project_id, issue_id, facilitator_id, status,
  current_round_no, created_at, meta_json
)
SELECT
  id, team_id, project_id, issue_id, facilitator_id, status,
  current_round_no, created_at, meta_json
FROM sessions;

DROP TABLE sessions;

ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
