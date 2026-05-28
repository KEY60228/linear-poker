-- Saved participant groups, scoped to a Linear team. Anyone can create,
-- edit, or delete groups (matching the rest of the app's permission model
-- around sessions). Membership is a snapshot of Linear users with the
-- display_name / email cached so the picker can show them without going
-- back to Linear.

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
