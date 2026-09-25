-- vault_profiles and vault_tokens move to the vault plugin's adopted tables
-- at activation, and ssh_data.vault_profile_id is copied into the vault
-- plugin's host settings by a boot migration after this runs. Dropping any
-- of them here would lose the data first.
SELECT 1;