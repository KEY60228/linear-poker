-- Allow 'needs_discussion' as a session status.
--
-- SQLite's ALTER TABLE doesn't support modifying CHECK constraints. The
-- usual workaround — rebuild the table, copy rows, drop the old, rename
-- the new — collides with D1's foreign-key enforcement: the children
-- (participants / rounds / final_estimates) have ON DELETE CASCADE on
-- sessions(id), and dropping the old sessions row clears them out.
--
-- Instead, edit the schema in place. `PRAGMA writable_schema` lets us
-- UPDATE the `sql` column of `sqlite_master` so the table's CHECK
-- constraint string contains the new status. The underlying data pages
-- aren't touched, so all the children stay intact.

PRAGMA writable_schema = 1;

UPDATE sqlite_master
SET sql = replace(
  sql,
  'CHECK (status IN (''voting'', ''revealed'', ''finalized''))',
  'CHECK (status IN (''voting'', ''needs_discussion'', ''revealed'', ''finalized''))'
)
WHERE type = 'table' AND name = 'sessions';

PRAGMA writable_schema = 0;
