-- ssh_data.autostart_password, autostart_key and autostart_key_password held
-- copies of a host's login for 2.8's autostart endpoint, which nothing has read
-- since. They leave the schema but stay in place, unused, until 3.0.0, so no
-- install loses what it stored.
SELECT 1;
