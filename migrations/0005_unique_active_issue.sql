-- Enforce "1 Linear Issue = at most 1 active (non-finalized) session" at the
-- DB level. The application-level duplicate check in SessionDO.createSession
-- runs in a different DO instance per create (the DO is keyed by the fresh
-- session id), so two concurrent creates for the same issue could both pass
-- the check and both insert. A partial unique index makes the second insert
-- fail atomically; the DO translates the constraint error into the existing
-- session_already_exists error.
--
-- Before creating the index, remove any duplicate active sessions that the
-- race already produced (keep the newest per issue, drop the rest with their
-- children). Ties on created_at break by id so the survivor is deterministic.

DELETE FROM votes WHERE round_id IN (
  SELECT r.id FROM rounds r WHERE r.session_id IN (
    SELECT s.id FROM sessions s
    WHERE s.status != 'finalized'
      AND EXISTS (
        SELECT 1 FROM sessions s2
        WHERE s2.issue_id = s.issue_id AND s2.status != 'finalized'
          AND (s2.created_at > s.created_at OR (s2.created_at = s.created_at AND s2.id > s.id))
      )
  )
);

DELETE FROM rounds WHERE session_id IN (
  SELECT s.id FROM sessions s
  WHERE s.status != 'finalized'
    AND EXISTS (
      SELECT 1 FROM sessions s2
      WHERE s2.issue_id = s.issue_id AND s2.status != 'finalized'
        AND (s2.created_at > s.created_at OR (s2.created_at = s.created_at AND s2.id > s.id))
    )
);

DELETE FROM final_estimates WHERE session_id IN (
  SELECT s.id FROM sessions s
  WHERE s.status != 'finalized'
    AND EXISTS (
      SELECT 1 FROM sessions s2
      WHERE s2.issue_id = s.issue_id AND s2.status != 'finalized'
        AND (s2.created_at > s.created_at OR (s2.created_at = s.created_at AND s2.id > s.id))
    )
);

DELETE FROM participants WHERE session_id IN (
  SELECT s.id FROM sessions s
  WHERE s.status != 'finalized'
    AND EXISTS (
      SELECT 1 FROM sessions s2
      WHERE s2.issue_id = s.issue_id AND s2.status != 'finalized'
        AND (s2.created_at > s.created_at OR (s2.created_at = s.created_at AND s2.id > s.id))
    )
);

DELETE FROM sessions WHERE id IN (
  SELECT s.id FROM sessions s
  WHERE s.status != 'finalized'
    AND EXISTS (
      SELECT 1 FROM sessions s2
      WHERE s2.issue_id = s.issue_id AND s2.status != 'finalized'
        AND (s2.created_at > s.created_at OR (s2.created_at = s.created_at AND s2.id > s.id))
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_active_issue
  ON sessions(issue_id) WHERE status != 'finalized';
