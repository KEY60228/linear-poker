-- Linear Planning Poker — initial schema.
-- One session corresponds to one Linear Project / one StoryPoint Issue.

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  team_id         TEXT NOT NULL,
  project_id      TEXT NOT NULL,
  issue_id        TEXT NOT NULL,
  facilitator_id  TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('voting', 'needs_discussion', 'revealed', 'finalized')),
  current_round_no INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  -- Cached snapshot of team/project/issue/scale so the polling read path
  -- doesn't have to call Linear on every request.
  meta_json       TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

CREATE TABLE IF NOT EXISTS participants (
  session_id    TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  added_at      INTEGER NOT NULL,
  -- Cached display_name / email so the session view doesn't refetch from
  -- Linear on every render.
  display_name  TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
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

-- Saved participant rosters, scoped to a Linear team. Anyone can create,
-- edit, or delete groups (matching the rest of the app's permission model).
-- Membership snapshots display_name / email so the picker can render
-- without hitting Linear.

CREATE TABLE IF NOT EXISTS participant_groups (
  id          TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_participant_groups_team ON participant_groups(team_id);

CREATE TABLE IF NOT EXISTS participant_group_members (
  group_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  email         TEXT NOT NULL,
  added_at      INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES participant_groups(id) ON DELETE CASCADE
);
