-- Cache the human-readable Team / Project / Issue / scale snapshot on the
-- session row so we don't have to refetch Linear on every poll. Participant
-- rows also cache the user's displayName + email so the session view can
-- render names without going back to Linear.

ALTER TABLE sessions ADD COLUMN meta_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE participants ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE participants ADD COLUMN email TEXT NOT NULL DEFAULT '';
