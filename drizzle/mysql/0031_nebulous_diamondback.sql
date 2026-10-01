-- user_workspaces moved to the workspaces plugin, whose first migration renames it
-- to p_workspaces_workspaces. Dropping it here would lose every saved workspace,
-- so this only stops drizzle tracking it. SELECT 1 because MySQL rejects an
-- empty query.
SELECT 1;
