-- secret_sources moves to the secret-sources plugin's adopted table at
-- activation, after this migration runs. Dropping it here would delete the
-- data before the plugin has a chance to rename it.
SELECT 1;
