-- Allow 'needs_discussion' as a session status.
--
-- SQLite's ALTER TABLE doesn't support modifying CHECK constraints, and
-- D1 disallows PRAGMA writable_schema, so we can't just edit the table
-- definition in place. We can't naively rebuild the sessions table either
-- because the children (participants / rounds / final_estimates) have
-- ON DELETE CASCADE on sessions(id) and D1 enforces foreign keys.
--
-- Workaround: snapshot every child table into a temp table, drop the
-- children (so dropping sessions no longer cascades), rebuild sessions
-- with the widened CHECK, recreate the children with the same schema,
-- and restore their rows from the snapshots. The whole thing runs in a
-- single transaction so it's atomic.

-- 1. Snapshot child rows.
CREATE TABLE _participants_backup AS SELECT * FROM participants;
CREATE TABLE _rounds_backup        AS SELECT * FROM rounds;
CREATE TABLE _votes_backup         AS SELECT * FROM votes;
CREATE TABLE _final_estimates_backup AS SELECT * FROM final_estimates;

-- 2. Drop the children so dropping sessions doesn't cascade anything.
DROP TABLE votes;
DROP TABLE rounds;
DROP TABLE final_estimates;
DROP TABLE participants;

-- 3. Rebuild sessions with the new CHECK.
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

-- 4. Recreate the children with the same schema they had after 0002 (the
--    original columns plus the display_name / email added there).
CREATE TABLE participants (
  session_id   TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  added_at     INTEGER NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (session_id, user_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE rounds (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  round_no     INTEGER NOT NULL,
  revealed_at  INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE (session_id, round_no)
);

CREATE TABLE votes (
  round_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  value      TEXT NOT NULL,
  voted_at   INTEGER NOT NULL,
  PRIMARY KEY (round_id, user_id),
  FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE
);

CREATE TABLE final_estimates (
  session_id     TEXT PRIMARY KEY,
  value          TEXT NOT NULL,
  finalized_by   TEXT NOT NULL,
  finalized_at   INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- 5. Restore from the snapshots and drop them.
INSERT INTO participants     SELECT * FROM _participants_backup;
INSERT INTO rounds           SELECT * FROM _rounds_backup;
INSERT INTO votes            SELECT * FROM _votes_backup;
INSERT INTO final_estimates  SELECT * FROM _final_estimates_backup;

DROP TABLE _participants_backup;
DROP TABLE _rounds_backup;
DROP TABLE _votes_backup;
DROP TABLE _final_estimates_backup;
