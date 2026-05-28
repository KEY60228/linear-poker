-- Backfill: any pre-migration session whose current round already has every
-- participant voting AND at least one need_info should be in the new
-- needs_discussion bucket. Without this, those sessions stay on status
-- 'voting' until something nudges maybeAutoReveal again.

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
