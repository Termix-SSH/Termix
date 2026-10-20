-- recent_activity moved to the homepage plugin, whose migration renames it to
-- p_homepage_recent_activity. Dropping it here would lose every entry, so this
-- only stops drizzle tracking it. SELECT 1 because MySQL rejects an empty query.
SELECT 1;
