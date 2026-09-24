-- The ai tables moved to the ai plugin, which renames them into its own
-- namespace at activation, and ssh_data.enable_ai_assistant and the two
-- user_preferences ai columns moved to its settings. Both run after this
-- migration, so a real DROP here would delete the data first. The columns
-- stay in place, unused, until 3.0.0.
SELECT 1;
