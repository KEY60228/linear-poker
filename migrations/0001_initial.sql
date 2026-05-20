-- Linear Planning Poker — initial schema.
-- One session corresponds to one Linear Project / one StoryPoint Issue.

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  team_id         TEXT NOT NULL,
  project_id      TEXT NOT NULL,
  issue_id        TEXT NOT NULL,
  facilitator_id  TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('voting', 'revealed', 'finalized')),
  current_round_no INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

CREATE TABLE IF NOT EXISTS participants (
  session_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (session_id, user_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rounds (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  round_no     INTEGER NOT NULL,
  revealed_at  INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE (session_id, round_no)
);

CREATE TABLE IF NOT EXISTS votes (
  round_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  value      TEXT NOT NULL,
  voted_at   INTEGER NOT NULL,
  PRIMARY KEY (round_id, user_id),
  FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS final_estimates (
  session_id     TEXT PRIMARY KEY,
  value          TEXT NOT NULL,
  finalized_by   TEXT NOT NULL,
  finalized_at   INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
