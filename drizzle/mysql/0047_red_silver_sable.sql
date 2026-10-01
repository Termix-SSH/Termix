-- The ai tables moved to the ai plugin, which renames them into its own
-- namespace at activation, and ssh_data.enable_ai_assistant and the two
-- user_preferences ai columns moved to its settings. Both run after this
-- migration, so a real DROP here would delete the data first. The columns
-- stay in place, unused, until 3.0.0. The timestamp and label type changes
-- drizzle-kit also wrote are generator drift (see FINISH-LIST.md), not a
-- change to the database, and are left out on purpose.
SELECT 1;
