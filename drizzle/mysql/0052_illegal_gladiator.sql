-- sso_providers moves to the sso plugin's adopted table at activation, and
-- its LDAP rows are copied into the ldap plugin by a boot migration after
-- this runs. Dropping it here would lose the data first.
SELECT 1;
