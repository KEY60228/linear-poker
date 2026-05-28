-- Allow 'needs_discussion' as a session status. SQLite can't ALTER a CHECK
-- constraint in place, so we rebuild the sessions table with the wider set
-- of allowed values. D1 doesn't enforce foreign keys by default, so the
-- drop/rename is safe without juggling the child tables.

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
