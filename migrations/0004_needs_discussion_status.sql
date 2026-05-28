-- Add 'needs_discussion' to the sessions.status set, then backfill any
-- existing voting session that already meets the new condition
-- (every participant voted AND at least one picked need_info).
--
-- SQLite's ALTER TABLE can't modify a CHECK constraint and D1 forbids
-- PRAGMA writable_schema, so we have to rebuild the sessions table.
-- D1 enforces foreign keys, so dropping the old sessions row would
-- cascade into participants / rounds / final_estimates. Workaround:
-- snapshot every child table first, drop the children, rebuild
-- sessions with the widened CHECK, recreate the children with the
-- same schema (matching their state after 0002), and restore from
-- the snapshots. The whole thing runs in a single transaction.

-- 1. Snapshot child rows.
CREATE TABLE _participants_backup     AS SELECT * FROM participants;
CREATE TABLE _rounds_backup           AS SELECT * FROM rounds;
CREATE TABLE _votes_backup            AS SELECT * FROM votes;
CREATE TABLE _final_estimates_backup  AS SELECT * FROM final_estimates;

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

-- 5. Restore the data, drop the snapshots.
INSERT INTO participants    SELECT * FROM _participants_backup;
INSERT INTO rounds          SELECT * FROM _rounds_backup;
INSERT INTO votes           SELECT * FROM _votes_backup;
INSERT INTO final_estimates SELECT * FROM _final_estimates_backup;

DROP TABLE _participants_backup;
DROP TABLE _rounds_backup;
DROP TABLE _votes_backup;
DROP TABLE _final_estimates_backup;

-- 6. Backfill: any voting session whose current round already has every
--    participant voting AND at least one need_info should move to the new
--    needs_discussion bucket.
UPDATE sessions
SET status = 'needs_discussion'
WHERE status = 'voting'
  AND id IN (
    SELECT s.id
    FROM sessions s
    JOIN rounds r
      ON r.session_id = s.id AND r.round_no = s.current_round_no
    WHERE
      (SELECT COUNT(*) FROM participants WHERE session_id = s.id) > 0
      AND (SELECT COUNT(*) FROM participants WHERE session_id = s.id)
        = (SELECT COUNT(DISTINCT user_id) FROM votes WHERE round_id = r.id)
      AND EXISTS (
        SELECT 1 FROM votes WHERE round_id = r.id AND value = 'need_info'
      )
  );
