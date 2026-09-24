-- session_recordings moved to the session-recording plugin, whose first
-- migration renames it. Dropping it here would lose every recording, so
-- this only stops drizzle tracking it. SELECT 1 because MySQL rejects an
-- empty query.
SELECT 1;
