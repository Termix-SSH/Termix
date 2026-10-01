-- webauthn_credentials moves to the webauthn plugin's adopted table at
-- activation, and the users TOTP columns are read by the TOTP boot migration
-- after this runs. Dropping either here would lose the data first.
SELECT 1;
