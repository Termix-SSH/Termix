-- opkssh_tokens moves to the opkssh plugin's adopted table at activation,
-- and ssh_data.use_warpgate is copied into the warpgate plugin's host
-- settings by a boot migration after this runs. Dropping either here would
-- lose the data first.
SELECT 1;