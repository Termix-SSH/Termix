-- The automation tables moved to the automations plugin, which renames them
-- into its own namespace at activation. That runs after this migration, so a
-- real DROP TABLE here would delete every automation first.
SELECT 1;
