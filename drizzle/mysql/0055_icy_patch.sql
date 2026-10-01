-- termix_identities, termix_identity_keys and termix_identity_ca move to the
-- termix-identity plugin's adopted tables at activation. Dropping them here
-- would lose the data first.
SELECT 1;